import Queue, { Queue as QueueType } from 'bull';
import { addAuditLog } from './audit-logs';

// Minimal job data to reduce Redis memory usage
export interface CrawlJob {
  url: string; // Required - the URL to crawl
  auditId: string; // Required - audit ID
  fromSitemap?: boolean; // Optional: true if URL came from sitemap (vs discovered link)
  // Optional fields removed to save memory:
  // domainId - can be derived from URL
  // priority - use default priority
  // depth - use default depth
  // source - not needed for processing
}

// Create Redis connection
// Note: Bull requires Redis. For development, you can use a local Redis instance
// or a cloud Redis service. If Redis is not available, the queue will fail to initialize.
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error('[Queue] ❌ REDIS_URL is not set in environment variables!');
  console.error('[Queue] Please add REDIS_URL to your .env file');
}

// Bull needs to create its own Redis clients
// We can't use createClient with maxRetriesPerRequest or enableReadyCheck
// Pass connection config directly to Bull
// IMPORTANT: Bull creates 2 connections per queue (client + subscriber)
// To minimize connections, we use a singleton pattern
const redisConfig = REDIS_URL 
  ? REDIS_URL  // Connection string - Bull will parse it
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    };

console.log('[Queue] Redis config:', REDIS_URL ? 'Using REDIS_URL' : `Using host/port: ${typeof redisConfig === 'object' ? `${redisConfig.host}:${redisConfig.port}` : 'connection string'}`);

// Singleton pattern to ensure only ONE queue instance exists
// This prevents multiple Redis connections from being created
// Use global to persist across Next.js hot reloads
declare global {
  // eslint-disable-next-line no-var
  var __crawlQueueInstance: QueueType<CrawlJob> | undefined;
}

function getQueue(): QueueType<CrawlJob> {
  // In development, Next.js hot reload can reset module state
  // Use global to persist the queue instance across hot reloads
  if (process.env.NODE_ENV === 'development') {
    if (!global.__crawlQueueInstance) {
      global.__crawlQueueInstance = createQueueInstance();
    }
    return global.__crawlQueueInstance;
  }
  
  // In production, use module-level singleton
  if (!queueInstance) {
    queueInstance = createQueueInstance();
  }
  return queueInstance;
}

let queueInstance: QueueType<CrawlJob> | null = null;

function createQueueInstance(): QueueType<CrawlJob> {
  const queue = new Queue<CrawlJob>('crawl', {
    redis: redisConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      // Optimize Redis memory: Remove jobs immediately after completion/failure
      // This saves Redis memory but loses job history for debugging
      removeOnComplete: true, // Remove completed jobs immediately
      removeOnFail: true, // Remove failed jobs immediately
      // Reduce job data size - don't store full job data in Redis
      jobId: undefined, // Let Bull generate compact IDs
    },
    // Optimize connection usage
    settings: {
      stalledInterval: 30000, // Check for stalled jobs every 30s
      maxStalledCount: 1, // Only retry stalled jobs once
      // Reduce connection overhead
      lockDuration: 30000, // Lock duration for jobs
      lockRenewTime: 15000, // Renew lock every 15s
    },
    // Don't use createClient - let Bull manage its own connections
    // Bull will create 2 connections (client + subscriber) which is the minimum
  });
  
  console.log('[Queue] ✅ Queue instance created (singleton - uses 2 Redis connections)');
  return queue;
}

export const crawlQueue = getQueue();

