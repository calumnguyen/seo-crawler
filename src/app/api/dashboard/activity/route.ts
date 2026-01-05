import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get active audits (in_progress, pending, paused, and pending_approval - paused can be resumed, pending_approval needs approval)
    const activeAudits = await prisma.audit.findMany({
      where: {
        status: {
          in: ['in_progress', 'pending', 'paused', 'pending_approval'],
        },
      },
      include: {
        Project: {
          select: {
            id: true,
            name: true,
            domain: true,
          },
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
    });

    // REVERTED: Use simple approach - skip count queries if no audits (groupBy was causing timeouts)
    // When database is empty or has connection issues, groupBy can timeout
    const activeAuditsWithActualCounts = activeAudits.length > 0
      ? await Promise.all(
          activeAudits.map(async (audit) => {
            const pagesCrawled = await prisma.crawlResult.count({
              where: { auditId: audit.id },
            });
            return {
              ...audit,
              pagesCrawled,
              project: audit.Project, // Map Project to project for backward compatibility
            };
          })
        )
      : [];

    // Get recent crawl results (last 50)
    const recentCrawls = await prisma.crawlResult.findMany({
      take: 50,
      orderBy: {
        crawledAt: 'desc',
      },
      include: {
        Audit: {
          include: {
            Project: {
              select: {
                name: true,
                domain: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      activeAudits: activeAuditsWithActualCounts,
      recentCrawls,
    });
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
      console.warn('[Activity] Database connection timeout (transient)');
      // Return valid response structure so frontend doesn't crash
      return NextResponse.json(
        { 
          error: 'Database connection timeout',
          message: 'The database connection timed out. Please try again in a moment.',
          retryable: true,
          activeAudits: [],
          recentCrawls: [],
        },
        { status: 503 } // Service Unavailable - indicates temporary issue
      );
    }
    
    console.error('Error fetching activity:', error);
    // Return valid response structure even on error
    return NextResponse.json(
      { 
        error: 'Failed to fetch activity',
        activeAudits: [],
        recentCrawls: [],
      },
      { status: 500 }
    );
  }
}

