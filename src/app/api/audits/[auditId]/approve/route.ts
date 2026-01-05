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

    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
      include: { Project: true },
    });

    if (!audit) {
      return NextResponse.json(
        { error: 'Audit not found' },
        { status: 404 }
      );
    }

    if (audit.status !== 'pending_approval') {
      return NextResponse.json(
        { error: `Cannot approve audit with status: ${audit.status}` },
        { status: 400 }
      );
    }

    // Update status to in_progress before starting crawl (so UI updates immediately)
    await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: 'in_progress',
        startedAt: new Date(),
      },
    });

    // Start the crawl (will skip robots.txt check since it's approved)
    // Don't await - let it run in background so API responds immediately
    startAutomaticCrawl(auditId, [], true).catch((error) => {
      console.error('[API] Error in approved crawl start:', error);
      // Update status to failed if crawl fails to start
      prisma.audit.update({
        where: { id: auditId },
        data: { status: 'failed' },
      }).catch((updateError) => {
        console.error('[API] Failed to update audit status to failed:', updateError);
      });
    });

    return NextResponse.json({
      success: true,
      message: 'Crawl approved and started',
    });
  } catch (error) {
    console.error('[API] Error approving crawl:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to approve crawl',
      },
      { status: 500 }
    );
  }
}

