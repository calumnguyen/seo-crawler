import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get active audits (in_progress, pending, paused, and pending_approval - paused can be resumed, pending_approval needs approval)
    const activeAudits = await prisma.audit.findMany({
      where: {
        status: {
          in: ['in_progress', 'pending', 'paused', 'pending_approval'],
        },
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            domain: true,
          },
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    // Calculate actual pagesCrawled from database count for each audit
    const activeAuditsWithActualCounts = await Promise.all(
      activeAudits.map(async (audit) => {
        const actualPagesCrawled = await prisma.crawlResult.count({
          where: { auditId: audit.id },
        });
        return {
          ...audit,
          pagesCrawled: actualPagesCrawled,
        };
      })
    );

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
      activeAudits: activeAuditsWithActualCounts,
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

