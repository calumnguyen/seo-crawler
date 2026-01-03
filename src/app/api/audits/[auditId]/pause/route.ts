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

    if (audit.status !== 'in_progress') {
      return NextResponse.json(
        { error: `Cannot pause audit with status: ${audit.status}` },
        { status: 400 }
      );
    }

    // Pause all jobs for this audit in the queue
    // Get all jobs (waiting, delayed, active, completed, failed)
    const allJobs = await crawlQueue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed'], 0, 10000);
    const auditJobs = allJobs.filter((j: Job<CrawlJob>) => {
      try {
        return j && j.data && j.data.auditId === auditId;
      } catch {
        return false;
      }
    });

    let removedCount = 0;
    let activeCount = 0;
    
    for (const job of auditJobs) {
      try {
        const state = await job.getState();
        
        // Remove waiting/delayed jobs (will be re-queued on resume)
        if (state === 'waiting' || state === 'delayed') {
          await job.remove();
          removedCount++;
        } else if (state === 'active') {
          // Active jobs can't be stopped, but they won't queue new links
          // because the queue processor checks audit status before queuing
          activeCount++;
          console.log(`[Pause] Job ${job.id} is active and will complete, but won't queue new links`);
        }
      } catch (error) {
        console.error(`[Pause] Error processing job ${job.id}:`, error);
      }
    }
    
    console.log(`[Pause] Removed ${removedCount} waiting/delayed jobs, ${activeCount} active jobs will complete`);

    // Update audit status to paused
    // NOTE: Paused audits can be resumed, but if not resumed within 14 days,
    // they will be automatically converted to stopped (cannot be resumed)
    await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: 'paused',
        pausedAt: new Date(),
      },
    });

    // Clear visited URLs cache (as requested)
    const { clearVisitedUrls } = await import('@/lib/link-follower');
    clearVisitedUrls();

    console.log(`[Pause] Audit ${auditId} paused. ${auditJobs.length} jobs affected.`);

    return NextResponse.json({
      success: true,
      message: 'Crawl paused successfully',
      pausedJobs: auditJobs.length,
    });
  } catch (error) {
    console.error('[Pause] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to pause crawl',
      },
      { status: 500 }
    );
  }
}

