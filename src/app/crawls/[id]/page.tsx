'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import TetrisLoading from '@/components/ui/tetris-loader';

interface Heading {
  id: string;
  level: number;
  text: string;
  order: number;
}

interface Image {
  id: string;
  src: string;
  alt: string | null;
  title: string | null;
  width: number | null;
  height: number | null;
  order: number;
}

interface Link {
  id: string;
  href: string;
  text: string | null;
  isExternal: boolean;
  rel: string | null;
  order: number;
}

interface OgTag {
  id: string;
  title: string | null;
  description: string | null;
  image: string | null;
  type: string | null;
  url: string | null;
}

interface CrawlResult {
  id: string;
  url: string;
  statusCode: number;
  title: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  metaRobots: string | null;
  canonicalUrl: string | null;
  language: string | null;
  responseTimeMs: number;
  contentLength: number | null;
  crawledAt: string;
  lastModified: string | null;
  etag: string | null;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  imagesCount: number;
  imagesWithAltCount: number;
  internalLinksCount: number;
  externalLinksCount: number;
  completenessScore: number | null;
  wordCount: number | null;
  contentQualityScore: number | null;
  contentDepthScore: number | null;
  redirectChain: string[] | null;
  redirectCount: number | null;
  finalUrl: string | null;
  contentHash: string | null;
  httpHeaders: Record<string, string> | null;
  structuredData: any[] | null;
  performanceMetrics: {
    firstContentfulPaint: number | null;
    largestContentfulPaint: number | null;
    firstInputDelay: number | null;
    cumulativeLayoutShift: number | null;
    timeToInteractive: number | null;
    totalBlockingTime: number | null;
    speedIndex: number | null;
    aiSeoScore: number | null;
  } | null;
  mobileMetrics: {
    hasViewportMeta: boolean | null;
    viewportContent: string | null;
    isMobileFriendly: boolean | null;
    touchTargetSize: string | null;
    textReadability: string | null;
    contentWidth: number | null;
  } | null;
  Heading: Heading[];
  Image: Image[];
  Link: Link[];
  OgTag: OgTag | null;
  Audit: {
    Project: {
      id: string;
      name: string;
      domain: string;
      baseUrl: string;
    };
  };
  Issue: Array<{
    id: string;
    severity: 'error' | 'warning' | 'info';
    category: string;
    type: string;
    message: string;
    recommendation: string | null;
    details: any;
  }>;
}

