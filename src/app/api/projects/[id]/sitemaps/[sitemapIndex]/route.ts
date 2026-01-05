import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET - Get a specific sitemap content by index
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sitemapIndex: string }> }
) {
  try {
    const { id, sitemapIndex } = await params;
    const index = parseInt(sitemapIndex, 10);
    
    if (isNaN(index)) {
      return NextResponse.json(
        { error: 'Invalid sitemap index' },
        { status: 400 }
      );
    }
    
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
      return NextResponse.json(
        { error: 'Sitemaps not found' },
        { status: 404 }
      );
    }

    const sitemaps = Array.isArray(domain.sitemaps) ? domain.sitemaps : [];

    if (index < 0 || index >= sitemaps.length) {
      return NextResponse.json(
        { error: 'Sitemap index out of range' },
        { status: 404 }
      );
    }

    const sitemap = sitemaps[index] as { url: string; content: string };

    return NextResponse.json({
      url: sitemap.url,
      content: sitemap.content,
    });
  } catch (error) {
    console.error('Error fetching sitemap:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sitemap' },
      { status: 500 }
    );
  }
}

