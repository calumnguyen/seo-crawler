import { NextRequest, NextResponse } from 'next/server';
import { crawlQueue } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import '@/lib/ensure-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Force stop all jobs for a specific audit (or all audits if auditId not provided)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { auditId } = body;

    // Get all jobs
    const allJobs = await crawlQueue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'], 0, 50000);
    
    let removedCount = 0;
    let skippedCount = 0;

    for (const job of allJobs) {
      try {
        // If auditId provided, only remove jobs for that audit
        if (auditId && job.data?.auditId !== auditId) {
          continue;
        }

        const state = await job.getState();
        
        // Remove waiting/delayed jobs
        if (state === 'waiting' || state === 'delayed') {
          await job.remove();
          removedCount++;
        } else if (state === 'active') {
          // Active jobs can't be removed, but we can mark them to skip
          // They'll complete but won't save results if audit is deleted
          console.log(`[Force-Stop] Job ${job.id} is active, will skip on completion`);
          skippedCount++;
        }
      } catch (error) {
        // Job might already be removed or invalid
        console.error(`Error removing job ${job.id}:`, error);
      }
    }

    // If auditId provided, also mark audit as stopped
    if (auditId) {
      try {
        const audit = await prisma.audit.findUnique({
          where: { id: auditId },
        });

        if (audit && (audit.status === 'in_progress' || audit.status === 'paused')) {
          // CRITICAL: Recalculate pagesCrawled from actual database count before stopping
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

          console.log(`[Force-Stop] Audit ${auditId} stopped: ${actualPagesCrawled} pages actually crawled (updated from ${audit.pagesCrawled})`);
        }
      } catch (error) {
        // Audit might not exist (already deleted)
        console.log(`[Force-Stop] Audit ${auditId} not found or already deleted`);
      }
    }

    // Get final counts
    const [waiting, active, completed, failed] = await Promise.all([
      crawlQueue.getWaitingCount(),
      crawlQueue.getActiveCount(),
      crawlQueue.getCompletedCount(),
      crawlQueue.getFailedCount(),
    ]);

    return NextResponse.json({
      success: true,
      message: auditId 
        ? `Force stopped all jobs for audit ${auditId}`
        : 'Force stopped all jobs',
      removedJobs: removedCount,
      activeJobsSkipped: skippedCount,
      remaining: {
        waiting,
        active,
        completed,
        failed,
      },
    });
  } catch (error) {
    console.error('Error force stopping jobs:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

