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

    // Delete all audit logs to save space
    try {
      const { clearAuditLogs } = await import('@/lib/audit-logs');
      await clearAuditLogs(auditId);
      console.log(`[Stop] Deleted audit logs for audit ${auditId} to save space`);
    } catch (error) {
      console.error(`[Stop] Error deleting audit logs for audit ${auditId}:`, error);
      // Don't fail the request if log deletion fails
    }

    console.log(`[Stop] ⚠️  Audit ${auditId} marked as stopped immediately. Active jobs will abort on next status check.`);

    // Return immediately - process job removal asynchronously to avoid blocking
    // This prevents the API from hanging when there are many jobs
    (async () => {
      try {
        // Set a timeout to prevent this from running too long
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Job removal timeout')), 30000) // 30 second timeout
        );

        const removeJobsPromise = (async () => {
          // Remove all jobs for this audit from the queue
          // Limit to reasonable number to avoid memory issues
          const jobs = await crawlQueue.getJobs(['waiting', 'active', 'delayed'], 0, 10000);
          const auditJobs = jobs.filter((j: Job<CrawlJob>) => j.data?.auditId === auditId);

          let removedCount = 0;
          let activeCount = 0;
          
          for (const job of auditJobs) {
            try {
              const state = await job.getState();
              if (state === 'waiting' || state === 'delayed') {
                await job.remove();
                removedCount++;
              } else if (state === 'active') {
                // Try to cancel active jobs (Bull doesn't support this directly, but we can mark them)
                // Active jobs will check status and abort on next check
                activeCount++;
              }
            } catch (error) {
              console.error(`[Stop] Error processing job ${job.id}:`, error);
            }
          }

          console.log(`[Stop] Audit ${auditId} stopped: ${actualPagesCrawled} pages actually crawled (updated from ${audit.pagesCrawled})`);
          console.log(`[Stop] Audit ${auditId} stopped permanently (cannot be resumed). ${removedCount} jobs removed, ${activeCount} active jobs will abort on next check.`);

          // Clear visited URLs cache (as requested)
          const { clearVisitedUrls } = await import('@/lib/link-follower');
          clearVisitedUrls();
        })();

        await Promise.race([removeJobsPromise, timeoutPromise]);
      } catch (error) {
        // Log error but don't fail the request - audit is already marked as stopped
        console.error(`[Stop] Error removing jobs for audit ${auditId} (background):`, error);
        console.log(`[Stop] Audit ${auditId} is marked as stopped. Active jobs will abort on next status check.`);
      }
    })();

    // Return immediately - don't wait for job removal
    return NextResponse.json({
      success: true,
      message: 'Crawl stopped successfully. Jobs are being removed in the background.',
      removedJobs: 'processing', // Indicate that removal is in progress
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

