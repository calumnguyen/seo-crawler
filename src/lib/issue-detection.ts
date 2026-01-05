import { prisma } from './prisma';
import type { SEOData } from '@/types/seo';

export interface Issue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  type: string;
  message: string;
  recommendation: string | null;
  details?: Record<string, any>;
}

/**
 * Detect SEO issues for a single crawl result
 */
export async function detectIssuesForCrawlResult(
  seoData: SEOData,
  crawlResultId: string,
  auditId: string
): Promise<Issue[]> {
  const issues: Issue[] = [];

  // 1. Missing title
  if (!seoData.title || seoData.title.trim().length === 0) {
    issues.push({
      severity: 'error',
      category: 'on-page-seo',
      type: 'missing_title',
      message: 'Page is missing a title tag',
      recommendation: 'Add a unique, descriptive title tag (50-60 characters) to improve SEO and click-through rates',
    });
  }

  // 2. Title too long/short
  if (seoData.title) {
    const titleLength = seoData.title.length;
    if (titleLength > 60) {
      issues.push({
        severity: 'warning',
        category: 'on-page-seo',
        type: 'title_too_long',
        message: `Title tag is ${titleLength} characters (recommended: 50-60)`,
        recommendation: 'Shorten your title tag to improve display in search results',
        details: { length: titleLength },
      });
    } else if (titleLength < 30) {
      issues.push({
        severity: 'info',
        category: 'on-page-seo',
        type: 'title_too_short',
        message: `Title tag is only ${titleLength} characters (recommended: 50-60)`,
        recommendation: 'Consider adding more descriptive text to your title tag',
        details: { length: titleLength },
      });
    }
  }

  // 3. Missing meta description
  if (!seoData.metaDescription || seoData.metaDescription.trim().length === 0) {
    issues.push({
      severity: 'warning',
      category: 'on-page-seo',
      type: 'missing_meta_description',
      message: 'Page is missing a meta description',
      recommendation: 'Add a compelling meta description (120-160 characters) to improve click-through rates',
    });
  }

  // 4. Meta description too long/short
  if (seoData.metaDescription) {
    const descLength = seoData.metaDescription.length;
    if (descLength > 160) {
      issues.push({
        severity: 'warning',
        category: 'on-page-seo',
        type: 'meta_description_too_long',
        message: `Meta description is ${descLength} characters (recommended: 120-160)`,
        recommendation: 'Shorten your meta description to prevent truncation in search results',
        details: { length: descLength },
      });
    } else if (descLength < 120) {
      issues.push({
        severity: 'info',
        category: 'on-page-seo',
        type: 'meta_description_too_short',
        message: `Meta description is only ${descLength} characters (recommended: 120-160)`,
        recommendation: 'Consider expanding your meta description to better describe the page',
        details: { length: descLength },
      });
    }
  }

  // 5. Multiple H1 tags
  if (seoData.h1.length > 1) {
    issues.push({
      severity: 'warning',
      category: 'content-structure',
      type: 'multiple_h1_tags',
      message: `Page has ${seoData.h1.length} H1 tags (recommended: 1)`,
      recommendation: 'Use a single H1 tag per page to clearly indicate the main topic',
      details: { count: seoData.h1.length, headings: seoData.h1 },
    });
  }

  // 6. Missing H1 tag
  if (seoData.h1.length === 0) {
    issues.push({
      severity: 'error',
      category: 'content-structure',
      type: 'missing_h1_tag',
      message: 'Page is missing an H1 heading',
      recommendation: 'Add an H1 tag that clearly describes the page content',
    });
  }

  // 7. Headings that are too long (H1, H2, H3)
  // Recommended max length: 70 characters for headings (good for SEO and readability)
  const MAX_HEADING_LENGTH = 100; // Allow up to 100 chars, but warn if over 70
  const allHeadings = [
    ...seoData.h1.map((text, idx) => ({ level: 1, text, index: idx })),
    ...seoData.h2.map((text, idx) => ({ level: 2, text, index: idx })),
    ...seoData.h3.map((text, idx) => ({ level: 3, text, index: idx })),
  ];
  
  const longHeadings = allHeadings.filter((h) => h.text.length > MAX_HEADING_LENGTH);
  if (longHeadings.length > 0) {
    const longestHeading = longHeadings.reduce((longest, current) => 
      current.text.length > longest.text.length ? current : longest
    );
    issues.push({
      severity: 'warning',
      category: 'content-structure',
      type: 'heading_too_long',
      message: `${longHeadings.length} heading(s) are too long (over ${MAX_HEADING_LENGTH} characters). Longest: ${longestHeading.text.length} characters`,
      recommendation: 'Shorten headings to improve readability and SEO. Recommended: under 70 characters',
      details: {
        count: longHeadings.length,
        maxLength: MAX_HEADING_LENGTH,
        longHeadings: longHeadings.map(h => ({
          level: h.level,
          text: h.text,
          length: h.text.length,
        })),
      },
    });
  }

  // 8. Images without alt text
  const imagesWithoutAlt = seoData.images.filter((img) => !img.alt || img.alt.trim().length === 0);
  if (imagesWithoutAlt.length > 0) {
    issues.push({
      severity: seoData.images.length > 0 && imagesWithoutAlt.length / seoData.images.length > 0.5 ? 'error' : 'warning',
      category: 'accessibility',
      type: 'missing_alt_text',
      message: `${imagesWithoutAlt.length} image(s) missing alt text`,
      recommendation: 'Add descriptive alt text to all images for accessibility and SEO',
      details: {
        totalImages: seoData.images.length,
        imagesWithoutAlt: imagesWithoutAlt.length,
        affectedImages: imagesWithoutAlt.slice(0, 5).map((img) => img.src), // First 5 for reference
      },
    });
  }

  // 9. Meta robots noindex
  if (seoData.metaRobots && seoData.metaRobots.toLowerCase().includes('noindex')) {
    issues.push({
      severity: 'warning',
      category: 'crawlability',
      type: 'noindex_meta_tag',
      message: 'Page has noindex meta tag - will not be indexed by search engines',
      recommendation: 'Remove noindex tag if you want this page to appear in search results',
      details: { metaRobots: seoData.metaRobots },
    });
  }

  // 10. Missing canonical URL
  if (!seoData.canonicalUrl) {
    issues.push({
      severity: 'info',
      category: 'on-page-seo',
      type: 'missing_canonical',
      message: 'Page is missing a canonical URL',
      recommendation: 'Add a canonical URL to prevent duplicate content issues',
    });
  }

  // 11. Low word count (content depth)
  if (seoData.wordCount !== undefined) {
    if (seoData.wordCount < 150) {
      issues.push({
        severity: 'warning',
        category: 'content-quality',
        type: 'low_word_count',
        message: `Page has only ${seoData.wordCount} words (recommended: 300+)`,
        recommendation: 'Add more comprehensive content to improve SEO and user experience',
        details: { wordCount: seoData.wordCount },
      });
    }
  }

  // 12. HTTP error status codes
  if (seoData.statusCode >= 400) {
    issues.push({
      severity: 'error',
      category: 'technical',
      type: `http_${seoData.statusCode}`,
      message: `Page returned HTTP ${seoData.statusCode}`,
      recommendation: seoData.statusCode === 404
        ? 'Fix broken link or create redirect to working page'
        : seoData.statusCode === 500
        ? 'Fix server error - check server logs'
        : 'Resolve HTTP error to ensure page is accessible',
      details: { statusCode: seoData.statusCode },
    });
  }

  // 13. Slow response time
  if (seoData.responseTime > 3000) {
    issues.push({
      severity: 'warning',
      category: 'performance',
      type: 'slow_response_time',
      message: `Page response time is ${seoData.responseTime}ms (recommended: <1000ms)`,
      recommendation: 'Optimize page load time to improve user experience and SEO rankings',
      details: { responseTime: seoData.responseTime },
    });
  }

  // 14. Redirect chain too long
  if (seoData.redirectCount && seoData.redirectCount > 3) {
    issues.push({
      severity: 'warning',
      category: 'technical',
      type: 'long_redirect_chain',
      message: `Page has ${seoData.redirectCount} redirects (recommended: <3)`,
      recommendation: 'Shorten redirect chain to improve page load time and SEO',
      details: { redirectCount: seoData.redirectCount, redirectChain: seoData.redirectChain },
    });
  }

  // 15. Missing structured data
  if (!seoData.structuredData || seoData.structuredData.length === 0) {
    issues.push({
      severity: 'info',
      category: 'on-page-seo',
      type: 'missing_structured_data',
      message: 'Page is missing structured data (JSON-LD)',
      recommendation: 'Add structured data to enable rich results in search engines',
    });
  }

  return issues;
}

