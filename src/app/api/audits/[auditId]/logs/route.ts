import { NextRequest, NextResponse } from 'next/server';
import { getAuditLogs } from '@/lib/audit-logs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  try {
    const { auditId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category') as 'setup' | 'filtering' | 'queued' | 'crawled' | 'skipped' | 'backlink-discovery' | null;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
    
    const logs = await getAuditLogs(auditId, category || undefined, limit);
    
    // Serialize logs with proper timestamp formatting
    const serializedLogs = logs.map(log => ({
      ...log,
      timestamp: log.timestamp instanceof Date ? log.timestamp.toISOString() : log.timestamp,
    }));
    
    return NextResponse.json({
      logs: serializedLogs,
      count: serializedLogs.length,
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}

