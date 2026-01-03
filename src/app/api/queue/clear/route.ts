import { NextResponse } from 'next/server';
import { crawlQueue } from '@/lib/queue';
import '@/lib/ensure-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Clear ALL jobs from Redis queue
export async function POST() {
  try {
    console.log('[Clear] Starting queue clear...');
    
    // Wait for queue to be ready
    await crawlQueue.isReady();
    console.log('[Clear] Queue is ready');
    
    // First, empty the queue completely (this is the fastest way)
    // This removes all jobs in one operation
    console.log('[Clear] Emptying queue...');
    await crawlQueue.empty();
    console.log('[Clear] Queue emptied');
    
    // Clean up any remaining jobs in all states (with timeout)
    console.log('[Clear] Cleaning job states...');
    try {
      await Promise.race([
        Promise.all([
          crawlQueue.clean(0, 'completed', 10000),
          crawlQueue.clean(0, 'failed', 10000),
          crawlQueue.clean(0, 'active', 10000),
          crawlQueue.clean(0, 'delayed', 10000),
        ]),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Clean operation timeout')), 10000)
        ),
      ]);
      console.log('[Clear] Cleaned all job states');
    } catch (error) {
      console.warn('[Clear] Clean operation timed out or failed:', error);
      // Continue anyway - empty() should have cleared most jobs
    }

    // Get final counts
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      crawlQueue.getWaitingCount(),
      crawlQueue.getActiveCount(),
      crawlQueue.getCompletedCount(),
      crawlQueue.getFailedCount(),
      crawlQueue.getDelayedCount(),
    ]);
    
    console.log('[Clear] Final counts:', { waiting, active, completed, failed, delayed });

    return NextResponse.json({
      success: true,
      message: 'Redis queue cleared',
      remaining: {
        waiting,
        active,
        completed,
        failed,
        delayed,
      },
    });
  } catch (error) {
    console.error('Error clearing queue:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

