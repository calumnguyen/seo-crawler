import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectId = searchParams.get('projectId');
    const auditId = searchParams.get('auditId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: any = {};
    if (projectId) {
      where.audit = { projectId };
    }
    if (auditId) {
      where.auditId = auditId;
    }

    const [crawlResults, total] = await Promise.all([
      prisma.crawlResult.findMany({
        where,
        take: limit,
        skip: offset,
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
          h1Count: true,
          h2Count: true,
          imagesCount: true,
          internalLinksCount: true,
          externalLinksCount: true,
          Audit: {
            include: {
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
    console.error('Error fetching crawl results:', error);
    return NextResponse.json(
      { error: 'Failed to fetch crawl results' },
      { status: 500 }
    );
  }
}

