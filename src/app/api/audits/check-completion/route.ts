import { NextResponse } from 'next/server';
import { Job } from 'bull';
import { prisma } from '@/lib/prisma';
import '@/lib/ensure-queue'; // Ensure queue is running
import { crawlQueue, CrawlJob } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// This endpoint checks for audits that should be marked as completed
// Also auto-stops paused audits that have been paused for over 1 hour
// Call this periodically (e.g., every minute) to clean up completed audits
export async function POST() {
  // First, auto-stop paused audits that have been paused for over 14 days
  // After 14 days, paused audits become stopped and cannot be resumed
  // Note: Using startedAt as fallback since pausedAt might not be in DB yet
  try {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Get all paused audits
    // Don't use select with pausedAt - it might not be in the Prisma client yet
    const pausedAudits = await prisma.audit.findMany({
      where: {
        status: 'paused',
      },
    });

    // Filter audits that have been paused for over 14 days
    // Use pausedAt if available, otherwise use startedAt as fallback
    const auditsToStop = pausedAudits.filter((audit) => {
      // Type assertion needed because pausedAt might not be in Prisma client yet
      const auditWithPausedAt = audit as { pausedAt?: Date | null; startedAt: Date };
      const pauseTime = auditWithPausedAt.pausedAt || auditWithPausedAt.startedAt;
      return pauseTime && pauseTime <= fourteenDaysAgo;
    });

    for (const audit of auditsToStop) {
      await prisma.audit.update({
        where: { id: audit.id },
        data: {
          status: 'stopped',
          completedAt: new Date(),
        },
      });
      
      // Delete all audit logs to save space
      try {
        const { clearAuditLogs } = await import('@/lib/audit-logs');
        await clearAuditLogs(audit.id);
        console.log(`[Check-Completion] Deleted audit logs for audit ${audit.id} to save space`);
      } catch (error) {
        console.error(`[Check-Completion] Error deleting audit logs for audit ${audit.id}:`, error);
        // Don't fail if log deletion fails
      }
      
      const auditWithPausedAt = audit as { pausedAt?: Date | null };
      const pauseTime = auditWithPausedAt.pausedAt || audit.startedAt;
      const daysPaused = pauseTime ? Math.floor((Date.now() - pauseTime.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      console.log(`[Check-Completion] Auto-stopped paused audit ${audit.id} (paused for ${daysPaused} days - over 14 day limit)`);
    }
  } catch (error) {
    // Check if it's a database connection timeout
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('ETIMEDOUT') || 
                      errorMessage.includes('timeout') ||
                      (error as any)?.code === 'ETIMEDOUT';
    
    if (isTimeout) {
      // Log timeout errors at a lower level - these are usually transient
      console.warn('[Check-Completion] Database connection timeout while auto-stopping paused audits (transient):', errorMessage);
    } else {
      // Log other errors normally - pausedAt field might not exist yet
      console.error('Error auto-stopping paused audits:', error);
    }
    // Continue execution - this is a background cleanup operation
  }
  try {
    // Get all in_progress audits
    const inProgressAudits = await prisma.audit.findMany({
      where: {
        status: 'in_progress',
      },
    });

    const completed: string[] = [];

    for (const audit of inProgressAudits) {
      // Check if there are any jobs in queue for this audit
      // IMPORTANT: Include 'delayed' jobs - these are jobs waiting for their delay to expire
      const jobs = await crawlQueue.getJobs(['waiting', 'active', 'delayed'], 0, 10000);
      const auditJobs = jobs.filter((j: Job<CrawlJob>) => {
        try {
          return j && j.data && j.data.auditId === audit.id;
        } catch {
          return false;
        }
      });

      // Log queue state for debugging
      const waitingCount = auditJobs.filter(j => {
        try {
          return j.opts.delay === undefined || j.opts.delay === 0;
        } catch {
          return false;
        }
      }).length;
      const delayedCount = auditJobs.filter(j => {
        try {
          return j.opts.delay && j.opts.delay > 0;
        } catch {
          return false;
        }
      }).length;
      const activeCount = auditJobs.filter(j => {
        try {
          return j.processedOn && !j.finishedOn;
        } catch {
          return false;
        }
      }).length;
      
      console.log(`[Check-Completion] Audit ${audit.id}: ${auditJobs.length} jobs in queue (waiting: ${waitingCount}, delayed: ${delayedCount}, active: ${activeCount})`);

      // Get actual pages crawled count
      const pagesCrawled = await prisma.crawlResult.count({
        where: { auditId: audit.id },
      });
      
      // Calculate actual pagesTotal = crawled + queued_in_redis
      // This represents URLs that will be/are crawled (NOT skipped - those are already processed and won't be crawled)
      const queueCount = auditJobs.length;
      const actualPagesTotal = pagesCrawled + queueCount;
      
      // Update pagesTotal to reflect actual total (crawled + queued)
      // Skipped URLs are NOT included because they were processed but NOT crawled
      if (audit.pagesTotal !== actualPagesTotal) {
        console.log(`[Check-Completion] Updating pagesTotal for audit ${audit.id}: ${audit.pagesTotal} → ${actualPagesTotal} (crawled: ${pagesCrawled}, queued: ${queueCount})`);
        await prisma.audit.update({
          where: { id: audit.id },
          data: {
            pagesTotal: actualPagesTotal,
          },
        });
        audit.pagesTotal = actualPagesTotal;
      }

      // If no jobs in queue, check if we should mark as completed
      // BUT: Only mark as completed if:
      // 1. We have crawled at least one page
      // 2. There are no waiting, active, or delayed jobs
      // 3. pagesCrawled >= pagesTotal (all expected pages are done)
      // 4. The audit was started at least 30 seconds ago (give time for background queuing to finish)
      if (auditJobs.length === 0 && pagesCrawled > 0) {
        const startedAt = audit.startedAt ? new Date(audit.startedAt) : null;
        const thirtySecondsAgo = new Date();
        thirtySecondsAgo.setSeconds(thirtySecondsAgo.getSeconds() - 30);
        
        // Only mark as completed if:
        // - Started at least 30 seconds ago (background queuing should be done)
        // - pagesCrawled >= pagesTotal (all expected pages are done)
        // - OR pagesTotal is 0/null (no pages expected, but we crawled something)
        const shouldComplete = 
          (!startedAt || startedAt <= thirtySecondsAgo) && // Started at least 30s ago
          (audit.pagesTotal === null || audit.pagesTotal === 0 || pagesCrawled >= audit.pagesTotal);
        
        if (shouldComplete) {
          await prisma.audit.update({
            where: { id: audit.id },
            data: {
              status: 'completed',
              completedAt: new Date(),
              pagesCrawled: pagesCrawled,
              pagesTotal: Math.max(audit.pagesTotal || 0, pagesCrawled),
            },
          });
          
          // Delete all audit logs to save space
          try {
            const { clearAuditLogs } = await import('@/lib/audit-logs');
            await clearAuditLogs(audit.id);
            console.log(`[Check-Completion] Deleted audit logs for audit ${audit.id} to save space`);
          } catch (error) {
            console.error(`[Check-Completion] Error deleting audit logs for audit ${audit.id}:`, error);
            // Don't fail if log deletion fails
          }
          
          completed.push(audit.id);
          console.log(`[Check-Completion] Marked audit ${audit.id} as completed: ${pagesCrawled} pages crawled`);
        } else {
          // Log why we're not completing yet
          if (startedAt && startedAt > thirtySecondsAgo) {
            console.log(`[Check-Completion] Audit ${audit.id} not completed yet: started ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s ago (need 30s for background queuing)`);
          } else if (audit.pagesTotal && pagesCrawled < audit.pagesTotal) {
            console.log(`[Check-Completion] Audit ${audit.id} not completed yet: ${pagesCrawled}/${audit.pagesTotal} pages crawled`);
          }
        }
      }
    }

    return NextResponse.json({
      checked: inProgressAudits.length,
      completed: completed.length,
      auditIds: completed,
    });
  } catch (error) {
    console.error('Error checking audit completion:', error);
    return NextResponse.json(
      { error: 'Failed to check completion' },
      { status: 500 }
    );
  }
}

