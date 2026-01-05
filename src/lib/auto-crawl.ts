import { prisma } from './prisma';
import { discoverSitemaps, parseSitemap } from './sitemap';
import { getRobotsTxt, normalizeUrl } from './robots';
import { crawlQueue } from './queue'; // Import queue directly
import { shouldCrawlUrlInAudit, shouldCrawlUrlsInAudit } from './deduplication';
import { addAuditLog } from './audit-logs';

export async function startAutomaticCrawl(
  auditId: string,
  skipRecentUrls: string[] = [],
  skipRobotsCheck: boolean = false, // If true, skip robots.txt requirement (for approved crawls)
  allowResume: boolean = false // If true, allow resuming paused/stopped audits
): Promise<{
  sitemapsFound: number;
  urlsQueued: number;
  baseUrl: string;
}> {
  console.log(`[Auto-Crawl] 🚀 Starting automatic crawl for audit ${auditId}...`);
  
  // CRITICAL: Add initial log immediately to ensure logs are visible from the start
  addAuditLog(auditId, 'setup', `🚀 Starting automatic crawl for audit ${auditId}...`, { auditId, timestamp: new Date().toISOString() });
  
  // Get audit and project info
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    include: { Project: true },
  });

  if (!audit) {
    throw new Error('Audit not found');
  }

  const projectId = audit.projectId;

  console.log(`[Auto-Crawl] Audit ${auditId} current status: ${audit.status}, startedAt: ${audit.startedAt}`);
  
  // Check if already in progress (prevent duplicates)
  // But allow resume if explicitly requested (for paused/stopped audits)
  // Also allow if status was just set to in_progress (within last 2 seconds) - this handles the race condition
  // where the API route sets status to in_progress before calling this function
  if (audit.status === 'in_progress' && !allowResume) {
    const timeSinceStart = Date.now() - audit.startedAt.getTime();
    console.log(`[Auto-Crawl] Audit ${auditId} is in_progress, time since start: ${timeSinceStart}ms`);
    if (timeSinceStart > 2000) {
      // Status was set more than 2 seconds ago, so it's a real duplicate
      console.log(`[Auto-Crawl] Audit ${auditId} is already in progress (started ${timeSinceStart}ms ago), skipping`);
      throw new Error('Crawl already in progress');
    } else {
      // Status was just set (within last 2 seconds), so this is the initial call - allow it
      console.log(`[Auto-Crawl] Audit ${auditId} status was just set to in_progress (${timeSinceStart}ms ago), continuing...`);
    }
  }
  
  // If not resuming, only allow starting from pending/pending_approval
  // BUT: Also allow in_progress if it was just set (within 2 seconds) - this handles the race condition
  // where the API route sets status to in_progress before calling this function
  // If resuming, allow paused/stopped status
  if (!allowResume) {
    const timeSinceStart = audit.status === 'in_progress' ? Date.now() - audit.startedAt.getTime() : Infinity;
    const isJustSet = audit.status === 'in_progress' && timeSinceStart <= 2000;
    console.log(`[Auto-Crawl] Status check: status=${audit.status}, timeSinceStart=${timeSinceStart}ms, isJustSet=${isJustSet}`);
    
    if (audit.status !== 'pending' && audit.status !== 'pending_approval' && !isJustSet) {
      console.error(`[Auto-Crawl] ❌ Cannot start crawl with status: ${audit.status}. Expected pending/pending_approval or just-set in_progress`);
      throw new Error(`Cannot start crawl with status: ${audit.status}. Use resume endpoint for paused/stopped audits.`);
    }
    console.log(`[Auto-Crawl] ✅ Status check passed, continuing with crawl...`);
  } else {
    // When resuming, only allow paused status (stopped audits cannot be resumed)
    if (audit.status !== 'paused' && audit.status !== 'in_progress') {
      throw new Error(`Cannot resume audit with status: ${audit.status}. Only paused audits can be resumed. Stopped audits cannot be resumed.`);
    }
  }

  const baseUrl = audit.Project.baseUrl;
  const projectDomain = audit.Project.domain;

  // STEP 0: Check for previous crawl attempts in this project within 14 days
  // Get URLs that were already crawled to skip them
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  
  console.log(`[Auto-Crawl] Checking for previous crawl attempts in project ${projectId} within 14 days...`);
  const previousAudits = await prisma.audit.findMany({
    where: {
      projectId: projectId,
      id: { not: auditId }, // Exclude current audit
      startedAt: {
        gte: fourteenDaysAgo, // Started within 14 days
      },
    },
    select: {
      id: true,
      startedAt: true,
      status: true,
    },
    orderBy: {
      startedAt: 'desc',
    },
  });

  // Get all URLs that were crawled in previous audits within 14 days
  const recentlyCrawledUrls: Set<string> = new Set();
  if (previousAudits.length > 0) {
    console.log(`[Auto-Crawl] Found ${previousAudits.length} previous audit(s) within 14 days`);
    
    const previousAuditIds = previousAudits.map((a: { id: string }) => a.id);
    const recentCrawlResults = await prisma.crawlResult.findMany({
      where: {
        auditId: { in: previousAuditIds },
        crawledAt: {
          gte: fourteenDaysAgo, // Crawled within 14 days
        },
      },
      select: {
        url: true,
      },
    });

    // Normalize URLs and add to set
    for (const result of recentCrawlResults) {
      const normalized = normalizeUrl(result.url, baseUrl);
      recentlyCrawledUrls.add(normalized);
    }
    
    console.log(`[Auto-Crawl] Found ${recentlyCrawledUrls.size} URLs already crawled in previous audits (will skip these)`);
  } else {
    console.log(`[Auto-Crawl] No previous audits found within 14 days - will crawl all URLs`);
  }

  // Get or create domain record
  let domainId: string | undefined;
  try {
    const urlObj = new URL(baseUrl);
    const domain = urlObj.hostname.replace(/^www\./, '');
    
    const domainRecord = await prisma.domain.upsert({
      where: { domain },
      update: {},
      create: {
        id: crypto.randomUUID(),
        domain,
        baseUrl: `${urlObj.protocol}//${urlObj.host}`,
        updatedAt: new Date(),
      },
    });
    domainId = domainRecord.id;
  } catch (error) {
    console.error('Error creating domain record:', error);
  }

  // STEP 1: Check robots.txt - REQUIRED before crawling (unless approved)
  addAuditLog(auditId, 'setup', `🔍 Step 1: Checking robots.txt for ${baseUrl}...`, { baseUrl });
  
  let robotsTxt: Awaited<ReturnType<typeof getRobotsTxt>> | null = null;
  let robotsTxtUrl: string | null = null;
  let crawlDelay: number | null = null;
  
  if (skipRobotsCheck) {
    // Skip robots.txt check (for approved crawls)
    console.log(`[Auto-Crawl] ⚠️  Skipping robots.txt check (approved crawl)`);
    robotsTxt = await getRobotsTxt(baseUrl); // Still get it for crawl delay, but don't require it
    crawlDelay = robotsTxt ? robotsTxt.getCrawlDelay() || null : null;
    const url = new URL(baseUrl);
    const robotsTxtUrl = `${url.protocol}//${url.host}/robots.txt`;
    addAuditLog(auditId, 'setup', `⚠️ robots.txt check skipped (approved crawl): ${robotsTxtUrl}`, { url: robotsTxtUrl, skipped: true });
  } else {
    // Check robots.txt - REQUIRED - Try multiple variations before giving up
    console.log(`[Auto-Crawl] Checking robots.txt for ${baseUrl}...`);
    
    try {
      const url = new URL(baseUrl);
      const host = url.hostname;
      const protocol = url.protocol;
      
      // Generate all possible robots.txt URLs to try
      const robotsTxtUrls: string[] = [];
      
      // Try with original host
      robotsTxtUrls.push(`${protocol}//${host}/robots.txt`);
      
      // Try with/without www
      if (host.startsWith('www.')) {
        robotsTxtUrls.push(`${protocol}//${host.replace(/^www\./, '')}/robots.txt`);
      } else {
        robotsTxtUrls.push(`${protocol}//www.${host}/robots.txt`);
      }
      
      // Try HTTP/HTTPS variations
      if (protocol === 'https:') {
        robotsTxtUrls.push(`http://${host}/robots.txt`);
        if (!host.startsWith('www.')) {
          robotsTxtUrls.push(`http://www.${host}/robots.txt`);
        } else {
          robotsTxtUrls.push(`http://${host.replace(/^www\./, '')}/robots.txt`);
        }
      } else if (protocol === 'http:') {
        robotsTxtUrls.push(`https://${host}/robots.txt`);
        if (!host.startsWith('www.')) {
          robotsTxtUrls.push(`https://www.${host}/robots.txt`);
        } else {
          robotsTxtUrls.push(`https://${host.replace(/^www\./, '')}/robots.txt`);
        }
      }
      
      // Remove duplicates
      const uniqueUrls = [...new Set(robotsTxtUrls)];
      
      console.log(`[Auto-Crawl] Trying ${uniqueUrls.length} robots.txt variations:`, uniqueUrls);
      addAuditLog(auditId, 'setup', `🔍 Trying ${uniqueUrls.length} robots.txt locations...`, { urls: uniqueUrls, count: uniqueUrls.length });
      
      let foundRobotsTxt = false;
      let lastError: Error | null = null;
      
      // Try each URL with a shorter timeout per attempt
      for (const testUrl of uniqueUrls) {
        try {
          addAuditLog(auditId, 'setup', `  Trying: ${testUrl}`, { url: testUrl });
          
          const response = await fetch(testUrl, {
            headers: {
              'User-Agent': 'SEO-Crawler/1.0',
            },
            signal: AbortSignal.timeout(8000), // 8 second timeout per attempt
          });

          if (response.ok) {
            robotsTxtUrl = testUrl;
            robotsTxt = await getRobotsTxt(baseUrl);
            crawlDelay = robotsTxt ? robotsTxt.getCrawlDelay() || null : null;
            console.log(`[Auto-Crawl] ✅ robots.txt found at ${robotsTxtUrl}`);
            addAuditLog(auditId, 'setup', `✅ robots.txt fetched successfully: ${robotsTxtUrl}`, { url: robotsTxtUrl, success: true });
            
            // Update domain record with robots.txt URL and crawl delay
            if (domainId) {
              try {
                await prisma.domain.update({
                  where: { id: domainId },
                  data: {
                    robotsTxtUrl: robotsTxtUrl,
                    crawlDelay: crawlDelay ? Math.round(crawlDelay) : null,
                  },
                });
                console.log(`[Auto-Crawl] ✅ Saved robots.txt URL and crawl delay to domain record`);
              } catch (error) {
                console.error(`[Auto-Crawl] Error updating domain with robots.txt info:`, error);
              }
            }
            
            foundRobotsTxt = true;
            break; // Success! Exit loop
          } else if (response.status !== 404) {
            // Non-404 errors might be temporary, log but continue trying
            console.log(`[Auto-Crawl] ⚠️  Error ${response.status} at ${testUrl}, trying next...`);
            addAuditLog(auditId, 'setup', `  ⚠️ ${testUrl}: HTTP ${response.status}`, { url: testUrl, status: response.status });
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          lastError = error instanceof Error ? error : new Error(String(error));
          
          // Log but continue trying other URLs
          if (errorMessage.includes('timeout') || errorMessage.includes('aborted')) {
            console.log(`[Auto-Crawl] ⚠️  Timeout at ${testUrl}, trying next...`);
            addAuditLog(auditId, 'setup', `  ⚠️ ${testUrl}: Timeout`, { url: testUrl, error: 'timeout' });
          } else {
            console.log(`[Auto-Crawl] ⚠️  Error at ${testUrl}: ${errorMessage}, trying next...`);
            addAuditLog(auditId, 'setup', `  ⚠️ ${testUrl}: ${errorMessage}`, { url: testUrl, error: errorMessage });
          }
        }
      }
      
      if (!foundRobotsTxt) {
        // All attempts failed - require approval
        const errorMessage = lastError instanceof Error ? lastError.message : 'All robots.txt locations failed';
        console.log(`[Auto-Crawl] ⚠️  robots.txt NOT FOUND after trying ${uniqueUrls.length} locations - requires approval`);
        addAuditLog(auditId, 'setup', `❌ robots.txt not found after trying ${uniqueUrls.length} locations`, { 
          urls: uniqueUrls, 
          success: false, 
          error: errorMessage,
          attempts: uniqueUrls.length
        });
        await prisma.audit.update({
          where: { id: auditId },
          data: {
            status: 'pending_approval',
            startedAt: new Date(),
          },
        });
        throw new Error(`robots.txt not found after trying ${uniqueUrls.length} locations - approval required before crawling`);
      }
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // If it's our custom error, re-throw it
      if (errorMessage.includes('approval required') || errorMessage.includes('robots.txt not found')) {
        throw error;
      }
      // Network/timeout errors - require approval
      console.log(`[Auto-Crawl] ⚠️  Error checking robots.txt: ${errorMessage} - requires approval`);
      addAuditLog(auditId, 'setup', `❌ robots.txt fetch error: ${robotsTxtUrl || 'unknown'} - ${errorMessage}`, { url: robotsTxtUrl || 'unknown', success: false, error: errorMessage });
      await prisma.audit.update({
        where: { id: auditId },
        data: {
          status: 'pending_approval',
          startedAt: new Date(),
        },
      });
      throw new Error(`Failed to check robots.txt: ${errorMessage} - approval required`);
    }
  }

  // STEP 2: Discover sitemaps - REQUIRED before crawling
  addAuditLog(auditId, 'setup', `🗺️  Step 2: Discovering sitemaps for ${baseUrl}...`, { baseUrl });
  console.log(`[Auto-Crawl] Discovering sitemaps for ${baseUrl}...`);
  let sitemapUrls: string[] = [];
  try {
    sitemapUrls = await discoverSitemaps(baseUrl);
    console.log(`[Auto-Crawl] Found ${sitemapUrls.length} sitemaps for ${baseUrl}`);
    
    // Log sitemap discovery results
    if (sitemapUrls.length > 0) {
      const sitemapList = sitemapUrls.join(', ');
      addAuditLog(auditId, 'setup', `✅ Sitemap(s) discovered: ${sitemapUrls.length} found`, { 
        urls: sitemapUrls, 
        count: sitemapUrls.length,
        success: true 
      });
      // Log each sitemap URL
      sitemapUrls.forEach((url, index) => {
        addAuditLog(auditId, 'setup', `  ${index + 1}. ${url}`, { url, index: index + 1 });
      });
    } else {
      addAuditLog(auditId, 'setup', `⚠️ No sitemaps found - will queue base URL only`, { success: false, urls: [] });
    }
    
    // Update domain record with sitemap URL (use first sitemap if multiple found)
    if (sitemapUrls.length > 0 && domainId) {
      try {
        await prisma.domain.update({
          where: { id: domainId },
          data: {
            sitemapUrl: sitemapUrls[0], // Save first sitemap URL
          },
        });
        console.log(`[Auto-Crawl] ✅ Saved sitemap URL to domain record: ${sitemapUrls[0]}`);
        if (sitemapUrls.length > 1) {
          console.log(`[Auto-Crawl] ℹ️  Note: Found ${sitemapUrls.length} sitemaps, saved first one. Others will still be parsed.`);
        }
      } catch (error) {
        console.error(`[Auto-Crawl] Error updating domain with sitemap URL:`, error);
      }
    }
    
    if (sitemapUrls.length === 0) {
      console.log(`[Auto-Crawl] ⚠️  No sitemaps found - will queue base URL only`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Auto-Crawl] Error discovering sitemaps:`, error);
    addAuditLog(auditId, 'setup', `❌ Sitemap discovery failed: ${errorMessage}`, { success: false, error: errorMessage });
    // Continue even if sitemap discovery fails - we can still crawl the base URL
    sitemapUrls = [];
  }

  // STEP 3: Both robots.txt and sitemap check passed - audit should already be marked as in_progress by API
  // But we'll verify and update if needed (in case of direct function calls)
  const currentAudit = await prisma.audit.findUnique({
    where: { id: auditId },
    select: { status: true },
  });
  
  if (currentAudit && currentAudit.status !== 'in_progress' && currentAudit.status !== 'pending_approval') {
    await prisma.audit.update({
      where: { id: auditId },
      data: {
        status: 'in_progress',
        startedAt: new Date(),
      },
    });
    console.log(`[Auto-Crawl] ✅ Audit ${auditId} marked as in_progress (robots.txt and sitemap checks passed)`);
  } else {
    console.log(`[Auto-Crawl] ✅ Audit ${auditId} already in progress or pending approval`);
  }

  // Use crawlDelay from robots.txt, default to 0.5 seconds if not set (faster crawling)
  // Can be overridden with CRAWL_DELAY_SECONDS environment variable
  // IMPORTANT: Cap crawl delay to prevent extremely slow crawling (some sites set 5+ minutes!)
  // Maximum delay is 5 seconds - if robots.txt specifies more, cap it
  const defaultCrawlDelay = parseFloat(process.env.CRAWL_DELAY_SECONDS || '0.5');
  const maxCrawlDelay = parseFloat(process.env.MAX_CRAWL_DELAY_SECONDS || '5'); // Cap at 5 seconds max
  const rawCrawlDelay = crawlDelay || defaultCrawlDelay;
  const crawlDelaySeconds = Math.min(rawCrawlDelay, maxCrawlDelay); // Cap the delay
  
  if (crawlDelay && crawlDelay > maxCrawlDelay) {
    console.log(`[Auto-Crawl] ⚠️  robots.txt specifies crawl-delay: ${crawlDelay}s, capping to ${maxCrawlDelay}s for reasonable performance`);
  }
  console.log(`[Auto-Crawl] Using crawl delay: ${crawlDelaySeconds}s (from robots.txt: ${crawlDelay || 'not specified'}, default: ${defaultCrawlDelay}s, max: ${maxCrawlDelay}s)`);

  let totalUrlsQueued = 0;

  // Queue base URL first (highest priority) - this starts crawling immediately
  // CRITICAL: Check robots.txt FIRST - never queue disallowed URLs
  if (!robotsTxt || !robotsTxt.isAllowed(baseUrl)) {
    console.log(`[Auto-Crawl] 🚫 Base URL disallowed by robots.txt, skipping: ${baseUrl}`);
  } else {
    const normalizedBaseUrl = normalizeUrl(baseUrl, baseUrl);
    
    // NOTE: We do NOT check 14-day project-level deduplication for base URL during queuing.
    // Only check if already queued in Redis or crawled in THIS audit.
    const shouldCrawl = await shouldCrawlUrlInAudit(baseUrl, auditId, crawlQueue, baseUrl, projectId);
    if (shouldCrawl) {
        console.log(`[Auto-Crawl] Queuing seed URL: ${baseUrl}`);
        // Use SHA-256 hash to create unique, fixed-length jobId (prevents collisions from truncation)
        const { createHash } = await import('crypto');
        const urlHash = createHash('sha256').update(normalizedBaseUrl).digest('base64').slice(0, 32);
        const jobId = `${auditId}:${urlHash}`; // Unique job ID
        
        try {
          await crawlQueue.add(
            {
              url: baseUrl,
              auditId,
            },
            {
              jobId, // Unique job ID prevents duplicates
              priority: 10, // Highest priority for seed URL
            }
          );
          totalUrlsQueued++;
          
          // Add queued log for base URL
          addAuditLog(auditId, 'queued', `Queued: ${baseUrl}`, { url: baseUrl, jobId, source: 'base-url' });
          
          // Note: pagesTotal is updated by check-completion route as: crawled + skipped + queued_in_redis
        } catch (error: unknown) {
          // If job already exists (duplicate jobId), skip it
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
          
          // Check for Redis storage limit errors
          if (errorMessage.includes('OOM') || 
              errorMessage.includes('maxmemory') || 
              errorMessage.includes('out of memory') ||
              errorMessage.includes('ERR maxmemory')) {
            console.error(`[Auto-Crawl] ⚠️  Redis storage limit reached while queuing base URL: ${baseUrl}`);
            console.error(`[Auto-Crawl] ⚠️  Pausing audit ${auditId}...`);
            
            // Pause this audit
            await prisma.audit.update({
              where: { id: auditId },
              data: { status: 'paused' },
            });
            
            addAuditLog(auditId, 'setup', '⚠️ Audit paused: Redis storage limit reached.', {
              reason: 'redis_storage_limit',
            });
            
            throw new Error('Redis storage limit reached - audit paused');
          }
          
          if (errorMessage.includes('already exists') || errorCode === 'DUPLICATE_JOB') {
            console.log(`[Auto-Crawl] ⏭️  Skipping duplicate job for base URL: ${baseUrl}`);
            // Add queued log even for duplicates
            addAuditLog(auditId, 'queued', `Queued: ${baseUrl}`, { url: baseUrl, jobId, source: 'base-url', duplicate: true });
          } else {
            throw error; // Re-throw other errors
          }
        }
      } else {
        console.log(`[Auto-Crawl] ⏭️  Skipping base URL (already crawled or queued): ${baseUrl}`);
      }
  }

  // NEW APPROACH: Collect all sitemap URLs first, then filter and queue
  // Step 1: Parse all sitemaps and collect URLs
  // Step 2: Filter URLs (robots.txt disallowed + 14-day crawled)
  // Step 3: Queue all filtered URLs
  // Step 4: Then follow links from crawled pages (with same filters)
  (async () => {
    try {
      console.log(`[Auto-Crawl] Starting sitemap collection and filtering...`);
      
      // CRITICAL: Check audit status at start - stop if already stopped/paused
      const initialAuditCheck = await prisma.audit.findUnique({
        where: { id: auditId },
        select: { status: true },
      });
      
      if (!initialAuditCheck || initialAuditCheck.status === 'stopped' || initialAuditCheck.status === 'paused') {
        console.log(`[Auto-Crawl] ⏸️  Audit ${auditId} is ${initialAuditCheck?.status || 'not found'}, skipping sitemap queuing`);
        return;
      }
      
      if (sitemapUrls.length === 0) {
        console.log(`[Auto-Crawl] ⚠️  No sitemaps to parse, only base URL will be crawled`);
        // Update pagesTotal to reflect only base URL
        await prisma.audit.update({
          where: { id: auditId },
          data: {
            pagesTotal: totalUrlsQueued > 0 ? totalUrlsQueued : 1,
          },
        });
        return;
      }
      
      // STEP 1: Collect all URLs from all sitemaps
      const allSitemapUrls: Array<{ url: string; priority?: number }> = [];
      for (const sitemapUrl of sitemapUrls) {
        try {
          console.log(`[Auto-Crawl] Parsing sitemap: ${sitemapUrl}`);
          const sitemapUrlList = await parseSitemap(sitemapUrl);
          console.log(`[Auto-Crawl] Found ${sitemapUrlList.length} URLs in sitemap ${sitemapUrl}`);
          allSitemapUrls.push(...sitemapUrlList);
        } catch (error) {
          console.error(`[Auto-Crawl] ❌ Error parsing sitemap ${sitemapUrl}:`, error);
          // Continue with other sitemaps
        }
      }
      
      console.log(`[Auto-Crawl] Collected ${allSitemapUrls.length} total URLs from all sitemaps`);
      
      // CRITICAL: Check audit status before filtering - stop if paused/stopped
      const preFilterAuditCheck = await prisma.audit.findUnique({
        where: { id: auditId },
        select: { status: true },
      });
      
      if (!preFilterAuditCheck || preFilterAuditCheck.status === 'stopped' || preFilterAuditCheck.status === 'paused') {
        console.log(`[Auto-Crawl] ⏸️  Audit ${auditId} is ${preFilterAuditCheck?.status || 'not found'}, stopping before filtering`);
        return;
      }
      
      console.log(`[Auto-Crawl] Starting filtering and queuing process (will queue immediately after each batch)...`);
      
      // STEP 2 & 3: Filter URLs and queue them immediately after each batch
      // This allows crawling to start sooner instead of waiting for all filtering to complete
      let skippedRobotsTxt = 0;
      let skipped14Days = 0;
      let skippedAlreadyQueued = 0;
      let queuedCount = totalUrlsQueued; // Start with base URL count
      let failedCount = 0;
      
      // Process in batches to show progress and avoid blocking
      const filterBatchSize = 100;
      const queueBatchSize = 50; // Queue in smaller batches for better control
      const concurrentFilterBatches = 3; // Process 3 filtering batches concurrently
      
      // Create all batch ranges first
      const batchRanges: Array<{ start: number; end: number; batchNum: number }> = [];
      for (let i = 0; i < allSitemapUrls.length; i += filterBatchSize) {
        batchRanges.push({
          start: i,
          end: Math.min(i + filterBatchSize, allSitemapUrls.length),
          batchNum: Math.floor(i / filterBatchSize) + 1,
        });
      }
      const totalBatches = batchRanges.length;
      
      // Process batches concurrently with a limit
      for (let i = 0; i < batchRanges.length; i += concurrentFilterBatches) {
        const concurrentBatches = batchRanges.slice(i, i + concurrentFilterBatches);
        
        // Process these batches concurrently
        await Promise.all(concurrentBatches.map(async ({ start, end, batchNum }) => {
          // CRITICAL: Check audit status before each batch - stop if paused/stopped
          const currentAudit = await prisma.audit.findUnique({
            where: { id: auditId },
            select: { status: true },
          });
          
          if (!currentAudit || currentAudit.status === 'stopped' || currentAudit.status === 'paused') {
            console.log(`[Auto-Crawl] ⏸️  Audit ${auditId} is ${currentAudit?.status || 'not found'}, stopping batch ${batchNum}`);
            return; // Skip this batch
          }
          
          const batch = allSitemapUrls.slice(start, end);
          console.log(`[Auto-Crawl] Filtering batch ${batchNum}/${totalBatches}: ${start + 1}-${end}/${allSitemapUrls.length} URLs`);
          addAuditLog(auditId, 'filtering', `Filtering batch ${batchNum}/${totalBatches}: ${start + 1}-${end}/${allSitemapUrls.length} URLs`);
        
        // OPTIMIZED: Filter this batch efficiently using batch operations
        const batchUrlsToQueue: Array<{ url: string; normalizedUrl: string; priority: number }> = [];
        let batchSkippedRobots = 0;
        let batchSkipped14Days = 0;
        let batchSkippedAlreadyQueued = 0;
        
        // CRITICAL: Check audit status once before processing batch
        const urlAuditCheck = await prisma.audit.findUnique({
          where: { id: auditId },
          select: { status: true },
        });
        
        if (!urlAuditCheck || urlAuditCheck.status === 'stopped' || urlAuditCheck.status === 'paused') {
          console.log(`[Auto-Crawl] ⏸️  Audit ${auditId} is ${urlAuditCheck?.status || 'not found'}, stopping filtering batch`);
          return; // Skip this batch
        }
        
        // STEP 1: Filter by robots.txt and in-memory checks (fast)
        const robotsFilteredUrls: Array<{ url: string; normalizedUrl: string; priority: number; originalUrl: string }> = [];
        
        for (const sitemapUrlData of batch) {
          const originalUrl = sitemapUrlData.url;
          
          // FIRST: Check robots.txt (before normalization)
          const isAllowed = robotsTxt ? robotsTxt.isAllowed(originalUrl) : true;
          if (!isAllowed) {
            skippedRobotsTxt++;
            batchSkippedRobots++;
            // Log first 20 skipped URLs for debugging
            if (skippedRobotsTxt <= 20) {
              console.log(`[Auto-Crawl] 🚫 Skipped by robots.txt: ${originalUrl}`);
            }
            addAuditLog(auditId, 'skipped', `Skipped by robots.txt: ${originalUrl}`, { reason: 'robots.txt', url: originalUrl });
            continue; // Skip - disallowed by robots.txt
          }
          
          // Normalize for deduplication
          const url = normalizeUrl(originalUrl, baseUrl);
          const normalizedUrl = normalizeUrl(url, baseUrl);
          
          // NOTE: We do NOT check 14-day project-level deduplication here during queuing.
          // URLs are only skipped if:
          // 1. Disallowed by robots.txt (already checked above)
          // 2. Already queued in Redis (checked in shouldCrawlUrlsInAudit)
          // 3. Already crawled in THIS audit (checked in shouldCrawlUrlsInAudit)
          //
          // The 14-day project-level check is done in the queue processor (queue.ts)
          // to prevent re-crawling, but it doesn't block URLs from being queued initially.
          // This allows child URLs to be queued even if parent URLs were crawled in previous audits.
          
          // Skip recently crawled URLs if within 14 days (from resume parameter - this is explicit user action)
          if (skipRecentUrls.includes(url)) {
            skipped14Days++;
            batchSkipped14Days++;
            addAuditLog(auditId, 'skipped', `Skipped (recent crawl): ${url}`, { reason: 'recent', url });
            continue;
          }
          
          // Passed fast filters - add to batch for database check
          robotsFilteredUrls.push({
            url,
            normalizedUrl,
            priority: sitemapUrlData.priority || 0.5,
            originalUrl,
          });
        }
        
        // STEP 2: OPTIMIZED - Batch check database for deduplication (one query instead of N queries)
        if (robotsFilteredUrls.length > 0) {
          const urlsToCheck = robotsFilteredUrls.map(u => u.url);
          const shouldCrawlSet = await shouldCrawlUrlsInAudit(urlsToCheck, auditId, crawlQueue, baseUrl, projectId);
          
          // Filter URLs that should be crawled
          for (const urlData of robotsFilteredUrls) {
            if (shouldCrawlSet.has(urlData.url)) {
              // URL passed all filters - add to batch queue list
              batchUrlsToQueue.push({
                url: urlData.url,
                normalizedUrl: urlData.normalizedUrl,
                priority: urlData.priority,
              });
            } else {
              skippedAlreadyQueued++;
              batchSkippedAlreadyQueued++;
              addAuditLog(auditId, 'skipped', `Skipped (already queued/crawled): ${urlData.url}`, { reason: 'duplicate', url: urlData.url });
            }
          }
        }
        
        // Log filtering results for this batch
        console.log(`[Auto-Crawl] Batch ${batchNum}/${totalBatches} filtered: ${batchUrlsToQueue.length} passed filters, ${batchSkippedRobots} robots.txt, ${batchSkipped14Days} 14-day, ${batchSkippedAlreadyQueued} already queued`);
        addAuditLog(auditId, 'filtering', `Batch ${batchNum}/${totalBatches} filtered: ${batchUrlsToQueue.length} passed, ${batchSkippedRobots} robots.txt, ${batchSkipped14Days} 14-day, ${batchSkippedAlreadyQueued} duplicate`);
        
        // Also log individual filtering events for better visibility
        if (batchUrlsToQueue.length > 0) {
          addAuditLog(auditId, 'filtering', `✅ ${batchUrlsToQueue.length} URLs passed all filters in batch ${batchNum}`);
        }
        
        // Immediately queue this batch's URLs to Redis
        if (batchUrlsToQueue.length > 0) {
          console.log(`[Auto-Crawl] Queuing ${batchUrlsToQueue.length} URLs from batch ${batchNum} to Redis...`);
          
          // Track how many URLs were successfully queued in THIS batch
          let batchQueuedCount = 0;
          
          // Queue in smaller batches for better control
          for (let j = 0; j < batchUrlsToQueue.length; j += queueBatchSize) {
            // Check audit status before queuing
            const queueAuditCheck = await prisma.audit.findUnique({
              where: { id: auditId },
              select: { status: true },
            });
            
            if (!queueAuditCheck || queueAuditCheck.status === 'stopped' || queueAuditCheck.status === 'paused') {
              console.log(`[Auto-Crawl] ⏸️  Audit ${auditId} is ${queueAuditCheck?.status || 'not found'}, stopping queuing`);
              break;
            }
            
            const queueBatch = batchUrlsToQueue.slice(j, j + queueBatchSize);
            const queueBatchNum = Math.floor(j / queueBatchSize) + 1;
            const totalQueueBatches = Math.ceil(batchUrlsToQueue.length / queueBatchSize);
            
            const queueResults = await Promise.allSettled(
              queueBatch.map(async (urlData) => {
                // Use SHA-256 hash to create unique, fixed-length jobId (prevents collisions from truncation)
                const { createHash } = await import('crypto');
                const urlHash = createHash('sha256').update(urlData.normalizedUrl).digest('base64').slice(0, 32);
                const jobId = `${auditId}:${urlHash}`;
                
                try {
                  // Don't add delay when queuing - delay is handled by the processor
                  // Adding delay here would make later jobs wait too long (e.g., job 1400 waits 700 seconds!)
                  const job = await crawlQueue.add(
                    {
                      url: urlData.url,
                      auditId,
                      fromSitemap: true,
                    },
                    {
                      jobId,
                      priority: Math.floor((urlData.priority || 0.5) * 10),
                      // No delay - processor handles rate limiting
                    }
                  );
                  
                  // Verify job was actually added
                  if (!job || !job.id) {
                    console.error(`[Auto-Crawl] ❌ Queue returned null job for ${urlData.url}`);
                    failedCount++;
                    return { success: false, url: urlData.url, error: 'Job was null' };
                  }
                  
                  queuedCount++;
                  batchQueuedCount++;
                  // Only log first 10 successful queues to reduce noise
                  if (queuedCount - totalUrlsQueued <= 10) {
                    console.log(`[Auto-Crawl] ✅ Queued: ${urlData.url} (jobId: ${job.id})`);
                  }
                  addAuditLog(auditId, 'queued', `Queued: ${urlData.url}`, { url: urlData.url, jobId: job.id });
                  
                  return { success: true, url: urlData.url, jobId: job.id };
                } catch (error: unknown) {
                  // If job already exists (duplicate jobId), that's okay - it's already queued
                  const queueErrorMsg = error instanceof Error ? error.message : String(error);
                  const queueErrorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
                  
                  // Check for Redis storage limit errors
                  if (queueErrorMsg.includes('OOM') || 
                      queueErrorMsg.includes('maxmemory') || 
                      queueErrorMsg.includes('out of memory') ||
                      queueErrorMsg.includes('ERR maxmemory')) {
                    console.error(`[Auto-Crawl] ⚠️  Redis storage limit reached while queuing ${urlData.url}`);
                    console.error(`[Auto-Crawl] ⚠️  Pausing audit ${auditId} and stopping queue operations...`);
                    
                    // Pause this audit
                    await prisma.audit.update({
                      where: { id: auditId },
                      data: { status: 'paused' },
                    });
                    
                    addAuditLog(auditId, 'setup', '⚠️ Audit paused: Redis storage limit reached. Queue operations stopped.', {
                      reason: 'redis_storage_limit',
                    });
                    
                    // Stop processing more batches
                    throw new Error('Redis storage limit reached - audit paused');
                  }
                  
                  if (queueErrorMsg.includes('already exists') || queueErrorCode === 'DUPLICATE_JOB') {
                    queuedCount++; // Count as queued since it already exists
                    batchQueuedCount++;
                    addAuditLog(auditId, 'queued', `Queued: ${urlData.url}`, { url: urlData.url, jobId: 'duplicate' });
                    
                    return { success: true, url: urlData.url, jobId: 'duplicate' };
                  }
                  // Log other errors but don't fail the entire batch
                  const queueErrorMsg2 = error instanceof Error ? error.message : String(error);
                  console.error(`[Auto-Crawl] ❌ Failed to queue ${urlData.url}:`, queueErrorMsg2);
                  failedCount++;
                  return { success: false, url: urlData.url, error: queueErrorMsg2 };
                }
              })
            );
            
            // Count successful vs failed
            const queueBatchSuccess = queueResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const queueBatchFailed = queueResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
            
            if (totalQueueBatches > 1) {
              console.log(`[Auto-Crawl] ✅ Queue batch ${queueBatchNum}/${totalQueueBatches} of filter batch ${batchNum}: ${queueBatchSuccess} queued, ${queueBatchFailed} failed`);
            }
          }
          
          // Note: pagesTotal is updated by check-completion route as: crawled + skipped + queued_in_redis
          // We don't update it here during queuing since we don't know which URLs will be skipped yet
          
          console.log(`[Auto-Crawl] ✅ Batch ${batchNum}/${totalBatches} COMPLETE: ${batchQueuedCount} URLs queued to Redis (total queued so far: ${queuedCount - totalUrlsQueued})`);
          
          // Continue to next filtering batch immediately - no need to wait for crawling
          // Filtering/queuing and crawling happen concurrently:
          // - Filtering keeps adding URLs to queue
          // - Crawling processes whatever is in the queue independently
          // This allows maximum throughput
        } else {
          console.log(`[Auto-Crawl] ✅ Batch ${batchNum}/${totalBatches} COMPLETE: No URLs to queue from this batch`);
        }
        })); // End of Promise.all map
      } // End of concurrent batches loop
      
      console.log(`[Auto-Crawl] ✅ Filtering and queuing complete: ${queuedCount - totalUrlsQueued} URLs queued to Redis, ${failedCount} failed, ${skippedRobotsTxt} disallowed by robots.txt, ${skipped14Days} crawled within 14 days, ${skippedAlreadyQueued} already queued/crawled`);
      // Note: pagesTotal is updated per-URL when each queued log is added, so no final calculation needed
    } catch (error) {
      console.error(`[Auto-Crawl] ❌ CRITICAL: Error in sitemap URL queuing:`, error);
      // Update audit status to failed if queuing fails
      try {
        await prisma.audit.update({
          where: { id: auditId },
          data: {
            status: 'failed',
          },
        });
        console.log(`[Auto-Crawl] Audit ${auditId} marked as failed due to URL queuing error`);
      } catch (updateError) {
        console.error(`[Auto-Crawl] Failed to update audit status:`, updateError);
      }
    }
  })();

  // Return immediately - sitemap parsing happens in background
  // pagesTotal starts at 0 and increments by 1 for each queued log entry
  // No initial value needed - it will be updated as URLs are queued

  console.log(`[Auto-Crawl] Audit ${auditId} started, queuing URLs in background...`);

  return {
    sitemapsFound: sitemapUrls.length,
    urlsQueued: totalUrlsQueued, // Will be updated as URLs are queued
    baseUrl,
  };
}

