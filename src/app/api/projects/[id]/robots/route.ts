import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - Get robots.txt content for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const project = await prisma.project.findUnique({
      where: { id },
      select: { domain: true },
    });

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const domain = await prisma.domain.findUnique({
      where: { domain: project.domain },
      select: { robotsTxtContent: true, robotsTxtUrl: true },
    });

    if (!domain || !domain.robotsTxtContent) {
      return NextResponse.json(
        { error: 'Robots.txt not found or not yet fetched' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      content: domain.robotsTxtContent,
      url: domain.robotsTxtUrl,
    });
  } catch (error) {
    console.error('Error fetching robots.txt:', error);
    return NextResponse.json(
      { error: 'Failed to fetch robots.txt' },
      { status: 500 }
    );
  }
}

