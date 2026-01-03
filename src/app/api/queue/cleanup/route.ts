import { NextResponse } from 'next/server';
import { Job } from 'bull';
import { crawlQueue } from '@/lib/queue';
import '@/lib/ensure-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Manual cleanup endpoint to reduce Redis memory usage
export async function POST() {
  try {
    // Clean up old completed jobs
    const completedJobs = await crawlQueue.getJobs(['completed'], 0, 1000);
    const oldCompleted = completedJobs.filter((job: Job) => {
      const age = Date.now() - (job.finishedOn || 0);
      return age > 3600000; // Older than 1 hour
    });

    // Clean up old failed jobs
    const failedJobs = await crawlQueue.getJobs(['failed'], 0, 1000);
    const oldFailed = failedJobs.filter((job: Job) => {
      const age = Date.now() - (job.failedReason ? Date.now() : 0);
      return age > 86400000; // Older than 24 hours
    });

    // Remove old jobs
    let removedCompleted = 0;
    let removedFailed = 0;

    for (const job of oldCompleted.slice(0, 500)) {
      try {
        await job.remove();
        removedCompleted++;
      } catch (error) {
        // Job might already be removed
      }
    }

    for (const job of oldFailed.slice(0, 100)) {
      try {
        await job.remove();
        removedFailed++;
      } catch (error) {
        // Job might already be removed
      }
    }

    // Get current queue stats
    const [waiting, active, completed, failed] = await Promise.all([
      crawlQueue.getWaitingCount(),
      crawlQueue.getActiveCount(),
      crawlQueue.getCompletedCount(),
      crawlQueue.getFailedCount(),
    ]);

    return NextResponse.json({
      success: true,
      removed: {
        completed: removedCompleted,
        failed: removedFailed,
      },
      current: {
        waiting,
        active,
        completed,
        failed,
      },
      message: `Cleaned up ${removedCompleted} completed and ${removedFailed} failed jobs`,
    });
  } catch (error) {
    console.error('Error cleaning up queue:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

