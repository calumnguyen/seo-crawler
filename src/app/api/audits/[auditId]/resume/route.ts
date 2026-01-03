import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { startAutomaticCrawl } from '@/lib/auto-crawl';
import '@/lib/ensure-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;

    // Get audit and project
    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
      include: { project: true },
    });

    if (!audit) {
      return NextResponse.json(
        { error: 'Audit not found' },
        { status: 404 }
      );
    }

    // Only allow resuming PAUSED audits (not stopped - stopped cannot be resumed)
    if (audit.status !== 'paused') {
      return NextResponse.json(
        { error: `Cannot resume audit with status: ${audit.status}. Only paused audits can be resumed. Stopped audits cannot be resumed.` },
        { status: 400 }
      );
    }

    // Check if we should skip recently crawled pages (within 14 days)
    // For resume, check the CURRENT audit's crawl results, not a completed audit
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Get crawl results from the CURRENT audit (the one being resumed)
    const currentAuditResults = await prisma.crawlResult.findMany({
      where: {
        auditId: auditId,
      },
      select: {
        url: true,
        crawledAt: true,
      },
    });

    // Check when this audit was started (not completed, since it was paused)
    const auditStartedAt = audit.startedAt;
    const timeSinceStart = auditStartedAt ? Date.now() - auditStartedAt.getTime() : 0;
    const daysSinceStart = timeSinceStart / (1000 * 60 * 60 * 24);

    // Determine if we should skip recently crawled URLs
    // Only skip if the audit was started less than 14 days ago
    const shouldSkipRecent = daysSinceStart < 14 && currentAuditResults.length > 0;

    if (shouldSkipRecent) {
      console.log(`[Resume] Audit was started ${daysSinceStart.toFixed(1)} days ago. Will skip recently crawled URLs (${currentAuditResults.length} URLs already crawled).`);
    } else {
      console.log(`[Resume] Audit was started ${daysSinceStart.toFixed(1)} days ago or has no results. Will recrawl all URLs.`);
    }

    // Store skip logic - get URLs that were crawled within 14 days from THIS audit
    const skipRecentUrls = shouldSkipRecent 
      ? currentAuditResults
          .filter((cr: { url: string; crawledAt: Date }) => cr.crawledAt > fourteenDaysAgo)
          .map((cr: { url: string; crawledAt: Date }) => cr.url)
      : [];

    // Resume the crawl with smart URL skipping
    // Pass allowResume=true to allow resuming paused/stopped audits
    // This will re-queue URLs from sitemaps, skipping recently crawled ones
    await startAutomaticCrawl(auditId, skipRecentUrls, false, true);

    return NextResponse.json({
      success: true,
      message: 'Crawl resumed successfully',
      skipRecentUrls: shouldSkipRecent,
      skippedCount: skipRecentUrls.length,
    });
  } catch (error) {
    console.error('[Resume] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to resume crawl',
      },
      { status: 500 }
    );
  }
}

