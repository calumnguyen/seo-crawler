import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const scheduled = await prisma.crawlSchedule.findMany({
      where: {
        isActive: true,
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            domain: true,
          },
        },
        domain: {
          select: {
            id: true,
            domain: true,
          },
        },
      },
      orderBy: {
        nextCrawlAt: 'asc',
      },
    });

    return NextResponse.json(scheduled);
  } catch (error) {
    console.error('Error fetching scheduled crawls:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scheduled crawls' },
      { status: 500 }
    );
  }
}

