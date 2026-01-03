import { NextRequest, NextResponse } from 'next/server';
import { Job } from 'bull';
import { prisma } from '@/lib/prisma';
import { crawlQueue, CrawlJob } from '@/lib/queue';
import '@/lib/ensure-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;

    // Get audit
    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
    });

    if (!audit) {
      return NextResponse.json(
        { error: 'Audit not found' },
        { status: 404 }
      );
    }

    if (audit.status === 'completed' || audit.status === 'stopped') {
      return NextResponse.json(
        { error: `Audit is already ${audit.status}` },
        { status: 400 }
      );
    }

    // CRITICAL: Update audit status to stopped FIRST (before removing jobs)
    // This ensures active jobs will immediately see the stopped status and abort
    const actualPagesCrawled = await prisma.crawlResult.count({
      where: { auditId },
    });

    await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: 'stopped',
        completedAt: new Date(),
        pagesCrawled: actualPagesCrawled, // Update to actual count from database
      },
    });

    console.log(`[Stop] ⚠️  Audit ${auditId} marked as stopped immediately. Active jobs will abort on next status check.`);

    // Remove all jobs for this audit from the queue
    const jobs = await crawlQueue.getJobs(['waiting', 'active', 'delayed']);
    const auditJobs = jobs.filter((j: Job<CrawlJob>) => j.data?.auditId === auditId);

    let removedCount = 0;
    for (const job of auditJobs) {
      try {
        const state = await job.getState();
        if (state === 'waiting' || state === 'delayed') {
          await job.remove();
          removedCount++;
        }
        // Active jobs will check status and abort on next check
      } catch (error) {
        console.error(`Error removing job ${job.id}:`, error);
      }
    }

    console.log(`[Stop] Audit ${auditId} stopped: ${actualPagesCrawled} pages actually crawled (updated from ${audit.pagesCrawled})`);

    // Clear visited URLs cache (as requested)
    const { clearVisitedUrls } = await import('@/lib/link-follower');
    clearVisitedUrls();

    console.log(`[Stop] Audit ${auditId} stopped permanently (cannot be resumed). ${removedCount} jobs removed.`);

    return NextResponse.json({
      success: true,
      message: 'Crawl stopped successfully',
      removedJobs: removedCount,
    });
  } catch (error) {
    console.error('[Stop] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to stop crawl',
      },
      { status: 500 }
    );
  }
}