/**
 * Detect duplicate titles across an audit
 */
export async function detectDuplicateTitles(auditId: string): Promise<Issue[]> {
  const crawlResults = await prisma.crawlResult.findMany({
    where: {
      auditId,
      title: { not: null },
    },
    select: {
      id: true,
      url: true,
      title: true,
    },
  });

  // Group by title
  const titleMap = new Map<string, Array<{ id: string; url: string }>>();
  for (const result of crawlResults) {
    if (result.title) {
      const normalizedTitle = result.title.toLowerCase().trim();
      if (!titleMap.has(normalizedTitle)) {
        titleMap.set(normalizedTitle, []);
      }
      titleMap.get(normalizedTitle)!.push({ id: result.id, url: result.url });
    }
  }

  // Find duplicates
  const issues: Issue[] = [];
  for (const [title, pages] of titleMap.entries()) {
    if (pages.length > 1) {
      for (const page of pages) {
        issues.push({
          severity: 'warning',
          category: 'on-page-seo',
          type: 'duplicate_title',
          message: `Title "${title}" is used on ${pages.length} pages`,
          recommendation: 'Create unique titles for each page to improve SEO and user experience',
          details: {
            title,
            duplicateCount: pages.length,
            duplicateUrls: pages.map((p) => p.url),
          },
        });
      }
    }
  }

  return issues;
}

