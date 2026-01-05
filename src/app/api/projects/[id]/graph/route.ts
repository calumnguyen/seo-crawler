import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the project to find the base URL
    const project = await prisma.project.findUnique({
      where: { id },
      select: { baseUrl: true, domain: true },
    });

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Extract domain from baseUrl for comparison
    let projectDomain: string;
    try {
      const baseUrlObj = new URL(project.baseUrl);
      projectDomain = baseUrlObj.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      projectDomain = project.domain.toLowerCase();
    }

    // Get all crawled pages for this project
    const allCrawlResults = await prisma.crawlResult.findMany({
      where: {
        Audit: {
          projectId: id,
        },
      },
      select: {
        id: true,
        url: true,
        title: true,
        statusCode: true,
        internalLinksCount: true,
      },
      orderBy: {
        crawledAt: 'desc',
      },
    });

    // Filter to only include pages from the project's domain (exclude external backlink pages)
    const crawlResults = allCrawlResults.filter((result) => {
      try {
        const urlObj = new URL(result.url);
        const resultDomain = urlObj.hostname.replace(/^www\./, '').toLowerCase();
        return resultDomain === projectDomain;
      } catch {
        // If URL parsing fails, exclude it to be safe
        return false;
      }
    });

    if (crawlResults.length === 0) {
      return NextResponse.json({
        nodes: [],
        links: [],
      });
    }

    // Create a map of URL to crawl result ID for quick lookup
    const urlToIdMap = new Map<string, string>();
    crawlResults.forEach((result) => {
      // Normalize URLs for matching (remove trailing slashes, handle fragments, etc.)
      const normalizedUrl = normalizeUrl(result.url);
      urlToIdMap.set(normalizedUrl, result.id);
    });

    // Create a map of crawl result ID to URL for resolving relative URLs
    const idToUrlMap = new Map<string, string>();
    crawlResults.forEach((result) => {
      idToUrlMap.set(result.id, result.url);
    });

    // Get all internal links
    const allLinks = await prisma.link.findMany({
      where: {
        crawlResultId: {
          in: crawlResults.map((r) => r.id),
        },
        isExternal: false,
      },
      select: {
        id: true,
        crawlResultId: true,
        href: true,
      },
    });

    // Identify root page (baseUrl/homepage)
    const normalizedBaseUrl = normalizeUrl(project.baseUrl);
    let rootId: string | undefined;
    crawlResults.forEach((result) => {
      const normalizedUrl = normalizeUrl(result.url);
      if (normalizedUrl === normalizedBaseUrl || normalizedUrl === normalizeUrl(project.baseUrl + '/')) {
        rootId = result.id;
      }
    });
    
    // If no exact match, find the page with shortest path (likely homepage)
    if (!rootId && crawlResults.length > 0) {
      const sortedByPath = [...crawlResults].sort((a, b) => {
        try {
          const aPath = new URL(a.url).pathname.length;
          const bPath = new URL(b.url).pathname.length;
          return aPath - bPath;
        } catch {
          return 0;
        }
      });
      rootId = sortedByPath[0].id;
    }

    // Build adjacency map (child -> parent relationships)
    const parentMap = new Map<string, string>(); // childId -> parentId
    const childrenMap = new Map<string, Set<string>>(); // parentId -> Set<childId>
    
    // Initialize children map
    crawlResults.forEach((result) => {
      childrenMap.set(result.id, new Set());
    });

    // Build edges and identify parent-child relationships
    const linkSet = new Set<string>(); // Track unique links to avoid duplicates
    const links: Array<{ source: string; target: string; id: string }> = [];

    for (const link of allLinks) {
      const sourceId = link.crawlResultId;
      const sourceUrl = idToUrlMap.get(sourceId);
      
      if (!sourceUrl) continue;
      
      // Resolve the href to an absolute URL (use source page URL as base for relative URLs)
      const targetUrl = resolveUrl(link.href, sourceUrl);
      const normalizedTargetUrl = normalizeUrl(targetUrl);
      
      // Check if the target URL was crawled
      const targetId = urlToIdMap.get(normalizedTargetUrl);
      
      if (targetId && targetId !== sourceId) {
        // Create a unique key for this edge
        const edgeKey = `${sourceId}-${targetId}`;
        
        if (!linkSet.has(edgeKey)) {
          linkSet.add(edgeKey);
          links.push({
            source: sourceId,
            target: targetId,
            id: link.id,
          });
          
          // Build parent-child relationships (only if target doesn't already have a parent closer to root)
          if (!parentMap.has(targetId) || rootId === sourceId) {
            parentMap.set(targetId, sourceId);
            childrenMap.get(sourceId)?.add(targetId);
          }
        }
      }
    }

    // Calculate depth for each node (distance from root)
    const depthMap = new Map<string, number>();
    const calculateDepth = (nodeId: string, visited: Set<string> = new Set()): number => {
      if (visited.has(nodeId)) return 0; // Cycle detection
      if (nodeId === rootId) return 0;
      
      visited.add(nodeId);
      const parentId = parentMap.get(nodeId);
      if (!parentId) {
        // Orphan node, assign high depth
        return 999;
      }
      
      return 1 + calculateDepth(parentId, visited);
    };

    crawlResults.forEach((result) => {
      const depth = rootId === result.id ? 0 : calculateDepth(result.id);
      depthMap.set(result.id, depth);
    });

    // Build nodes with depth information
    const nodes = crawlResults.map((result) => ({
      id: result.id,
      url: result.url,
      title: result.title || result.url,
      statusCode: result.statusCode,
      internalLinksCount: result.internalLinksCount,
      depth: depthMap.get(result.id) || 999,
      isRoot: result.id === rootId,
      // Calculate node size based on number of internal links
      value: Math.max(3, Math.min(20, result.internalLinksCount || 1)),
    }));

    return NextResponse.json({
      nodes,
      links,
      rootId: rootId || nodes[0]?.id,
    });
  } catch (error) {
    console.error('Error fetching graph data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch graph data' },
      { status: 500 }
    );
  }
}

// Helper function to normalize URLs for matching
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove fragment
    urlObj.hash = '';
    // Normalize path (remove trailing slash except for root)
    if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    return urlObj.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// Helper function to resolve relative URLs to absolute
function resolveUrl(href: string, baseUrl: string): string {
  try {
    // If it's already absolute, return it
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }
    // Resolve relative URLs
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

