import { prisma } from './prisma';
import type { SEOData } from '@/types/seo';

export async function saveCrawlResultToDb(
  seoData: SEOData,
  auditId: string,
  domainId?: string
) {
  // Save main crawl result
  // Note: Some fields require Prisma client regeneration after migration
  const crawlResult = await prisma.crawlResult.create({
    data: {
      id: crypto.randomUUID(),
      auditId,
      domainId,
      url: seoData.url,
      statusCode: seoData.statusCode,
      title: seoData.title,
      metaDescription: seoData.metaDescription,
      metaKeywords: seoData.metaKeywords,
      canonicalUrl: seoData.canonicalUrl,
      language: seoData.language,
      responseTimeMs: seoData.responseTime,
      contentLength: seoData.contentLength || null,
      crawledAt: seoData.crawledAt,
      // Redirect tracking
      redirectChain: seoData.redirectChain && seoData.redirectChain.length > 0 
        ? seoData.redirectChain 
        : undefined,
      redirectCount: seoData.redirectCount || 0,
      finalUrl: seoData.finalUrl || null,
      // HTTP metadata
      lastModified: seoData.lastModified 
        ? new Date(seoData.lastModified) 
        : null,
      etag: seoData.etag || null,
      // Meta robots tag (requires migration)
      // metaRobots: seoData.metaRobots || null,
      // Structured data
      structuredData: seoData.structuredData && seoData.structuredData.length > 0
        ? seoData.structuredData
        : undefined,
      // HTTP headers (requires migration)
      // httpHeaders: seoData.headers && Object.keys(seoData.headers).length > 0
      //   ? seoData.headers
      //   : undefined,
      // Content metrics (requires migration)
      // wordCount: seoData.wordCount || null,
      // contentQualityScore: seoData.contentQualityScore !== undefined ? seoData.contentQualityScore : null,
      // contentDepthScore: seoData.contentDepthScore !== undefined ? seoData.contentDepthScore : null,
      h1Count: seoData.h1.length,
      h2Count: seoData.h2.length,
      h3Count: seoData.h3.length,
      imagesCount: seoData.images.length,
      imagesWithAltCount: seoData.images.filter((img) => img.alt).length,
      internalLinksCount: seoData.links.filter((link) => !link.isExternal).length,
      externalLinksCount: seoData.links.filter((link) => link.isExternal).length,
      completenessScore: calculateCompletenessScore(seoData),
      // Save headings
      Heading: {
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
      },
      // Save images
      Image: {
        create: seoData.images.map((img, index) => ({
          id: crypto.randomUUID(),
          src: img.src,
          alt: img.alt,
          title: img.title,
          width: img.width || null,
          height: img.height || null,
          order: index,
        })),
      },
      // Save links
      Link: {
        create: seoData.links.map((link, index) => ({
          id: crypto.randomUUID(),
          href: link.href,
          text: link.text,
          isExternal: link.isExternal,
          rel: link.rel,
          order: index,
        })),
      },
      // Save OG tags (only if at least one exists)
      ...(seoData.ogTags.title ||
      seoData.ogTags.description ||
      seoData.ogTags.image ||
      seoData.ogTags.type ||
      seoData.ogTags.url
        ? {
            OgTag: {
              create: {
                id: crypto.randomUUID(),
                title: seoData.ogTags.title,
                description: seoData.ogTags.description,
                image: seoData.ogTags.image,
                type: seoData.ogTags.type,
                url: seoData.ogTags.url,
              },
            },
          }
        : {}),
    },
    include: {
      Heading: true,
      Image: true,
      Link: true,
      OgTag: true,
    },
  });

  return crawlResult;
}

function calculateCompletenessScore(seoData: SEOData): number {
  let score = 0;
  const maxScore = 100;

  // Title (20 points)
  if (seoData.title && seoData.title.length > 0) {
    score += 20;
  }

  // Meta description (20 points)
  if (seoData.metaDescription && seoData.metaDescription.length > 0) {
    score += 20;
  }

  // Headings (20 points)
  if (seoData.h1.length > 0) score += 10;
  if (seoData.h2.length > 0) score += 5;
  if (seoData.h3.length > 0) score += 5;

  // Images with alt text (20 points)
  const imagesWithAlt = seoData.images.filter((img) => img.alt).length;
  if (imagesWithAlt > 0) {
    score += Math.min(20, (imagesWithAlt / seoData.images.length) * 20);
  }

  // Links (20 points)
  if (seoData.links.length > 0) score += 20;

  return Math.min(maxScore, score);
}
