import { NextRequest, NextResponse } from 'next/server';
import { crawlUrl } from '@/lib/crawler';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL is required and must be a string' },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    const seoData = await crawlUrl(url);
    return NextResponse.json(seoData);
  } catch (error) {
    console.error('Crawl error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to crawl URL',
      },
      { status: 500 }
    );
  }
}

