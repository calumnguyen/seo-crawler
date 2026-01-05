import { prisma } from './prisma';
import { normalizeUrl } from './robots';
import type { SEOData, LinkData } from '@/types/seo';

/**
 * Save backlinks for a crawl result
 * Backlinks track links FROM other pages TO the current page
 * 
 * EFFICIENT IMPLEMENTATION:
 * - Only processes internal links (external links don't create backlinks within the project)
 * - Uses batch operations (createMany) for efficiency
 * - Only creates backlinks for links that point to pages already crawled in the same project
 * - Uses URL normalization for matching
 * - Runs asynchronously to not block crawl processing
 */
export async function saveBacklinksForCrawlResult(
  sourceCrawlResultId: string,
  sourceUrl: string,
  links: LinkData[],
  projectId: string,
  baseUrl?: string,
  discoveredVia?: 'google' | 'bing' | 'crawl' // How this backlink was discovered
): Promise<number> {
  if (links.length === 0) {
    return 0;
  }

  try {
    // Process ALL links (both internal and external) for true backlink tracking
    // This provides real SEO value by tracking external backlinks from other sites
    const allLinks = links;
    
    if (allLinks.length === 0) {
      return 0;
    }

    // Normalize the base URL for consistent matching
    const normalizedBaseUrl = baseUrl || sourceUrl;

    // Get all unique normalized link URLs (target URLs)
    const targetUrls = new Set<string>();
    const linkDataMap = new Map<string, LinkData>(); // Map normalized URL to link data
    
    for (const link of allLinks) {
      try {
        const normalizedLinkUrl = normalizeUrl(link.href, normalizedBaseUrl);
        targetUrls.add(normalizedLinkUrl);
        linkDataMap.set(normalizedLinkUrl, link);
      } catch {
        // Skip invalid URLs
        continue;
      }
    }

    if (targetUrls.size === 0) {
      return 0;
    }

    // Find all CrawlResults (target pages) in ANY project that match these link URLs
    // This enables cross-project backlink tracking for true SEO value
    // External links from Project A to Project B will create backlinks in Project B
    const targetResults = await prisma.crawlResult.findMany({
      where: {
        url: {
          in: Array.from(targetUrls),
        },
        // Removed projectId filter to allow cross-project backlinks
      },
      select: {
        id: true,
        url: true,
        Audit: {
          select: {
            projectId: true,
          },
        },
      },
    });

    if (targetResults.length === 0) {
      return 0; // No target pages found yet (they'll be backlinked later when those pages are crawled)
    }

    // Get the Link records we just created for the source page
    // We need to match link URLs to Link IDs
    const sourceLinks = await prisma.link.findMany({
      where: {
        crawlResultId: sourceCrawlResultId,
        href: {
          in: Array.from(targetUrls),
        },
      },
      select: {
        id: true,
        href: true,
        text: true,
        rel: true,
      },
    });

    // Create a map of normalized URL to Link ID and data
    const linkUrlToIdMap = new Map<string, string>();
    const linkUrlToDataMap = new Map<string, { id: string; text: string | null; rel: string | null }>();
    
    for (const linkRecord of sourceLinks) {
      try {
        const normalizedLinkUrl = normalizeUrl(linkRecord.href, normalizedBaseUrl);
        linkUrlToIdMap.set(normalizedLinkUrl, linkRecord.id);
        linkUrlToDataMap.set(normalizedLinkUrl, {
          id: linkRecord.id,
          text: linkRecord.text,
          rel: linkRecord.rel,
        });
      } catch {
        continue;
      }
    }

    // Prepare backlink records to create
    // Backlink.projectId = the target project (the project that receives the backlink)
    // Backlink.sourcePageId = the page that contains the link (sourceCrawlResultId)
    // Backlink.linkId = the Link record ID (optional)
    const backlinksToCreate: Array<{
      id: string;
      projectId: string;
      sourcePageId: string;
      linkId: string | null;
      anchorText: string | null;
      isDofollow: boolean;
      isSponsored: boolean;
      isUgc: boolean;
      linkPosition: string | null;
      discoveredVia: string | null;
    }> = [];

    // Create backlink records for each target page
    for (const targetResult of targetResults) {
      const normalizedTargetUrl = normalizeUrl(targetResult.url, normalizedBaseUrl);
      const linkId = linkUrlToIdMap.get(normalizedTargetUrl) || null;
      const linkData = linkDataMap.get(normalizedTargetUrl);

      if (!linkData || !targetResult.Audit?.projectId) {
        continue;
      }

      const targetProjectId = targetResult.Audit.projectId;
      const linkRecordData = linkUrlToDataMap.get(normalizedTargetUrl);
      const anchorText = linkRecordData?.text || linkData.text || null;
      const rel = linkRecordData?.rel || linkData.rel || '';

      // Parse rel attributes to determine link attributes
      const relLower = rel.toLowerCase();
      const isDofollow = !relLower.includes('nofollow');
      const isSponsored = relLower.includes('sponsored');
      const isUgc = relLower.includes('ugc');

      // Create backlink record
      // projectId = target project (the project receiving the backlink)
      // sourcePageId = source page (the page containing the link)
      // This allows cross-project backlinks: links from Project A create backlinks in Project B
      backlinksToCreate.push({
        id: crypto.randomUUID(),
        projectId: targetProjectId, // Target project (receives the backlink)
        sourcePageId: sourceCrawlResultId, // Source page (contains the link)
        linkId: linkId, // The Link record ID (optional)
        anchorText: anchorText,
        isDofollow: isDofollow,
        isSponsored: isSponsored,
        isUgc: isUgc,
        linkPosition: null, // Could be enhanced to track link position (header, footer, content, etc.)
        discoveredVia: discoveredVia || 'crawl', // Default to 'crawl' if not specified (normal crawl)
      });
    }

    if (backlinksToCreate.length === 0) {
      return 0;
    }

    // Use createMany for efficiency (batch insert)
    // Use skipDuplicates to handle cases where backlinks already exist
    try {
      await prisma.backlink.createMany({
        data: backlinksToCreate,
        skipDuplicates: true, // Skip if duplicate (projectId, sourcePageId, linkId) already exists
      });
      
      const backlinksCreated = backlinksToCreate.length;
      
      // Log to audit if we have audit context (for backlink discovery tracking)
      if (backlinksCreated > 0) {
        // Try to find the audit for this project to log the backlink creation
        try {
          const audit = await prisma.audit.findFirst({
            where: { projectId },
            orderBy: { startedAt: 'desc' },
            select: { id: true },
          });
          
          if (audit) {
            const { addAuditLog } = await import('./audit-logs');
            const discoveredViaLabel = discoveredVia === 'google' ? 'Google' : discoveredVia === 'bing' ? 'Bing' : 'crawl';
            addAuditLog(
              audit.id,
              'backlink-discovery',
              `✅ Found ${backlinksCreated} backlink(s) from ${sourceUrl} (discovered via ${discoveredViaLabel})`,
              {
                sourceUrl,
                sourceCrawlResultId,
                backlinksCreated,
                discoveredVia: discoveredVia || 'crawl',
                targetPages: backlinksToCreate.length,
                backlinkFound: true,
              }
            );
          }
        } catch (logError) {
          // Don't fail if logging fails
          console.error(`[Backlinks] Error logging backlink creation:`, logError);
        }
      } else if (discoveredVia && (discoveredVia === 'google' || discoveredVia === 'bing')) {
        // Log when no backlinks found from a discovered page (for tracking)
        try {
          const audit = await prisma.audit.findFirst({
            where: { projectId },
            orderBy: { startedAt: 'desc' },
            select: { id: true },
          });
          
          if (audit) {
            const { addAuditLog } = await import('./audit-logs');
            const discoveredViaLabel = discoveredVia === 'google' ? 'Google' : 'Bing';
            addAuditLog(
              audit.id,
              'backlink-discovery',
              `ℹ️ No backlinks found from ${sourceUrl} (discovered via ${discoveredViaLabel})`,
              {
                sourceUrl,
                sourceCrawlResultId,
                backlinksCreated: 0,
                discoveredVia: discoveredVia,
                backlinkFound: false,
              }
            );
          }
        } catch (logError) {
          // Don't fail if logging fails
          console.error(`[Backlinks] Error logging no backlinks found:`, logError);
        }
      }
      
      return backlinksCreated;
    } catch (error) {
      console.error(`[Backlinks] Error creating backlinks:`, error);
      return 0;
    }
  } catch (error) {
    console.error(`[Backlinks] Error saving backlinks for ${sourceCrawlResultId}:`, error);
    return 0;
  }
}

