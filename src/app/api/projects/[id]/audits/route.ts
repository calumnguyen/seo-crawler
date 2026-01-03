import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const audits = await prisma.audit.findMany({
      where: { projectId: id },
      orderBy: {
        startedAt: 'desc',
      },
    });

    // Optimize: Get all crawl result counts in a single query using groupBy
    const auditIds = audits.map(a => a.id);
    const crawlCounts = await prisma.crawlResult.groupBy({
      by: ['auditId'],
      where: {
        auditId: { in: auditIds },
      },
      _count: {
        id: true,
      },
    });

    // Create a map for O(1) lookup
    const countMap = new Map(
      crawlCounts.map(item => [item.auditId, item._count.id])
    );

    // Merge counts with audits
    const auditsWithActualCounts = audits.map((audit) => ({
      ...audit,
      pagesCrawled: countMap.get(audit.id) || 0,
    }));

    return NextResponse.json(auditsWithActualCounts);
  } catch (error) {
    console.error('Error fetching audits:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audits' },
      { status: 500 }
    );
  }
}

