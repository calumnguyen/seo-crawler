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

// Backlink crawl limit from environment variable
// Set to "nolimit" or leave unset for no limit (current behavior)
// Set to a number (e.g., "300") to limit how many search results are queued for crawling
// This prevents backlink discovery from branching out too much and blocking domain crawls
const BACKLINK_CRAWL_LIMIT_STR = process.env.BACKLINK_CRAWL_LIMIT || 'nolimit';
const BACKLINK_CRAWL_LIMIT = BACKLINK_CRAWL_LIMIT_STR.toLowerCase() === 'nolimit' 
  ? null 
  : parseInt(BACKLINK_CRAWL_LIMIT_STR, 10);

// Patterns to identify sitemap URLs (should not be crawled)
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

interface DiscoveredBacklink {
  sourceUrl: string;
  sourceTitle: string | null;
  discoveredVia: 'google' | 'bing' | 'crawl';
  discoveredAt: Date;
}

// In-memory cache to track which domains have been searched per audit
// Key: `${auditId}:${domain}`, Value: timestamp
const domainSearchCache = new Map<string, number>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Track total backlink discovery jobs queued per audit (for limit enforcement)
// Key: `${auditId}`, Value: count of backlink discovery jobs queued
const auditBacklinkQueueCount = new Map<string, number>();

// Track if backlink discovery limit has been reached per audit
// Key: `${auditId}`, Value: true if limit reached
const auditBacklinkLimitReached = new Map<string, boolean>();

/**
 * Discover backlink sources for a crawled page
 * Queries search engines to find pages that link to the target page
 * Then queues those pages for crawling to extract actual links
 * 
 * This runs asynchronously and doesn't block the main crawl process
 * 
 * NOTE: Since we search for link:domain.com (not link:domain.com/path),
 * we deduplicate searches by domain to avoid querying the same domain multiple times
 */
