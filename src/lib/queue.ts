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

/**
 * Handle Redis storage limit - pause all audits and drain queue
 * This allows current jobs to complete and frees up Redis memory
 */
async function handleRedisStorageLimit() {
  try {
    const { prisma } = await import('./prisma');
    
    // Pause all in_progress audits
    const inProgressAudits = await prisma.audit.findMany({
      where: { status: 'in_progress' },
      select: { id: true },
    });
    
    if (inProgressAudits.length > 0) {
      console.log(`[Queue] Pausing ${inProgressAudits.length} in-progress audit(s) due to Redis storage limit...`);
      await prisma.audit.updateMany({
        where: { status: 'in_progress' },
        data: { status: 'paused' },
      });
      
      // Add audit logs
      for (const audit of inProgressAudits) {
        const { addAuditLog } = await import('./audit-logs');
        addAuditLog(audit.id, 'setup', '⚠️ Audit paused: Redis storage limit reached. Queue will be drained.', {
          reason: 'redis_storage_limit',
        });
      }
    }
    
    // Get current queue stats
    const [waiting, active, delayed] = await Promise.all([
      crawlQueue.getWaitingCount(),
      crawlQueue.getActiveCount(),
      crawlQueue.getDelayedCount(),
    ]);
    
    console.log(`[Queue] Current queue state: waiting=${waiting}, active=${active}, delayed=${delayed}`);
    console.log(`[Queue] ⚠️  All audits paused. Processing ${active} active jobs to drain queue...`);
    console.log(`[Queue] ⚠️  After active jobs complete, ${waiting + delayed} jobs will remain in queue but won't be processed.`);
    console.log(`[Queue] ⚠️  Please increase Redis storage or clear old jobs, then resume audits manually.`);
    
  } catch (error) {
    console.error('[Queue] Error handling Redis storage limit:', error);
  }
}

