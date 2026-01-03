'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface CrawlResult {
  id: string;
  url: string;
  statusCode: number;
  title: string | null;
  metaDescription: string | null;
  crawledAt: string;
  h1Count: number;
  h2Count: number;
  imagesCount: number;
  internalLinksCount: number;
  externalLinksCount: number;
  audit: {
    project: {
      id: string;
      name: string;
      domain: string;
    };
  };
}

export default function CrawlsPage() {
  const [crawlResults, setCrawlResults] = useState<CrawlResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const limit = 50;

  const fetchCrawls = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/crawl-results?limit=${limit}&offset=${page * limit}`
      );
      const data = await response.json();
      setCrawlResults(data.crawlResults || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Error fetching crawls:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCrawls();
  }, [page]);

  if (loading && crawlResults.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl">Loading crawled data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-4xl font-bold text-black dark:text-zinc-50">
              All Crawled Pages
            </h1>
            <p className="text-lg text-zinc-600 dark:text-zinc-400">
              {total} pages crawled
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg bg-black px-4 py-2 text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
          >
            Back to Dashboard
          </Link>
        </div>

        {crawlResults.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center dark:bg-zinc-900">
            <p className="text-zinc-500 dark:text-zinc-400">
              No pages crawled yet. Start a crawl from the dashboard.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {crawlResults.map((result) => (
                <Link
                  key={result.id}
                  href={`/crawls/${result.id}`}
                  className="block rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="mb-1 font-semibold text-black dark:text-zinc-50">
                        {result.title || result.url}
                      </h3>
                      <p className="mb-2 truncate text-sm text-zinc-600 dark:text-zinc-400">
                        {result.url}
                      </p>
                      {result.metaDescription && (
                        <p className="mb-2 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
                          {result.metaDescription}
                        </p>
                      )}
                      <div className="flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>Status: {result.statusCode}</span>
                        <span>{result.h1Count} H1</span>
                        <span>{result.h2Count} H2</span>
                        <span>{result.imagesCount} images</span>
                        <span>
                          {result.internalLinksCount + result.externalLinksCount}{' '}
                          links
                        </span>
                        <span>
                          {new Date(result.crawledAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="ml-4 text-sm text-zinc-500 dark:text-zinc-400">
                      {result.audit.project.name}
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Pagination */}
            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-zinc-300 px-4 py-2 disabled:opacity-50 dark:border-zinc-700"
              >
                Previous
              </button>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                Page {page + 1} of {Math.ceil(total / limit)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * limit >= total}
                className="rounded-lg border border-zinc-300 px-4 py-2 disabled:opacity-50 dark:border-zinc-700"
              >
                Next
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

