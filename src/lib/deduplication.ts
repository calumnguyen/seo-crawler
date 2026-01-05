import { prisma } from './prisma';
import { normalizeUrl } from './robots';
import { createHash } from 'crypto';

/**
 * Database-backed URL deduplication
 * This ensures URLs are only crawled once per audit, even across server restarts
 */

/**
 * Check if a URL has already been crawled in this audit
 */
export async function isUrlCrawledInAudit(
  url: string,
  auditId: string,
  baseUrl?: string
): Promise<boolean> {
  try {
    const normalized = normalizeUrl(url, baseUrl);
    
    // Check if URL exists in crawl results for this audit
    const existing = await prisma.crawlResult.findFirst({
      where: {
        auditId,
        url: normalized,
      },
      select: {
        id: true,
      },
    });

    return !!existing;
  } catch (error) {
    console.error(`Error checking if URL is crawled: ${url}`, error);
    return false; // Fail open - allow crawl if check fails
  }
}

/**
 * Check if a URL is already queued for this audit
 * This prevents duplicate jobs in the queue
 * OPTIMIZED: Uses jobId existence check instead of fetching all jobs
 */
export async function isUrlQueuedForAudit(
  url: string,
  auditId: string,
  crawlQueue: any,
  baseUrl?: string
): Promise<boolean> {
  try {
    const normalized = normalizeUrl(url, baseUrl);
    
    // OPTIMIZED: Use jobId to check if job exists instead of fetching all jobs
    // This is MUCH faster - O(1) lookup instead of O(n) scan
    // Use SHA-256 hash to create unique, fixed-length jobId (prevents collisions from truncation)
    const urlHash = createHash('sha256').update(normalized).digest('base64').slice(0, 32);
    const jobId = `${auditId}:${urlHash}`;
    
    try {
      const existingJob = await crawlQueue.getJob(jobId);
      if (existingJob) {
        // Check if job is in a state that means it's queued/active
        const state = await existingJob.getState();
        if (state === 'waiting' || state === 'delayed' || state === 'active') {
          return true;
        }
      }
    } catch (jobError) {
      // Job doesn't exist or error checking - that's fine, means it's not queued
      // This is expected for most URLs, so we don't log it
    }
    
    return false;
  } catch (error) {
    console.error(`Error checking if URL is queued: ${url}`, error);
    return false; // Fail open
  }
}

/**
 * Batch check if multiple URLs are already queued
 * OPTIMIZED: Checks multiple URLs efficiently using jobId lookups
 */
export async function areUrlsQueuedForAudit(
  urls: string[],
  auditId: string,
  crawlQueue: any,
  baseUrl?: string
): Promise<Set<string>> {
  const queuedUrls = new Set<string>();
  
  try {
    // Check all URLs in parallel using jobId lookups
    const checks = await Promise.allSettled(
      urls.map(async (url) => {
        const normalized = normalizeUrl(url, baseUrl);
        // Use SHA-256 hash to create unique, fixed-length jobId (prevents collisions from truncation)
        const urlHash = createHash('sha256').update(normalized).digest('base64').slice(0, 32);
        const jobId = `${auditId}:${urlHash}`;
        
        try {
          const existingJob = await crawlQueue.getJob(jobId);
          if (existingJob) {
            const state = await existingJob.getState();
            if (state === 'waiting' || state === 'delayed' || state === 'active') {
              // DEBUG: Log when we find a job in Redis - this is why URL is being skipped
              console.log(`[Deduplication] ✅ Found job in Redis: ${url} (jobId: ${jobId}, state: ${state})`);
              // Also verify the job data matches
              if (existingJob.data && existingJob.data.url) {
                console.log(`[Deduplication]   Job data URL: ${existingJob.data.url}, matches: ${existingJob.data.url === url || existingJob.data.url === normalized}`);
              }
              return normalized;
            } else {
              // Job exists but in a different state (completed/failed) - don't skip
              console.log(`[Deduplication] ⚠️  Job exists but not queued (state: ${state}): ${url} (jobId: ${jobId})`);
            }
          } else {
            // Job not found - this is normal for most URLs
            // Only log for first few to verify the check is working
            if (urls.indexOf(url) < 5) {
              console.log(`[Deduplication] ❌ Job NOT found in Redis: ${url} (jobId: ${jobId}) - will queue`);
            }
          }
        } catch (jobError) {
          // Job doesn't exist or error checking - that's fine, means it's not queued
          // Log errors for debugging (only first few to avoid spam)
          if (urls.indexOf(url) < 5) {
            console.log(`[Deduplication] ❌ Error checking job: ${url} (jobId: ${jobId}), error: ${jobError instanceof Error ? jobError.message : String(jobError)}`);
          }
        }
        return null;
      })
    );
    
    checks.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        queuedUrls.add(result.value);
      } else if (result.status === 'rejected') {
        console.error(`[Deduplication] Promise rejected for URL check:`, result.reason);
      }
    });
  } catch (error) {
    console.error(`Error batch checking if URLs are queued:`, error);
    // Fail open - return empty set
  }
  
  return queuedUrls;
}

/**
 * Check if a URL was already crawled in the project within 14 days
 * This prevents re-crawling the same URL across different audits for the same project
 */