// Only register event listeners once to prevent duplicates and memory leaks
if (!global.__queueEventListenersRegistered) {
  global.__queueEventListenersRegistered = true;
  
  // Handle Redis connection errors and storage limits
  crawlQueue.on('error', async (error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Queue] Redis error:', errorMessage);
    
    // Check if it's a storage/memory error (Redis OOM)
    if (errorMessage.includes('OOM') || 
        errorMessage.includes('maxmemory') || 
        errorMessage.includes('out of memory') ||
        errorMessage.includes('ERR maxmemory')) {
      console.error('[Queue] ⚠️  Redis storage limit reached! Pausing all audits and draining queue...');
      await handleRedisStorageLimit();
    }
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
  
  // CRITICAL: Check if audit exists and is not stopped/paused BEFORE any processing or logging
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

  // If audit doesn't exist (was deleted), skip job immediately (no log to reduce noise)
  if (!auditCheck) {
    // Try to remove job (only works for waiting/delayed, not active)
    try {
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
      }
    } catch {
      // Job might be in a state we can't remove
    }
    return null; // Skip processing silently
  }

  // If audit is paused or stopped, skip processing immediately (no log to reduce noise)
  if (auditCheck.status === 'paused' || auditCheck.status === 'stopped') {
    // Try to remove job from queue (only if not active)
    try {
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
      }
    } catch {
      // Job might be active, can't remove it
    }
    return null; // Skip processing silently
  }
  
  // Only log "Processing" if we're actually going to process the job
  console.log(`[Queue] 🚀 Processing job ${job.id}: ${url} (audit: ${auditId})`);
  
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
      // IMPORTANT: Cap crawl delay to prevent extremely slow crawling (some sites set 5+ minutes!)
      // Maximum delay is 5 seconds - if robots.txt specifies more, cap it
      const defaultCrawlDelay = parseFloat(process.env.CRAWL_DELAY_SECONDS || '0.5');
      const robotsCrawlDelay = robotsTxt.getCrawlDelay();
      const maxCrawlDelay = parseFloat(process.env.MAX_CRAWL_DELAY_SECONDS || '5'); // Cap at 5 seconds max
      crawlDelay = robotsCrawlDelay 
        ? Math.min(robotsCrawlDelay, maxCrawlDelay) // Cap the delay
        : defaultCrawlDelay;
      
      // Log if we're capping the delay
      if (robotsCrawlDelay && robotsCrawlDelay > maxCrawlDelay) {
        console.log(`[Queue] ⚠️  robots.txt specifies crawl-delay: ${robotsCrawlDelay}s, capping to ${maxCrawlDelay}s for reasonable performance`);
      }
    } catch (error) {
      console.error(`[Queue] ❌ CRITICAL: Failed to get robots.txt for ${domainBaseUrl}:`, error);
      // Fail closed - if we can't check robots.txt, don't crawl
      console.log(`[Queue] 🚫 Cannot verify robots.txt, skipping crawl for safety: ${url}`);
      addAuditLog(auditId, 'skipped', `Skipped (robots.txt check failed): ${url}`, { url, reason: 'robots.txt-failed', error: error instanceof Error ? error.message : String(error) });
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
      addAuditLog(auditId, 'skipped', `Skipped (robots.txt check error): ${url}`, { url, reason: 'robots.txt-error', error: error instanceof Error ? error.message : String(error) });
      return null;
    }
    
    // CRITICAL: Double-check - if not explicitly allowed, block
    if (!isAllowed) {
      console.log(`[Queue] 🚫 URL disallowed by robots.txt, skipping crawl: ${url}`);
      console.log(`[Queue] 🚫 This URL should NOT have been queued. Check queuing logic for bugs.`);
      addAuditLog(auditId, 'skipped', `Skipped by robots.txt: ${url}`, { url, reason: 'robots.txt' });
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
      addAuditLog(auditId, 'skipped', `Skipped (already crawled): ${url}`, { url, reason: 'duplicate' });
      return null; // Skip this job - already crawled
    }

    // CRITICAL: Final robots.txt check right before crawling (defense in depth)
    // This is a last-chance check to prevent any disallowed URLs from being crawled
    const finalCheck = robotsTxt.isAllowed(url);
    if (finalCheck !== true) {
      console.log(`[Queue] 🚫 FINAL CHECK: URL disallowed by robots.txt, aborting crawl: ${url}`);
      console.log(`[Queue] 🚫 Final check result: ${finalCheck}`);
      addAuditLog(auditId, 'skipped', `Skipped by robots.txt (final check): ${url}`, { url, reason: 'robots.txt' });
      return null;
    }
    
    // CRITICAL: Re-check audit status before crawling (stop might have been clicked)
    const preCrawlAuditCheck = await prismaCheck.audit.findUnique({
      where: { id: auditId },
      select: { status: true },
    });
    if (!preCrawlAuditCheck || preCrawlAuditCheck.status === 'stopped' || preCrawlAuditCheck.status === 'paused') {
      console.log(`[Queue] ⏸️  Audit ${auditId} is ${preCrawlAuditCheck?.status || 'not found'}, aborting job ${job.id} before crawl`);
      return null;
    }
    
    // Apply crawl delay BEFORE crawling (respect robots.txt rate limiting)
    // This ensures we don't overwhelm the server
    // Note: crawlDelay is defined above when loading robots.txt
    // For long delays, check status periodically to allow faster cancellation
    const delayMs = crawlDelay * 1000;
    if (delayMs > 0) {
      // For delays longer than 1 second, check status every 500ms to allow faster cancellation
      if (delayMs > 1000) {
        const checkInterval = 500; // Check every 500ms
        const totalChecks = Math.ceil(delayMs / checkInterval);
        for (let i = 0; i < totalChecks; i++) {
          await new Promise(resolve => setTimeout(resolve, Math.min(checkInterval, delayMs - (i * checkInterval))));
          
          // Check status during delay to allow immediate cancellation
          const delayAuditCheck = await prismaCheck.audit.findUnique({
            where: { id: auditId },
            select: { status: true },
          });
          if (!delayAuditCheck || delayAuditCheck.status === 'stopped' || delayAuditCheck.status === 'paused') {
            console.log(`[Queue] ⏸️  Audit ${auditId} is ${delayAuditCheck?.status || 'not found'}, aborting job ${job.id} during delay`);
            return null;
          }
        }
      } else {
        // For short delays, just wait
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    // CRITICAL: Re-check audit status after delay (stop might have been clicked during delay)
    const postDelayAuditCheck = await prismaCheck.audit.findUnique({
      where: { id: auditId },
      select: { status: true },
    });
    if (!postDelayAuditCheck || postDelayAuditCheck.status === 'stopped' || postDelayAuditCheck.status === 'paused') {
      console.log(`[Queue] ⏸️  Audit ${auditId} is ${postDelayAuditCheck?.status || 'not found'}, aborting job ${job.id} after delay`);
      return null;
    }
    
    // Crawl the URL
    console.log(`[Queue] Crawling: ${url}`);
    const seoData = await crawlUrl(url);
    
    // CRITICAL: Re-check audit status after crawling (stop might have been clicked during crawl)
    const postCrawlAuditCheck = await prismaCheck.audit.findUnique({
      where: { id: auditId },
      select: { status: true },
    });
    if (!postCrawlAuditCheck || postCrawlAuditCheck.status === 'stopped' || postCrawlAuditCheck.status === 'paused') {
      console.log(`[Queue] ⏸️  Audit ${auditId} is ${postCrawlAuditCheck?.status || 'not found'}, aborting job ${job.id} after crawl (not saving)`);
      return null;
    }
    
    // Skip saving 404 pages - they're errors, not valid pages
    if (seoData.statusCode === 404) {
      console.log(`[Queue] ⚠️  404 Not Found - skipping save for: ${url}`);
      addAuditLog(auditId, 'skipped', `404 Not Found: ${url}`, { url, statusCode: 404, reason: '404' });
      // Still return null so job is marked as completed, but don't save to database
      return null;
    }
    
    // CRITICAL: Re-check audit status before saving (stop might have been clicked)
    const preSaveAuditCheck = await prismaCheck.audit.findUnique({
      where: { id: auditId },
      select: { status: true },
    });
    if (!preSaveAuditCheck || preSaveAuditCheck.status === 'stopped' || preSaveAuditCheck.status === 'paused') {
      console.log(`[Queue] ⏸️  Audit ${auditId} is ${preSaveAuditCheck?.status || 'not found'}, aborting job ${job.id} before save`);
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
        addAuditLog(auditId, 'skipped', `Skipped (duplicate crawl result): ${url}`, { url, reason: 'duplicate-result' });
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
    
    // CRITICAL: Re-check audit status before updating progress (stop might have been clicked)
    const preUpdateAuditCheck = await prismaCheck.audit.findUnique({
      where: { id: auditId },
      select: { status: true },
    });
    if (!preUpdateAuditCheck || preUpdateAuditCheck.status === 'stopped' || preUpdateAuditCheck.status === 'paused') {
      console.log(`[Queue] ⏸️  Audit ${auditId} is ${preUpdateAuditCheck?.status || 'not found'}, aborting job ${job.id} before progress update`);
      return null;
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
      // If audit was deleted or stopped, log and continue
      if (error?.code === 'P2025' || error?.code === 'P2003') {
        console.log(`[Queue] ⚠️  Audit ${auditId} was deleted or stopped, cannot update progress`);
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
    // IMPORTANT: Cap crawl delay to prevent extremely slow crawling
    // Note: crawlDelay is already defined above in the processor function
    const defaultCrawlDelay = parseFloat(process.env.CRAWL_DELAY_SECONDS || '0.5');
    const maxCrawlDelay = parseFloat(process.env.MAX_CRAWL_DELAY_SECONDS || '5'); // Cap at 5 seconds max
    const robotsLinkDelay = robotsTxt.getCrawlDelay();
    const linkCrawlDelay = robotsLinkDelay 
      ? Math.min(robotsLinkDelay, maxCrawlDelay) // Cap the delay
      : defaultCrawlDelay;
    
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
        // Use SHA-256 hash to create unique, fixed-length jobId (prevents collisions from truncation)
        const { createHash } = await import('crypto');
        const urlHash = createHash('sha256').update(normalizedLinkUrl).digest('base64').slice(0, 32);
        const jobId = `${auditId}:${urlHash}`; // Unique job ID
        
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
          
          // Note: pagesTotal is updated by check-completion route as: crawled + skipped + queued_in_redis
        } catch (error: any) {
          const errorMessage = error?.message || String(error);
          
          // Check for Redis storage limit errors
          if (errorMessage.includes('OOM') || 
              errorMessage.includes('maxmemory') || 
              errorMessage.includes('out of memory') ||
              errorMessage.includes('ERR maxmemory')) {
            console.error(`[Queue] ⚠️  Redis storage limit reached while queuing link: ${link.href}`);
            console.error(`[Queue] ⚠️  Stopping link following for this URL. Active jobs will continue to drain queue.`);
            // Don't throw - just stop following links for this URL
            break;
          }
          
          // If job already exists (duplicate jobId), skip it
          if (errorMessage.includes('already exists') || error?.code === 'DUPLICATE_JOB') {
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
    
    // Note: pagesTotal is updated by check-completion route as: crawled + skipped + queued_in_redis
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

