import { NextResponse } from 'next/server';
import '@/lib/ensure-queue'; // Ensure queue is running
import { crawlQueue } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    console.log('[Test] REDIS_URL:', process.env.REDIS_URL ? 'Set' : 'Not set');
    
    // Test Redis connection with timeout
    const connectionTest = Promise.race([
      crawlQueue.isReady(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 5 seconds')), 5000)
      ),
    ]);
    
    await connectionTest;
    
    // Get queue stats
    const [waiting, active, completed, failed] = await Promise.all([
      crawlQueue.getWaitingCount(),
      crawlQueue.getActiveCount(),
      crawlQueue.getCompletedCount(),
      crawlQueue.getFailedCount(),
    ]);

    // Try to add a test job
    const testJob = await crawlQueue.add(
      { url: 'https://example.com', auditId: 'test' },
      { 
        priority: 1,
        removeOnComplete: true, 
        removeOnFail: true 
      }
    );

    // Remove test job immediately
    await testJob.remove();

    return NextResponse.json({
      status: 'ok',
      redis: 'connected',
      redisUrl: process.env.REDIS_URL ? 'Set (hidden)' : 'Not set',
      queue: {
        waiting,
        active,
        completed,
        failed,
      },
      message: 'Redis and queue are working!',
    });
  } catch (error) {
    console.error('[Test] Redis test failed:', error);
    return NextResponse.json(
      {
        status: 'error',
        redis: 'disconnected',
        redisUrl: process.env.REDIS_URL ? 'Set (but connection failed)' : 'Not set in .env',
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Redis connection failed. Check your REDIS_URL in .env file.',
        hint: process.env.REDIS_URL 
          ? 'REDIS_URL is set but connection failed. Check if Redis server is running.'
          : 'REDIS_URL is not set. Add it to your .env file.',
      },
      { status: 500 }
    );
  }
}

