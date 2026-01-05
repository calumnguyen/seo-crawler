import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeUrl } from '@/lib/robots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Get all backlinks for a project
 * Returns all backlinks where the target page belongs to this project
 * 
 * This shows all pages from other sites that link to pages in your project
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const discoveredVia = searchParams.get('discoveredVia'); // Filter by 'google', 'bing', or 'crawl'

    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        domain: true,
        baseUrl: true,
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Build where clause for backlinks
    const where: any = {
      projectId: projectId, // Backlinks TO this project
    };

    // Filter by discovery method if provided
    if (discoveredVia && ['google', 'bing', 'crawl'].includes(discoveredVia)) {
      where.discoveredVia = discoveredVia;
    }

    // Get backlinks with related data
    const [backlinks, total] = await Promise.all([
      prisma.backlink.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: {
          discoveredAt: 'desc', // Most recently discovered first
        },
        select: {
          id: true,
          sourcePageId: true,
          linkId: true,
          anchorText: true,
          isDofollow: true,
          isSponsored: true,
          isUgc: true,
          discoveredAt: true,
          lastSeenAt: true,
          isActive: true,
          discoveredVia: true,
          // Source page (the page that contains the link)
          CrawlResult: {
            select: {
              id: true,
              url: true,
              title: true,
              statusCode: true,
              crawledAt: true,
              Audit: {
                select: {
                  id: true,
                  Project: {
                    select: {
                      id: true,
                      name: true,
                      domain: true,
                    },
                  },
                },
              },
            },
          },
          // Link record (if available)
          Link: {
            select: {
              id: true,
              href: true,
              text: true,
              rel: true,
            },
          },
        },
      }),
      prisma.backlink.count({ where }),
    ]);

    // Get target pages (pages in this project that receive the backlinks)
    // We need to find which pages in this project are being linked to
    const linkIds = backlinks
      .map(bl => bl.linkId)
      .filter((id): id is string => id !== null);

    const links = linkIds.length > 0
      ? await prisma.link.findMany({
          where: {
            id: { in: linkIds },
          },
          select: {
            id: true,
            href: true,
            crawlResultId: true,
            CrawlResult: {
              select: {
                id: true,
                url: true,
                title: true,
                statusCode: true,
              },
            },
          },
        })
      : [];

    const linkMap = new Map(links.map(link => [link.id, link]));

    // Format backlinks with target page information
    const formattedBacklinks = backlinks.map(backlink => {
      const link = backlink.linkId ? linkMap.get(backlink.linkId) : null;
      const targetPage = link?.CrawlResult;

      return {
        id: backlink.id,
        // Source page (where the link comes from)
        sourcePage: {
          id: backlink.CrawlResult.id,
          url: backlink.CrawlResult.url,
          title: backlink.CrawlResult.title,
          statusCode: backlink.CrawlResult.statusCode,
          crawledAt: backlink.CrawlResult.crawledAt,
          project: backlink.CrawlResult.Audit?.Project,
        },
        // Target page (the page in this project that receives the backlink)
        targetPage: targetPage
          ? {
              id: targetPage.id,
              url: targetPage.url,
              title: targetPage.title,
              statusCode: targetPage.statusCode,
            }
          : null,
        // Link details
        anchorText: backlink.anchorText || backlink.Link?.text || null,
        href: backlink.Link?.href || (targetPage ? targetPage.url : null),
        isDofollow: backlink.isDofollow,
        isSponsored: backlink.isSponsored,
        isUgc: backlink.isUgc,
        discoveredAt: backlink.discoveredAt,
        lastSeenAt: backlink.lastSeenAt,
        isActive: backlink.isActive,
        discoveredVia: backlink.discoveredVia || 'crawl',
      };
    });

    // Get summary statistics
    const stats = await prisma.backlink.groupBy({
      by: ['discoveredVia'],
      where: {
        projectId: projectId,
      },
      _count: {
        id: true,
      },
    });

    const statsByMethod = {
      google: stats.find(s => s.discoveredVia === 'google')?._count.id || 0,
      bing: stats.find(s => s.discoveredVia === 'bing')?._count.id || 0,
      crawl: stats.find(s => s.discoveredVia === 'crawl')?._count.id || 0,
      total: total,
    };

    return NextResponse.json({
      backlinks: formattedBacklinks,
      total,
      limit,
      offset,
      project: {
        id: project.id,
        name: project.name,
        domain: project.domain,
      },
      stats: statsByMethod,
    });
  } catch (error) {
    console.error('Error fetching project backlinks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project backlinks' },
      { status: 500 }
    );
  }
}

