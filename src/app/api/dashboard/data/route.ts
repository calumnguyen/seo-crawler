import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectId = searchParams.get('projectId');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where = projectId
      ? {
          audit: {
            projectId,
          },
        }
      : {};

    const [crawlResults, total] = await Promise.all([
      prisma.crawlResult.findMany({
        where,
        take: limit,
        skip: offset,
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
          _count: {
            select: {
              headings: true,
              images: true,
              links: true,
            },
          },
        },
      }),
      prisma.crawlResult.count({ where }),
    ]);

    return NextResponse.json({
      crawlResults,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching crawled data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch crawled data' },
      { status: 500 }
    );
  }
}

