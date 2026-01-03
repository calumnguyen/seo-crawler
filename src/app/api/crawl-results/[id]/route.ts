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

    const crawlResult = await prisma.crawlResult.findUnique({
      where: { id },
      include: {
        audit: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                domain: true,
                baseUrl: true,
              },
            },
          },
        },
        headings: {
          orderBy: [
            { level: 'asc' },
            { order: 'asc' },
          ],
        },
        images: {
          orderBy: {
            order: 'asc',
          },
        },
        links: {
          orderBy: {
            order: 'asc',
          },
        },
        ogTags: true,
      },
    });

    if (!crawlResult) {
      return NextResponse.json(
        { error: 'Crawl result not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(crawlResult);
  } catch (error) {
    console.error('Error fetching crawl result:', error);
    return NextResponse.json(
      { error: 'Failed to fetch crawl result' },
      { status: 500 }
    );
  }
}

