'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import TetrisLoading from '@/components/ui/tetris-loader';

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
  Audit: {
    Project: {
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
  const [deduplicating, setDeduplicating] = useState(false);
  const [deduplicationLogs, setDeduplicationLogs] = useState<string[]>([]);
  const [showDeduplicationModal, setShowDeduplicationModal] = useState(false);

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

  const handleDeduplicateContentHash = async () => {
    setDeduplicating(true);
    setDeduplicationLogs([]);
    setShowDeduplicationModal(true);

    try {
      const response = await fetch('/api/crawl-results/deduplicate-content-hash', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        setDeduplicationLogs(data.logs || []);
        // Refresh the crawl results after deduplication
        await fetchCrawls();
      } else {
        setDeduplicationLogs([`Error: ${data.error}`, ...(data.logs || [])]);
      }
    } catch (error) {
      setDeduplicationLogs([`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    } finally {
      setDeduplicating(false);
    }
  };

  if (loading && crawlResults.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <TetrisLoading size="md" speed="normal" loadingText="Loading..." />
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
          <div className="flex gap-3">
            <button
              onClick={handleDeduplicateContentHash}
              disabled={deduplicating}
              className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/30"
            >
              {deduplicating ? 'Deduplicating...' : 'Remove Duplicates (Content Hash)'}
            </button>
            <Link
              href="/"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              ← Back to Dashboard
            </Link>
          </div>
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
                      {result.Audit?.Project?.name || 'Unknown Project'}
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

        {/* Deduplication Modal */}
        {showDeduplicationModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-4xl max-h-[80vh] rounded-lg bg-white shadow-xl dark:bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-700">
                <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
                  Content Hash Deduplication
                </h2>
                <button
                  onClick={() => setShowDeduplicationModal(false)}
                  className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(80vh - 80px)' }}>
                {deduplicationLogs.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="text-center">
                      <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
                      <p className="text-zinc-600 dark:text-zinc-400">Processing...</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 font-mono text-sm">
                    {deduplicationLogs.map((log, index) => (
                      <div
                        key={index}
                        className="rounded px-2 py-1 text-zinc-800 dark:text-zinc-200"
                      >
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {!deduplicating && deduplicationLogs.length > 0 && (
                <div className="border-t border-zinc-200 p-4 dark:border-zinc-700">
                  <button
                    onClick={() => setShowDeduplicationModal(false)}
                    className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

