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
      include: { project: true },
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

    // Start the crawl (will skip robots.txt check since it's approved)
    await startAutomaticCrawl(auditId, [], true); // true = skip robots.txt check

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

