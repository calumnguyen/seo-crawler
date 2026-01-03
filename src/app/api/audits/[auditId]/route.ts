import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;

    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            baseUrl: true,
          },
        },
      },
    });

    if (!audit) {
      return NextResponse.json(
        { error: 'Audit not found' },
        { status: 404 }
      );
    }

    // Calculate actual pagesCrawled from database count (more accurate than stored counter)
    const actualPagesCrawled = await prisma.crawlResult.count({
      where: { auditId },
    });

    // Return audit with actual pagesCrawled count
    return NextResponse.json({
      ...audit,
      pagesCrawled: actualPagesCrawled,
    });
  } catch (error) {
    console.error('Error fetching audit:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit' },
      { status: 500 }
    );
  }
}

