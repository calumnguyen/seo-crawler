import { prisma } from './prisma';

export interface ContentSimilarityResult {
  crawlResultId1: string;
  crawlResultId2: string;
  url1: string;
  url2: string;
  similarityScore: number; // 0-1, where 1 is identical
  similarityType: 'exact' | 'near-duplicate' | 'similar';
  sharedWordCount?: number;
  totalWordCount1?: number;
  totalWordCount2?: number;
}

/**
 * Calculate similarity between two content hashes
 * Uses exact match for now - could be extended with fuzzy matching
 */
export function calculateContentSimilarity(
  hash1: string,
  hash2: string
): { similarity: number; type: 'exact' | 'near-duplicate' | 'similar' } {
  if (hash1 === hash2) {
    return { similarity: 1.0, type: 'exact' };
  }
  
  // For now, we only do exact hash matching
  // Could extend with:
  // - Levenshtein distance for near-duplicate detection
  // - Jaccard similarity for word overlap
  // - SimHash for fuzzy matching
  
  return { similarity: 0, type: 'similar' };
}

/**
 * Find duplicate/similar content across all crawled projects
 */
export async function findDuplicateContent(
  minSimilarity: number = 0.95
): Promise<ContentSimilarityResult[]> {
  // Get all crawl results with content hashes
  const crawlResults = await prisma.crawlResult.findMany({
    where: {
      contentHash: { not: null },
      statusCode: { gte: 200, lt: 400 }, // Only successful pages
    },
    select: {
      id: true,
      url: true,
      contentHash: true,
      wordCount: true,
      Audit: {
        select: {
          projectId: true,
        },
      },
    },
    orderBy: {
      crawledAt: 'desc',
    },
  });
  
  // Group by content hash
  const hashMap = new Map<string, Array<{ id: string; url: string; wordCount: number | null; projectId: string | null }>>();
  
  for (const result of crawlResults) {
    if (result.contentHash) {
      if (!hashMap.has(result.contentHash)) {
        hashMap.set(result.contentHash, []);
      }
      hashMap.get(result.contentHash)!.push({
        id: result.id,
        url: result.url,
        wordCount: result.wordCount,
        projectId: result.Audit?.projectId || null,
      });
    }
  }
  
  // Find duplicates (same hash = exact duplicate)
  const duplicates: ContentSimilarityResult[] = [];
  
  for (const [hash, pages] of hashMap.entries()) {
    if (pages.length > 1) {
      // Create pairs for all combinations
      for (let i = 0; i < pages.length; i++) {
        for (let j = i + 1; j < pages.length; j++) {
          duplicates.push({
            crawlResultId1: pages[i].id,
            crawlResultId2: pages[j].id,
            url1: pages[i].url,
            url2: pages[j].url,
            similarityScore: 1.0,
            similarityType: 'exact',
            totalWordCount1: pages[i].wordCount || undefined,
            totalWordCount2: pages[j].wordCount || undefined,
          });
        }
      }
    }
  }
  
  return duplicates;
}

/**
 * Create issues for duplicate content across projects
 */
export async function createDuplicateContentIssues(
  duplicates: ContentSimilarityResult[]
): Promise<void> {
  const issues = [];
  
  for (const dup of duplicates) {
    // Create issue for first page
    issues.push({
      crawlResultId: dup.crawlResultId1,
      severity: 'warning' as const,
      category: 'content-quality',
      type: 'duplicate_content',
      message: `Exact duplicate content found with ${dup.url2}`,
      recommendation: 'Consider using canonical tags or creating unique content for each page',
      details: {
        duplicateUrl: dup.url2,
        similarityScore: dup.similarityScore,
        similarityType: dup.similarityType,
      },
    });
    
    // Create issue for second page
    issues.push({
      crawlResultId: dup.crawlResultId2,
      severity: 'warning' as const,
      category: 'content-quality',
      type: 'duplicate_content',
      message: `Exact duplicate content found with ${dup.url1}`,
      recommendation: 'Consider using canonical tags or creating unique content for each page',
      details: {
        duplicateUrl: dup.url1,
        similarityScore: dup.similarityScore,
        similarityType: dup.similarityType,
      },
    });
  }
  
  if (issues.length > 0) {
    // Get audit IDs for the crawl results
    const crawlResultIds = [...new Set(issues.map(i => i.crawlResultId))];
    const crawlResults = await prisma.crawlResult.findMany({
      where: {
        id: { in: crawlResultIds },
      },
      select: {
        id: true,
        auditId: true,
      },
    });
    
    const auditIdMap = new Map(crawlResults.map(cr => [cr.id, cr.auditId]));
    
    await prisma.issue.createMany({
      data: issues.map((issue) => ({
        id: crypto.randomUUID(),
        crawlResultId: issue.crawlResultId,
        auditId: auditIdMap.get(issue.crawlResultId) || null,
        severity: issue.severity,
        category: issue.category,
        type: issue.type,
        message: issue.message,
        recommendation: issue.recommendation,
        details: issue.details,
      })),
      skipDuplicates: true,
    });
  }
}

/**
 * Analyze and detect duplicate content across all projects
 * This should be run periodically (e.g., daily) or after major crawls
 */
export async function analyzeDuplicateContentAcrossProjects(): Promise<number> {
  console.log('[Content Similarity] Starting duplicate content analysis across all projects...');
  
  const duplicates = await findDuplicateContent(0.95);
  console.log(`[Content Similarity] Found ${duplicates.length} duplicate content pairs`);
  
  if (duplicates.length > 0) {
    await createDuplicateContentIssues(duplicates);
    console.log(`[Content Similarity] Created ${duplicates.length * 2} duplicate content issues`);
  }
  
  return duplicates.length;
}

