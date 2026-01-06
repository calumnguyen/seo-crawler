/**
 * Script to remove sitemap pages from crawl results
 * 
 * This script identifies and deletes crawl results that are sitemap pages
 * (URLs containing /sitemap or sitemap.xml patterns)
 * 
 * Run with: npx tsx scripts/clean-sitemap-pages.ts [--dry-run] [--audit-id=<id>]
 */

import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import ws from 'ws';

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

// Patterns to identify sitemap URLs
const SITEMAP_PATTERNS = [
  /\/sitemap\.xml$/i,
  /\/sitemap[^\/]*\.xml$/i, // sitemap-news.xml, sitemap-index.xml, etc.
  /\/sitemap\/\d{4}\/\d{2}\/\d{2}/i, // /sitemap/2023/02/06 (NYTimes format)
  /\/sitemaps?\/.*/i, // /sitemap/ or /sitemaps/ with anything after
  /sitemap\.xml\?/i, // sitemap.xml?param=value
  /\/sitemap_index\.xml$/i,
  /\/sitemapindex\.xml$/i,
];

function isSitemapUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const fullUrl = url.toLowerCase();
    
    // Check if URL matches any sitemap pattern
    return SITEMAP_PATTERNS.some(pattern => 
      pattern.test(pathname) || pattern.test(fullUrl)
    );
  } catch {
    // If URL parsing fails, check the raw URL string
    const urlLower = url.toLowerCase();
    return SITEMAP_PATTERNS.some(pattern => pattern.test(urlLower));
  }
}

async function findSitemapPages(auditId?: string) {
  console.log(`Finding sitemap pages${auditId ? ` for audit ${auditId}` : ' across all audits'}...`);
  
  const where = auditId ? { auditId } : {};
  
  // Get all crawl results
  const allResults = await prisma.crawlResult.findMany({
    where,
    select: {
      id: true,
      url: true,
      title: true,
      auditId: true,
      crawledAt: true,
    },
  });
  
  console.log(`Found ${allResults.length} total crawl results to analyze`);
  
  // Filter to sitemap pages
  const sitemapPages = allResults.filter(result => isSitemapUrl(result.url));
  
  console.log(`Found ${sitemapPages.length} sitemap pages`);
  
  // Show some examples
  if (sitemapPages.length > 0) {
    console.log('\nExample sitemap pages found:');
    sitemapPages.slice(0, 10).forEach((page, index) => {
      console.log(`  ${index + 1}. ${page.url}`);
      if (page.title) {
        console.log(`     Title: ${page.title.substring(0, 80)}${page.title.length > 80 ? '...' : ''}`);
      }
    });
    if (sitemapPages.length > 10) {
      console.log(`  ... and ${sitemapPages.length - 10} more`);
    }
  }
  
  return sitemapPages;
}

async function cleanSitemapPages(auditId?: string, dryRun: boolean = true) {
  const sitemapPages = await findSitemapPages(auditId);
  
  if (sitemapPages.length === 0) {
    console.log('\nNo sitemap pages found. Nothing to delete.');
    return;
  }
  
  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Preparing to delete ${sitemapPages.length} sitemap pages...`);
  
  let deleted = 0;
  let errors = 0;
  
  for (let i = 0; i < sitemapPages.length; i++) {
    const page = sitemapPages[i];
    
    if (!dryRun) {
      try {
        await prisma.crawlResult.delete({
          where: { id: page.id },
        });
        deleted++;
        
        // Log progress every 100 deletions
        if (deleted % 100 === 0) {
          console.log(`  Progress: ${deleted}/${sitemapPages.length} deleted...`);
        }
      } catch (error) {
        errors++;
        console.error(`  Error deleting ${page.url}:`, error instanceof Error ? error.message : String(error));
      }
    } else {
      // In dry run, just count
      deleted++;
    }
  }
  
  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Summary:`);
  console.log(`  Sitemap pages found: ${sitemapPages.length}`);
  if (!dryRun) {
    console.log(`  Successfully deleted: ${deleted - errors}`);
    if (errors > 0) {
      console.log(`  Errors: ${errors}`);
    }
  } else {
    console.log(`  Would delete: ${deleted} pages`);
    console.log('\nThis was a dry run. Run without --dry-run to actually delete sitemap pages.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const auditIdArg = args.find(arg => arg.startsWith('--audit-id='));
  const auditId = auditIdArg ? auditIdArg.split('=')[1] : undefined;
  
  try {
    console.log('Starting sitemap page cleanup...');
    if (dryRun) {
      console.log('DRY RUN MODE - No changes will be made\n');
    }
    
    await cleanSitemapPages(auditId, dryRun);
    
    console.log('\nDone!');
  } catch (error) {
    console.error('Error cleaning sitemap pages:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

