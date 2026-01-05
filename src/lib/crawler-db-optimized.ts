import { prisma } from './prisma';
import { normalizeUrl } from './robots';
import type { SEOData } from '@/types/seo';

// Environment variable to control data storage level
// 'minimal' = only essential data (cheapest)
// 'standard' = essential + limited detail data
// 'full' = all data including headings/images/links
const STORAGE_LEVEL = (process.env.CRAWL_STORAGE_LEVEL || 'minimal') as 'minimal' | 'standard' | 'full';

// Limits for standard storage
const MAX_HEADINGS = 10; // Only save first 10 headings per level
const MAX_IMAGES = 20; // Only save first 20 images
const MAX_LINKS = 50; // Only save first 50 links

// Text field limits (space optimization)
const MAX_TITLE_LENGTH = parseInt(process.env.MAX_TITLE_LENGTH || '200', 10);
const MAX_META_DESCRIPTION_LENGTH = parseInt(process.env.MAX_META_DESCRIPTION_LENGTH || '300', 10);

// JSONB field limits (space optimization)
const MAX_HTTP_HEADERS = parseInt(process.env.MAX_HTTP_HEADERS || '10', 10);
const MAX_STRUCTURED_DATA_BLOCKS = parseInt(process.env.MAX_STRUCTURED_DATA_BLOCKS || '3', 10);
const MAX_REDIRECT_CHAIN_LENGTH = parseInt(process.env.MAX_REDIRECT_CHAIN_LENGTH || '5', 10);

// Essential HTTP headers to keep (others filtered out)
const ESSENTIAL_HEADERS = new Set([
  'cache-control',
  'content-type',
  'content-length',
  'etag',
  'last-modified',
  'expires',
  'x-robots-tag',
  'x-frame-options',
  'x-content-type-options',
]);

// Helper function to truncate text
function truncateText(text: string | null, maxLength: number): string | null {
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// Helper function to filter HTTP headers
function filterHttpHeaders(headers: Record<string, string> | undefined): Record<string, string> | null {
  if (!headers || Object.keys(headers).length === 0) return null;
  
  const filtered: Record<string, string> = {};
  let count = 0;
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (ESSENTIAL_HEADERS.has(lowerKey) && count < MAX_HTTP_HEADERS) {
      filtered[key] = value;
      count++;
    }
  }
  
  return Object.keys(filtered).length > 0 ? filtered : null;
}

// Helper function to limit structured data
function limitStructuredData(data: any[] | undefined): any[] | null {
  if (!data || data.length === 0) return null;
  
  // Limit number of blocks
  const limited = data.slice(0, MAX_STRUCTURED_DATA_BLOCKS);
  
  // Truncate large JSON blocks (over 5KB)
  const processed = limited.map((block) => {
    if (block.data) {
      const jsonStr = JSON.stringify(block.data);
      if (jsonStr.length > 5000) {
        // Truncate large structured data
        try {
          const truncated = JSON.parse(jsonStr.substring(0, 5000));
          return { ...block, data: truncated, _truncated: true };
        } catch {
          return { ...block, data: null, _truncated: true };
        }
      }
    }
    return block;
  });
  
  return processed.length > 0 ? processed : null;
}

// Helper function to limit redirect chain
function limitRedirectChain(chain: string[] | undefined): string[] | null {
  if (!chain || chain.length === 0) return null;
  if (chain.length <= MAX_REDIRECT_CHAIN_LENGTH) return chain;
  // Keep first and last redirects, skip middle ones if too long
  // Only compress if chain is significantly longer than max
  if (chain.length > MAX_REDIRECT_CHAIN_LENGTH + 3) {
    return [
      ...chain.slice(0, 2),
      `... (${chain.length - 4} redirects) ...`,
      ...chain.slice(-2),
    ];
  }
  // Otherwise just truncate
  return chain.slice(0, MAX_REDIRECT_CHAIN_LENGTH);
}

