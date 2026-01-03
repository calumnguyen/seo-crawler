import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { crawlUrl } from '@/lib/crawler';
import { saveCrawlResultToDb } from '@/lib/crawler-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Update audit status to in_progress if it's pending
    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
      include: { project: true },
    });

    if (!audit) {
      return NextResponse.json(
        { error: 'Audit not found' },
        { status: 404 }
      );
    }

    if (audit.status === 'pending') {
      await prisma.audit.update({
        where: { id: auditId },
        data: { status: 'in_progress' },
      });
    }

    // Crawl the URL
    const seoData = await crawlUrl(url);

    // Extract domain for external crawls
    let domainId: string | undefined;
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace(/^www\./, '');
      
      // Find or create domain
      const domainRecord = await prisma.domain.upsert({
        where: { domain },
        update: {},
        create: {
          domain,
          baseUrl: `${urlObj.protocol}//${urlObj.host}`,
        },
      });
      domainId = domainRecord.id;
    } catch {
      // Domain extraction failed, continue without it
    }

    // Save to database
    const crawlResult = await saveCrawlResultToDb(seoData, auditId, domainId);

    // Update audit progress
    const updatedAudit = await prisma.audit.update({
      where: { id: auditId },
      data: {
        pagesCrawled: {
          increment: 1,
        },
      },
    });

    return NextResponse.json({
      crawlResult,
      audit: updatedAudit,
    });
  } catch (error) {
    console.error('Error crawling URL:', error);
    
    // Update audit status if it fails
    try {
      await prisma.audit.update({
        where: { id: auditId },
        data: { status: 'failed' },
      });
    } catch {
      // Ignore update errors
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to crawl URL',
      },
      { status: 500 }
    );
  }
}

