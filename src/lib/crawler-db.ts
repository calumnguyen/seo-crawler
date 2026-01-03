import { prisma } from './prisma';
import type { SEOData } from '@/types/seo';

export async function saveCrawlResultToDb(
  seoData: SEOData,
  auditId: string,
  domainId?: string
) {
  // Save main crawl result
  const crawlResult = await prisma.crawlResult.create({
    data: {
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
      contentLength: null, // Can be added later
      crawledAt: seoData.crawledAt,
      h1Count: seoData.h1.length,
      h2Count: seoData.h2.length,
      h3Count: seoData.h3.length,
      imagesCount: seoData.images.length,
      imagesWithAltCount: seoData.images.filter((img) => img.alt).length,
      internalLinksCount: seoData.links.filter((link) => !link.isExternal).length,
      externalLinksCount: seoData.links.filter((link) => link.isExternal).length,
      completenessScore: calculateCompletenessScore(seoData),
      // Save headings
      headings: {
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
      },
      // Save images
      images: {
        create: seoData.images.map((img, index) => ({
          src: img.src,
          alt: img.alt,
          title: img.title,
          order: index,
        })),
      },
      // Save links
      links: {
        create: seoData.links.map((link, index) => ({
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
            ogTags: {
              create: {
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
      headings: true,
      images: true,
      links: true,
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

