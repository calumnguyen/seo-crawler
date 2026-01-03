import { PrismaClient } from '@prisma/client';
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

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const connectionString = process.env.DATABASE_URL!;

const adapter = new PrismaNeon({
  connectionString,
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

