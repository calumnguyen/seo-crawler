import { NextRequest, NextResponse } from 'next/server';
import { Job } from 'bull';
import { prisma } from '@/lib/prisma';
import { crawlQueue, CrawlJob } from '@/lib/queue';
import '@/lib/ensure-queue'; // Ensure queue processor is running

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;

    // Get audit details
    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
      include: {
        project: true,
        crawlResults: {
          take: 5,
          orderBy: { crawledAt: 'desc' },
        },
      },
    });

    if (!audit) {
      return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
    }

    // Get queue status
    const [waiting, active, completed, failed] = await Promise.all([
      crawlQueue.getWaitingCount(),
      crawlQueue.getActiveCount(),
      crawlQueue.getCompletedCount(),
      crawlQueue.getFailedCount(),
    ]);

    // Get jobs for this audit
    const allJobs = await crawlQueue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'], 0, 100);
    const auditJobs = allJobs.filter((job: Job<CrawlJob>) => job.data?.auditId === auditId);

    const jobsByState = {
      waiting: auditJobs.filter((j: Job<CrawlJob>) => j.opts?.delay && j.opts.delay > Date.now()).length,
      active: auditJobs.filter((j: Job<CrawlJob>) => {
        // Active jobs are those currently being processed
        // We can't determine this from opts alone, so we'll use getState() if needed
        // For now, we'll check if job has no delay and is not completed
        const hasDelay = j.opts?.delay && j.opts.delay > Date.now();
        return !hasDelay; // Simplified: jobs without delay are considered active/waiting
      }).length,
      completed: auditJobs.filter((j: Job<CrawlJob>) => {
        try {
          return j.finishedOn !== null;
        } catch {
          return false;
        }
      }).length,
      failed: auditJobs.filter((j: Job<CrawlJob>) => {
        try {
          return j.failedReason !== null;
        } catch {
          return false;
        }
      }).length,
    };

    // Check if queue processor is running
    const queueReady = await crawlQueue.isReady().then(() => true).catch(() => false);

    return NextResponse.json({
      audit: {
        id: audit.id,
        status: audit.status,
        pagesCrawled: audit.pagesCrawled,
        pagesTotal: audit.pagesTotal,
        // createdAt not available on Audit model, using startedAt instead
        startedAt: audit.startedAt,
        completedAt: audit.completedAt,
        project: {
          id: audit.project.id,
          domain: audit.project.domain,
          baseUrl: audit.project.baseUrl,
        },
        crawlResultsCount: audit.crawlResults.length,
      },
      queue: {
        ready: queueReady,
        global: {
          waiting,
          active,
          completed,
          failed,
        },
        forThisAudit: {
          total: auditJobs.length,
          ...jobsByState,
        },
      },
      diagnostics: {
        hasPagesTotal: audit.pagesTotal !== null && audit.pagesTotal > 0,
        hasCrawlResults: audit.crawlResults.length > 0,
        hasJobsInQueue: auditJobs.length > 0,
        queueProcessorRunning: queueReady,
      },
    });
  } catch (error) {
    console.error('[Diagnostics] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

