import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get('projectId');
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');
  
  // OPTIMIZED: Reduce default limit to improve performance
  const optimizedLimit = Math.min(limit, 100); // Cap at 100 for performance
  
  try {
    const where = projectId
      ? {
          Audit: {
            projectId,
          },
        }
      : {};
    
    const [crawlResults, total] = await Promise.all([
      prisma.crawlResult.findMany({
        where,
        take: optimizedLimit,
        skip: offset,
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
          // OPTIMIZED: Remove _count queries - they're expensive and not always needed
          // If counts are needed, they can be calculated separately or cached
        },
      }),
      prisma.crawlResult.count({ where }),
    ]);

    return NextResponse.json({
      crawlResults,
      total,
      limit: optimizedLimit,
      offset,
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
      console.warn('[Dashboard Data] Database connection timeout (transient)');
      // Return valid response structure so frontend doesn't crash
      return NextResponse.json(
        { 
          error: 'Database connection timeout',
          message: 'The database connection timed out. Please try again in a moment.',
          retryable: true,
          crawlResults: [],
          total: 0,
          limit: optimizedLimit,
          offset,
        },
        { status: 503 } // Service Unavailable - indicates temporary issue
      );
    }
    
    console.error('Error fetching crawled data:', error);
    // Return valid response structure even on error
    return NextResponse.json(
      { 
        error: 'Failed to fetch crawled data',
        crawlResults: [],
        total: 0,
        limit: optimizedLimit,
        offset,
      },
      { status: 500 }
    );
  }
}

