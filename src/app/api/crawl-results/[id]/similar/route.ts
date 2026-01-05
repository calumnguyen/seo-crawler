import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the current crawl result
    const currentResult = await prisma.crawlResult.findUnique({
      where: { id },
      select: {
        id: true,
        contentHash: true,
        url: true,
        auditId: true,
      },
    });

    if (!currentResult || !currentResult.contentHash) {
      return NextResponse.json({
        similarPages: [],
        message: 'No content hash available for similarity comparison',
      });
    }

    // Find all crawl results with the same content hash (exact duplicates = 100% similarity)
    // Exclude the current page itself
    const similarResults = await prisma.crawlResult.findMany({
      where: {
        contentHash: currentResult.contentHash,
        id: { not: id },
        statusCode: { gte: 200, lt: 400 }, // Only successful pages
      },
      select: {
        id: true,
        url: true,
        title: true,
        crawledAt: true,
        statusCode: true,
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
      orderBy: {
        crawledAt: 'desc',
      },
      take: 20, // Limit to 20 similar pages
    });

    // Format results with similarity score (100% for exact hash matches)
    const similarPages = similarResults.map((result) => ({
      id: result.id,
      url: result.url,
      title: result.title,
      similarityScore: 1.0, // 100% - exact duplicate (same content hash)
      crawledAt: result.crawledAt,
      statusCode: result.statusCode,
      project: result.Audit?.Project ? {
        id: result.Audit.Project.id,
        name: result.Audit.Project.name,
      } : null,
    }));

    return NextResponse.json({
      similarPages: similarPages.filter(page => page.similarityScore >= 0.6), // Only return pages with >= 60% similarity
      currentPageId: id,
      currentPageUrl: currentResult.url,
    });
  } catch (error) {
    console.error('Error fetching similar pages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch similar pages' },
      { status: 500 }
    );
  }
}

