import { prisma } from './prisma';
import { normalizeUrl } from './robots';

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
 */
export async function isUrlQueuedForAudit(
  url: string,
  auditId: string,
  crawlQueue: any,
  baseUrl?: string
): Promise<boolean> {
  try {
    const normalized = normalizeUrl(url, baseUrl);
    
    // CRITICAL: Check ALL job states (waiting, delayed, AND active)
    // Active jobs are currently being processed, so we shouldn't queue them again
    const jobs = await crawlQueue.getJobs(['waiting', 'delayed', 'active'], 0, 10000); // Get up to 10k jobs
    
    // Filter safely - handle null jobs
    const auditJobs = jobs.filter((j: any) => {
      try {
        return j && j.data && j.data.auditId === auditId;
      } catch {
        return false;
      }
    });
    
    const isQueued = auditJobs.some((job: any) => {
      try {
        if (!job || !job.data || !job.data.url) {
          return false;
        }
        const jobUrl = normalizeUrl(job.data.url, baseUrl);
        return jobUrl === normalized;
      } catch {
        return false;
      }
    });
    
    if (isQueued) {
      console.log(`[Deduplication] ⚠️  URL already queued/active: ${normalized} (audit: ${auditId})`);
    }
    
    return isQueued;
  } catch (error) {
    console.error(`Error checking if URL is queued: ${url}`, error);
    return false; // Fail open
  }
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
        audit: {
          projectId: projectId,
        },
      },
      select: {
        id: true,
        crawledAt: true,
        audit: {
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
 * Now also checks if URL was crawled in the project within 14 days
 */
export async function shouldCrawlUrlInAudit(
  url: string,
  auditId: string,
  crawlQueue: any,
  baseUrl?: string,
  projectId?: string // Optional: if provided, check project-level deduplication
): Promise<boolean> {
  // Check if already crawled in this audit
  const isCrawled = await isUrlCrawledInAudit(url, auditId, baseUrl);
  if (isCrawled) {
    return false;
  }

  // Check if already queued in this audit
  const isQueued = await isUrlQueuedForAudit(url, auditId, crawlQueue, baseUrl);
  if (isQueued) {
    return false;
  }

  // If projectId provided, check if URL was crawled in the project within 14 days
  if (projectId) {
    const isCrawledInProject = await isUrlCrawledInProject(url, projectId, baseUrl);
    if (isCrawledInProject) {
      return false;
    }
  }

  return true;
}