export async function isUrlCrawledInProject(
  url: string,
  projectId: string,
  baseUrl?: string
): Promise<boolean> {
  try {
    const normalized = normalizeUrl(url, baseUrl);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    
    // Check if URL exists in crawl results for ANY audit in this project within 14 days
    const existing = await prisma.crawlResult.findFirst({
      where: {
        url: normalized,
        crawledAt: {
          gte: fourteenDaysAgo, // Crawled within 14 days
        },
        Audit: {
          projectId: projectId,
        },
      },
      select: {
        id: true,
        crawledAt: true,
        Audit: {
          select: {
            id: true,
            projectId: true,
          },
        },
      },
    });

    if (existing) {
      const daysAgo = Math.floor((Date.now() - existing.crawledAt.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`[Deduplication] ⚠️  URL already crawled in project ${projectId} ${daysAgo} days ago: ${normalized}`);
    }

    return !!existing;
  } catch (error) {
    console.error(`Error checking if URL is crawled in project: ${url}`, error);
    return false; // Fail open - allow crawl if check fails
  }
}

/**
 * Check if URL should be crawled (not already crawled or queued)
 * 
 * IMPORTANT: Only checks:
 * 1. If already crawled in THIS audit
 * 2. If already queued in Redis (to prevent duplicate jobs)
 * 
 * Does NOT check project-level 14-day deduplication during queuing.
 * That check is done in the queue processor to prevent re-crawling, but doesn't block initial queuing.
 */
export async function shouldCrawlUrlInAudit(
  url: string,
  auditId: string,
  crawlQueue: any,
  baseUrl?: string,
  projectId?: string // Not used for queuing, but kept for API compatibility
): Promise<boolean> {
  // Check if already crawled in this audit
  const isCrawled = await isUrlCrawledInAudit(url, auditId, baseUrl);
  if (isCrawled) {
    return false;
  }

  // Check if already queued in Redis (this prevents duplicate jobs)
  const isQueued = await isUrlQueuedForAudit(url, auditId, crawlQueue, baseUrl);
  if (isQueued) {
    return false;
  }

  // NOTE: We do NOT check project-level 14-day deduplication here.
  // That check is done in the queue processor (queue.ts) to prevent re-crawling,
  // but it doesn't block URLs from being queued initially.

  return true;
}

/**
 * Batch check if multiple URLs should be crawled
 * OPTIMIZED: Performs batch database queries instead of per-URL queries
 * 
 * IMPORTANT: Only skips URLs that are:
 * 1. Already crawled in THIS audit
 * 2. Already queued in Redis (to prevent duplicate jobs)
 * 
 * Does NOT skip based on 14-day project-level deduplication during queuing.
 * That check is done in the queue processor to prevent re-crawling, but doesn't block initial queuing.
 */
export async function shouldCrawlUrlsInAudit(
  urls: string[],
  auditId: string,
  crawlQueue: any,
  baseUrl?: string,
  projectId?: string // Not used for queuing, but kept for API compatibility
): Promise<Set<string>> {
  const urlsToCrawl = new Set<string>();
  
  try {
    // Normalize all URLs first
    const normalizedUrls = urls.map(url => normalizeUrl(url, baseUrl));
    
    // OPTIMIZED: Batch check if URLs are already crawled in this audit
    const crawledInAudit = await prisma.crawlResult.findMany({
      where: {
        auditId,
        url: {
          in: normalizedUrls,
        },
      },
      select: {
        url: true,
      },
    });
    const crawledSet = new Set(crawledInAudit.map(cr => cr.url));
    
    // OPTIMIZED: Batch check if URLs are already queued in Redis
    // This is the ONLY check we do - if it's not queued and not crawled in this audit, queue it
    const queuedSet = await areUrlsQueuedForAudit(urls, auditId, crawlQueue, baseUrl);
    
    // NOTE: We do NOT check project-level 14-day deduplication here.
    // That check is done in the queue processor (queue.ts) to prevent re-crawling,
    // but it doesn't block URLs from being queued initially.
    // This allows child URLs to be queued even if parent URLs were crawled in previous audits.
    
    // Filter URLs that should be crawled
    normalizedUrls.forEach((normalized, index) => {
      const originalUrl = urls[index];
      const isCrawled = crawledSet.has(normalized);
      const isQueued = queuedSet.has(normalized);
      
      // Log why URLs are being skipped for debugging
      if (isCrawled || isQueued) {
        const reasons: string[] = [];
        if (isCrawled) reasons.push('crawled in audit');
        if (isQueued) reasons.push('queued in Redis');
        console.log(`[Deduplication] ⏭️  Skipping ${originalUrl} (normalized: ${normalized}) - ${reasons.join(', ')}`);
      }
      
      // Only skip if already crawled in THIS audit or already queued in Redis
      if (!isCrawled && !isQueued) {
        urlsToCrawl.add(originalUrl); // Use original URL, not normalized
      }
    });
  } catch (error) {
    console.error(`Error batch checking if URLs should be crawled:`, error);
    // Fail open - return all URLs as crawlable
    urls.forEach(url => urlsToCrawl.add(url));
  }
  
  return urlsToCrawl;
}

