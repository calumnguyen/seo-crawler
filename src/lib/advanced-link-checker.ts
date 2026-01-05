import { prisma } from './prisma';

export interface LinkCheckResult {
  url: string;
  statusCode: number | null;
  status: 'ok' | 'broken' | 'redirect' | 'timeout' | 'error';
  finalUrl?: string | null;
  responseTime?: number;
  error?: string;
  checkedAt: Date;
}

export interface BrokenLinkIssue {
  crawlResultId: string;
  url: string;
  linkText: string | null;
  statusCode: number | null;
  severity: 'error' | 'warning';
  message: string;
  recommendation: string;
}

/**
 * Check if a link is broken (async, with timeout)
 */
export async function checkLinkStatus(
  url: string,
  timeoutMs: number = 5000
): Promise<LinkCheckResult> {
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(url, {
      method: 'HEAD', // Use HEAD to avoid downloading full content
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEO-Crawler/1.0)',
      },
    });
    
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;
    
    let status: LinkCheckResult['status'] = 'ok';
    if (response.status >= 400) {
      status = 'broken';
    } else if ([301, 302, 307, 308].includes(response.status)) {
      status = 'redirect';
    }
    
    return {
      url,
      statusCode: response.status,
      status,
      finalUrl: response.url !== url ? response.url : null,
      responseTime,
      checkedAt: new Date(),
    };
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    
    if (error.name === 'AbortError') {
      return {
        url,
        statusCode: null,
        status: 'timeout',
        responseTime,
        error: 'Request timeout',
        checkedAt: new Date(),
      };
    }
    
    return {
      url,
      statusCode: null,
      status: 'error',
      responseTime,
      error: error.message || 'Unknown error',
      checkedAt: new Date(),
    };
  }
}

/**
 * Check multiple links in parallel (with concurrency limit)
 */
export async function checkLinksBatch(
  links: Array<{ url: string; text: string | null }>,
  concurrency: number = 5,
  timeoutMs: number = 5000
): Promise<Map<string, LinkCheckResult>> {
  const results = new Map<string, LinkCheckResult>();
  const checkedUrls = new Set<string>();
  
  // Process in batches
  for (let i = 0; i < links.length; i += concurrency) {
    const batch = links.slice(i, i + concurrency);
    
    const batchResults = await Promise.all(
      batch.map(async (link) => {
        // Skip if already checked
        if (checkedUrls.has(link.url)) {
          return null;
        }
        checkedUrls.add(link.url);
        
        return checkLinkStatus(link.url, timeoutMs);
      })
    );
    
    for (const result of batchResults) {
      if (result) {
        results.set(result.url, result);
      }
    }
    
    // Small delay between batches to avoid overwhelming servers
    if (i + concurrency < links.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

/**
 * Detect broken links for a crawl result and create issues
 */
export async function detectBrokenLinksForCrawlResult(
  crawlResultId: string,
  links: Array<{ href: string; text: string | null }>
): Promise<BrokenLinkIssue[]> {
  // Only check external links (internal links are validated during crawl)
  const externalLinks = links.filter((link) => {
    try {
      const url = new URL(link.href);
      return url.protocol.startsWith('http');
    } catch {
      return false;
    }
  });
  
  // Limit to first 20 external links to avoid excessive checks
  const linksToCheck = externalLinks.slice(0, 20).map(link => ({
    url: link.href,
    text: link.text,
  }));
  
  if (linksToCheck.length === 0) {
    return [];
  }
  
  // Check links in batches
  const checkResults = await checkLinksBatch(linksToCheck, 5, 5000);
  
  // Create issues for broken links
  const issues: BrokenLinkIssue[] = [];
  
  for (const linkData of linksToCheck) {
    const link = externalLinks.find(l => l.href === linkData.url);
    if (!link) continue;
    const result = checkResults.get(linkData.url);
    if (!result) continue;
    
    if (result.status === 'broken') {
      issues.push({
        crawlResultId,
        url: linkData.url,
        linkText: linkData.text,
        statusCode: result.statusCode,
        severity: result.statusCode && result.statusCode >= 500 ? 'error' : 'warning',
        message: `Broken link "${linkData.text || linkData.url}" returns HTTP ${result.statusCode || 'error'}`,
        recommendation: 'Fix or remove broken link to improve user experience and SEO',
      });
    } else if (result.status === 'timeout') {
      issues.push({
        crawlResultId,
        url: linkData.url,
        linkText: linkData.text,
        statusCode: null,
        severity: 'warning',
        message: `Link "${linkData.text || linkData.url}" timed out when checking`,
        recommendation: 'Verify link is accessible - timeout may indicate server issues',
      });
    } else if (result.status === 'redirect' && result.statusCode && [301, 302].includes(result.statusCode)) {
      // Track redirects as info (not broken, but good to know)
      // Could be upgraded to warning if redirect chain is too long
    }
  }
  
  return issues;
}

/**
 * Queue link checks for background processing
 * This allows checking links asynchronously without blocking crawl
 */
export async function queueLinkChecks(
  crawlResultId: string,
  links: Array<{ href: string; text: string | null }>
): Promise<void> {
  // Store links to check in database for background processing
  // This could be implemented with a job queue (Redis/Bull) in the future
  // For now, we'll check immediately but limit the number
  
  // Only queue external links
  const externalLinks = links.filter((link) => {
    try {
      const url = new URL(link.href);
      return url.protocol.startsWith('http');
    } catch {
      return false;
    }
  });
  
  // Store in database for background processing
  // Could create a LinkCheckJob table for this
  // For now, we'll process immediately but limit batch size
  
  if (externalLinks.length > 0) {
    // Process in smaller batches to avoid overwhelming
    const batch = externalLinks.slice(0, 10);
    const issues = await detectBrokenLinksForCrawlResult(crawlResultId, batch);
    
    // Save issues to database
    if (issues.length > 0) {
      await prisma.issue.createMany({
        data: issues.map((issue) => ({
          id: crypto.randomUUID(),
          crawlResultId: issue.crawlResultId,
          auditId: null, // Will be set based on crawlResult
          severity: issue.severity,
          category: 'links',
          type: 'broken_link',
          message: issue.message,
          recommendation: issue.recommendation,
          details: {
            url: issue.url,
            linkText: issue.linkText,
            statusCode: issue.statusCode,
          },
        })),
        skipDuplicates: true,
      });
    }
  }
}

