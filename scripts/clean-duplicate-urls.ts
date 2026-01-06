/**
 * Script to clean duplicate crawl results based on normalized URLs and content hash
 * 
 * This script:
 * 1. Finds duplicate URLs (same normalized URL but different raw URLs, e.g., different session IDs)
 * 2. Finds duplicate content (same contentHash but different URLs - e.g., tribunal decisions with different IDs but same content)
 * 3. Keeps the most recent crawl result for each normalized URL/content hash per audit
 * 4. Deletes older duplicate crawl results
 * 
 * Run with: npx tsx scripts/clean-duplicate-urls.ts [--dry-run] [--audit-id=<id>] [--content-hash-only]
 */

import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import ws from 'ws';
import { normalizeUrl } from '../src/lib/robots';

// Configure Neon for Node.js
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL!;

if (!connectionString) {
  console.error('Error: DATABASE_URL environment variable is not set');
  process.exit(1);
}

const adapter = new PrismaNeon({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

interface DuplicateGroup {
  normalizedUrl: string;
  auditId: string | null;
  count: number;
  crawlResultIds: string[];
  urls: string[];
}

async function findDuplicates(auditId?: string, contentHashOnly: boolean = false): Promise<DuplicateGroup[]> {
  console.log(`Finding duplicate URLs${auditId ? ` for audit ${auditId}` : ' across all audits'}...`);
  
  // Get all crawl results (or for specific audit)
  const where = auditId ? { auditId } : {};
  const crawlResults = await prisma.crawlResult.findMany({
    where,
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

  console.log(`Found ${crawlResults.length} crawl results to analyze`);

  // Group by normalized URL/content hash and auditId
  const groups = new Map<string, DuplicateGroup>();
  
  for (const result of crawlResults) {
    let key: string;
    
    if (contentHashOnly) {
      // Group by contentHash only (for content-based duplicates)
      if (!result.contentHash) {
        continue; // Skip results without content hash
      }
      key = `${result.auditId || 'null'}:contentHash:${result.contentHash}`;
    } else {
      // Group by normalized URL (for URL-based duplicates like session IDs)
      const normalized = normalizeUrl(result.url);
      key = `${result.auditId || 'null'}:url:${normalized}`;
    }
    
    if (!groups.has(key)) {
      groups.set(key, {
        normalizedUrl: contentHashOnly ? `contentHash:${result.contentHash}` : normalizeUrl(result.url),
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
  
  console.log(`Found ${duplicates.length} groups of duplicate URLs${contentHashOnly ? ' (by content hash)' : ' (by normalized URL)'}`);
  
  return duplicates;
}

async function cleanDuplicates(duplicates: DuplicateGroup[], dryRun: boolean): Promise<void> {
  let totalDeleted = 0;
  let totalKept = 0;
  
  for (const group of duplicates) {
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
      console.log(`\nGroup: ${group.normalizedUrl}`);
      console.log(`  Keeping: ${toKeep.url} (crawled at ${toKeep.crawledAt.toISOString()})`);
      console.log(`  Deleting ${toDelete.length} duplicates:`);
      
      for (const result of toDelete) {
        console.log(`    - ${result.url} (crawled at ${result.crawledAt.toISOString()})`);
        
        if (!dryRun) {
          // Delete the crawl result (cascading deletes will handle related records)
          await prisma.crawlResult.delete({
            where: { id: result.id },
          });
        }
      }
      
      totalKept++;
      totalDeleted += toDelete.length;
    }
  }
  
  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Summary:`);
  console.log(`  Groups processed: ${duplicates.length}`);
  console.log(`  URLs kept: ${totalKept}`);
  console.log(`  Duplicate URLs deleted: ${totalDeleted}`);
  
  if (dryRun) {
    console.log('\nThis was a dry run. Run without --dry-run to actually delete duplicates.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const contentHashOnly = args.includes('--content-hash-only');
  const auditIdArg = args.find(arg => arg.startsWith('--audit-id='));
  const auditId = auditIdArg ? auditIdArg.split('=')[1] : undefined;
  
  try {
    console.log('Starting duplicate URL cleanup...');
    if (dryRun) {
      console.log('DRY RUN MODE - No changes will be made\n');
    }
    if (contentHashOnly) {
      console.log('CONTENT HASH MODE - Finding duplicates by content hash (same content, different URLs)\n');
    } else {
      console.log('URL NORMALIZATION MODE - Finding duplicates by normalized URL (same page, different session IDs/tracking params)\n');
    }
    
    const duplicates = await findDuplicates(auditId, contentHashOnly);
    
    if (duplicates.length === 0) {
      console.log('No duplicates found!');
      return;
    }
    
    await cleanDuplicates(duplicates, dryRun);
    
    console.log('\nDone!');
    
    if (!contentHashOnly) {
      console.log('\nNote: To also find duplicates by content (same content, different URLs), run with --content-hash-only flag');
      console.log('Example: npx tsx scripts/clean-duplicate-urls.ts --content-hash-only --dry-run');
    }
  } catch (error) {
    console.error('Error cleaning duplicates:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

