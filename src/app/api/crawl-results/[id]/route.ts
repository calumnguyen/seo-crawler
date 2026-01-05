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
        Audit: {
          include: {
            Project: {
              select: {
                id: true,
                name: true,
                domain: true,
                baseUrl: true,
              },
            },
          },
        },
        Heading: {
          orderBy: [
            { level: 'asc' },
            { order: 'asc' },
          ],
        },
        Image: {
          orderBy: {
            order: 'asc',
          },
        },
        Link: {
          orderBy: {
            order: 'asc',
          },
        },
        OgTag: true,
        Issue: {
          orderBy: [
            { severity: 'asc' }, // error, warning, info
            { category: 'asc' },
            { type: 'asc' },
          ],
        },
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