/**
 * Save issues to database
 */
export async function saveIssuesToDb(
  issues: Issue[],
  auditId: string,
  crawlResultId?: string
): Promise<void> {
  if (issues.length === 0) return;

  await prisma.issue.createMany({
    data: issues.map((issue) => ({
      id: crypto.randomUUID(),
      auditId,
      crawlResultId,
      severity: issue.severity,
      category: issue.category,
      type: issue.type,
      message: issue.message,
      recommendation: issue.recommendation,
      details: issue.details || undefined,
    })),
  });
}

/**
 * Check for broken links (external links that return 4xx/5xx)
 * Note: This is a basic check - in production, you might want to queue this separately
 */
export async function detectBrokenLinks(
  crawlResultId: string,
  links: Array<{ href: string; text: string }>
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const checkedUrls = new Set<string>();

  // Only check first 10 external links to avoid too many requests
  const externalLinks = links.filter((link) => {
    try {
      const url = new URL(link.href);
      return url.protocol.startsWith('http');
    } catch {
      return false;
    }
  }).slice(0, 10);

  for (const link of externalLinks) {
    if (checkedUrls.has(link.href)) continue;
    checkedUrls.add(link.href);

    try {
      const response = await fetch(link.href, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (response.status >= 400) {
        issues.push({
          severity: response.status >= 500 ? 'error' : 'warning',
          category: 'links',
          type: 'broken_link',
          message: `Link "${link.text || link.href}" returns HTTP ${response.status}`,
          recommendation: 'Fix or remove broken link',
          details: {
            url: link.href,
            statusCode: response.status,
            linkText: link.text,
          },
        });
      }
    } catch (error) {
      // Network errors, timeouts, etc. - log but don't create issue for all
      // In production, might want to retry or mark as "unknown"
    }
  }

  return issues;
}