export async function saveCrawlResultToDb(
  seoData: SEOData,
  auditId: string,
  domainId?: string,
  baseUrl?: string // Optional baseUrl for consistent normalization
) {
  // IMPORTANT: Check if this URL was already crawled in this audit to prevent duplicates
  // Normalize URL for comparison - use baseUrl if provided for consistent normalization
  const normalizedUrl = normalizeUrl(seoData.url, baseUrl);
  
  // OPTIMIZED: Get audit info and check duplicates in parallel
  const [audit, existingInAudit] = await Promise.all([
    prisma.audit.findUnique({
      where: { id: auditId },
      select: { projectId: true },
    }),
    // Check in current audit first (most common case)
    prisma.crawlResult.findFirst({
      where: {
        auditId,
        url: normalizedUrl,
      },
      select: {
        id: true,
      },
    }),
  ]);

  if (existingInAudit) {
    console.log(`[Crawler-DB] ⚠️  Duplicate crawl result detected for ${normalizedUrl} in audit ${auditId}, skipping save`);
    return null; // Don't create duplicate
  }

  // Also check if URL was crawled in the project within 14 days (project-level deduplication)
  // OPTIMIZED: Only check if we have a projectId
  if (audit?.projectId) {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    
    const existingInProject = await prisma.crawlResult.findFirst({
      where: {
        url: normalizedUrl,
        crawledAt: {
          gte: fourteenDaysAgo,
        },
        Audit: {
          projectId: audit.projectId,
        },
      },
      select: {
        id: true,
        crawledAt: true,
      },
    });

    if (existingInProject) {
      const daysAgo = Math.floor((Date.now() - existingInProject.crawledAt.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`[Crawler-DB] ⚠️  URL already crawled in project ${audit.projectId} ${daysAgo} days ago: ${normalizedUrl}, skipping save`);
      return null; // Don't create duplicate across audits
    }
  }

  const data: any = {
    id: crypto.randomUUID(),
    auditId,
    domainId,
    url: normalizedUrl, // Use normalized URL
    statusCode: seoData.statusCode,
    // Truncate text fields to save space
    title: truncateText(seoData.title, MAX_TITLE_LENGTH),
    metaDescription: truncateText(seoData.metaDescription, MAX_META_DESCRIPTION_LENGTH),
    metaKeywords: truncateText(seoData.metaKeywords, 200), // Limit keywords too
    canonicalUrl: seoData.canonicalUrl, // URLs already normalized
    language: seoData.language,
    responseTimeMs: seoData.responseTime,
    crawledAt: seoData.crawledAt,
    h1Count: seoData.h1.length,
    h2Count: seoData.h2.length,
    h3Count: seoData.h3.length,
    imagesCount: seoData.images.length,
    imagesWithAltCount: seoData.images.filter((img) => img.alt).length,
    internalLinksCount: seoData.links.filter((link) => !link.isExternal).length,
    externalLinksCount: seoData.links.filter((link) => link.isExternal).length,
    completenessScore: calculateCompletenessScore(seoData),
    // Redirect tracking (limited to save space)
    redirectChain: limitRedirectChain(seoData.redirectChain),
    redirectCount: seoData.redirectCount || 0,
    finalUrl: seoData.finalUrl || null,
    // HTTP metadata
    contentLength: seoData.contentLength || null,
    lastModified: seoData.lastModified 
      ? new Date(seoData.lastModified) 
      : null,
    etag: seoData.etag || null,
    // Meta robots tag
    metaRobots: seoData.metaRobots || null,
    // Structured data (limited to save space)
    structuredData: limitStructuredData(seoData.structuredData),
    // HTTP headers (filtered to essential only)
    httpHeaders: filterHttpHeaders(seoData.headers),
    // Content metrics
    wordCount: seoData.wordCount || null,
    contentQualityScore: seoData.contentQualityScore !== undefined ? seoData.contentQualityScore : null,
    contentDepthScore: seoData.contentDepthScore !== undefined ? seoData.contentDepthScore : null,
    // Content hash for similarity detection
    contentHash: seoData.contentHash || null,
    // Performance metrics (only store non-null values to save space)
    performanceMetrics: seoData.performanceMetrics && Object.values(seoData.performanceMetrics).some(v => v !== null)
      ? seoData.performanceMetrics
      : null,
    // Mobile metrics (small, but only store if has data)
    mobileMetrics: seoData.mobileMetrics && (
      seoData.mobileMetrics.hasViewportMeta !== null ||
      seoData.mobileMetrics.isMobileFriendly !== null ||
      seoData.mobileMetrics.viewportContent !== null
    ) ? seoData.mobileMetrics : null,
  };

  // Only save detailed data based on storage level
  if (STORAGE_LEVEL === 'full') {
    // Save all headings, images, and links
    data.Heading = {
      create: [
        ...seoData.h1.map((text, index) => ({
          id: crypto.randomUUID(),
          level: 1,
          text,
          order: index,
        })),
        ...seoData.h2.map((text, index) => ({
          id: crypto.randomUUID(),
          level: 2,
          text,
          order: index,
        })),
        ...seoData.h3.map((text, index) => ({
          id: crypto.randomUUID(),
          level: 3,
          text,
          order: index,
        })),
      ],
    };
    data.Image = {
      create: seoData.images.map((img, index) => ({
        id: crypto.randomUUID(),
        src: img.src,
        alt: img.alt,
        title: img.title,
        width: img.width || null,
        height: img.height || null,
        order: index,
      })),
    };
    data.Link = {
      create: seoData.links.map((link, index) => ({
        id: crypto.randomUUID(),
        href: link.href,
        text: link.text,
        isExternal: link.isExternal,
        rel: link.rel,
        order: index,
      })),
    };
  } else if (STORAGE_LEVEL === 'standard') {
    // Save limited headings, images, and links
    data.Heading = {
      create: [
        ...seoData.h1.slice(0, MAX_HEADINGS).map((text, index) => ({
          id: crypto.randomUUID(),
          level: 1,
          text,
          order: index,
        })),
        ...seoData.h2.slice(0, MAX_HEADINGS).map((text, index) => ({
          id: crypto.randomUUID(),
          level: 2,
          text,
          order: index,
        })),
        ...seoData.h3.slice(0, MAX_HEADINGS).map((text, index) => ({
          id: crypto.randomUUID(),
          level: 3,
          text,
          order: index,
        })),
      ],
    };
    data.Image = {
      create: seoData.images.slice(0, MAX_IMAGES).map((img, index) => ({
        id: crypto.randomUUID(),
        src: img.src,
        alt: img.alt,
        title: img.title,
        width: img.width || null,
        height: img.height || null,
        order: index,
      })),
    };
    data.Link = {
      create: seoData.links.slice(0, MAX_LINKS).map((link, index) => ({
        id: crypto.randomUUID(),
        href: link.href,
        text: link.text,
        isExternal: link.isExternal,
        rel: link.rel,
        order: index,
      })),
    };
  }
  // 'minimal' level: Don't save headings/images/links at all

  // Save OG tags (always save - small data)
  if (
    seoData.ogTags.title ||
    seoData.ogTags.description ||
    seoData.ogTags.image ||
    seoData.ogTags.type ||
    seoData.ogTags.url
  ) {
    data.OgTag = {
      create: {
        id: crypto.randomUUID(),
        title: seoData.ogTags.title,
        description: seoData.ogTags.description,
        image: seoData.ogTags.image,
        type: seoData.ogTags.type,
        url: seoData.ogTags.url,
      },
    };
  }

  // Check if audit exists before saving (prevent foreign key errors)
  if (auditId) {
    try {
      const auditExists = await prisma.audit.findUnique({
        where: { id: auditId },
        select: { id: true },
      });

      if (!auditExists) {
        console.error(`[DB] Audit ${auditId} not found, cannot save crawl result for ${seoData.url}`);
        throw new Error(`Audit ${auditId} not found - may have been deleted`);
      }
    } catch (error: any) {
      // If it's our custom error, re-throw it
      if (error?.message?.includes('not found')) {
        throw error;
      }
      // If it's a Prisma error (like connection issue), log and re-throw
      console.error(`[DB] Error checking audit existence:`, error);
      throw error;
    }
  }

  const crawlResult = await prisma.crawlResult.create({
    data,
    include: {
      Heading: STORAGE_LEVEL !== 'minimal',
      Image: STORAGE_LEVEL !== 'minimal',
      Link: STORAGE_LEVEL !== 'minimal',
      OgTag: true,
    },
  });

  return crawlResult;
}

function calculateCompletenessScore(seoData: SEOData): number {
  let score = 0;
  let total = 0;

  // Title (required)
  total += 1;
  if (seoData.title) score += 1;

  // Meta description (important)
  total += 1;
  if (seoData.metaDescription) score += 1;

  // H1 (important)
  total += 1;
  if (seoData.h1.length > 0) score += 1;

  // Canonical URL (optional but good)
  total += 0.5;
  if (seoData.canonicalUrl) score += 0.5;

  // Images with alt text
  total += 1;
  const imagesWithAlt = seoData.images.filter((img) => img.alt).length;
  if (seoData.images.length > 0) {
    score += imagesWithAlt / seoData.images.length;
  } else {
    score += 1; // No images is fine
  }

  return score / total;
}