export async function discoverBacklinksForPage(
  targetCrawlResultId: string,
  targetUrl: string,
  auditId: string,
  projectId: string
): Promise<number> {
  try {
    // Check if backlink discovery limit has already been reached for this audit
    if (BACKLINK_CRAWL_LIMIT !== null && auditBacklinkLimitReached.get(auditId)) {
      console.log(`[Reverse-Discovery] ⏭️  Skipping backlink discovery for ${targetUrl} - backlink crawl limit (${BACKLINK_CRAWL_LIMIT}) already reached for audit ${auditId}`);
      // Don't log every skip to avoid spam - limit already logged when reached
      return 0;
    }
    
    // Extract domain (no subdirectories) - same logic as queryGoogleBacklinks
    const urlObj = new URL(targetUrl);
    const domain = urlObj.hostname.replace(/^www\./, '');
    const cacheKey = `${auditId}:${domain}`;
    
    // Check if we've already searched for this domain in this audit
    const lastSearchTime = domainSearchCache.get(cacheKey);
    const now = Date.now();
    
    if (lastSearchTime && (now - lastSearchTime) < CACHE_TTL) {
      // Already searched for this domain recently, skip to avoid duplicate API calls
      console.log(`[Reverse-Discovery] ⏭️  Skipping backlink search for ${targetUrl} - already searched domain ${domain} in this audit`);
      if (auditId) {
        addAuditLog(
          auditId,
          'backlink-discovery',
          `⏭️  Skipped backlink search for ${targetUrl} - domain ${domain} already searched in this audit`,
          {
            targetUrl,
            domain,
            skipped: true,
            reason: 'domain_already_searched',
          }
        );
      }
      return 0;
    }
    
    // Mark this domain as searched
    domainSearchCache.set(cacheKey, now);
    
    // Clean up old cache entries (older than 24 hours)
    if (domainSearchCache.size > 1000) {
      // Only clean up if cache is getting large
      for (const [key, timestamp] of domainSearchCache.entries()) {
        if (now - timestamp > CACHE_TTL) {
          domainSearchCache.delete(key);
        }
      }
    }
    
    console.log(`[Reverse-Discovery] 🔍 Discovering backlinks for: ${targetUrl} (domain: ${domain})`);
    
    // Query search engines to find pages that link to this domain
    // We search for link:domain.com (domain/subdomain only, no paths)
    // Try Google first, then Bing if Google quota is exceeded or if we need more results
    let googleResults: any[] = [];
    let googleQuotaExceeded = false;
    
    try {
      googleResults = await queryGoogleBacklinks(targetUrl, 100, auditId);
    } catch (error: any) {
      // Check if it's a quota error
      if (error?.isQuotaError || (error instanceof Error && error.message.includes('quota'))) {
        googleQuotaExceeded = true;
        console.log(`[Reverse-Discovery] ⚠️ Google API quota exceeded, falling back to Bing for: ${targetUrl}`);
        if (auditId) {
          addAuditLog(
            auditId,
            'backlink-discovery',
            `⚠️ Google API quota exceeded (10,000/day limit reached). Falling back to Bing for domain: ${domain}`,
            {
              targetUrl,
              domain,
              searchEngine: 'google',
              quotaExceeded: true,
              fallbackTo: 'bing',
            }
          );
        }
      } else {
        // Other error, log and continue
        console.error(`[Reverse-Discovery] Google API error:`, error);
        if (auditId) {
          addAuditLog(
            auditId,
            'backlink-discovery',
            `❌ Google API error for ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`,
            {
              targetUrl,
              domain,
              searchEngine: 'google',
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }
    }
    
    // Use Bing if Google quota exceeded or if we need more results
    const bingResults = (googleQuotaExceeded || googleResults.length < 100)
      ? await queryBingBacklinks(targetUrl, googleQuotaExceeded ? 100 : (100 - googleResults.length), auditId)
      : [];
    
    const searchResults = [
      ...googleResults.map(r => ({ ...r, discoveredVia: 'google' as const })),
      ...bingResults.map(r => ({ ...r, discoveredVia: 'bing' as const })),
    ];
    
    // Apply backlink crawl limit if set
    // This prevents backlink discovery from queuing too many pages and blocking domain crawls
    let limitedSearchResults = searchResults;
    if (BACKLINK_CRAWL_LIMIT !== null && searchResults.length > BACKLINK_CRAWL_LIMIT) {
      limitedSearchResults = searchResults.slice(0, BACKLINK_CRAWL_LIMIT);
      console.log(`[Reverse-Discovery] ⚠️  Backlink crawl limit applied: ${searchResults.length} results found, limiting to ${BACKLINK_CRAWL_LIMIT} results`);
      if (auditId) {
        addAuditLog(
          auditId,
          'backlink-discovery',
          `⚠️  Backlink crawl limit applied: ${searchResults.length} results found, limiting to first ${BACKLINK_CRAWL_LIMIT} results (BACKLINK_CRAWL_LIMIT=${BACKLINK_CRAWL_LIMIT})`,
          {
            targetUrl,
            domain,
            totalResults: searchResults.length,
            limitedTo: BACKLINK_CRAWL_LIMIT,
            limitApplied: true,
          }
        );
      }
    }
    
    if (limitedSearchResults.length === 0) {
      console.log(`[Reverse-Discovery] No backlink sources found for: ${targetUrl}`);
      addAuditLog(
        auditId,
        'backlink-discovery',
        `✅ Backlink discovery complete for ${targetUrl}: No sources found`,
        {
          targetUrl,
          sourcesFound: 0,
          queued: 0,
          completed: true,
        }
      );
      return 0;
    }
    
    console.log(`[Reverse-Discovery] Found ${searchResults.length} potential backlink sources for: ${targetUrl}${BACKLINK_CRAWL_LIMIT !== null ? ` (limited to ${limitedSearchResults.length} by BACKLINK_CRAWL_LIMIT)` : ''}`);
    
    // Normalize target URL for matching
    const normalizedTargetUrl = normalizeUrl(targetUrl);
    
    // Queue discovered pages for crawling (low priority)
    // These will be crawled to extract actual links
    let queuedCount = 0;
    const baseUrl = new URL(targetUrl).origin;
    
    // Get current count of backlink discovery jobs queued for this audit
    const currentAuditCount = auditBacklinkQueueCount.get(auditId) || 0;
    let auditCountReached = false;
    
    for (const result of limitedSearchResults) {
      // Check if we've reached the audit-wide limit before processing each result
      if (BACKLINK_CRAWL_LIMIT !== null) {
        const currentCount = auditBacklinkQueueCount.get(auditId) || 0;
        if (currentCount >= BACKLINK_CRAWL_LIMIT) {
          if (!auditBacklinkLimitReached.get(auditId)) {
            // First time reaching the limit - log it
            auditBacklinkLimitReached.set(auditId, true);
            auditCountReached = true;
            console.log(`[Reverse-Discovery] 🛑 Backlink crawl limit (${BACKLINK_CRAWL_LIMIT}) reached for audit ${auditId}. No more backlink discovery will be queued.`);
            if (auditId) {
              addAuditLog(
                auditId,
                'backlink-discovery',
                `🛑 Backlink crawl limit reached: ${BACKLINK_CRAWL_LIMIT} backlink discovery jobs have been queued for this audit. No more backlink discovery will be performed. (BACKLINK_CRAWL_LIMIT=${BACKLINK_CRAWL_LIMIT})`,
                {
                  targetUrl,
                  domain,
                  limitReached: true,
                  totalQueued: currentCount,
                  limit: BACKLINK_CRAWL_LIMIT,
                }
              );
            }
          }
          // Stop queueing more backlink discovery jobs
          break;
        }
      }
      
      const discoveredVia = result.discoveredVia || 'google';
      try {
        // Skip sitemap URLs - these are not useful for backlink discovery
        if (isSitemapUrl(result.url)) {
          console.log(`[Reverse-Discovery] ⏭️  Skipping sitemap URL: ${result.url}`);
          continue;
        }
        
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
          
          // Update audit-wide counter
          const newCount = (auditBacklinkQueueCount.get(auditId) || 0) + 1;
          auditBacklinkQueueCount.set(auditId, newCount);
          
          // Check if we just reached the limit
          if (BACKLINK_CRAWL_LIMIT !== null && newCount >= BACKLINK_CRAWL_LIMIT) {
            auditBacklinkLimitReached.set(auditId, true);
            auditCountReached = true;
            console.log(`[Reverse-Discovery] 🛑 Backlink crawl limit (${BACKLINK_CRAWL_LIMIT}) reached for audit ${auditId} after queuing ${result.url}. No more backlink discovery will be queued.`);
            if (auditId) {
              addAuditLog(
                auditId,
                'backlink-discovery',
                `🛑 Backlink crawl limit reached: ${BACKLINK_CRAWL_LIMIT} backlink discovery jobs have been queued for this audit. No more backlink discovery will be performed. (BACKLINK_CRAWL_LIMIT=${BACKLINK_CRAWL_LIMIT})`,
                {
                  targetUrl,
                  domain,
                  limitReached: true,
                  totalQueued: newCount,
                  limit: BACKLINK_CRAWL_LIMIT,
                  lastQueuedUrl: result.url,
                }
              );
            }
            // Stop queueing more (we've reached the limit with this one)
            break;
          }
          
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
    
    // Log if we stopped early due to limit
    if (auditCountReached && queuedCount < limitedSearchResults.length) {
      const remaining = limitedSearchResults.length - queuedCount;
      console.log(`[Reverse-Discovery] ⚠️  Stopped queueing backlink discovery jobs: ${remaining} remaining results skipped due to audit limit (${BACKLINK_CRAWL_LIMIT})`);
    }
    
    // Log discovery summary to backlink-discovery logs
    const currentAuditTotal = auditBacklinkQueueCount.get(auditId) || 0;
    const limitReached = auditBacklinkLimitReached.get(auditId) || false;
    let limitInfo = '';
    if (BACKLINK_CRAWL_LIMIT !== null) {
      if (limitReached) {
        limitInfo = ` (limit reached: ${currentAuditTotal}/${BACKLINK_CRAWL_LIMIT} total for audit)`;
      } else if (searchResults.length > BACKLINK_CRAWL_LIMIT) {
        limitInfo = ` (limited from ${searchResults.length} results, ${currentAuditTotal}/${BACKLINK_CRAWL_LIMIT} total queued for audit)`;
      } else {
        limitInfo = ` (${currentAuditTotal}/${BACKLINK_CRAWL_LIMIT} total queued for audit)`;
      }
    }
    
    addAuditLog(
      auditId,
      'backlink-discovery',
      `✅ Backlink discovery complete for ${targetUrl}: Found ${searchResults.length} source(s), queued ${queuedCount} for crawling${limitInfo}`,
      {
        targetUrl,
        sourcesFound: searchResults.length,
        queued: queuedCount,
        limited: BACKLINK_CRAWL_LIMIT !== null && searchResults.length > BACKLINK_CRAWL_LIMIT,
        limitApplied: BACKLINK_CRAWL_LIMIT !== null && searchResults.length > BACKLINK_CRAWL_LIMIT ? BACKLINK_CRAWL_LIMIT : null,
        auditTotalQueued: currentAuditTotal,
        auditLimit: BACKLINK_CRAWL_LIMIT,
        limitReached: limitReached,
        completed: true,
      }
    );
    
    // Also log to crawled category for visibility (only if limit not reached, to avoid spam)
    if (!limitReached) {
      addAuditLog(
        auditId,
        'crawled',
        `🔍 Discovered ${queuedCount} potential backlink sources for ${targetUrl} via search engines${limitInfo}`,
        {
          targetUrl,
          sourcesFound: searchResults.length,
          queued: queuedCount,
          limited: BACKLINK_CRAWL_LIMIT !== null && searchResults.length > BACKLINK_CRAWL_LIMIT,
        }
      );
    }
    
    console.log(`[Reverse-Discovery] ✅ Queued ${queuedCount} backlink discovery crawls for: ${targetUrl}`);
    
    return queuedCount;
    
  } catch (error) {
    console.error(`[Reverse-Discovery] Error discovering backlinks for ${targetUrl}:`, error);
    addAuditLog(
      auditId,
      'backlink-discovery',
      `❌ Backlink discovery failed for ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`,
      {
        targetUrl,
        error: error instanceof Error ? error.message : String(error),
        completed: true,
      }
    );
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

/**
 * Trigger backlink discovery for all already-crawled pages in an audit
 * This is called when pending domain crawls drop below 50 for the first time,
 * or when a crawl completes, to ensure all pages get backlink discovery even if
 * they were crawled while discovery was deferred (>50 pending)
 */
export async function triggerRetroactiveBacklinkDiscovery(
  auditId: string,
  projectId: string
): Promise<void> {
  // Prevent duplicate retroactive discovery triggers for the same audit
  // This can be called from both queue.ts (when pending drops < 50) and check-completion (on audit complete)
  const retroactiveDiscoveryRunningKey = `retroactive-discovery-running-${auditId}`;
  const retroactiveDiscoveryCompletedKey = `retroactive-discovery-completed-${auditId}`;
  
  try {
    // Check if already completed
    if ((global as any)[retroactiveDiscoveryCompletedKey]) {
      console.log(`[Reverse-Discovery] ⏭️  Retroactive backlink discovery already completed for audit ${auditId}, skipping...`);
      return;
    }
    
    // Check if currently running
    if ((global as any)[retroactiveDiscoveryRunningKey]) {
      console.log(`[Reverse-Discovery] ⏸️  Retroactive backlink discovery already running for audit ${auditId}, skipping duplicate trigger...`);
      return;
    }
    
    // Mark as running
    (global as any)[retroactiveDiscoveryRunningKey] = true;
    
    console.log(`[Reverse-Discovery] 🔄 Starting retroactive backlink discovery for audit ${auditId}...`);
    
    // Get all crawled pages for this audit that belong to the project's domain
    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
      include: {
        Project: {
          select: {
            domain: true,
            baseUrl: true,
          },
        },
      },
    });
    
    if (!audit?.Project) {
      console.error(`[Reverse-Discovery] ❌ Audit ${auditId} or project not found`);
      return;
    }
    
    const projectDomain = audit.Project.domain.replace(/^www\./, '').toLowerCase();
    
    // Get all crawl results for this audit that belong to the project's domain
    const crawlResults = await prisma.crawlResult.findMany({
      where: {
        auditId,
        url: {
          startsWith: audit.Project.baseUrl,
        },
      },
      select: {
        id: true,
        url: true,
      },
      orderBy: {
        crawledAt: 'asc', // Process oldest first
      },
    });
    
    console.log(`[Reverse-Discovery] Found ${crawlResults.length} crawled pages for retroactive discovery`);
    
    if (crawlResults.length === 0) {
      console.log(`[Reverse-Discovery] No pages to process for retroactive discovery`);
      return;
    }
    
    // Log start
    addAuditLog(
      auditId,
      'backlink-discovery',
      `🔄 Starting retroactive backlink discovery for ${crawlResults.length} already-crawled pages. This will query Google and Bing search APIs.`,
      {
        retroactive: true,
        pagesToProcess: crawlResults.length,
      }
    );
    
    // Process pages in batches to avoid overwhelming the system
    const BATCH_SIZE = 10;
    let processed = 0;
    
    for (let i = 0; i < crawlResults.length; i += BATCH_SIZE) {
      const batch = crawlResults.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel
      await Promise.all(
        batch.map(async (result) => {
          try {
            // discoverBacklinksForPage handles domain-level deduplication via domainSearchCache
            // Since all pages are from the same domain, it will only search once per domain
            // This is correct behavior - we search for link:domain.com (not per-page)
            await discoverBacklinksForPage(
              result.id,
              result.url,
              auditId,
              projectId
            );
            processed++;
            
            // Log progress every 50 pages
            if (processed % 50 === 0) {
              console.log(`[Reverse-Discovery] Retroactive discovery progress: ${processed}/${crawlResults.length} pages processed`);
            }
          } catch (error) {
            console.error(`[Reverse-Discovery] Error processing ${result.url} for retroactive discovery:`, error);
          }
        })
      );
      
      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < crawlResults.length) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between batches
      }
    }
    
    console.log(`[Reverse-Discovery] ✅ Retroactive backlink discovery complete: ${processed}/${crawlResults.length} pages processed`);
    
    addAuditLog(
      auditId,
      'backlink-discovery',
      `✅ Retroactive backlink discovery complete: ${processed}/${crawlResults.length} pages processed. Google and Bing searches have been triggered for all crawled pages.`,
      {
        retroactive: true,
        processed,
        total: crawlResults.length,
        completed: true,
      }
    );
    
    // Mark as completed (so future calls are skipped)
    delete (global as any)[retroactiveDiscoveryRunningKey];
    (global as any)[retroactiveDiscoveryCompletedKey] = true;
  } catch (error) {
    console.error(`[Reverse-Discovery] ❌ Error in retroactive backlink discovery:`, error);
    addAuditLog(
      auditId,
      'backlink-discovery',
      `❌ Error during retroactive backlink discovery: ${error instanceof Error ? error.message : String(error)}`,
      {
        retroactive: true,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    
    // Clear running flag on error so it can be retried if needed
    delete (global as any)[retroactiveDiscoveryRunningKey];
  }
}