// Only register event listeners once to prevent duplicates and memory leaks
if (!global.__queueEventListenersRegistered) {
  global.__queueEventListenersRegistered = true;
  
  // Handle Redis connection errors
  crawlQueue.on('error', (error) => {
    console.error('[Queue] Redis connection error:', error);
  });

  crawlQueue.on('waiting', (jobId) => {
    // Only log occasionally to reduce noise
    // console.log(`[Queue] Job ${jobId} is waiting`);
  });

  crawlQueue.on('active', (job) => {
    const delayInfo = job.opts.delay ? ` (delayed by ${job.opts.delay}ms)` : '';
    console.log(`[Queue] Job ${job.id} is now active: ${job.data.url}${delayInfo}`);
  });

  crawlQueue.on('completed', (job) => {
    console.log(`[Queue] Job ${job.id} completed: ${job.data.url}`);
  });

  crawlQueue.on('failed', (job, err) => {
    console.error(`[Queue] Job ${job?.id} failed:`, err.message);
  });
}

// Test Redis connection on startup
crawlQueue.isReady()
  .then(() => {
    console.log('[Queue] ✅ Redis connection established');
  })
  .catch((error: unknown) => {
    console.error('[Queue] ❌ Redis connection failed:', error);
    console.error('[Queue] Make sure REDIS_URL is set correctly in .env');
  });

// Process crawl jobs
// IMPORTANT: This processor must be initialized for jobs to be processed
// Use a global flag to prevent multiple processor registrations (especially in Next.js hot reload)
declare global {
  // eslint-disable-next-line no-var
  var __queueProcessorRegistered: boolean | undefined;
  // eslint-disable-next-line no-var
  var __queueEventListenersRegistered: boolean | undefined;
}

