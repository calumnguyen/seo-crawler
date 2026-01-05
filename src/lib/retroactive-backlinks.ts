import { prisma } from './prisma';
import { normalizeUrl } from './robots';

/**
 * Retroactive Backlink Creation
 * 
 * When a new page is crawled, check if any existing Link records point to it
 * and create backlinks retroactively.
 * 
 * This handles the case where:
 * - Day 1: Page A is crawled, links to Page B (Page B doesn't exist yet)
 * - Day 2: Page B is crawled
 * - Result: Backlink from Page A to Page B should be created
 */

/**
 * Create backlinks retroactively for a newly crawled page
 * Finds all existing Link records that point to this page and creates backlinks
 */
export async function createRetroactiveBacklinks(
  targetCrawlResultId: string,
  targetUrl: string,
  targetProjectId: string,
  baseUrl?: string
): Promise<number> {
  try {
    // Normalize the target URL for matching
    const normalizedTargetUrl = normalizeUrl(targetUrl, baseUrl);
    
    // Find all existing Link records that point to this URL
    // These are links from pages that were crawled BEFORE this page
    const existingLinks = await prisma.link.findMany({
      where: {
        href: normalizedTargetUrl,
        // Exclude links from the same crawl result (self-references)
        crawlResultId: {
          not: targetCrawlResultId,
        },
      },
      select: {
        id: true,
        crawlResultId: true,
        href: true,
        text: true,
        rel: true,
        CrawlResult: {
          select: {
            id: true,
            url: true,
            Audit: {
              select: {
                projectId: true,
              },
            },
          },
        },
      },
    });
    
    if (existingLinks.length === 0) {
      return 0; // No existing links found
    }
    
    // Check which backlinks already exist to avoid duplicates
    const existingBacklinkLinkIds = await prisma.backlink.findMany({
      where: {
        projectId: targetProjectId,
        linkId: {
          in: existingLinks.map(link => link.id),
        },
      },
      select: {
        linkId: true,
      },
    });
    
    const existingLinkIds = new Set(existingBacklinkLinkIds.map(bl => bl.linkId).filter(Boolean));
    
    // Prepare backlink records to create
    const backlinksToCreate: Array<{
      id: string;
      projectId: string;
      sourcePageId: string;
      linkId: string;
      anchorText: string | null;
      isDofollow: boolean;
      isSponsored: boolean;
      isUgc: boolean;
      linkPosition: string | null;
      discoveredVia: string;
    }> = [];
    
    for (const link of existingLinks) {
      // Skip if backlink already exists
      if (existingLinkIds.has(link.id)) {
        continue;
      }
      
      // Skip if source page doesn't have a project (shouldn't happen, but safety check)
      if (!link.CrawlResult?.Audit?.projectId) {
        continue;
      }
      
      // Parse rel attributes to determine link attributes
      const rel = link.rel || '';
      const relLower = rel.toLowerCase();
      const isDofollow = !relLower.includes('nofollow');
      const isSponsored = relLower.includes('sponsored');
      const isUgc = relLower.includes('ugc');
      
      // Create backlink record
      // projectId = target project (the project receiving the backlink)
      // sourcePageId = source page (the page containing the link)
      backlinksToCreate.push({
        id: crypto.randomUUID(),
        projectId: targetProjectId, // Target project (receives the backlink)
        sourcePageId: link.crawlResultId, // Source page (contains the link)
        linkId: link.id, // The Link record ID
        anchorText: link.text || null,
        isDofollow: isDofollow,
        isSponsored: isSponsored,
        isUgc: isUgc,
        linkPosition: null, // Could be enhanced to track link position
        discoveredVia: 'crawl', // Retroactive backlinks are from normal crawls
      });
    }
    
    if (backlinksToCreate.length === 0) {
      return 0;
    }
    
    // Use createMany for efficiency (batch insert)
    try {
      await prisma.backlink.createMany({
        data: backlinksToCreate,
        skipDuplicates: true, // Skip if duplicate (projectId, sourcePageId, linkId) already exists
      });
      
      console.log(`[Retroactive-Backlinks] Created ${backlinksToCreate.length} retroactive backlinks for ${targetUrl}`);
      
      return backlinksToCreate.length;
    } catch (error) {
      console.error(`[Retroactive-Backlinks] Error creating retroactive backlinks:`, error);
      return 0;
    }
    
  } catch (error) {
    console.error(`[Retroactive-Backlinks] Error creating retroactive backlinks for ${targetUrl}:`, error);
    return 0;
  }
}

