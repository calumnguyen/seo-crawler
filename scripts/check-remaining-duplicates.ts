/**
 * Script to check for remaining duplicates after cleanup
 * This helps identify patterns that aren't being caught by the cleanup script
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

async function checkRemainingDuplicates() {
  console.log('Checking for remaining duplicate patterns...\n');
  
  // Get all crawl results
  const crawlResults = await prisma.crawlResult.findMany({
    select: {
      id: true,
      url: true,
      title: true,
      contentHash: true,
      auditId: true,
    },
    orderBy: {
      crawledAt: 'desc',
    },
  });

  console.log(`Total crawl results: ${crawlResults.length}\n`);

  // Group by normalized URL to find potential duplicates
  const urlGroups = new Map<string, Array<{ id: string; url: string; title: string | null }>>();
  
  for (const result of crawlResults) {
    const normalized = normalizeUrl(result.url);
    
    if (!urlGroups.has(normalized)) {
      urlGroups.set(normalized, []);
    }
    
    urlGroups.get(normalized)!.push({
      id: result.id,
      url: result.url,
      title: result.title,
    });
  }

  // Find groups with multiple URLs (potential duplicates)
  const duplicateUrlGroups = Array.from(urlGroups.entries())
    .filter(([_, urls]) => urls.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20); // Show top 20

  console.log(`Found ${duplicateUrlGroups.length} groups with multiple URLs after normalization:\n`);
  
  for (const [normalized, urls] of duplicateUrlGroups) {
    console.log(`Normalized URL: ${normalized}`);
    console.log(`  Count: ${urls.length}`);
    console.log(`  Examples:`);
    for (const urlData of urls.slice(0, 3)) {
      console.log(`    - ${urlData.url} (${urlData.title || 'No title'})`);
    }
    if (urls.length > 3) {
      console.log(`    ... and ${urls.length - 3} more`);
    }
    console.log('');
  }

  // Check contentHash duplicates
  const contentHashGroups = new Map<string, Array<{ id: string; url: string; title: string | null }>>();
  
  for (const result of crawlResults) {
    if (!result.contentHash) continue;
    
    if (!contentHashGroups.has(result.contentHash)) {
      contentHashGroups.set(result.contentHash, []);
    }
    
    contentHashGroups.get(result.contentHash)!.push({
      id: result.id,
      url: result.url,
      title: result.title,
    });
  }

  const duplicateContentGroups = Array.from(contentHashGroups.entries())
    .filter(([_, urls]) => urls.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20); // Show top 20

  console.log(`\nFound ${duplicateContentGroups.length} groups with same contentHash but different URLs:\n`);
  
  for (const [hash, urls] of duplicateContentGroups) {
    console.log(`ContentHash: ${hash.substring(0, 16)}...`);
    console.log(`  Count: ${urls.length}`);
    console.log(`  Examples:`);
    for (const urlData of urls.slice(0, 3)) {
      console.log(`    - ${urlData.url} (${urlData.title || 'No title'})`);
    }
    if (urls.length > 3) {
      console.log(`    ... and ${urls.length - 3} more`);
    }
    console.log('');
  }

  // Check for pages without contentHash
  const withoutContentHash = crawlResults.filter(r => !r.contentHash).length;
  console.log(`\nPages without contentHash: ${withoutContentHash} (${((withoutContentHash / crawlResults.length) * 100).toFixed(1)}%)`);
  
  // Look for common patterns in remaining duplicates
  console.log('\nAnalyzing patterns in duplicate URLs...\n');
  
  // Check for locale parameters
  const localePattern = /[?&]locale=[^&]*/i;
  const urlsWithLocale = crawlResults.filter(r => localePattern.test(r.url));
  console.log(`URLs with locale parameter: ${urlsWithLocale.length}`);
  
  // Group by base URL (without query params) for locale variants
  const baseUrlGroups = new Map<string, string[]>();
  for (const result of crawlResults) {
    try {
      const urlObj = new URL(result.url);
      urlObj.search = '';
      urlObj.hash = '';
      const baseUrl = urlObj.toString();
      
      if (!baseUrlGroups.has(baseUrl)) {
        baseUrlGroups.set(baseUrl, []);
      }
      baseUrlGroups.get(baseUrl)!.push(result.url);
    } catch {
      // Invalid URL, skip
    }
  }
  
  const localeDuplicates = Array.from(baseUrlGroups.entries())
    .filter(([_, urls]) => urls.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);
  
  console.log(`\nTop base URLs with multiple variants (likely locale/query param differences):`);
  for (const [baseUrl, urls] of localeDuplicates) {
    console.log(`\n${baseUrl}`);
    console.log(`  Variants: ${urls.length}`);
    const uniqueVariants = new Set(urls.map(u => {
      try {
        const urlObj = new URL(u);
        return urlObj.search;
      } catch {
        return u;
      }
    }));
    console.log(`  Unique query strings: ${uniqueVariants.size}`);
    if (urls.length <= 5) {
      urls.forEach(u => console.log(`    - ${u}`));
    } else {
      urls.slice(0, 3).forEach(u => console.log(`    - ${u}`));
      console.log(`    ... and ${urls.length - 3} more`);
    }
  }
}

checkRemainingDuplicates()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

