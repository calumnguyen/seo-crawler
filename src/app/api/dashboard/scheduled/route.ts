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
        Project: {
          select: {
            id: true,
            name: true,
            domain: true,
          },
        },
        Domain: {
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
    // Check if it's a database connection timeout
    // Handle ErrorEvent with AggregateError (Neon WebSocket errors)
    const errorObj = error as any;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check for ETIMEDOUT in various error structures
    const nestedError = errorObj?.Symbol?.(Symbol.for('kError')) || errorObj?.Symbol?.kError || errorObj?.error;
    const errorCode = errorObj?.code || nestedError?.code || (nestedError as any)?.code;
    const isTimeout = errorMessage.includes('ETIMEDOUT') || 
                      errorMessage.includes('timeout') ||
                      errorMessage.includes('ErrorEvent') ||
                      errorCode === 'ETIMEDOUT';
    
    if (isTimeout) {
      // Log at warn level - these are transient and expected occasionally
      console.warn('[Scheduled Crawls] Database connection timeout (transient)');
      // Return valid response structure so frontend doesn't crash
      return NextResponse.json(
        { 
          error: 'Database connection timeout',
          message: 'The database connection timed out. Please try again in a moment.',
          retryable: true,
          scheduled: [],
        },
        { status: 503 } // Service Unavailable - indicates temporary issue
      );
    }
    
    console.error('Error fetching scheduled crawls:', error);
    // Return valid response structure even on error
    return NextResponse.json(
      { 
        error: 'Failed to fetch scheduled crawls',
        scheduled: [],
      },
      { status: 500 }
    );
  }
}

