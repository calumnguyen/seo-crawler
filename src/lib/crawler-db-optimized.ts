import { prisma } from './prisma';
import { normalizeUrl } from './robots';
import type { SEOData } from '@/types/seo';

// Environment variable to control data storage level
// 'minimal' = only essential data (cheapest)
// 'standard' = essential + limited detail data
// 'full' = all data including headings/images/links
const STORAGE_LEVEL = (process.env.CRAWL_STORAGE_LEVEL || 'standard') as 'minimal' | 'standard' | 'full';

// Limits for standard storage
const MAX_HEADINGS = 10; // Only save first 10 headings per level
const MAX_IMAGES = 20; // Only save first 20 images
const MAX_LINKS = 50; // Only save first 50 links

export async function saveCrawlResultToDb(
  seoData: SEOData,
  auditId: string,
  domainId?: string,
  baseUrl?: string // Optional baseUrl for consistent normalization
) {
  // IMPORTANT: Check if this URL was already crawled in this audit to prevent duplicates
  // Normalize URL for comparison - use baseUrl if provided for consistent normalization
  const normalizedUrl = normalizeUrl(seoData.url, baseUrl);
  
  // Check if crawl result already exists for this audit and URL
  // Also check across ALL audits in the same project to prevent duplicates
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    select: { projectId: true },
  });

  // First check in current audit
  const existingInAudit = await prisma.crawlResult.findFirst({
    where: {
      auditId,
      url: normalizedUrl,
    },
    select: {
      id: true,
    },
  });

  if (existingInAudit) {
    console.log(`[Crawler-DB] ⚠️  Duplicate crawl result detected for ${normalizedUrl} in audit ${auditId}, skipping save`);
    return null; // Don't create duplicate
  }

  // Also check if URL was crawled in the project within 14 days (project-level deduplication)
  if (audit?.projectId) {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    
    const existingInProject = await prisma.crawlResult.findFirst({
      where: {
        url: normalizedUrl,
        crawledAt: {
          gte: fourteenDaysAgo,
        },
        audit: {
          projectId: audit.projectId,
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

    if (existingInProject) {
      const daysAgo = Math.floor((Date.now() - existingInProject.crawledAt.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`[Crawler-DB] ⚠️  URL already crawled in project ${audit.projectId} ${daysAgo} days ago: ${normalizedUrl}, skipping save`);
      return null; // Don't create duplicate across audits
    }
  }

  const data: any = {
    auditId,
    domainId,
    url: normalizedUrl, // Use normalized URL
    statusCode: seoData.statusCode,
    title: seoData.title,
    metaDescription: seoData.metaDescription,
    metaKeywords: seoData.metaKeywords,
    canonicalUrl: seoData.canonicalUrl,
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
  };

  // Only save detailed data based on storage level
  if (STORAGE_LEVEL === 'full') {
    // Save all headings, images, and links
    data.headings = {
      create: [
        ...seoData.h1.map((text, index) => ({
          level: 1,
          text,
          order: index,
        })),
        ...seoData.h2.map((text, index) => ({
          level: 2,
          text,
          order: index,
        })),
        ...seoData.h3.map((text, index) => ({
          level: 3,
          text,
          order: index,
        })),
      ],
    };
    data.images = {
      create: seoData.images.map((img, index) => ({
        src: img.src,
        alt: img.alt,
        title: img.title,
        order: index,
      })),
    };
    data.links = {
      create: seoData.links.map((link, index) => ({
        href: link.href,
        text: link.text,
        isExternal: link.isExternal,
        rel: link.rel,
        order: index,
      })),
    };
  } else if (STORAGE_LEVEL === 'standard') {
    // Save limited headings, images, and links
    data.headings = {
      create: [
        ...seoData.h1.slice(0, MAX_HEADINGS).map((text, index) => ({
          level: 1,
          text,
          order: index,
        })),
        ...seoData.h2.slice(0, MAX_HEADINGS).map((text, index) => ({
          level: 2,
          text,
          order: index,
        })),
        ...seoData.h3.slice(0, MAX_HEADINGS).map((text, index) => ({
          level: 3,
          text,
          order: index,
        })),
      ],
    };
    data.images = {
      create: seoData.images.slice(0, MAX_IMAGES).map((img, index) => ({
        src: img.src,
        alt: img.alt,
        title: img.title,
        order: index,
      })),
    };
    data.links = {
      create: seoData.links.slice(0, MAX_LINKS).map((link, index) => ({
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
    data.ogTags = {
      create: {
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
      headings: STORAGE_LEVEL !== 'minimal',
      images: STORAGE_LEVEL !== 'minimal',
      links: STORAGE_LEVEL !== 'minimal',
      ogTags: true,
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

