import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import '@/lib/ensure-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// This endpoint should be called periodically (e.g., every hour)
// It auto-stops paused audits that have been paused for over 14 days
// After 14 days, paused audits become stopped and cannot be resumed
export async function POST() {
  try {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Find paused audits that have been paused for over 14 days
    const pausedAudits = await prisma.audit.findMany({
      where: {
        status: 'paused',
      },
    });

    // Filter audits that have been paused for over 14 days
    // Use pausedAt if available, otherwise use startedAt as fallback
    const auditsToStop = pausedAudits.filter((audit: { id: string; pausedAt: Date | null; startedAt: Date }) => {
      // Type assertion needed because pausedAt might not be in Prisma client yet
      const auditWithPausedAt = audit as { pausedAt?: Date | null };
      const pauseTime = auditWithPausedAt.pausedAt || audit.startedAt;
      return pauseTime && pauseTime <= fourteenDaysAgo;
    });

    const stopped: string[] = [];

    for (const audit of auditsToStop) {
      // CRITICAL: Recalculate pagesCrawled from actual database count before stopping
      const actualPagesCrawled = await prisma.crawlResult.count({
        where: { auditId: audit.id },
      });

      // Update to stopped status (cannot be resumed after this)
      await prisma.audit.update({
        where: { id: audit.id },
        data: {
          status: 'stopped',
          completedAt: new Date(),
          pagesCrawled: actualPagesCrawled, // Update to actual count from database
        },
      });
      
      // Delete all audit logs to save space
      try {
        const { clearAuditLogs } = await import('@/lib/audit-logs');
        await clearAuditLogs(audit.id);
        console.log(`[Auto-Stop] Deleted audit logs for audit ${audit.id} to save space`);
      } catch (error) {
        console.error(`[Auto-Stop] Error deleting audit logs for audit ${audit.id}:`, error);
        // Don't fail if log deletion fails
      }
      
      stopped.push(audit.id);
      const auditWithPausedAt = audit as { pausedAt?: Date | null };
      const pauseTime = auditWithPausedAt.pausedAt || audit.startedAt;
      const daysPaused = pauseTime ? Math.floor((Date.now() - pauseTime.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      console.log(`[Auto-Stop] Auto-stopped paused audit ${audit.id} (paused for ${daysPaused} days - over 14 day limit): ${actualPagesCrawled} pages actually crawled (updated from ${audit.pagesCrawled})`);
    }

    return NextResponse.json({
      checked: pausedAudits.length,
      stopped: stopped.length,
      auditIds: stopped,
    });
  } catch (error) {
    // Check if it's a database connection timeout
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('ETIMEDOUT') || 
                      errorMessage.includes('timeout') ||
                      (error as any)?.code === 'ETIMEDOUT';
    
    if (isTimeout) {
      console.error('[Auto-Stop-Paused] Database connection timeout - this is usually transient:', errorMessage);
      return NextResponse.json(
        { 
          error: 'Database connection timeout',
          message: 'The database connection timed out. Please try again in a moment.',
          retryable: true 
        },
        { status: 503 } // Service Unavailable - indicates temporary issue
      );
    }
    
    console.error('Error auto-stopping paused audits:', error);
    return NextResponse.json(
      { error: 'Failed to auto-stop paused audits' },
      { status: 500 }
    );
  }
}

