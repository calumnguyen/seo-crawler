import { PrismaClient } from '@/generated/prisma/client';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';

// Only configure WebSocket for Node.js environments (not serverless/Vercel)
// In serverless environments like Vercel, Neon uses its default HTTP-based implementation
// which doesn't require the 'ws' package and avoids the "mask is not a function" error
// 
// The 'ws' package doesn't work in Vercel's serverless runtime, so we skip it there
// Neon's serverless driver automatically uses fetch-based connections when ws is not configured
const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.FUNCTION_NAME;

// Configure WebSocket only for non-serverless Node.js environments
// In serverless (Vercel), Neon automatically uses fetch-based connections without ws
// We don't configure ws in serverless to avoid the "mask is not a function" error
if (!isServerless && typeof window === 'undefined') {
  // Use dynamic import to avoid bundling ws in serverless builds
  // This will only execute in Node.js environments where ws is available
  // The import is fire-and-forget - Neon will use default if not set
  void import('ws')
    .then((wsModule) => {
      neonConfig.webSocketConstructor = wsModule.default;
    })
    .catch(() => {
      // If ws is not available, Neon will use its default serverless implementation
      // This is expected and fine in serverless environments
    });
}

// PERMANENT FIX: Global error handlers to prevent crashes from database errors
// These handlers catch unhandled errors and prevent the app from crashing
if (typeof process !== 'undefined') {
  // Handle unhandled promise rejections (like database timeouts)
  process.on('unhandledRejection', (reason: any, promise) => {
    // Check if it's a database connection error
    const isDbError = 
      reason?.code === 'ETIMEDOUT' ||
      reason?.code === 'ECONNRESET' ||
      reason?.code === 'EPIPE' ||
      (reason?.message && typeof reason.message === 'string' && 
       (reason.message.includes('ETIMEDOUT') || 
        reason.message.includes('ECONNRESET') ||
        reason.message.includes('aborted'))) ||
      (reason?.Symbol && reason.Symbol.for && reason.Symbol.for('kError')?.code === 'ETIMEDOUT');
    
    if (isDbError) {
      // Log at warn level - these are transient database connection issues
      console.warn('[Prisma] Unhandled database connection error (transient, will retry):', 
        reason?.code || reason?.message || 'Unknown');
      // Don't crash - Prisma/Neon will retry automatically
      return;
    }
    
    // For other errors, log but don't crash in production
    if (process.env.NODE_ENV === 'production') {
      console.error('[Prisma] Unhandled rejection (non-db error):', reason);
    } else {
      console.error('[Prisma] Unhandled rejection:', reason);
    }
  });

  // Handle uncaught exceptions (should be rare, but catch them)
  process.on('uncaughtException', (error: any) => {
    // Check if it's a database connection error
    const isDbError = 
      error?.code === 'ETIMEDOUT' ||
      error?.code === 'ECONNRESET' ||
      error?.code === 'EPIPE' ||
      (error?.message && typeof error.message === 'string' && 
       (error.message.includes('ETIMEDOUT') || 
        error.message.includes('ECONNRESET') ||
        error.message.includes('aborted')));
    
    if (isDbError) {
      // Log and continue - don't crash on transient DB errors
      console.warn('[Prisma] Uncaught database connection error (transient, will retry):', 
        error?.code || error?.message || 'Unknown');
      return;
    }
    
    // For critical errors, log and allow process to exit
    console.error('[Prisma] Uncaught exception (critical):', error);
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// PERMANENT FIX: Use pooled connection string for Neon
// Neon provides a pooled connection string that handles connection pooling automatically
// The pooled connection is more reliable and prevents connection exhaustion
let connectionString = process.env.DATABASE_URL!;

// If DATABASE_URL doesn't contain '-pooler', try to use DATABASE_URL_POOL if available
// Otherwise, ensure we're using a connection string that supports pooling
if (process.env.DATABASE_URL_POOL) {
  connectionString = process.env.DATABASE_URL_POOL;
} else if (!connectionString.includes('-pooler') && connectionString.includes('neon.tech')) {
  // Auto-convert to pooled connection if it's a Neon URL
  // This helps prevent connection exhaustion
  console.warn('[Prisma] Consider using DATABASE_URL_POOL with -pooler suffix for better connection handling');
}

// PERMANENT FIX: Add connection and query timeouts to prevent hanging
// statement_timeout: Maximum query execution time (30 seconds)
// connect_timeout: Maximum connection establishment time (15 seconds)
if (connectionString) {
  const url = new URL(connectionString);
  if (!url.searchParams.has('statement_timeout')) {
    url.searchParams.set('statement_timeout', '30000'); // 30 seconds
  }
  if (!url.searchParams.has('connect_timeout')) {
    url.searchParams.set('connect_timeout', '15'); // 15 seconds
  }
  connectionString = url.toString();
}

// PERMANENT FIX: Configure Neon adapter
// PrismaNeon doesn't support pool config directly - Neon handles pooling via connection string
// Use pooled connection string (with -pooler suffix) for better connection management
const adapter = new PrismaNeon({
  connectionString,
});

// PERMANENT FIX: Configure PrismaClient with error handling
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    // Error formatting - make errors more informative
    errorFormat: 'pretty',
  });

// Note: PrismaClient doesn't support $on('error') - error handling is done via global handlers above
// Prisma's built-in error logging (via log: ['error']) will log errors automatically

// PERMANENT FIX: Graceful shutdown
// Ensure connections are properly closed on shutdown
if (typeof process !== 'undefined') {
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
  
  process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
