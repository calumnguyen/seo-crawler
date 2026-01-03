import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        audits: {
          orderBy: {
            startedAt: 'desc',
          },
          take: 10, // Latest 10 audits per project
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
            pagesCrawled: true,
            pagesTotal: true,
          },
        },
        _count: {
          select: {
            audits: true,
            backlinks: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects with audits:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

