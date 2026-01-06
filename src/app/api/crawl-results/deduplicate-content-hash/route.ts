import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeUrl } from '@/lib/robots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DuplicateGroup {
  normalizedUrl: string;
  auditId: string | null;
  count: number;
  crawlResultIds: string[];
  urls: string[];
}

async function findDuplicatesByContentHash(): Promise<DuplicateGroup[]> {
  const crawlResults = await prisma.crawlResult.findMany({
    select: {
      id: true,
      url: true,
      auditId: true,
      crawledAt: true,
      contentHash: true,
    },
    orderBy: {
      crawledAt: 'desc',
    },
  });

  const groups = new Map<string, DuplicateGroup>();
  
  for (const result of crawlResults) {
    if (!result.contentHash) {
      continue; // Skip results without content hash
    }
    
    const key = `${result.auditId || 'null'}:contentHash:${result.contentHash}`;
    
    if (!groups.has(key)) {
      groups.set(key, {
        normalizedUrl: `contentHash:${result.contentHash}`,
        auditId: result.auditId,
        count: 0,
        crawlResultIds: [],
        urls: [],
      });
    }
    
    const group = groups.get(key)!;
    group.count++;
    group.crawlResultIds.push(result.id);
    group.urls.push(result.url);
  }

  // Filter to only groups with duplicates (count > 1)
  const duplicates = Array.from(groups.values()).filter(g => g.count > 1);
  
  return duplicates;
}

export async function POST(request: NextRequest) {
  try {
    const logs: string[] = [];
    
    logs.push('Starting content-hash deduplication...');
    logs.push(`[${new Date().toISOString()}] Analyzing crawl results...`);
    
    const duplicates = await findDuplicatesByContentHash();
    
    logs.push(`[${new Date().toISOString()}] Found ${duplicates.length} groups of duplicate content`);
    
    let totalDeleted = 0;
    let totalKept = 0;
    const deletedUrls: string[] = [];
    
    for (let i = 0; i < duplicates.length; i++) {
      const group = duplicates[i];
      
      // Get all crawl results for this group, ordered by crawledAt (most recent first)
      const results = await prisma.crawlResult.findMany({
        where: {
          id: {
            in: group.crawlResultIds,
          },
        },
        select: {
          id: true,
          url: true,
          crawledAt: true,
        },
        orderBy: {
          crawledAt: 'desc',
        },
      });
      
      // Keep the most recent one, delete the rest
      const toKeep = results[0];
      const toDelete = results.slice(1);
      
      if (toDelete.length > 0) {
        logs.push(`[${new Date().toISOString()}] Group ${i + 1}/${duplicates.length}: ${group.normalizedUrl.substring(0, 50)}...`);
        logs.push(`  Keeping: ${toKeep.url.substring(0, 100)}${toKeep.url.length > 100 ? '...' : ''}`);
        logs.push(`  Deleting ${toDelete.length} duplicates`);
        
        for (const result of toDelete) {
          // Delete the crawl result (cascading deletes will handle related records)
          await prisma.crawlResult.delete({
            where: { id: result.id },
          });
          deletedUrls.push(result.url);
          totalDeleted++;
        }
        
        totalKept++;
      }
      
      // Log progress every 10 groups
      if ((i + 1) % 10 === 0) {
        logs.push(`[${new Date().toISOString()}] Progress: ${i + 1}/${duplicates.length} groups processed, ${totalDeleted} duplicates deleted so far`);
      }
    }
    
    logs.push(`[${new Date().toISOString()}] Summary:`);
    logs.push(`  Groups processed: ${duplicates.length}`);
    logs.push(`  URLs kept: ${totalKept}`);
    logs.push(`  Duplicate URLs deleted: ${totalDeleted}`);
    logs.push(`[${new Date().toISOString()}] Deduplication complete!`);
    
    return NextResponse.json({
      success: true,
      logs,
      summary: {
        groupsProcessed: duplicates.length,
        urlsKept: totalKept,
        duplicatesDeleted: totalDeleted,
      },
    });
  } catch (error) {
    console.error('Error during content-hash deduplication:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        logs: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      },
      { status: 500 }
    );
  }
}

