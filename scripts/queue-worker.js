#!/usr/bin/env node

/**
 * Queue Worker Script
 * 
 * This script runs the queue processor as a separate process.
 * Use this if you're deploying to serverless (Vercel, Netlify) where
 * API routes terminate after each request.
 * 
 * Usage:
 *   node scripts/queue-worker.js
 * 
 * Or with PM2:
 *   pm2 start scripts/queue-worker.js --name crawl-worker
 */

// Load environment variables
require('dotenv').config();

console.log('🚀 Starting queue worker...');
console.log('📦 Loading queue processor...');

// Import the queue module - this will initialize the processor
// The processor will automatically start processing jobs from Redis
try {
  require('../src/lib/queue');
  console.log('✅ Queue processor loaded successfully');
  console.log('⏳ Waiting for jobs to process...');
  console.log('💡 Jobs will be processed automatically as they are queued');
  console.log('');
  console.log('Press Ctrl+C to stop the worker');
} catch (error) {
  console.error('❌ Failed to load queue processor:', error);
  process.exit(1);
}

// Keep the process alive
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  // Don't exit - let the queue processor handle it
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
  // Don't exit - let the queue processor handle it
});