// Check if processor is already registered by checking if queue has workers
// Bull throws an error if you try to register the same processor twice
if (!global.__queueProcessorRegistered) {
  try {
    // Check if processor is already registered by trying to get workers
    // If this doesn't throw, processor might already exist, but we'll try to register anyway
    console.log('[Queue] 🔄 Setting up crawl job processor...');
    global.__queueProcessorRegistered = true;
    
    // Process multiple jobs concurrently for faster crawling
    // Default is 10, but we can process multiple jobs at once
    // This significantly speeds up crawling while still respecting rate limits
    // Each job still respects crawl delay, but multiple jobs run in parallel
    const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || '10');
    console.log(`[Queue] Processing with concurrency: ${concurrency} (set QUEUE_CONCURRENCY env var to change)`);
    
    crawlQueue.process(concurrency, async (job) => {
  const { url, auditId } = job.data;
  
  // Derive domainId from URL if needed
  let domainId: string | undefined;
  let domainBaseUrl: string;
  try {
    const urlObjForDomain = new URL(url);
    const domain = urlObjForDomain.hostname.replace(/^www\./, '');
    domainBaseUrl = `${urlObjForDomain.protocol}//${urlObjForDomain.host}`;
    const { prisma: prismaClient } = await import('./prisma');
    const domainRecord = await prismaClient.domain.findUnique({
      where: { domain },
      select: { id: true },
    });
    domainId = domainRecord?.id;
  } catch (error) {
    // Ignore domain lookup errors, but set domainBaseUrl
    try {
      const urlObjForDomain = new URL(url);
      domainBaseUrl = `${urlObjForDomain.protocol}//${urlObjForDomain.host}`;
    } catch {
      domainBaseUrl = url;
    }
  }
  
  console.log(`[Queue] 🚀 Processing job ${job.id}: ${url} (audit: ${auditId})`);
  
  // CRITICAL: Check if audit exists BEFORE any processing
  const { prisma: prismaCheck } = await import('./prisma');
  let auditCheck;
  try {
    auditCheck = await prismaCheck.audit.findUnique({
      where: { id: auditId },
      select: { status: true },
    });
  } catch (error) {
    console.error(`[Queue] Error checking audit ${auditId}:`, error);
    // If we can't check, skip this job to be safe
    return null;
  }

  // If audit doesn't exist (was deleted), skip job immediately
  if (!auditCheck) {
    console.log(`[Queue] ⚠️  Audit ${auditId} not found (deleted), skipping job ${job.id}`);
    // Try to remove job (only works for waiting/delayed, not active)
    try {
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
      } else {
        // Active job - can't remove, but we return null so it won't save results
        console.log(`[Queue] Job ${job.id} is active, cannot remove but will skip processing`);
      }
    } catch (error) {
      // Job might be in a state we can't remove
      console.log(`[Queue] Could not remove job ${job.id}, but will skip processing`);
    }
    return null; // Skip processing
  }

  // If audit is paused or stopped, skip processing
  if (auditCheck.status === 'paused' || auditCheck.status === 'stopped') {
    console.log(`[Queue] ⏸️  Audit ${auditId} is ${auditCheck.status}, skipping job ${job.id}`);
    // Try to remove job from queue (only if not active)
    try {
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
      }
    } catch {
      // Job might be active, can't remove it
    }
    return null;
  }
  
  try {
    // Import here to avoid circular dependencies
    const { crawlUrl } = await import('./crawler');
    // Use optimized DB save function
    const { saveCrawlResultToDb } = await import('./crawler-db-optimized');
    const { extractLinksFromCrawlResult, shouldCrawlUrl } = await import('./link-follower');
    const { shouldCrawlUrlInAudit } = await import('./deduplication');
    const { prisma } = await import('./prisma');
    
    // CRITICAL: Check robots.txt before crawling
    // IMPORTANT: Get robots.txt for the domain, not the specific URL
    // This is a safety check - URLs should have been filtered before queuing,
    // but we check again here to ensure we never crawl disallowed URLs
    // NOTE: The isAllowed() function in robots.ts now handles trailing slash variants
    // automatically, so we just need to call it once
    const { getRobotsTxt } = await import('./robots');
    let robotsTxt;
    let crawlDelay: number;
    try {
      robotsTxt = await getRobotsTxt(domainBaseUrl);
      
      // Get crawl delay from robots.txt (for rate limiting between jobs)
      // Use crawlDelay from robots.txt, default to 0.5 seconds if not set
      const defaultCrawlDelay = parseFloat(process.env.CRAWL_DELAY_SECONDS || '0.5');
      crawlDelay = robotsTxt.getCrawlDelay() || defaultCrawlDelay;
    } catch (error) {
      console.error(`[Queue] ❌ CRITICAL: Failed to get robots.txt for ${domainBaseUrl}:`, error);
      // Fail closed - if we can't check robots.txt, don't crawl
      console.log(`[Queue] 🚫 Cannot verify robots.txt, skipping crawl for safety: ${url}`);
      return null;
    }
    
    // Check if URL is allowed (isAllowed() handles trailing slash variants internally)
    // CRITICAL: This check MUST happen before any crawling occurs
    let isAllowed: boolean;
    try {
      const checkResult = robotsTxt.isAllowed(url);
      // CRITICAL: Explicitly convert to boolean - ensure false is false, not undefined
      isAllowed = checkResult === true; // Only true if explicitly true
      
      // Log the check result for debugging
      if (!isAllowed) {
        console.log(`[Queue] 🚫 Robots.txt check: URL disallowed: ${url}`);
        console.log(`[Queue] 🚫 Check result was: ${checkResult} (type: ${typeof checkResult})`);
      } else {
        console.log(`[Queue] ✅ Robots.txt check passed: ${url}`);
      }
    } catch (error) {
      console.error(`[Queue] ❌ CRITICAL: Error checking robots.txt for ${url}:`, error);
      // Fail closed - if check fails, don't crawl
      console.log(`[Queue] 🚫 Robots.txt check failed, skipping crawl for safety: ${url}`);
      return null;
    }
    
    // CRITICAL: Double-check - if not explicitly allowed, block
    if (!isAllowed) {
      console.log(`[Queue] 🚫 URL disallowed by robots.txt, skipping crawl: ${url}`);
      console.log(`[Queue] 🚫 This URL should NOT have been queued. Check queuing logic for bugs.`);
      // Don't throw error - just skip this job
      // This prevents retries and marks job as completed (skipped)
      // The job will be removed from queue automatically (removeOnComplete: true)
      return null;
    }

    // IMPORTANT: Double-check database deduplication before crawling
    // BUT: Don't check if URL is already in queue (including active) because this job IS the active job
    // Check if URL was already crawled in this audit OR in the project within 14 days
    let alreadyCrawled = false;
    try {
      const { isUrlCrawledInAudit, isUrlCrawledInProject } = await import('./deduplication');
      
      // First check if crawled in this audit
      const crawledInAudit = await isUrlCrawledInAudit(url, auditId, domainBaseUrl);
      if (crawledInAudit) {
        alreadyCrawled = true;
      } else {
        // Also check if crawled in the project within 14 days
        const auditCheck = await prisma.audit.findUnique({
          where: { id: auditId },
          select: { projectId: true },
        });
        
        if (auditCheck) {
          const crawledInProject = await isUrlCrawledInProject(url, auditCheck.projectId, domainBaseUrl);
          if (crawledInProject) {
            alreadyCrawled = true;
          }
        }
      }
    } catch (error) {
      console.error(`[Queue] Error checking if URL is crawled: ${url}`, error);
      // Continue with crawl if check fails (fail open)
    }
    
    if (alreadyCrawled) {
      console.log(`[Queue] ⏭️  URL already crawled in database (audit or project within 14 days), skipping: ${url}`);
      return null; // Skip this job - already crawled
    }

    // CRITICAL: Final robots.txt check right before crawling (defense in depth)
    // This is a last-chance check to prevent any disallowed URLs from being crawled
    const finalCheck = robotsTxt.isAllowed(url);
    if (finalCheck !== true) {
      console.log(`[Queue] 🚫 FINAL CHECK: URL disallowed by robots.txt, aborting crawl: ${url}`);
      console.log(`[Queue] 🚫 Final check result: ${finalCheck}`);
      return null;
    }
    
    // Apply crawl delay BEFORE crawling (respect robots.txt rate limiting)
    // This ensures we don't overwhelm the server
    // Note: crawlDelay is defined above when loading robots.txt
    const delayMs = crawlDelay * 1000;
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    // Crawl the URL
    console.log(`[Queue] Crawling: ${url}`);
    const seoData = await crawlUrl(url);
    
    // Skip saving 404 pages - they're errors, not valid pages
    if (seoData.statusCode === 404) {
      console.log(`[Queue] ⚠️  404 Not Found - skipping save for: ${url}`);
      addAuditLog(auditId, 'skipped', `404 Not Found: ${url}`, { url, statusCode: 404, reason: '404' });
      // Still return null so job is marked as completed, but don't save to database
      return null;
    }
    
    // Save to database (will check if audit exists)
    // Pass baseUrl for consistent URL normalization
    let crawlResult;
    try {
      crawlResult = await saveCrawlResultToDb(seoData, auditId, domainId, domainBaseUrl);
      if (crawlResult) {
        console.log(`[Queue] Saved crawl result for: ${url}`);
        addAuditLog(auditId, 'crawled', `Crawled: ${url}`, { url, statusCode: seoData.statusCode, title: seoData.title });
      } else {
        console.log(`[Queue] ⚠️  Duplicate crawl result, skipping save and increment for: ${url}`);
        // Don't increment pagesCrawled if it was a duplicate
        return null;
      }
    } catch (error: any) {
      // If audit was deleted (foreign key constraint or not found error), skip this job
      if (error?.message?.includes('not found') || 
          error?.code === 'P2003' || 
          error?.code === 'P2025') {
        console.log(`[Queue] ⚠️  Audit ${auditId} not found (deleted), skipping save for job ${job.id}`);
        // Don't try to remove active jobs - just return null
        try {
          const state = await job.getState();
          if (state === 'waiting' || state === 'delayed') {
            await job.remove();
          }
        } catch {
          // Can't remove, that's okay - job will complete but won't save
        }
        return null; // Skip this job - don't save results
      }
      throw error; // Re-throw other errors
    }
    
    // Update audit progress (check if audit still exists)
    // Only increment if we actually saved a crawl result (crawlResult is not null)
    let updatedAudit;
    try {
      updatedAudit = await prisma.audit.update({
        where: { id: auditId },
        data: {
          pagesCrawled: {
            increment: 1,
          },
        },
      });
    } catch (error: any) {
      // If audit was deleted, log and continue
      if (error?.code === 'P2025' || error?.code === 'P2003') {
        console.log(`[Queue] ⚠️  Audit ${auditId} was deleted, cannot update progress`);
        // Don't return crawlResult - it wasn't saved anyway
        return null; // Skip this job
      }
      throw error; // Re-throw other errors
    }
    
    // DON'T mark as completed here - let the completion check endpoint handle it
    // This prevents premature completion when:
    // 1. Background sitemap parsing is still queuing jobs
    // 2. Link following is discovering new pages
    // 3. pagesTotal might be updated dynamically
    // The completion check endpoint will verify there are truly no jobs left
    
    // Extract and queue new links
    const newLinks = extractLinksFromCrawlResult(seoData, url);
    const baseUrl = new URL(url).origin;
    // Use crawlDelay from robots.txt, default to 0.5 seconds if not set (faster crawling)
    // Can be overridden with CRAWL_DELAY_SECONDS environment variable
    // Note: crawlDelay is already defined above in the processor function
    const defaultCrawlDelay = parseFloat(process.env.CRAWL_DELAY_SECONDS || '0.5');
    const linkCrawlDelay = robotsTxt.getCrawlDelay() || defaultCrawlDelay;
    
    let newJobsQueued = 0;
    let disallowedCount = 0;
    // Limit link following to prevent infinite crawling
    // Only follow internal links from same domain
    const maxLinksToFollow = 20; // Limit links per page to prevent explosion
    
    // Check if audit is paused or stopped - don't queue new links if so
    const currentAudit = await prisma.audit.findUnique({
      where: { id: auditId },
      select: { status: true },
    });

    if (currentAudit?.status === 'paused' || currentAudit?.status === 'stopped') {
      console.log(`[Queue] Audit ${auditId} is ${currentAudit.status}, not queuing new links`);
      return crawlResult;
    }

    for (const link of newLinks.slice(0, maxLinksToFollow)) {
      // Only follow internal links (same domain)
      if (!link.isExternal && shouldCrawlUrl(link.href, url, 0)) {
        // CRITICAL: Check robots.txt BEFORE queuing discovered links
        // Never queue URLs that are disallowed by robots.txt
        // Use the same robots.txt instance that was used for the current page
        // NOTE: isAllowed() handles trailing slash variants internally
        let linkIsAllowed: boolean;
        try {
          linkIsAllowed = robotsTxt.isAllowed(link.href);
        } catch (error) {
          console.error(`[Queue] ❌ Error checking robots.txt for link ${link.href}:`, error);
          // Fail closed - if check fails, don't queue
          linkIsAllowed = false;
        }
        
        if (!linkIsAllowed) {
          console.log(`[Queue] 🚫 Link disallowed by robots.txt, skipping: ${link.href}`);
          console.log(`[Queue] 🚫 This link will NOT be queued or crawled`);
          disallowedCount++;
          continue;
        }
        
        // IMPORTANT: Check database deduplication before queuing
        // This checks: already crawled in audit, already queued, or crawled in project within 14 days
        // Get projectId for project-level deduplication (14-day check)
        const auditCheck = await prisma.audit.findUnique({
          where: { id: auditId },
          select: { projectId: true },
        });
        const shouldCrawlLink = await shouldCrawlUrlInAudit(
          link.href, 
          auditId, 
          crawlQueue, 
          baseUrl,
          auditCheck?.projectId // This enables 14-day project-level deduplication check
        );
        if (!shouldCrawlLink) {
          continue; // Already crawled, queued, or crawled in project within 14 days
        }
        
        // CRITICAL: Use jobId to prevent duplicate jobs for the same URL
        // This creates a unique job ID based on URL + auditId, preventing duplicates
        const { normalizeUrl: normalizeUrlForJob } = await import('./robots');
        const normalizedLinkUrl = normalizeUrlForJob(link.href, baseUrl);
        const jobId = `${auditId}:${Buffer.from(normalizedLinkUrl).toString('base64').slice(0, 50)}`; // Unique job ID
        
        try {
          // Don't add delay when queuing - delay is handled by the processor
          // Adding delay here would make later jobs wait too long
          const job = await crawlQueue.add(
            {
              url: link.href,
              auditId,
            },
            {
              jobId, // Unique job ID prevents duplicates
              priority: 5, // Lower priority for discovered links
              // No delay - processor handles rate limiting
            }
          );
          newJobsQueued++;
          // Log first few jobs to console to verify they're being queued
          if (newJobsQueued <= 3) {
            console.log(`[Queue] Queued link job ${job.id}: ${link.href} (delay: ${delayMs}ms)`);
          }
          // Always add audit log for all queued jobs
          addAuditLog(auditId, 'queued', `Queued: ${link.href}`, { url: link.href, jobId: job.id, source: 'link-following' });
          
          // CRITICAL: Set pagesTotal = count of queued logs (no math, no increment, just count and set)
          try {
            const queuedLogCount = await prisma.auditLog.count({
              where: {
                auditId,
                category: 'queued',
              },
            });
            await prisma.audit.update({
              where: { id: auditId },
              data: {
                pagesTotal: queuedLogCount,
              },
            });
          } catch (error) {
            // Non-critical - log but don't fail
            console.error(`[Queue] Failed to update pagesTotal for ${link.href}:`, error);
          }
        } catch (error: any) {
          // If job already exists (duplicate jobId), skip it
          if (error?.message?.includes('already exists') || error?.code === 'DUPLICATE_JOB') {
            console.log(`[Queue] ⏭️  Skipping duplicate job for ${normalizedLinkUrl}`);
            continue;
          }
          throw error; // Re-throw other errors
        }
      }
    }
    
    if (disallowedCount > 0) {
      console.log(`[Queue] Skipped ${disallowedCount} disallowed links from ${url}`);
    }
    
    // Note: pagesTotal is updated per-URL when each queued log is added (see line ~499)
    // No batch-level update needed - pagesTotal = total queued log count
    if (newJobsQueued > 0) {
      console.log(`[Queue] Queued ${newJobsQueued} new links from ${url} (${disallowedCount} skipped by robots.txt)`);
    }
    
    return crawlResult;
  } catch (error) {
    console.error(`[Queue] Error processing job ${job.id}:`, error);
    throw error; // Re-throw so Bull can handle retries
  }
    });
    
    console.log('✅ Queue processor registered and ready to process jobs');
  } catch (error: any) {
    // If processor is already registered, Bull will throw an error
    // Reset the flag so we don't try again
    if (error?.message?.includes('Cannot define the same handler twice') || 
        error?.message?.includes('already registered')) {
      console.log('[Queue] ⚠️  Processor already registered, skipping...');
      global.__queueProcessorRegistered = true; // Mark as registered to prevent retries
    } else {
      // Re-throw other errors
      console.error('[Queue] ❌ Error registering processor:', error);
      throw error;
    }
  }
}

// Event listeners are now registered above in a single block to prevent duplicates

// Verify processor is set up
crawlQueue.isReady()
  .then(() => {
    console.log('[Queue] ✅ Queue is ready and processor is active');
  })
  .catch((error: unknown) => {
    console.error('[Queue] ❌ Queue failed to initialize:', error);
  });

