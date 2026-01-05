import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeUrl } from '@/lib/robots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Get backlinks for a crawl result
 * Backlinks are links FROM other pages TO the current page
 * 
 * EFFICIENT QUERY:
 * - Finds all Link records with href matching the page URL
 * - Joins to Backlink records via linkId
 * - Returns source pages that link to this page
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the crawl result to get its URL and project
    const crawlResult = await prisma.crawlResult.findUnique({
      where: { id },
      select: {
        id: true,
        url: true,
        Audit: {
          select: {
            projectId: true,
            Project: {
              select: {
                baseUrl: true,
              },
            },
          },
        },
      },
    });

    if (!crawlResult) {
      return NextResponse.json(
        { error: 'Crawl result not found' },
        { status: 404 }
      );
    }

    const projectId = crawlResult.Audit?.projectId;
    const baseUrl = crawlResult.Audit?.Project?.baseUrl;

    if (!projectId || !baseUrl) {
      return NextResponse.json({
        backlinks: [],
        message: 'Project information not available',
      });
    }

    // Normalize the page URL for matching
    const normalizedPageUrl = normalizeUrl(crawlResult.url, baseUrl);

    // Find all Link records in ANY project that point to this page URL
    // This includes both internal links (same project) and external links (other projects)
    // This provides true SEO backlink tracking across all projects
    const linksToThisPage = await prisma.link.findMany({
      where: {
        href: normalizedPageUrl,
        // Removed projectId filter to allow cross-project backlinks
        // Removed isExternal filter to include both internal and external links
      },
      select: {
        id: true,
        crawlResultId: true,
        href: true,
        text: true,
        rel: true,
        CrawlResult: {
          select: {
            id: true,
            url: true,
            title: true,
            statusCode: true,
            crawledAt: true,
            Audit: {
              select: {
                Project: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      take: 100, // Limit to 100 backlinks for performance
    });

    // Get Backlink records for these links to get additional metadata
    // Query by projectId of the target page (this page), not the source page
    const linkIds = linksToThisPage.map(link => link.id);
    const backlinkRecords = await prisma.backlink.findMany({
      where: {
        linkId: {
          in: linkIds,
        },
        projectId: projectId, // Target project (this page's project)
      },
      select: {
        id: true,
        linkId: true,
        sourcePageId: true,
        anchorText: true,
        isDofollow: true,
        isSponsored: true,
        isUgc: true,
        discoveredAt: true,
        lastSeenAt: true,
        isActive: true,
      },
    });

    // Create a map of linkId to backlink data
    const backlinkMap = new Map<string, typeof backlinkRecords[0]>();
    for (const backlink of backlinkRecords) {
      if (backlink.linkId) {
        backlinkMap.set(backlink.linkId, backlink);
      }
    }

    // Format backlinks with source page information
    const backlinks = linksToThisPage.map(link => {
      const backlinkData = backlinkMap.get(link.id);
      return {
        id: backlinkData?.id || link.id,
        sourcePageId: link.crawlResultId,
        sourceUrl: link.CrawlResult.url,
        sourceTitle: link.CrawlResult.title,
        sourceStatusCode: link.CrawlResult.statusCode,
        anchorText: backlinkData?.anchorText || link.text,
        isDofollow: backlinkData?.isDofollow ?? true,
        isSponsored: backlinkData?.isSponsored ?? false,
        isUgc: backlinkData?.isUgc ?? false,
        discoveredAt: backlinkData?.discoveredAt || link.CrawlResult.crawledAt,
        lastSeenAt: backlinkData?.lastSeenAt || link.CrawlResult.crawledAt,
        isActive: backlinkData?.isActive ?? true,
        project: link.CrawlResult.Audit?.Project,
      };
    });

    // Remove duplicates (same source page) and sort by discoveredAt
    const uniqueBacklinks = Array.from(
      new Map(backlinks.map(bl => [bl.sourcePageId, bl])).values()
    ).sort((a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime());

    return NextResponse.json({
      backlinks: uniqueBacklinks,
      total: uniqueBacklinks.length,
      pageUrl: crawlResult.url,
      normalizedPageUrl: normalizedPageUrl,
    });
  } catch (error) {
    console.error('Error fetching backlinks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backlinks' },
      { status: 500 }
    );
  }
}

