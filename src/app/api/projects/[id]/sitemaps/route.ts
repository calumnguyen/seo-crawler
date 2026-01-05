import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - Get all sitemaps for a project
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
      select: { sitemaps: true },
    });

    if (!domain || !domain.sitemaps) {
      return NextResponse.json([]);
    }

    // sitemaps is stored as JSON array of { url: string, content: string }
    const sitemaps = Array.isArray(domain.sitemaps) ? domain.sitemaps : [];

    return NextResponse.json(sitemaps);
  } catch (error) {
    console.error('Error fetching sitemaps:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sitemaps' },
      { status: 500 }
    );
  }
}

