import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const total = await prisma.crawlResult.count({
      where: { auditId },
    });

    const crawlResults = await prisma.crawlResult.findMany({
      where: { auditId },
      orderBy: {
        crawledAt: 'desc',
      },
      skip,
      take: limit,
      select: {
        id: true,
        url: true,
        statusCode: true,
        title: true,
        crawledAt: true,
        responseTimeMs: true,
        h1Count: true,
        h2Count: true,
        h3Count: true,
        imagesCount: true,
        internalLinksCount: true,
        externalLinksCount: true,
      },
    });

    return NextResponse.json({
      results: crawlResults,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching crawl results:', error);
    return NextResponse.json(
      { error: 'Failed to fetch crawl results' },
      { status: 500 }
    );
  }
}

