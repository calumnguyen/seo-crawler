import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get active audits (in_progress, pending, and paused - paused can be resumed)
    const activeAudits = await prisma.audit.findMany({
      where: {
        status: {
          in: ['in_progress', 'pending', 'paused'],
        },
      },
      include: {
        project: {
          select: {
            name: true,
            domain: true,
          },
        },
        _count: {
          select: {
            crawlResults: true,
          },
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    // Get recent crawl results (last 50)
    const recentCrawls = await prisma.crawlResult.findMany({
      take: 50,
      orderBy: {
        crawledAt: 'desc',
      },
      include: {
        audit: {
          include: {
            project: {
              select: {
                name: true,
                domain: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      activeAudits,
      recentCrawls,
    });
  } catch (error) {
    console.error('Error fetching activity:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activity' },
      { status: 500 }
    );
  }
}