// Helper component to render an issue inline
function IssueAlert({ issue }: { issue: CrawlResult['Issue'][0] }) {
  const severityColors = {
    error: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
    warning: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-800',
    info: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
  };
  const severityIcons = {
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  };
  return (
    <div className={`rounded-lg border p-3 mt-2 ${severityColors[issue.severity]}`}>
      <div className="flex items-start gap-2">
        <span className="text-lg">{severityIcons[issue.severity]}</span>
        <div className="flex-1">
          <div className="font-medium text-black dark:text-zinc-50 text-sm">
            {issue.message}
          </div>
          {issue.recommendation && (
            <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">
              {issue.recommendation}
            </p>
          )}
          {issue.details && Object.keys(issue.details).length > 0 && (
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              {Object.entries(issue.details).map(([key, value]) => (
                <span key={key} className="mr-2">
                  <span className="font-medium">{key}:</span> {String(value)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CrawlDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [crawlResult, setCrawlResult] = useState<CrawlResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [similarPages, setSimilarPages] = useState<Array<{
    id: string;
    url: string;
    title: string | null;
    similarityScore: number;
    crawledAt: string;
    statusCode: number;
    project: { id: string; name: string } | null;
  }>>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [backlinks, setBacklinks] = useState<Array<{
    id: string;
    sourcePageId: string;
    sourceUrl: string;
    sourceTitle: string | null;
    sourceStatusCode: number;
    anchorText: string | null;
    isDofollow: boolean;
    isSponsored: boolean;
    isUgc: boolean;
    discoveredAt: string;
    lastSeenAt: string;
    isActive: boolean;
    project: { id: string; name: string } | null;
  }>>([]);
  const [loadingBacklinks, setLoadingBacklinks] = useState(false);

  // Helper to get issues by type
  const getIssuesByType = (types: string[]) => {
    if (!crawlResult?.Issue) return [];
    return crawlResult.Issue.filter(issue => types.includes(issue.type));
  };

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const response = await fetch(`/api/crawl-results/${id}`);
        if (response.ok) {
          const data = await response.json();
          setCrawlResult(data);
          
          // Fetch similar pages
          setLoadingSimilar(true);
          try {
            const similarResponse = await fetch(`/api/crawl-results/${id}/similar`);
            if (similarResponse.ok) {
              const similarData = await similarResponse.json();
              setSimilarPages(similarData.similarPages || []);
            }
          } catch (error) {
            console.error('Error fetching similar pages:', error);
          } finally {
            setLoadingSimilar(false);
          }

          // Fetch backlinks
          setLoadingBacklinks(true);
          try {
            const backlinksResponse = await fetch(`/api/crawl-results/${id}/backlinks`);
            if (backlinksResponse.ok) {
              const backlinksData = await backlinksResponse.json();
              setBacklinks(backlinksData.backlinks || []);
            }
          } catch (error) {
            console.error('Error fetching backlinks:', error);
          } finally {
            setLoadingBacklinks(false);
          }
        } else {
          // Handle non-ok responses (404, 500, etc.)
          console.error('Error fetching crawl detail:', response.status, response.statusText);
          setLoading(false);
        }
      } catch (error) {
        console.error('Error fetching crawl detail:', error);
        setLoading(false);
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchDetail();
    }
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <TetrisLoading size="md" speed="normal" loadingText="Loading..." />
      </div>
    );
  }

  if (!crawlResult) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold">Crawl Result Not Found</h1>
          <Link
            href="/crawls"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Back to All Crawls
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="container mx-auto max-w-7xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-black dark:text-zinc-50">
              Crawl Details
            </h1>
          </div>
          <Link
            href="/crawls"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            ← Back to All Crawls
          </Link>
        </div>

        {/* Basic Info */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
            Basic Information
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                URL:
              </span>
              <p className="break-all text-black dark:text-zinc-50">
                {crawlResult.url}
              </p>
            </div>
            <div>
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Status Code:
              </span>
              <p className="text-black dark:text-zinc-50">
                {crawlResult.statusCode}
              </p>
            </div>
            <div>
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Response Time:
              </span>
              <p className="text-black dark:text-zinc-50">
                {crawlResult.responseTimeMs}ms
              </p>
            </div>
            <div>
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Crawled At:
              </span>
              <p className="text-black dark:text-zinc-50">
                {new Date(crawlResult.crawledAt).toLocaleString()}
              </p>
            </div>
            {crawlResult.language && (
              <div>
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Language:
                </span>
                <p className="text-black dark:text-zinc-50">
                  {crawlResult.language}
                </p>
              </div>
            )}
            {crawlResult.completenessScore !== null && (
              <div>
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Completeness Score:
                </span>
                <p className="text-black dark:text-zinc-50">
                  {(crawlResult.completenessScore * 100).toFixed(1)}%
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Title & Meta */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
            Title & Meta Tags
          </h2>
          <div className="space-y-3">
            <div>
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Title:
              </span>
              <p className="text-black dark:text-zinc-50">
                {crawlResult.title || 'Not found'}
              </p>
              {getIssuesByType(['missing_title', 'title_too_long', 'title_too_short']).map(issue => (
                <IssueAlert key={issue.id} issue={issue} />
              ))}
            </div>
            <div>
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Meta Description:
              </span>
              <p className="text-black dark:text-zinc-50">
                {crawlResult.metaDescription || 'Not found'}
              </p>
              {getIssuesByType(['missing_meta_description', 'meta_description_too_long', 'meta_description_too_short']).map(issue => (
                <IssueAlert key={issue.id} issue={issue} />
              ))}
            </div>
            {crawlResult.metaKeywords && (
              <div>
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Meta Keywords:
                </span>
                <p className="text-black dark:text-zinc-50">
                  {crawlResult.metaKeywords}
                </p>
              </div>
            )}
            {crawlResult.metaRobots && (
              <div>
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Meta Robots:
                </span>
                <p className="text-black dark:text-zinc-50">
                  {crawlResult.metaRobots}
                </p>
                {getIssuesByType(['noindex_meta_tag']).map(issue => (
                  <IssueAlert key={issue.id} issue={issue} />
                ))}
              </div>
            )}
            <div>
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Canonical URL:
              </span>
              <p className="break-all text-black dark:text-zinc-50">
                {crawlResult.canonicalUrl || 'Not found'}
              </p>
              {getIssuesByType(['missing_canonical']).map(issue => (
                <IssueAlert key={issue.id} issue={issue} />
              ))}
            </div>
          </div>
        </div>

        {/* Redirect Information */}
        {(crawlResult.redirectCount && crawlResult.redirectCount > 0) || getIssuesByType(['long_redirect_chain']).length > 0 ? (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Redirect Information
            </h2>
            {getIssuesByType(['long_redirect_chain']).map(issue => (
              <IssueAlert key={issue.id} issue={issue} />
            ))}
            {crawlResult.redirectCount && crawlResult.redirectCount > 0 && (
              <div className="space-y-3 mt-4">
              <div>
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Redirect Count:
                </span>
                <p className="text-black dark:text-zinc-50">
                  {crawlResult.redirectCount} redirect(s)
                </p>
              </div>
              {crawlResult.finalUrl && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Final URL:
                  </span>
                  <p className="break-all text-black dark:text-zinc-50">
                    {crawlResult.finalUrl}
                  </p>
                </div>
              )}
              {crawlResult.redirectChain && crawlResult.redirectChain.length > 0 && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Redirect Chain:
                  </span>
                  <div className="mt-2 space-y-1">
                    {crawlResult.redirectChain.map((url, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <span className="text-zinc-500 dark:text-zinc-400">{idx + 1}.</span>
                        <span className="break-all text-black dark:text-zinc-50">{url}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            )}
          </div>
        ) : null}

        {/* Content Metrics */}
        {(crawlResult.wordCount !== null || crawlResult.contentQualityScore !== null || crawlResult.contentDepthScore !== null) && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Content Metrics
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {crawlResult.wordCount !== null && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Word Count:
                  </span>
                  <p className="text-2xl font-bold text-black dark:text-zinc-50">
                    {crawlResult.wordCount.toLocaleString()}
                  </p>
                </div>
              )}
              {crawlResult.contentQualityScore !== null && (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                      Content Quality Score:
                    </span>
                    <div className="group relative">
                      <span className="cursor-help text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">ℹ️</span>
                      <div className="absolute left-0 top-6 z-10 hidden w-80 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg group-hover:block dark:border-zinc-700 dark:bg-zinc-800">
                        <p className="font-semibold text-black dark:text-zinc-50 mb-2">Content Quality Score</p>
                        <p className="text-zinc-600 dark:text-zinc-400 mb-2">
                          Measures SEO best practices and optimization:
                        </p>
                        <ul className="list-disc list-inside space-y-1 text-zinc-600 dark:text-zinc-400">
                          <li>Title (optimal 50-60 chars): 15%</li>
                          <li>Meta description (120-160 chars): 15%</li>
                          <li>Single H1 heading: 15%</li>
                          <li>Word count (300+ words): 15%</li>
                          <li>Images with alt text: 10%</li>
                          <li>Canonical URL: 10%</li>
                          <li>Structured data: 10%</li>
                          <li>Internal links (5+ links): 5%</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-black dark:text-zinc-50">
                    {(crawlResult.contentQualityScore * 100).toFixed(1)}%
                  </p>
                </div>
              )}
              {crawlResult.contentDepthScore !== null && (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                      Content Depth Score:
                    </span>
                    <div className="group relative">
                      <span className="cursor-help text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">ℹ️</span>
                      <div className="absolute left-0 top-6 z-10 hidden w-80 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg group-hover:block dark:border-zinc-700 dark:bg-zinc-800">
                        <p className="font-semibold text-black dark:text-zinc-50 mb-2">Content Depth Score</p>
                        <p className="text-zinc-600 dark:text-zinc-400 mb-2">
                          Measures how comprehensive and in-depth the content is:
                        </p>
                        <ul className="list-disc list-inside space-y-1 text-zinc-600 dark:text-zinc-400">
                          <li>Word count (2000+ words = excellent): 25%</li>
                          <li>Headings structure (10+ headings = excellent): 25%</li>
                          <li>Internal links (20+ links = excellent): 25%</li>
                          <li>Images (10+ images = excellent): 25%</li>
                        </ul>
                        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                          Higher scores indicate more comprehensive, well-structured content that provides detailed information on the topic.
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-black dark:text-zinc-50">
                    {(crawlResult.contentDepthScore * 100).toFixed(1)}%
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Performance Metrics */}
        {crawlResult.performanceMetrics && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Performance Metrics
            </h2>
            {getIssuesByType(['slow_response_time']).map(issue => (
              <IssueAlert key={issue.id} issue={issue} />
            ))}
            <div className="grid gap-4 md:grid-cols-2 mt-4">
              {crawlResult.performanceMetrics.firstContentfulPaint !== null && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    First Contentful Paint:
                  </span>
                  <p className="text-black dark:text-zinc-50">
                    {crawlResult.performanceMetrics.firstContentfulPaint}ms
                  </p>
                </div>
              )}
              {crawlResult.performanceMetrics.largestContentfulPaint !== null && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Largest Contentful Paint:
                  </span>
                  <p className="text-black dark:text-zinc-50">
                    {crawlResult.performanceMetrics.largestContentfulPaint}ms
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mobile Metrics */}
        {crawlResult.mobileMetrics && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Mobile Metrics
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Has Viewport Meta:
                </span>
                <p className="text-black dark:text-zinc-50">
                  {crawlResult.mobileMetrics.hasViewportMeta ? 'Yes' : 'No'}
                </p>
              </div>
              {crawlResult.mobileMetrics.isMobileFriendly !== null && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Mobile Friendly:
                  </span>
                  <p className="text-black dark:text-zinc-50">
                    {crawlResult.mobileMetrics.isMobileFriendly ? (
                      <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-800 dark:bg-green-900 dark:text-green-200">
                        Yes
                      </span>
                    ) : (
                      <span className="rounded bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-900 dark:text-red-200">
                        No
                      </span>
                    )}
                  </p>
                </div>
              )}
              {crawlResult.mobileMetrics.viewportContent && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Viewport Content:
                  </span>
                  <p className="text-black dark:text-zinc-50">
                    {crawlResult.mobileMetrics.viewportContent}
                  </p>
                </div>
              )}
              {crawlResult.mobileMetrics.touchTargetSize && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    Touch Target Size:
                  </span>
                  <p className="text-black dark:text-zinc-50">
                    <span className={`rounded px-2 py-1 text-xs ${
                      crawlResult.mobileMetrics.touchTargetSize === 'good' 
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : crawlResult.mobileMetrics.touchTargetSize === 'needs-improvement'
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                    }`}>
                      {crawlResult.mobileMetrics.touchTargetSize}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Structured Data & AI SEO Metrics */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
            Structured Data & Schema Types
          </h2>
          
          {/* Issues for missing structured data */}
          {getIssuesByType(['missing_structured_data']).map(issue => (
            <IssueAlert key={issue.id} issue={issue} />
          ))}

          {/* Extract and display schema types */}
          {(() => {
            const structuredData = crawlResult.structuredData || [];
            const schemaTypes = new Set<string>();
            structuredData.forEach((sd: any) => {
              if (sd.schemaType) {
                const types = sd.schemaType.split(',').map((t: string) => t.trim());
                types.forEach((type: string) => schemaTypes.add(type));
              }
            });
            
            // Important schema types to check for
            const importantSchemaTypes = [
              'Organization', 'Review', 'BreadcrumbList', 'FAQPage', 'HowTo', 
              'Article', 'Person', 'Product', 'LocalBusiness', 'VideoObject', 
              'Event', 'Recipe', 'WebPage', 'WebSite'
            ];
            
            const foundTypes = Array.from(schemaTypes);
            const missingTypes = importantSchemaTypes.filter(type => 
              !foundTypes.some(found => found.toLowerCase().includes(type.toLowerCase()) || type.toLowerCase().includes(found.toLowerCase()))
            );
            
            return (
              <div className="space-y-4">
                {/* Schema types found */}
                {foundTypes.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                      Schema Types Found ({foundTypes.length}):
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {foundTypes.map((type) => (
                        <span
                          key={type}
                          className="rounded bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300"
                        >
                          {type}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No structured data found</p>
                )}
                
                {/* Missing important schema types */}
                {missingTypes.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                      Recommended Schema Types (Not Found):
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {missingTypes.map((type) => (
                        <span
                          key={type}
                          className="rounded bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        >
                          {type}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Detailed structured data */}
                {structuredData.length > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-3 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                      Structured Data Details ({structuredData.length}):
                    </h3>
                    <div className="space-y-3">
                      {structuredData.map((sd: any, idx: number) => (
                        <div key={idx} className="rounded border border-zinc-200 p-3 dark:border-zinc-700">
                          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                            <span>Format: {sd.type || 'Unknown'}</span>
                            {sd.schemaType && sd.schemaType !== 'Unknown' && (
                              <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                {sd.schemaType}
                              </span>
                            )}
                          </div>
                          <pre className="max-h-48 overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-800">
                            {JSON.stringify(sd.data, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          
          {/* AI SEO Metrics */}
          {crawlResult.performanceMetrics?.aiSeoScore !== null && crawlResult.performanceMetrics?.aiSeoScore !== undefined && (
            <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <h3 className="mb-3 text-lg font-semibold text-black dark:text-zinc-50">
                AI SEO Effectiveness
              </h3>
              <div className="flex items-center gap-3">
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    AI SEO Score:
                  </span>
                  <p className="text-2xl font-bold text-black dark:text-zinc-50">
                    {(crawlResult.performanceMetrics.aiSeoScore * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="group relative">
                  <span className="cursor-help text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">ℹ️</span>
                  <div className="absolute left-0 top-6 z-10 hidden w-80 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg group-hover:block dark:border-zinc-700 dark:bg-zinc-800">
                    <p className="font-semibold text-black dark:text-zinc-50 mb-2">AI SEO Score</p>
                    <p className="text-zinc-600 dark:text-zinc-400 mb-2">
                      Measures how well the page is optimized for AI-powered search engines:
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-zinc-600 dark:text-zinc-400">
                      <li>FAQ Schema: 30%</li>
                      <li>HowTo Schema: 25%</li>
                      <li>Article Schema: 15%</li>
                      <li>Question headings (3+): 15%</li>
                      <li>Word count (500+): 10%</li>
                      <li>Structured data: 5%</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* HTTP Headers */}
        {crawlResult.httpHeaders && Object.keys(crawlResult.httpHeaders).length > 0 && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              HTTP Headers
            </h2>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {Object.entries(crawlResult.httpHeaders).map(([key, value]) => (
                <div key={key} className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    {key}:
                  </span>
                  <span className="ml-2 break-all text-sm text-black dark:text-zinc-50">
                    {String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Headings */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
            Headings ({crawlResult.Heading?.length || 0})
          </h2>
          {getIssuesByType(['missing_h1_tag', 'multiple_h1_tags', 'heading_too_long']).map(issue => (
            <IssueAlert key={issue.id} issue={issue} />
          ))}
          {crawlResult.Heading && crawlResult.Heading.length > 0 ? (
            <div className="space-y-2 mt-4">
              {crawlResult.Heading.map((heading) => (
                <div
                  key={heading.id}
                  className="rounded border border-zinc-200 p-2 dark:border-zinc-700"
                >
                  <span className="mr-2 rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    H{heading.level}
                  </span>
                  <span className="text-black dark:text-zinc-50">
                    {heading.text}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-2">No headings found</p>
          )}
        </div>

        {/* Images */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
            Images ({crawlResult.Image?.length || 0})
          </h2>
          {getIssuesByType(['missing_alt_text']).map(issue => (
            <IssueAlert key={issue.id} issue={issue} />
          ))}
          {crawlResult.Image && crawlResult.Image.length > 0 ? (
            <div className="space-y-2 mt-4">
              {crawlResult.Image.map((image) => (
                <div
                  key={image.id}
                  className="rounded border border-zinc-200 p-3 dark:border-zinc-700"
                >
                  <div className="mb-1 break-all text-sm text-black dark:text-zinc-50">
                    {image.src}
                  </div>
                  {image.alt && (
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      Alt: {image.alt}
                    </div>
                  )}
                  {image.title && (
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      Title: {image.title}
                    </div>
                  )}
                  {(image.width || image.height) && (
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      Dimensions: {image.width || '?'} × {image.height || '?'} px
                    </div>
                  )}
                  {!image.alt && (
                    <span className="mt-1 inline-block rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                      Missing alt text
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-2">No images found</p>
          )}
        </div>

        {/* Links */}
        {crawlResult.Link && crawlResult.Link.length > 0 && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Links ({crawlResult.Link.length})
            </h2>
            <div className="mb-4 flex gap-4 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Internal: {crawlResult.internalLinksCount}
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">
                External: {crawlResult.externalLinksCount}
              </span>
            </div>
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {crawlResult.Link.map((link) => (
                <div
                  key={link.id}
                  className="rounded border border-zinc-200 p-2 dark:border-zinc-700"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {link.href}
                    </a>
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        link.isExternal
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                          : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      }`}
                    >
                      {link.isExternal ? 'External' : 'Internal'}
                    </span>
                    {link.rel && (
                      <span className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {link.rel}
                      </span>
                    )}
                  </div>
                  {link.text && (
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      Text: {link.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Similar Pages */}
        {similarPages.length > 0 && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Similar Pages ({similarPages.length})
            </h2>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Pages with {similarPages[0]?.similarityScore === 1.0 ? 'identical' : 'similar'} content ({(similarPages[0]?.similarityScore || 0) * 100}% similarity):
            </p>
            <div className="space-y-2">
              {similarPages.map((page) => (
                <Link
                  key={page.id}
                  href={`/crawls/${page.id}`}
                  className="block rounded-lg border border-zinc-200 p-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 truncate font-medium text-black dark:text-zinc-50">
                        {page.title || page.url}
                      </div>
                      <div className="mb-1 truncate text-sm text-zinc-600 dark:text-zinc-400">
                        {page.url}
                      </div>
                      <div className="flex gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>{(page.similarityScore * 100).toFixed(0)}% similar</span>
                        {page.project && (
                          <span>• {page.project.name}</span>
                        )}
                        <span>• {new Date(page.crawledAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Backlinks */}
        <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
            Backlinks ({loadingBacklinks ? '...' : backlinks.length})
          </h2>
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            Pages that link to this page (from any project/domain):
          </p>
          {loadingBacklinks ? (
            <div className="text-center py-4 text-zinc-500 dark:text-zinc-400">Loading backlinks...</div>
          ) : backlinks.length === 0 ? (
            <div className="text-center py-4 text-zinc-500 dark:text-zinc-400">No backlinks found</div>
          ) : (
            <div className="space-y-2">
              {backlinks.map((backlink) => (
                <Link
                  key={backlink.id}
                  href={`/crawls/${backlink.sourcePageId}`}
                  className="block rounded-lg border border-zinc-200 p-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 truncate font-medium text-black dark:text-zinc-50">
                        {backlink.sourceTitle || backlink.sourceUrl}
                      </div>
                      <div className="mb-1 truncate text-sm text-zinc-600 dark:text-zinc-400">
                        {backlink.sourceUrl}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                        {backlink.anchorText && (
                          <span className="font-medium">"{backlink.anchorText}"</span>
                        )}
                        {backlink.isDofollow ? (
                          <span className="text-green-600 dark:text-green-400">✓ DoFollow</span>
                        ) : (
                          <span className="text-orange-600 dark:text-orange-400">✗ NoFollow</span>
                        )}
                        {backlink.isSponsored && (
                          <span className="text-blue-600 dark:text-blue-400">Sponsored</span>
                        )}
                        {backlink.isUgc && (
                          <span className="text-purple-600 dark:text-purple-400">UGC</span>
                        )}
                        {backlink.project && (
                          <span>• {backlink.project.name}</span>
                        )}
                        <span>• {new Date(backlink.discoveredAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Open Graph Tags */}
        {crawlResult.OgTag && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Open Graph Tags
            </h2>
            <div className="space-y-3">
              {crawlResult.OgTag.title && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    OG Title:
                  </span>
                  <p className="text-black dark:text-zinc-50">
                    {crawlResult.OgTag.title}
                  </p>
                </div>
              )}
              {crawlResult.OgTag.description && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    OG Description:
                  </span>
                  <p className="text-black dark:text-zinc-50">
                    {crawlResult.OgTag.description}
                  </p>
                </div>
              )}
              {crawlResult.OgTag.image && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    OG Image:
                  </span>
                  <p className="break-all text-black dark:text-zinc-50">
                    {crawlResult.OgTag.image}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

