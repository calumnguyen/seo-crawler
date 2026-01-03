import { NextResponse } from 'next/server';
import { Job } from 'bull';
import '@/lib/ensure-queue'; // Ensure queue is running
import { crawlQueue, CrawlJob } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get queue stats
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      crawlQueue.getWaitingCount(),
      crawlQueue.getActiveCount(),
      crawlQueue.getCompletedCount(),
      crawlQueue.getFailedCount(),
      crawlQueue.getDelayedCount(),
    ]);

    // Get jobs from all states to see what's actually in the queue
    const [waitingJobs, activeJobs, delayedJobs] = await Promise.all([
      crawlQueue.getJobs(['waiting'], 0, 100),
      crawlQueue.getJobs(['active'], 0, 100),
      crawlQueue.getJobs(['delayed'], 0, 100),
    ]);

    // Analyze delayed jobs to see when they'll be available
    const delayedJobsInfo = delayedJobs.slice(0, 10).map((job: Job<CrawlJob>) => {
      const delay = job.opts?.delay || 0;
      const now = Date.now();
      const timestamp = job.timestamp || now;
      const availableAt = timestamp + delay;
      const timeUntilAvailable = Math.max(0, availableAt - now);
      
      return {
        id: String(job.id),
        url: job.data?.url || '',
        auditId: job.data?.auditId || '',
        delay: delay,
        timestamp: timestamp,
        availableAt: availableAt,
        timeUntilAvailable: timeUntilAvailable,
        availableIn: `${Math.round(timeUntilAvailable / 1000)}s`,
      };
    });

    return NextResponse.json({
      status: 'ok',
      queue: {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + delayed,
      },
      jobs: {
        waiting: waitingJobs.length,
        active: activeJobs.length,
        delayed: delayedJobs.length,
      },
      delayedJobsSample: delayedJobsInfo,
      recentJobs: await Promise.all(
        [...waitingJobs, ...activeJobs, ...delayedJobs].slice(0, 10).map(async (job) => ({
          id: job.id,
          data: job.data,
          state: await job.getState(),
          progress: job.progress,
          delay: job.opts.delay,
        }))
      ),
    });
  } catch (error) {
    console.error('Error getting queue status:', error);
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

