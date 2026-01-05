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

    // Get all crawl results for audits belonging to this project
    const crawlResults = await prisma.crawlResult.findMany({
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

    return NextResponse.json(crawlResults);
  } catch (error) {
    console.error('Error fetching crawl results:', error);
    return NextResponse.json(
      { error: 'Failed to fetch crawl results' },
      { status: 500 }
    );
  }
}


