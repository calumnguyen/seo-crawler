// Database-backed log store for audit logs
// Logs are persisted in the database to survive across serverless function invocations

import { prisma } from './prisma';

// JSON metadata type - Prisma accepts any JSON-serializable value
type JsonMetadata = string | number | boolean | null | JsonMetadata[] | { [key: string]: JsonMetadata };

export interface AuditLog {
  id: string;
  auditId: string;
  category: 'setup' | 'filtering' | 'queued' | 'crawled' | 'skipped';
  message: string;
  timestamp: Date;
  metadata?: JsonMetadata;
}

export function addAuditLog(
  auditId: string,
  category: 'setup' | 'filtering' | 'queued' | 'crawled' | 'skipped',
  message: string,
  metadata?: JsonMetadata
): void {
  // Fire and forget - save to database asynchronously without blocking
  prisma.auditLog.create({
    data: {
      id: crypto.randomUUID(),
      auditId,
      category,
      message,
      metadata: metadata || {},
    },
  }).catch((error: unknown) => {
    // If database write fails, log error but don't throw (non-critical)
    const errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // If audit was deleted (foreign key constraint violation), silently ignore
    // This happens when jobs are still processing after audit is deleted
    if (errorCode === 'P2003' || 
        errorMessage.includes('foreign key constraint') || 
        errorMessage.includes('AuditLog_auditId_fkey')) {
      // Audit was deleted - no need to log, just silently ignore
      return;
    }
    
    // Log other errors for debugging
    console.error(`[Audit-Logs] Failed to save log to database:`, errorMessage);
  });
}

export async function getAuditLogs(
  auditId: string,
  category?: 'setup' | 'filtering' | 'queued' | 'crawled' | 'skipped',
  limit?: number
): Promise<AuditLog[]> {
  try {
    const where: { auditId: string; category?: string } = { auditId };
    if (category) {
      where.category = category;
    }

    const dbLogs = await prisma.auditLog.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: limit || 10000, // Increased default limit to show more logs
    });

    return dbLogs.map((log: { id: string; auditId: string; category: string; message: string; createdAt: Date; metadata: unknown }) => ({
      id: log.id,
      auditId: log.auditId,
      category: (log.category || 'setup') as 'setup' | 'filtering' | 'queued' | 'crawled' | 'skipped',
      message: log.message,
      timestamp: log.createdAt,
      metadata: log.metadata as JsonMetadata | undefined,
    }));
  } catch (error) {
    console.error(`[Audit-Logs] Failed to fetch logs from database:`, error);
    return [];
  }
}

export async function clearAuditLogs(auditId: string): Promise<void> {
  try {
    await prisma.auditLog.deleteMany({
      where: { auditId },
    });
  } catch (error) {
    console.error(`[Audit-Logs] Failed to clear logs from database:`, error);
  }
}

