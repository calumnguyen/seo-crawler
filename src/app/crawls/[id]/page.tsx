'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

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
  canonicalUrl: string | null;
  language: string | null;
  responseTimeMs: number;
  contentLength: number | null;
  crawledAt: string;
  lastModified: string | null;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  imagesCount: number;
  imagesWithAltCount: number;
  internalLinksCount: number;
  externalLinksCount: number;
  completenessScore: number | null;
  headings: Heading[];
  images: Image[];
  links: Link[];
  ogTags: OgTag | null;
  audit: {
    project: {
      id: string;
      name: string;
      domain: string;
    };
  };
}

export default function CrawlDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [crawlResult, setCrawlResult] = useState<CrawlResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const response = await fetch(`/api/crawl-results/${id}`);
        if (response.ok) {
          const data = await response.json();
          setCrawlResult(data);
        }
      } catch (error) {
        console.error('Error fetching crawl detail:', error);
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
        <div className="text-xl">Loading crawl details...</div>
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
            </div>
            <div>
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Meta Description:
              </span>
              <p className="text-black dark:text-zinc-50">
                {crawlResult.metaDescription || 'Not found'}
              </p>
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
            {crawlResult.canonicalUrl && (
              <div>
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Canonical URL:
                </span>
                <p className="break-all text-black dark:text-zinc-50">
                  {crawlResult.canonicalUrl}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Headings */}
        {crawlResult.headings.length > 0 && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Headings ({crawlResult.headings.length})
            </h2>
            <div className="space-y-2">
              {crawlResult.headings.map((heading) => (
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
          </div>
        )}

        {/* Images */}
        {crawlResult.images.length > 0 && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Images ({crawlResult.images.length})
            </h2>
            <div className="space-y-2">
              {crawlResult.images.map((image) => (
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
                  {!image.alt && (
                    <span className="mt-1 inline-block rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                      Missing alt text
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Links */}
        {crawlResult.links.length > 0 && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Links ({crawlResult.links.length})
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
              {crawlResult.links.map((link) => (
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

        {/* Open Graph Tags */}
        {crawlResult.ogTags && (
          <div className="mb-6 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
              Open Graph Tags
            </h2>
            <div className="space-y-3">
              {crawlResult.ogTags.title && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    OG Title:
                  </span>
                  <p className="text-black dark:text-zinc-50">
                    {crawlResult.ogTags.title}
                  </p>
                </div>
              )}
              {crawlResult.ogTags.description && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    OG Description:
                  </span>
                  <p className="text-black dark:text-zinc-50">
                    {crawlResult.ogTags.description}
                  </p>
                </div>
              )}
              {crawlResult.ogTags.image && (
                <div>
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    OG Image:
                  </span>
                  <p className="break-all text-black dark:text-zinc-50">
                    {crawlResult.ogTags.image}
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

