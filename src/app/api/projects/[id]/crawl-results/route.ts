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

    // Get the project to find the domain/baseUrl
    const project = await prisma.project.findUnique({
      where: { id },
      select: { domain: true, baseUrl: true },
    });

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Extract domain from baseUrl for comparison
    let projectDomain: string;
    try {
      const baseUrlObj = new URL(project.baseUrl);
      projectDomain = baseUrlObj.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      projectDomain = project.domain.toLowerCase();
    }

    // Get all crawl results for audits belonging to this project
    const allCrawlResults = await prisma.crawlResult.findMany({
      where: {
        Audit: {
          projectId: id,
        },
      },
      orderBy: {
        crawledAt: 'desc',
      },
      select: {
        id: true,
        url: true,
        statusCode: true,
        title: true,
        metaDescription: true,
        crawledAt: true,
        responseTimeMs: true,
        h1Count: true,
        h2Count: true,
        h3Count: true,
        imagesCount: true,
        internalLinksCount: true,
        externalLinksCount: true,
        completenessScore: true,
        auditId: true,
      },
    });

    // Filter to only include pages from the project's domain (exclude external backlink pages)
    const crawlResults = allCrawlResults.filter((result) => {
      try {
        const urlObj = new URL(result.url);
        const resultDomain = urlObj.hostname.replace(/^www\./, '').toLowerCase();
        return resultDomain === projectDomain;
      } catch {
        // If URL parsing fails, exclude it to be safe
        return false;
      }
    });

    return NextResponse.json(crawlResults);
  } catch (error) {
    console.error('Error fetching crawl results:', error);
    return NextResponse.json(
      { error: 'Failed to fetch crawl results' },
      { status: 500 }
    );
  }
}


