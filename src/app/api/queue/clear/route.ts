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
          crawlQueue.clean(0, 'delayed', 10000),
        ]),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Clean operation timeout')), 10000)
        ),
      ]);
      console.log('[Clear] Cleaned completed/failed/delayed jobs');
    } catch (error) {
      console.warn('[Clear] Clean operation timed out or failed:', error);
      // Continue anyway - empty() should have cleared most jobs
    }

    // Force-remove stuck active jobs (jobs that have been active for more than 5 minutes)
    // Active jobs can't be removed normally, but we can fail them if they're stuck
    console.log('[Clear] Checking for stuck active jobs...');
    try {
      const activeJobs = await crawlQueue.getJobs(['active'], 0, 100);
      let removedStuck = 0;
      
      for (const job of activeJobs) {
        try {
          const processedOn = job.processedOn || 0;
          const age = Date.now() - processedOn;
          const fiveMinutes = 5 * 60 * 1000;
          
          // If job has been active for more than 5 minutes, it's likely stuck
          if (age > fiveMinutes) {
            console.log(`[Clear] Attempting to remove stuck active job ${job.id} (active for ${Math.round(age / 1000)}s): ${job.data?.url}`);
            try {
              // Try to remove directly - might work if lock has expired
              // Active jobs can't normally be removed, but if they're stuck long enough, the lock may have expired
              await job.remove();
              console.log(`[Clear] Successfully removed stuck job ${job.id}`);
              removedStuck++;
            } catch (removeError) {
              // If remove fails, the job is still locked (being processed)
              // It will eventually timeout when lock expires (2 minutes) or when worker completes
              console.warn(`[Clear] Could not remove stuck job ${job.id} - still locked. It will timeout when lock expires (${Math.round((120000 - age) / 1000)}s remaining) or complete naturally.`);
            }
          }
        } catch (jobError) {
          console.warn(`[Clear] Error removing stuck job ${job.id}:`, jobError);
        }
      }
      
      if (removedStuck > 0) {
        console.log(`[Clear] Removed ${removedStuck} stuck active job(s)`);
      }
    } catch (error) {
      console.warn('[Clear] Error checking for stuck active jobs:', error);
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

