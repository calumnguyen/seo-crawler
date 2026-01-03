import { NextRequest, NextResponse } from 'next/server';
import { startAutomaticCrawl } from '@/lib/auto-crawl';
import '@/lib/ensure-queue'; // Ensure queue processor is running

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;

    console.log(`[API] Starting automatic crawl for audit: ${auditId}`);
    
    // Check if audit is already in progress to prevent duplicates
    const { prisma } = await import('@/lib/prisma');
    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
      select: { status: true },
    });

    if (!audit) {
      return NextResponse.json(
        { error: 'Audit not found' },
        { status: 404 }
      );
    }

    if (audit.status === 'in_progress' || audit.status === 'pending_approval') {
      return NextResponse.json(
        { 
          error: 'Crawl already in progress or pending approval',
          message: 'This audit is already being processed. Please wait or check the audit details.',
        },
        { status: 409 } // Conflict
      );
    }

    // Immediately mark audit as in_progress to prevent double-clicks and show control buttons
    await prisma.audit.update({
      where: { id: auditId },
      data: { 
        status: 'in_progress',
        startedAt: new Date(),
      },
    });

    // Start crawl asynchronously - don't wait for it
    // This returns immediately after marking audit as in_progress
    startAutomaticCrawl(auditId).catch((error) => {
      console.error('[API] ❌ Error in background crawl start:', error);
      console.error('[API] Error details:', error instanceof Error ? error.stack : error);
      
      // Update audit status based on error type
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Don't mark as failed if it's "already in progress" - this is a race condition
      // The status is already in_progress, so leave it as is
      if (errorMessage.includes('already in progress')) {
        console.log('[API] Crawl already in progress (race condition), leaving status as in_progress');
        return; // Don't update status
      }
      
      let newStatus = 'failed';
      
      // If it's an approval required error, set to pending_approval
      if (errorMessage.includes('approval required') || errorMessage.includes('robots.txt not found')) {
        newStatus = 'pending_approval';
      }
      
      prisma.audit.update({
        where: { id: auditId },
        data: { status: newStatus },
      }).catch((updateError: unknown) => {
        console.error('[API] Failed to update audit status after error:', updateError);
      });
    });

    // Return immediately - crawl is starting in background
    return NextResponse.json({
      success: true,
      message: 'Crawl started! Jobs are being queued and processed in the background.',
      auditId,
    });
  } catch (error) {
    console.error('[API] Error starting automatic crawl:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to start automatic crawl',
      },
      { status: 500 }
    );
  }
}

