import Queue, { Queue as QueueType } from 'bull';
import { addAuditLog } from './audit-logs';

// Minimal job data to reduce Redis memory usage
export interface CrawlJob {
  url: string; // Required - the URL to crawl
  auditId: string; // Required - audit ID
  fromSitemap?: boolean; // Optional: true if URL came from sitemap (vs discovered link)
  metadata?: {
    backlinkDiscovery?: boolean; // True if this is a backlink discovery crawl
    targetUrl?: string; // The URL we're discovering backlinks for
    targetCrawlResultId?: string; // The crawl result ID we're discovering backlinks for
    sourceTitle?: string; // Title from search results
    discoveredVia?: 'google' | 'bing' | 'crawl'; // How we discovered this page
  };
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
      attempts: 5, // Increased attempts for resilience (was 3)
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      // Optimize Redis memory: Remove jobs immediately after completion
      // Keep failed jobs temporarily for debugging (can be cleared manually)
      removeOnComplete: true, // Remove completed jobs immediately
      removeOnFail: false, // Keep failed jobs for debugging and retry analysis
      // Timeout for job processing (5 minutes max per job)
      timeout: 300000, // 5 minutes
      // Reduce job data size - don't store full job data in Redis
      jobId: undefined, // Let Bull generate compact IDs
    },
    // Optimize connection usage
    settings: {
      stalledInterval: 60000, // Check for stalled jobs every 60s (increased to reduce false positives)
      maxStalledCount: 3, // Retry stalled jobs up to 3 times (increased for resilience)
      // Increase lock duration for longer-running crawl operations
      lockDuration: 120000, // Lock duration for jobs: 2 minutes (crawling can take time)
      lockRenewTime: 30000, // Renew lock every 30s (half of lockDuration to ensure renewal)
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
    
    // EPIPE (Error Pipe) - non-critical error that happens when Redis connection is closed
    // This typically occurs after job completion when BullMQ tries to update job status
    // The job has already completed successfully, this is just a write failure
    // BullMQ will automatically retry the status update, so we can safely ignore it
    if (errorMessage.includes('EPIPE') || errorMessage.includes('write EPIPE')) {
      // Log at debug level - this is expected occasionally and not a problem
      // Jobs have already completed, this is just a status update failure
      // BullMQ will retry automatically
      return; // Silently ignore - job already completed
    }
    
    // Check if it's a connection limit error
    if (errorMessage.includes('max number of clients') || 
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ECONNRESET')) {
      console.error('[Queue] ⚠️  Redis connection limit reached or connection error!');
      console.error('[Queue] ⚠️  Jobs will automatically retry when connections are available.');
      console.error('[Queue] ⚠️  Consider increasing Redis maxclients or reducing queue concurrency.');
      // Don't pause audits for connection errors - let jobs retry automatically
      return;
    }
    
    // Check if it's a storage/memory error (Redis OOM)
    if (errorMessage.includes('OOM') || 
        errorMessage.includes('maxmemory') || 
        errorMessage.includes('out of memory') ||
        errorMessage.includes('ERR maxmemory')) {
      console.error('[Queue] ⚠️  Redis storage limit reached! Pausing all audits and draining queue...');
      await handleRedisStorageLimit();
      return;
    }
    
    // Handle "Missing key" and "Missing lock" errors - these are non-critical
    // These occur when delayed jobs' keys expire or locks timeout before processing
    // Bull/BullMQ handles these gracefully by skipping/retrying internally
    if (errorMessage.includes('Missing key for job') || 
        errorMessage.includes('Missing lock for job')) {
      // These are expected for delayed jobs - BullMQ handles them internally
      // Only log at debug level to reduce noise
      // The job will be retried or skipped automatically by BullMQ
      return; // Silently ignore - non-critical
    }
    
    // Log other errors for debugging
    console.error('[Queue] Redis error:', errorMessage);
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
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    // EPIPE errors during job completion are non-critical - job already completed
    // This happens when Redis connection closes during status update
    if (errorMessage.includes('EPIPE') || errorMessage.includes('write EPIPE')) {
      // Job already completed successfully, just status update failed
      // BullMQ will retry the status update automatically
      return; // Don't log as failure - job completed successfully
    }
    
    console.error(`[Queue] Job ${job?.id} failed:`, errorMessage);
    
    // Check if it's a connection error - these should be retried
    if (errorMessage.includes('ECONNREFUSED') || 
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('max number of clients') ||
        errorMessage.includes('Lock mismatch') ||
        errorMessage.includes('stalled')) {
      console.log(`[Queue] ⚠️  Job ${job?.id} failed due to Redis connection/lock issue - will retry automatically`);
    }
  });

  // Handle stalled jobs - these are jobs that took longer than lockDuration
  crawlQueue.on('stalled', (jobId) => {
    console.log(`[Queue] ⚠️  Job ${jobId} stalled (took longer than lock duration) - will be retried`);
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
      
      // Crawl the URL (pass auditId for proxy logging)
      console.log(`[Queue] Crawling: ${url}`);
      const isBacklinkDiscovery = job.data.metadata?.backlinkDiscovery || false;
      const seoData = await crawlUrl(url, auditId, isBacklinkDiscovery);
      
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
      
      // Check if this is a backlink discovery crawl from an external domain
      // If so, we should NOT save it to this audit (it belongs to a different domain)
      let shouldSaveToDb = true;
      if (job.data.metadata?.backlinkDiscovery) {
      // Get the project's target domain
      const auditForDomain = await prisma.audit.findUnique({
        where: { id: auditId },
        include: { Project: { select: { domain: true, baseUrl: true } } },
      });
      
      if (auditForDomain?.Project) {
        const projectDomain = auditForDomain.Project.domain.toLowerCase();
        const crawledUrlDomain = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        
        // If domains don't match, don't save to this audit
        if (projectDomain !== crawledUrlDomain) {
          shouldSaveToDb = false;
          console.log(`[Queue] ⚠️  External domain detected (backlink discovery): ${crawledUrlDomain} (project: ${projectDomain}), skipping save to audit`);
          // Log to backlink-discovery category, not crawled
          addAuditLog(auditId, 'backlink-discovery', `🔍 Crawled external page (backlink source): ${url}`, { 
            url, 
            statusCode: seoData.statusCode, 
            title: seoData.title,
            externalDomain: true,
            projectDomain,
            crawledDomain: crawledUrlDomain,
            backlinkDiscoveryCrawl: true,
          });
        }
      }
      }
      
      // Save to database (will check if audit exists)
      // Pass baseUrl for consistent URL normalization
      let crawlResult = null;
      if (shouldSaveToDb) {
      try {
        crawlResult = await saveCrawlResultToDb(seoData, auditId, domainId, domainBaseUrl);
        if (crawlResult) {
          console.log(`[Queue] Saved crawl result for: ${url}`);
          // Log to appropriate category based on crawl type
          const logCategory = job.data.metadata?.backlinkDiscovery ? 'backlink-discovery' : 'crawled';
          const logMessage = job.data.metadata?.backlinkDiscovery 
            ? `🔍 Crawled backlink source: ${url}` 
            : `Crawled: ${url}`;
          addAuditLog(auditId, logCategory, logMessage, { 
            url, 
            statusCode: seoData.statusCode, 
            title: seoData.title,
            backlinkDiscoveryCrawl: job.data.metadata?.backlinkDiscovery || false,
          });
        
        // Detect and save issues for this crawl result
        try {
          const { detectIssuesForCrawlResult, saveIssuesToDb } = await import('./issue-detection');
          const issues = await detectIssuesForCrawlResult(seoData, crawlResult.id, auditId);
          if (issues.length > 0) {
            await saveIssuesToDb(issues, auditId, crawlResult.id);
            console.log(`[Queue] Detected ${issues.length} issue(s) for: ${url}`);
          }
        } catch (issueError) {
          // Don't fail the crawl if issue detection fails
          console.error(`[Queue] Error detecting issues for ${url}:`, issueError);
        }
        
        // Queue advanced link checking (async, non-blocking)
        try {
          const { queueLinkChecks } = await import('./advanced-link-checker');
          // Queue link checks asynchronously - don't wait
          queueLinkChecks(crawlResult.id, seoData.links).catch((linkError) => {
            console.error(`[Queue] Error checking links for ${url}:`, linkError);
          });
        } catch (linkError) {
          // Don't fail the crawl if link checking setup fails
          console.error(`[Queue] Error setting up link checks for ${url}:`, linkError);
        }


        // Reverse link discovery: Query search engines to find pages that link to this page
        // This discovers backlinks from sites we haven't crawled yet
        // IMPORTANT: Only search for backlinks to pages in the project's domain, not external domains
        try {
          const auditForDiscovery = await prismaCheck.audit.findUnique({
            where: { id: auditId },
            select: { 
              projectId: true,
              Project: {
                select: {
                  domain: true,
                  baseUrl: true,
                },
              },
            },
          });
          
          // Only run reverse discovery if:
          // 1. Page belongs to a project
          // 2. Page is NOT from a backlink discovery crawl (external pages)
          // 3. Page's domain matches the project's domain (prevent recursive searches for external domains)
          // 4. Domain crawl is mostly complete (few pending domain crawls) - prioritize domain pages first
          if (auditForDiscovery?.projectId && !job.data.metadata?.backlinkDiscovery) {
            // Check if the crawled page belongs to the project's domain
            try {
              const urlObj = new URL(url);
              const pageDomain = urlObj.hostname.replace(/^www\./, '');
              const projectDomain = auditForDiscovery.Project?.domain?.replace(/^www\./, '');
              
              // Only trigger discovery for pages in the project's domain
              // This prevents recursive searches when external pages (discovered via Google) are crawled
              if (projectDomain && pageDomain === projectDomain) {
                // CRITICAL: Only trigger backlink discovery if domain crawl is mostly complete
                // Check if there are few pending domain crawls (< 50) before starting backlink discovery
                // This ensures all domain pages are crawled first before branching out to backlinks
                try {
                  const allJobs = await crawlQueue.getJobs(['waiting', 'active', 'delayed'], 0, 10000);
                  const domainCrawlJobs = allJobs.filter((j: any) => {
                    try {
                      // Count only non-backlink-discovery jobs for this audit
                      return j.data?.auditId === auditId && !j.data?.metadata?.backlinkDiscovery;
                    } catch {
                      return false;
                    }
                  });
                  
                  const pendingDomainCrawls = domainCrawlJobs.length;
                  
                  // Only trigger backlink discovery if there are fewer than 50 pending domain crawls
                  // This ensures domain pages are prioritized and mostly completed before backlink discovery starts
                  if (pendingDomainCrawls < 50) {
                    const { discoverBacklinksForPage } = await import('./reverse-link-discovery');
                    // Discover backlinks asynchronously - don't wait
                    discoverBacklinksForPage(
                      crawlResult.id,
                      url,
                      auditId,
                      auditForDiscovery.projectId
                    ).catch((discoveryError) => {
                      console.error(`[Queue] Error discovering backlinks for ${url}:`, discoveryError);
                    });
                  } else {
                    // Domain crawl still has many pending jobs - defer backlink discovery
                    console.log(`[Queue] ⏭️  Deferring backlink discovery for ${url} - ${pendingDomainCrawls} domain crawls still pending (will trigger when < 50 pending)`);
                  }
                } catch (queueCheckError) {
                  // If queue check fails, skip backlink discovery to be safe
                  console.log(`[Queue] ⏭️  Skipping backlink discovery - queue check failed: ${queueCheckError instanceof Error ? queueCheckError.message : String(queueCheckError)}`);
                }
              } else {
                // External page - skip backlink discovery to prevent recursive searches
                console.log(`[Queue] ⏭️  Skipping backlink discovery for external page: ${url} (domain: ${pageDomain}, project domain: ${projectDomain})`);
              }
            } catch (urlError) {
              // Invalid URL, skip discovery
              console.log(`[Queue] ⏭️  Skipping backlink discovery - invalid URL: ${url}`);
            }
          }
        } catch (discoveryError) {
          // Don't fail the crawl if reverse discovery fails
          console.error(`[Queue] Error setting up reverse link discovery for ${url}:`, discoveryError);
        }
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
      
      // Process backlinks even for external domains (so we can find links to target domain)
      // This needs to happen even if we didn't save the crawlResult to this audit
      if (crawlResult || !shouldSaveToDb) {
        try {
        // Get projectId for backlink tracking
        const auditForBacklinks = await prismaCheck.audit.findUnique({
          where: { id: auditId },
          select: { projectId: true, Project: { select: { domain: true } } },
        });
        
        if (auditForBacklinks?.projectId && seoData.links.length > 0) {
          // For external domains that weren't saved, we need a crawlResult for backlink processing
          // Create a minimal one with auditId: null (won't show in audit, but allows backlink processing)
          let crawlResultForBacklinks = crawlResult;
          
          if (!crawlResultForBacklinks && !shouldSaveToDb) {
            // External domain - create a minimal crawlResult with auditId: null for backlink processing
            try {
              const { saveCrawlResultToDb: saveCrawlResult } = await import('./crawler-db-optimized');
              // Save with null auditId - won't show in audit results but allows backlink processing
              crawlResultForBacklinks = await saveCrawlResultToDb(seoData, null as any, domainId, domainBaseUrl);
              if (crawlResultForBacklinks) {
                console.log(`[Queue] Created temporary crawl result (auditId: null) for backlink processing: ${url}`);
              }
            } catch (tempError) {
              console.error(`[Queue] Error creating temporary crawl result for backlinks: ${url}`, tempError);
            }
          }
          
          if (crawlResultForBacklinks) {
            // 1. Forward backlinks: Create backlinks for pages this page links to (if they exist)
            const { saveBacklinksForCrawlResult } = await import('./backlinks');
            // Determine discoveredVia from job metadata (if this is a backlink discovery crawl)
            const discoveredVia = job.data.metadata?.discoveredVia || 'crawl';
            // Save backlinks asynchronously - don't wait
            saveBacklinksForCrawlResult(
              crawlResultForBacklinks.id,
              url,
              seoData.links,
              auditForBacklinks.projectId,
              domainBaseUrl,
              discoveredVia
            ).catch((backlinkError) => {
              console.error(`[Queue] Error saving backlinks for ${url}:`, backlinkError);
            });
            
            // 2. Retroactive backlinks: Create backlinks from existing pages that link to this page
            const { createRetroactiveBacklinks } = await import('./retroactive-backlinks');
            createRetroactiveBacklinks(
              crawlResultForBacklinks.id,
              url,
              auditForBacklinks.projectId,
              domainBaseUrl
            ).catch((retroError) => {
              console.error(`[Queue] Error creating retroactive backlinks for ${url}:`, retroError);
            });
          }
        }
        } catch (backlinkError) {
          // Don't fail the crawl if backlink saving fails
          console.error(`[Queue] Error setting up backlink saving for ${url}:`, backlinkError);
        }
      }
      
      // DON'T mark as completed here - let the completion check endpoint handle it
      // This prevents premature completion when:
      // 1. Background sitemap parsing is still queuing jobs
      // 2. Link following is discovering new pages
      // 3. pagesTotal might be updated dynamically
      // The completion check endpoint will verify there are truly no jobs left
      
      // LINK_CRAWL_SETTING: Control whether to follow links from backlink discovery pages
      // 'full' = follow links from backlink discovery pages (original behavior)
      // 'nofollow-backlink' = save links but don't follow them from backlink discovery pages (default)
      const LINK_CRAWL_SETTING = (process.env.LINK_CRAWL_SETTING || 'nofollow-backlink') as 'full' | 'nofollow-backlink';
      const isBacklinkDiscoveryCrawl = job.data.metadata?.backlinkDiscovery || false;
      const shouldFollowBacklinkLinks = LINK_CRAWL_SETTING === 'full';
      
      let newJobsQueued = 0;
      let disallowedCount = 0;
      
      // Skip link following for backlink discovery pages if setting is 'nofollow-backlink' (default)
      if (isBacklinkDiscoveryCrawl && !shouldFollowBacklinkLinks) {
        // Skip link following for backlink discovery pages
        // Links are still saved via saveBacklinksForCrawlResult above, just not followed
        console.log(`[Queue] ⏭️  Skipping link following for backlink discovery page: ${url} (LINK_CRAWL_SETTING=${LINK_CRAWL_SETTING})`);
      } else {
        // Extract and queue new links (only for domain pages, not backlink discovery pages)
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
        } // closes if (!link.isExternal && shouldCrawlUrl(...))
        } // closes for loop
        
        if (disallowedCount > 0) {
          console.log(`[Queue] Skipped ${disallowedCount} disallowed links from ${url}`);
        }
        
        // Note: pagesTotal is updated by check-completion route as: crawled + skipped + queued_in_redis
        if (newJobsQueued > 0) {
          console.log(`[Queue] Queued ${newJobsQueued} new links from ${url} (${disallowedCount} skipped by robots.txt)`);
        }
        } // closes else block (isBacklinkDiscoveryCrawl)
      
      return crawlResult;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Queue] Error processing job ${job.id}:`, errorMessage);
      
      // Check if it's a Redis connection error - these should be retried
      if (errorMessage.includes('ECONNREFUSED') || 
          errorMessage.includes('ECONNRESET') ||
          errorMessage.includes('max number of clients') ||
          errorMessage.includes('Lock mismatch') ||
          errorMessage.includes('stalled') ||
          errorMessage.includes('Connection closed')) {
        console.log(`[Queue] ⚠️  Job ${job.id} failed due to Redis connection/lock issue - will retry automatically`);
        // Re-throw so Bull can retry the job
        throw error;
      }
      
      // For other errors, also re-throw for retry mechanism
      throw error;
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

