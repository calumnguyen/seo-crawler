import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        audits: {
          orderBy: {
            startedAt: 'desc',
          },
          take: 10, // Latest 10 audits per project
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
            pagesCrawled: true,
            pagesTotal: true,
          },
        },
        _count: {
          select: {
            audits: true,
            backlinks: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Optimize: Get all crawl result counts in a single query using groupBy
    // Collect all audit IDs from all projects
    const allAuditIds = projects.flatMap(project => 
      project.audits.map(audit => audit.id)
    );

    // Single query to get all counts
    const crawlCounts = allAuditIds.length > 0 ? await prisma.crawlResult.groupBy({
      by: ['auditId'],
      where: {
        auditId: { in: allAuditIds },
      },
      _count: {
        id: true,
      },
    }) : [];

    // Create a map for O(1) lookup
    const countMap = new Map(
      crawlCounts.map(item => [item.auditId, item._count.id])
    );

    // Merge counts with audits for each project
    const projectsWithActualCounts = projects.map((project) => ({
      ...project,
      audits: project.audits.map((audit) => ({
        ...audit,
        pagesCrawled: countMap.get(audit.id) || 0,
      })),
    }));

    return NextResponse.json(projectsWithActualCounts);
  } catch (error) {
    console.error('Error fetching projects with audits:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

