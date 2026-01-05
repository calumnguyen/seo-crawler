import { prisma } from './prisma';
import { normalizeUrl } from './robots';
import { queryGoogleBacklinks, queryBingBacklinks } from './search-engine-queries';
import { crawlQueue, type CrawlJob } from './queue';
import { addAuditLog } from './audit-logs';

/**
 * Reverse Link Discovery System
 * Discovers backlinks by querying search engines and crawling discovered pages
 * 
 * When a page is crawled, this system:
 * 1. Queries search engines to find pages that link to it
 * 2. Queues those pages for crawling (low priority)
 * 3. When those pages are crawled, extracts links and creates backlinks
 */

interface DiscoveredBacklink {
  sourceUrl: string;
  sourceTitle: string | null;
  discoveredVia: 'google' | 'bing' | 'crawl';
  discoveredAt: Date;
}

/**
 * Discover backlink sources for a crawled page
 * Queries search engines to find pages that link to the target page
 * Then queues those pages for crawling to extract actual links
 * 
 * This runs asynchronously and doesn't block the main crawl process
 */
export async function discoverBacklinksForPage(
  targetCrawlResultId: string,
  targetUrl: string,
  auditId: string,
  projectId: string
): Promise<number> {
  try {
    console.log(`[Reverse-Discovery] 🔍 Discovering backlinks for: ${targetUrl}`);
    
    // Query search engines to find pages that link to this URL
    // Try Google first, then Bing if needed
    const googleResults = await queryGoogleBacklinks(targetUrl, 100, auditId);
    const bingResults = googleResults.length < 100 
      ? await queryBingBacklinks(targetUrl, 100 - googleResults.length, auditId)
      : [];
    
    const searchResults = [
      ...googleResults.map(r => ({ ...r, discoveredVia: 'google' as const })),
      ...bingResults.map(r => ({ ...r, discoveredVia: 'bing' as const })),
    ];
    
    if (searchResults.length === 0) {
      console.log(`[Reverse-Discovery] No backlink sources found for: ${targetUrl}`);
      return 0;
    }
    
    console.log(`[Reverse-Discovery] Found ${searchResults.length} potential backlink sources for: ${targetUrl}`);
    
    // Normalize target URL for matching
    const normalizedTargetUrl = normalizeUrl(targetUrl);
    
    // Queue discovered pages for crawling (low priority)
    // These will be crawled to extract actual links
    let queuedCount = 0;
    const baseUrl = new URL(targetUrl).origin;
    
    for (const result of searchResults) {
      const discoveredVia = result.discoveredVia || 'google';
      try {
        // Check if we've already crawled this page
        const existingPage = await prisma.crawlResult.findFirst({
          where: {
            url: normalizeUrl(result.url, baseUrl),
          },
          select: {
            id: true,
          },
        });
        
        // If already crawled, we can create backlink immediately
        if (existingPage) {
          // Check if link actually exists on that page
          const linkExists = await prisma.link.findFirst({
            where: {
              crawlResultId: existingPage.id,
              href: normalizedTargetUrl,
            },
            select: {
              id: true,
            },
          });
          
          if (linkExists) {
            // Link already exists, backlink should already be created
            // But we can mark it as "discovered via search" for tracking
            continue;
          }
        }
        
        // Queue for crawling (low priority, external discovery)
        // Use a special job type to mark these as backlink discovery crawls
        const { normalizeUrl: normalizeForJob } = await import('./robots');
        const normalizedSourceUrl = normalizeForJob(result.url, baseUrl);
        const { createHash } = await import('crypto');
        const urlHash = createHash('sha256').update(normalizedSourceUrl).digest('base64').slice(0, 32);
        const jobId = `backlink-discovery:${urlHash}`;
        
        try {
          const crawlJob: CrawlJob = {
            url: result.url,
            auditId, // Use same audit for tracking
            metadata: {
              backlinkDiscovery: true,
              targetUrl: targetUrl,
              targetCrawlResultId: targetCrawlResultId,
              sourceTitle: result.title || undefined,
              discoveredVia: discoveredVia,
            },
          };
          
          await crawlQueue.add(
            crawlJob,
            {
              jobId,
              priority: 1, // Low priority - don't interfere with main crawls
              delay: 5000, // Delay 5 seconds to avoid overwhelming
            }
          );
          
          queuedCount++;
          
          // Log first few for visibility
          if (queuedCount <= 5) {
            console.log(`[Reverse-Discovery] Queued backlink source: ${result.url}`);
          }
          
        } catch (error: any) {
          // If job already exists, skip
          if (error?.message?.includes('already exists')) {
            continue;
          }
          console.error(`[Reverse-Discovery] Error queuing ${result.url}:`, error);
        }
        
        // Rate limiting: small delay between queue operations
        if (queuedCount % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        console.error(`[Reverse-Discovery] Error processing result ${result.url}:`, error);
        continue;
      }
    }
    
    // Log discovery summary
    addAuditLog(
      auditId,
      'crawled',
      `🔍 Discovered ${queuedCount} potential backlink sources for ${targetUrl} via search engines`,
      {
        targetUrl,
        sourcesFound: searchResults.length,
        queued: queuedCount,
      }
    );
    
    console.log(`[Reverse-Discovery] ✅ Queued ${queuedCount} backlink discovery crawls for: ${targetUrl}`);
    
    return queuedCount;
    
  } catch (error) {
    console.error(`[Reverse-Discovery] Error discovering backlinks for ${targetUrl}:`, error);
    return 0;
  }
}

/**
 * Store discovered backlink source information
 * This tracks which pages we discovered via search engines
 * Separate from actual backlinks (which are created when we crawl the source page)
 */
export async function storeDiscoveredBacklinkSource(
  targetCrawlResultId: string,
  sourceUrl: string,
  sourceTitle: string | null,
  discoveredVia: 'google' | 'bing' | 'crawl',
  projectId: string
): Promise<void> {
  try {
    // We could create a separate table for discovered sources
    // For now, we'll just queue them for crawling
    // When they're crawled, backlinks will be created automatically
    
    // This function is a placeholder for future enhancement
    // Could store in a "DiscoveredBacklinkSource" table for tracking
    
  } catch (error) {
    console.error(`[Reverse-Discovery] Error storing discovered source:`, error);
  }
}

