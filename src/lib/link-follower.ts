import type { SEOData, LinkData } from '@/types/seo';
import { normalizeUrl } from './robots';

const MAX_DEPTH = 10;
const visitedUrls = new Set<string>();

export function extractLinksFromCrawlResult(
  seoData: SEOData,
  baseUrl: string
): LinkData[] {
  // Filter to same-domain links only
  try {
    const baseUrlObj = new URL(baseUrl);
    return seoData.links.filter((link) => {
      try {
        const linkUrl = new URL(link.href);
        return linkUrl.origin === baseUrlObj.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export function shouldCrawlUrl(
  url: string,
  baseUrl: string,
  currentDepth: number
): boolean {
  // Check depth limit
  if (currentDepth >= MAX_DEPTH) {
    return false;
  }

  // Normalize URL for deduplication
  const normalized = normalizeUrl(url, baseUrl);
  
  // Check if already visited
  if (visitedUrls.has(normalized)) {
    return false;
  }

  // Check if same domain
  try {
    const urlObj = new URL(url, baseUrl);
    const baseUrlObj = new URL(baseUrl);
    
    if (urlObj.origin !== baseUrlObj.origin) {
      return false; // Only crawl same domain
    }

    // Filter out common non-content URLs
    const path = urlObj.pathname.toLowerCase();
    const excludePatterns = [
      '/admin',
      '/login',
      '/logout',
      '/register',
      '/api/',
      '/_next/',
      '/static/',
      '/assets/',
      '.pdf',
      '.jpg',
      '.png',
      '.gif',
      '.svg',
      '.zip',
      '.exe',
    ];

    if (excludePatterns.some((pattern) => path.includes(pattern))) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function markUrlAsVisited(url: string, baseUrl?: string): boolean {
  const normalized = normalizeUrl(url, baseUrl);
  if (visitedUrls.has(normalized)) {
    return true; // Already visited
  }
  visitedUrls.add(normalized);
  return false; // Not visited before
}

export function clearVisitedUrls(): void {
  visitedUrls.clear();
}

