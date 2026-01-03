'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Audit {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  pagesCrawled: number;
  pagesTotal: number;
  overallScore: number | null;
  technicalScore: number | null;
  contentScore: number | null;
  performanceScore: number | null;
  project: {
    id: string;
    name: string;
    baseUrl: string;
  };
}

interface CrawlResult {
  id: string;
  url: string;
  statusCode: number;
  title: string | null;
  crawledAt: string;
  responseTimeMs: number;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  imagesCount: number;
  internalLinksCount: number;
  externalLinksCount: number;
}

export default function AuditDetailPage() {
  const params = useParams();
  const auditId = params.auditId as string;
  
  const [audit, setAudit] = useState<Audit | null>(null);
  const [crawlResults, setCrawlResults] = useState<CrawlResult[]>([]);
  const [crawlResultsPagination, setCrawlResultsPagination] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);
  const [crawlResultsPage, setCrawlResultsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [actionLoading, setActionLoading] = useState<'pause' | 'resume' | 'stop' | null>(null);
  const [queueStatus, setQueueStatus] = useState<{
    waiting: number;
    active: number;
    delayed: number;
    total: number;
  } | null>(null);
  const [logs, setLogs] = useState<{
    setup: any[];
    filtering: any[];
    queued: any[];
    crawled: any[];
    skipped: any[];
  }>({
    setup: [],
    filtering: [],
    queued: [],
    crawled: [],
    skipped: [],
  });
  // Search state for each log box
  const [logSearch, setLogSearch] = useState<{
    setup: string;
    filtering: string;
    queued: string;
    crawled: string;
    skipped: string;
  }>({
    setup: '',
    filtering: '',
    queued: '',
    crawled: '',
    skipped: '',
  });
  // Search match indices and current match for each log box
  const [logSearchMatches, setLogSearchMatches] = useState<{
    setup: { indices: number[]; current: number };
    filtering: { indices: number[]; current: number };
    queued: { indices: number[]; current: number };
    crawled: { indices: number[]; current: number };
    skipped: { indices: number[]; current: number };
  }>({
    setup: { indices: [], current: -1 },
    filtering: { indices: [], current: -1 },
    queued: { indices: [], current: -1 },
    crawled: { indices: [], current: -1 },
    skipped: { indices: [], current: -1 },
  });
  // Track if user has scrolled up (for smart auto-scroll)
  const [isAtBottom, setIsAtBottom] = useState<{
    setup: boolean;
    filtering: boolean;
    queued: boolean;
    crawled: boolean;
    skipped: boolean;
  }>({
    setup: true,
    filtering: true,
    queued: true,
    crawled: true,
    skipped: true,
  });
  const logRefs = {
    setup: useRef<HTMLDivElement>(null),
    filtering: useRef<HTMLDivElement>(null),
    queued: useRef<HTMLDivElement>(null),
    crawled: useRef<HTMLDivElement>(null),
    skipped: useRef<HTMLDivElement>(null),
  };

  useEffect(() => {
    fetchAuditData();
    fetchLogs();
    // Trigger check-completion to update pagesTotal immediately
    if (auditId) {
      fetch('/api/audits/check-completion', { method: 'POST' }).catch(() => {});
    }
    const interval = setInterval(fetchAuditData, 5000);
    const logsInterval = setInterval(fetchLogs, 2000); // Fetch logs more frequently
    // Also trigger check-completion periodically to keep pagesTotal updated
    const completionInterval = setInterval(() => {
      fetch('/api/audits/check-completion', { method: 'POST' }).catch(() => {});
    }, 10000); // Every 10 seconds
    return () => {
      clearInterval(interval);
      clearInterval(logsInterval);
      clearInterval(completionInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);
  
  useEffect(() => {
    fetchAuditData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crawlResultsPage]);
  
  // Check scroll position on mount and when logs update
  useEffect(() => {
    const categories: Array<'setup' | 'filtering' | 'queued' | 'crawled' | 'skipped'> = ['setup', 'filtering', 'queued', 'crawled', 'skipped'];
    categories.forEach(category => {
      checkScrollPosition(category);
    });
  }, [logs]);
  
  // Debounced search effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      // Update search matches when search text changes
      const categories: Array<'setup' | 'filtering' | 'queued' | 'crawled' | 'skipped'> = ['setup', 'filtering', 'queued', 'crawled', 'skipped'];
      categories.forEach(category => {
        const searchText = logSearch[category].toLowerCase();
        if (searchText) {
          const indices: number[] = [];
          logs[category].forEach((log, index) => {
            if (log.message.toLowerCase().includes(searchText)) {
              indices.push(index);
            }
          });
          setLogSearchMatches(prev => ({
            ...prev,
            [category]: { indices, current: indices.length > 0 ? 0 : -1 },
          }));
        } else {
          setLogSearchMatches(prev => ({
            ...prev,
            [category]: { indices: [], current: -1 },
          }));
        }
      });
    }, 300); // 300ms debounce
    
    return () => clearTimeout(timeoutId);
  }, [logSearch, logs]);
  
  // Check if scroll is at bottom for smart auto-scroll
  const checkScrollPosition = (category: 'setup' | 'filtering' | 'queued' | 'crawled' | 'skipped') => {
    const ref = logRefs[category].current;
    if (!ref) return;
    const { scrollTop, scrollHeight, clientHeight } = ref;
    const isBottom = scrollHeight - scrollTop - clientHeight < 10; // 10px threshold
    setIsAtBottom(prev => ({ ...prev, [category]: isBottom }));
  };
  
  // Navigate search matches
  const navigateSearch = (category: 'setup' | 'filtering' | 'queued' | 'crawled' | 'skipped', direction: 'up' | 'down') => {
    const matches = logSearchMatches[category];
    if (matches.indices.length === 0) return;
    
    let newCurrent = matches.current;
    if (direction === 'down') {
      newCurrent = (newCurrent + 1) % matches.indices.length;
    } else {
      newCurrent = (newCurrent - 1 + matches.indices.length) % matches.indices.length;
    }
    
    setLogSearchMatches(prev => ({
      ...prev,
      [category]: { ...prev[category], current: newCurrent },
    }));
    
    // Scroll to match
    const ref = logRefs[category].current;
    if (ref) {
      const matchIndex = matches.indices[newCurrent];
      const logElement = ref.children[matchIndex] as HTMLElement;
      if (logElement) {
        logElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };
  
  // Highlight text in log message
  const highlightText = (text: string, searchText: string) => {
    if (!searchText) return text;
    const parts = text.split(new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === searchText.toLowerCase() ? (
        <mark key={i} className="bg-yellow-300 dark:bg-yellow-600">{part}</mark>
      ) : part
    );
  };

  const fetchLogs = async () => {
    if (!auditId) return;
    
    try {
      // Fetch actual Redis queue status for this audit
      try {
        const diagnosticsRes = await fetch(`/api/audits/${auditId}/diagnostics`);
        if (diagnosticsRes.ok) {
          const diagnosticsData = await diagnosticsRes.json();
          if (diagnosticsData.queue?.forThisAudit) {
            setQueueStatus({
              waiting: diagnosticsData.queue.forThisAudit.waiting || 0,
              active: diagnosticsData.queue.forThisAudit.active || 0,
              delayed: diagnosticsData.queue.forThisAudit.delayed || 0,
              total: diagnosticsData.queue.forThisAudit.total || 0,
            });
          }
        }
      } catch (error) {
        console.error('Error fetching queue status:', error);
      }
      
      const [setupRes, filteringRes, queuedRes, crawledRes, skippedRes] = await Promise.all([
        fetch(`/api/audits/${auditId}/logs?category=setup`),
        fetch(`/api/audits/${auditId}/logs?category=filtering`),
        fetch(`/api/audits/${auditId}/logs?category=queued`),
        fetch(`/api/audits/${auditId}/logs?category=crawled`),
        fetch(`/api/audits/${auditId}/logs?category=skipped`),
      ]);

      if (setupRes.ok) {
        const data = await setupRes.json();
        const reversedLogs = (data.logs || []).reverse();
        // Check scroll position BEFORE updating logs to avoid stale state
        const ref = logRefs.setup.current;
        const wasAtBottom = ref ? (ref.scrollHeight - ref.scrollTop - ref.clientHeight < 10) : true;
        setLogs(prev => ({ ...prev, setup: reversedLogs }));
        // Smart auto-scroll: only if was at bottom before update
        setTimeout(() => {
          if (wasAtBottom && logRefs.setup.current) {
            logRefs.setup.current.scrollTo({ top: logRefs.setup.current.scrollHeight, behavior: 'smooth' });
            setIsAtBottom(prev => ({ ...prev, setup: true }));
          } else {
            setIsAtBottom(prev => ({ ...prev, setup: false }));
          }
        }, 100);
      } else {
        console.error('Failed to fetch setup logs:', setupRes.status, await setupRes.text());
      }

      if (filteringRes.ok) {
        const data = await filteringRes.json();
        const reversedLogs = (data.logs || []).reverse();
        // Check scroll position BEFORE updating logs to avoid stale state
        const ref = logRefs.filtering.current;
        const wasAtBottom = ref ? (ref.scrollHeight - ref.scrollTop - ref.clientHeight < 10) : true;
        setLogs(prev => ({ ...prev, filtering: reversedLogs }));
        // Smart auto-scroll: only if was at bottom before update
        setTimeout(() => {
          if (wasAtBottom && logRefs.filtering.current) {
            logRefs.filtering.current.scrollTo({ top: logRefs.filtering.current.scrollHeight, behavior: 'smooth' });
            setIsAtBottom(prev => ({ ...prev, filtering: true }));
          } else {
            setIsAtBottom(prev => ({ ...prev, filtering: false }));
          }
        }, 100);
      } else {
        const errorText = await filteringRes.text();
        console.error('Failed to fetch filtering logs:', filteringRes.status, errorText);
      }
      
      if (queuedRes.ok) {
        const data = await queuedRes.json();
        const reversedLogs = (data.logs || []).reverse();
        // Check scroll position BEFORE updating logs to avoid stale state
        const ref = logRefs.queued.current;
        const wasAtBottom = ref ? (ref.scrollHeight - ref.scrollTop - ref.clientHeight < 10) : true;
        setLogs(prev => ({ ...prev, queued: reversedLogs }));
        // Smart auto-scroll: only if was at bottom before update
        setTimeout(() => {
          if (wasAtBottom && logRefs.queued.current) {
            logRefs.queued.current.scrollTo({ top: logRefs.queued.current.scrollHeight, behavior: 'smooth' });
            setIsAtBottom(prev => ({ ...prev, queued: true }));
          } else {
            setIsAtBottom(prev => ({ ...prev, queued: false }));
          }
        }, 100);
      } else {
        console.error('Failed to fetch queued logs:', queuedRes.status, await queuedRes.text());
      }
      
      if (crawledRes.ok) {
        const data = await crawledRes.json();
        const reversedLogs = (data.logs || []).reverse();
        // Check scroll position BEFORE updating logs to avoid stale state
        const ref = logRefs.crawled.current;
        const wasAtBottom = ref ? (ref.scrollHeight - ref.scrollTop - ref.clientHeight < 10) : true;
        setLogs(prev => ({ ...prev, crawled: reversedLogs }));
        // Smart auto-scroll: only if was at bottom before update
        setTimeout(() => {
          if (wasAtBottom && logRefs.crawled.current) {
            logRefs.crawled.current.scrollTo({ top: logRefs.crawled.current.scrollHeight, behavior: 'smooth' });
            setIsAtBottom(prev => ({ ...prev, crawled: true }));
          } else {
            setIsAtBottom(prev => ({ ...prev, crawled: false }));
          }
        }, 100);
      } else {
        console.error('Failed to fetch crawled logs:', crawledRes.status, await crawledRes.text());
      }
      
      if (skippedRes.ok) {
        const data = await skippedRes.json();
        const reversedLogs = (data.logs || []).reverse();
        // Check scroll position BEFORE updating logs to avoid stale state
        const ref = logRefs.skipped.current;
        const wasAtBottom = ref ? (ref.scrollHeight - ref.scrollTop - ref.clientHeight < 10) : true;
        setLogs(prev => ({ ...prev, skipped: reversedLogs }));
        // Smart auto-scroll: only if was at bottom before update
        setTimeout(() => {
          if (wasAtBottom && logRefs.skipped.current) {
            logRefs.skipped.current.scrollTo({ top: logRefs.skipped.current.scrollHeight, behavior: 'smooth' });
            setIsAtBottom(prev => ({ ...prev, skipped: true }));
          } else {
            setIsAtBottom(prev => ({ ...prev, skipped: false }));
          }
        }, 100);
      } else {
        console.error('Failed to fetch skipped logs:', skippedRes.status, await skippedRes.text());
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
    }
  };

  const fetchAuditData = async () => {
    try {
      const [auditRes, pagesRes] = await Promise.all([
        fetch(`/api/audits/${auditId}`),
        fetch(`/api/audits/${auditId}/crawl-results?page=${crawlResultsPage}&limit=50`),
      ]);

      if (auditRes.ok) {
        const auditData = await auditRes.json();
        setAudit(auditData);
      }

      if (pagesRes.ok) {
        const pagesData = await pagesRes.json();
        if (pagesData.results && pagesData.pagination) {
          setCrawlResults(pagesData.results);
          setCrawlResultsPagination(pagesData.pagination);
        } else {
          // Fallback for old API format
          setCrawlResults(pagesData);
        }
      }
    } catch (error) {
      console.error('Error fetching audit data:', error);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchAuditData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crawlResultsPage]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl">Loading audit...</div>
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl">Audit not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="container mx-auto max-w-7xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link
              href={`/projects/${audit.project.id}`}
              className="mb-2 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              ← Back to Project
            </Link>
            <h1 className="mb-2 text-4xl font-bold text-black dark:text-zinc-50">
              Crawl Attempt Details
            </h1>
            <p className="text-lg text-zinc-600 dark:text-zinc-400">
              {audit.project.name} • {audit.project.baseUrl}
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Audit Info */}
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Status</div>
              <div className="mt-1">
                <span
                  className={`rounded-full px-3 py-1 text-sm font-medium ${
                    audit.status === 'completed'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : audit.status === 'in_progress'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                  }`}
                >
                  {audit.status}
                </span>
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Pages</div>
              <div className="mt-1 text-xl font-bold text-black dark:text-zinc-50">
                {(() => {
                  // Use actual crawled count from pagination (more accurate than stored counter)
                  const actualCrawled = crawlResultsPagination?.total || crawlResults.length || audit.pagesCrawled;
                  // Calculate pagesTotal: crawled + queued_in_redis (NOT historical queued logs)
                  // Use audit.pagesTotal if available, otherwise calculate from queueStatus
                  const calculatedTotal = queueStatus 
                    ? actualCrawled + queueStatus.total 
                    : audit.pagesTotal || 0;
                  const displayTotal = audit.pagesTotal > 0 ? audit.pagesTotal : calculatedTotal;
                  return `${actualCrawled} / ${displayTotal > 0 ? displayTotal : '?'}`;
                })()}
              </div>
              {audit.status === 'in_progress' && (
                <>
                  {(!logs.queued.length && (!audit.pagesTotal || audit.pagesTotal === 0)) && (
                    <div className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                      ⚠️ No URLs queued - check diagnostics
                    </div>
                  )}
                  {logs.queued.length > 0 && (crawlResultsPagination?.total || crawlResults.length || audit.pagesCrawled) === 0 && (
                    <div className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                      ⚠️ URLs discovered but not queued - jobs may have failed to queue
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Started</div>
              <div className="mt-1 text-sm text-black dark:text-zinc-50">
                {new Date(audit.startedAt).toLocaleString()}
              </div>
            </div>
            {audit.completedAt && (
              <div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Completed</div>
                <div className="mt-1 text-sm text-black dark:text-zinc-50">
                  {new Date(audit.completedAt).toLocaleString()}
                </div>
              </div>
            )}
          </div>

          {audit.status === 'in_progress' && (() => {
            // Use actual crawled count from pagination (more accurate than stored counter)
            const actualCrawled = crawlResultsPagination?.total || crawlResults.length || audit.pagesCrawled;
            // Calculate pagesTotal: crawled + queued_in_redis (NOT historical queued logs)
            const calculatedTotal = queueStatus 
              ? actualCrawled + queueStatus.total 
              : audit.pagesTotal || 0;
            const displayTotal = audit.pagesTotal > 0 ? audit.pagesTotal : calculatedTotal;
            return displayTotal > 0;
          })() && (
            <div className="mb-4">
              <div className="mb-1 flex justify-between text-sm text-zinc-600 dark:text-zinc-400">
                <span>Progress</span>
                <span>
                  {(() => {
                    // Use actual crawled count from pagination (more accurate than stored counter)
                    const actualCrawled = crawlResultsPagination?.total || crawlResults.length || audit.pagesCrawled;
                    const calculatedTotal = queueStatus 
                      ? actualCrawled + queueStatus.total 
                      : audit.pagesTotal || 1;
                    const displayTotal = audit.pagesTotal > 0 ? audit.pagesTotal : calculatedTotal;
                    return ((actualCrawled / displayTotal) * 100).toFixed(1);
                  })()}%
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{
                    width: `${(() => {
                      // Use actual crawled count from pagination (more accurate than stored counter)
                      const actualCrawled = crawlResultsPagination?.total || crawlResults.length || audit.pagesCrawled;
                      const calculatedTotal = queueStatus 
                        ? actualCrawled + queueStatus.total 
                        : audit.pagesTotal || 1;
                      const displayTotal = audit.pagesTotal > 0 ? audit.pagesTotal : calculatedTotal;
                      return (actualCrawled / displayTotal) * 100;
                    })()}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Control Buttons for In-Progress Crawls */}
          {(audit.status === 'in_progress' || audit.status === 'paused') && (
            <div className="mb-4 flex flex-wrap gap-3">
              {audit.status === 'in_progress' && (
                <button
                  onClick={async () => {
                    if (!confirm('Pause the crawl? It can be resumed later.')) return;
                    
                    setActionLoading('pause');
                    try {
                      const res = await fetch(`/api/audits/${auditId}/pause`, { method: 'POST' });
                      if (res.ok) {
                        await fetchAuditData(); // Refresh to get actual state
                      } else {
                        const error = await res.json();
                        alert(error.error || 'Failed to pause crawl');
                      }
                    } catch (error) {
                      console.error('Error pausing crawl:', error);
                      alert('Failed to pause crawl');
                    } finally {
                      setActionLoading(null);
                    }
                  }}
                  disabled={actionLoading !== null}
                  className="rounded-lg bg-yellow-600 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionLoading === 'pause' ? '⏳ Pausing...' : '⏸️ Pause'}
                </button>
              )}
              {audit.status === 'paused' && (
                <button
                  onClick={async () => {
                    setActionLoading('resume');
                    try {
                      const res = await fetch(`/api/audits/${auditId}/resume`, { method: 'POST' });
                      if (res.ok) {
                        await fetchAuditData(); // Refresh to get actual state
                      } else {
                        const error = await res.json();
                        alert(error.error || 'Failed to resume crawl');
                      }
                    } catch (error) {
                      console.error('Error resuming crawl:', error);
                      alert('Failed to resume crawl');
                    } finally {
                      setActionLoading(null);
                    }
                  }}
                  disabled={actionLoading !== null}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionLoading === 'resume' ? '⏳ Resuming...' : '▶️ Resume'}
                </button>
              )}
              <button
                onClick={async () => {
                  if (!confirm('Stop the crawl? All queued jobs will be removed and this crawl CANNOT be resumed. Use Pause if you want to resume later.')) return;
                  
                  setActionLoading('stop');
                  try {
                    const res = await fetch(`/api/audits/${auditId}/stop`, { method: 'POST' });
                    if (res.ok) {
                      await fetchAuditData(); // Refresh to get actual state
                    } else {
                      const error = await res.json();
                      alert(error.error || 'Failed to stop crawl');
                    }
                  } catch (error) {
                    console.error('Error stopping crawl:', error);
                    alert('Failed to stop crawl');
                  } finally {
                    setActionLoading(null);
                  }
                }}
                disabled={actionLoading !== null}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading === 'stop' ? '⏳ Stopping...' : '⏹️ Stop'}
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/audits/${auditId}/diagnostics`);
                    const data = await res.json();
                    setDiagnostics(data);
                    setShowDiagnostics(!showDiagnostics);
                  } catch (error) {
                    console.error('Error fetching diagnostics:', error);
                  }
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                {showDiagnostics ? 'Hide' : 'Show'} Diagnostics
              </button>
            </div>
          )}

          {/* Approval Required Message */}
          {audit.status === 'pending_approval' && (
            <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 p-4 dark:border-yellow-700 dark:bg-yellow-900/20">
              <div className="mb-2 font-semibold text-yellow-800 dark:text-yellow-200">
                ⚠️ Approval Required
              </div>
              <div className="mb-3 text-sm text-yellow-700 dark:text-yellow-300">
                robots.txt was not found for this domain. Please review and approve the crawl before proceeding.
              </div>
              <button
                onClick={async () => {
                  if (!confirm('Approve crawl without robots.txt? This will start crawling immediately.')) return;
                  try {
                    const res = await fetch(`/api/audits/${auditId}/approve`, { method: 'POST' });
                    if (res.ok) {
                      fetchAuditData();
                    } else {
                      const error = await res.json();
                      alert(error.error || 'Failed to approve crawl');
                    }
                  } catch (error) {
                    console.error('Error approving crawl:', error);
                    alert('Failed to approve crawl');
                  }
                }}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                ✅ Approve & Start Crawl
              </button>
            </div>
          )}

          {/* Warning if no jobs queued but queued logs > 0 AND no pages crawled yet */}
          {/* Only show warning if: queued logs > 0, queue is empty, AND no pages have been crawled yet */}
          {/* If pages have been crawled, jobs were clearly queued (they just completed) */}
          {audit.status === 'in_progress' && 
           logs.queued.length > 0 && 
           (crawlResultsPagination?.total || crawlResults.length || audit.pagesCrawled) === 0 &&
           diagnostics && 
           diagnostics.queue?.forThisAudit?.total === 0 && (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-900/20">
              <div className="mb-2 font-semibold text-red-800 dark:text-red-200">
                ⚠️ No Jobs Queued
              </div>
              <div className="mb-3 text-sm text-red-700 dark:text-red-300">
                {logs.queued.length} pages were discovered but no jobs were queued. This usually means:
                <ul className="mt-2 list-disc pl-5">
                  <li>robots.txt check failed and required approval</li>
                  <li>Sitemap parsing failed silently</li>
                  <li>Background queuing encountered an error</li>
                </ul>
              </div>
              <button
                onClick={async () => {
                  if (!confirm('Re-queue URLs? This will attempt to queue all discovered URLs again.')) return;
                  try {
                    const res = await fetch(`/api/audits/${auditId}/start-auto`, { method: 'POST' });
                    if (res.ok) {
                      alert('Re-queuing started. Check diagnostics in a few seconds.');
                      fetchAuditData();
                    } else {
                      const error = await res.json();
                      alert(error.error || 'Failed to re-queue URLs');
                    }
                  } catch (error) {
                    console.error('Error re-queuing:', error);
                    alert('Failed to re-queue URLs');
                  }
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                🔄 Re-queue URLs
              </button>
            </div>
          )}

          {audit.status === 'in_progress' && showDiagnostics && diagnostics && (
            <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              <div className="mb-2 font-semibold">Queue Status:</div>
              <div className="space-y-1">
                <div>Queue Ready: {diagnostics.queue?.ready ? '✅' : '❌'}</div>
                <div>Waiting Jobs: {diagnostics.queue?.global?.waiting || 0}</div>
                <div>Active Jobs: {diagnostics.queue?.global?.active || 0}</div>
                <div>Jobs for this Audit: {diagnostics.queue?.forThisAudit?.total || 0}</div>
              </div>
              <div className="mt-4 mb-2 font-semibold">Diagnostics:</div>
              <div className="space-y-1">
                <div>Has pagesTotal: {diagnostics.diagnostics?.hasPagesTotal ? '✅' : '❌'}</div>
                <div>Has crawl results: {diagnostics.diagnostics?.hasCrawlResults ? '✅' : '❌'}</div>
                <div>Has jobs in queue: {diagnostics.diagnostics?.hasJobsInQueue ? '✅' : '❌'}</div>
                <div>Queue processor running: {diagnostics.diagnostics?.queueProcessorRunning ? '✅' : '❌'}</div>
              </div>
            </div>
          )}

          {(audit.overallScore !== null || audit.technicalScore !== null) && (
            <div className="grid gap-4 md:grid-cols-4">
              {audit.overallScore !== null && (
                <div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Overall Score</div>
                  <div className="mt-1 text-2xl font-bold text-black dark:text-zinc-50">
                    {audit.overallScore.toFixed(1)}
                  </div>
                </div>
              )}
              {audit.technicalScore !== null && (
                <div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Technical</div>
                  <div className="mt-1 text-2xl font-bold text-black dark:text-zinc-50">
                    {audit.technicalScore.toFixed(1)}
                  </div>
                </div>
              )}
              {audit.contentScore !== null && (
                <div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Content</div>
                  <div className="mt-1 text-2xl font-bold text-black dark:text-zinc-50">
                    {audit.contentScore.toFixed(1)}
                  </div>
                </div>
              )}
              {audit.performanceScore !== null && (
                <div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Performance</div>
                  <div className="mt-1 text-2xl font-bold text-black dark:text-zinc-50">
                    {audit.performanceScore.toFixed(1)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Real-time Logs */}
        {(audit.status === 'pending' || audit.status === 'pending_approval' || audit.status === 'in_progress' || audit.status === 'paused' || audit.status === 'completed') && (
          <div className="mb-6">
            <h2 className="mb-4 text-2xl font-semibold text-black dark:text-zinc-50">
              Real-time Logs
            </h2>
            
            {/* Setup Logs - Sitemap and Robots.txt */}
            <div className="mb-4">
              <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 bg-indigo-50 px-4 py-2 dark:border-zinc-700 dark:bg-indigo-900/20">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-indigo-800 dark:text-indigo-200">
                      ⚙️ Setup ({logs.setup.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search..."
                        value={logSearch.setup}
                        onChange={(e) => {
                          setLogSearch(prev => ({ ...prev, setup: e.target.value }));
                          setIsAtBottom(prev => ({ ...prev, setup: false }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.shiftKey) {
                            navigateSearch('setup', 'up');
                          } else if (e.key === 'Enter') {
                            navigateSearch('setup', 'down');
                          }
                        }}
                        className="w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                      />
                      {logSearchMatches.setup.indices.length > 0 && (
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
                          {logSearchMatches.setup.current + 1}/{logSearchMatches.setup.indices.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div 
                  ref={logRefs.setup} 
                  className="h-48 overflow-y-auto p-4 font-mono text-xs"
                  onScroll={() => checkScrollPosition('setup')}
                >
                  {logs.setup.length === 0 ? (
                    <div className="text-zinc-500 dark:text-zinc-400">No setup logs yet</div>
                  ) : (
                    logs.setup.map((log, index) => {
                      const isMatch = logSearchMatches.setup.indices.includes(index);
                      const isCurrentMatch = logSearchMatches.setup.current >= 0 && logSearchMatches.setup.indices[logSearchMatches.setup.current] === index;
                      return (
                        <div 
                          key={log.id} 
                          className={`mb-1 text-zinc-700 dark:text-zinc-300 ${isCurrentMatch ? 'bg-yellow-200 dark:bg-yellow-800' : ''}`}
                        >
                          <span className="text-zinc-500 dark:text-zinc-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>{' '}
                          {highlightText(log.message, logSearch.setup)}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Filtering Logs */}
              <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 bg-blue-50 px-4 py-2 dark:border-zinc-700 dark:bg-blue-900/20">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-blue-800 dark:text-blue-200">
                      🔍 Filtering ({logs.filtering.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search..."
                        value={logSearch.filtering}
                        onChange={(e) => {
                          setLogSearch(prev => ({ ...prev, filtering: e.target.value }));
                          setIsAtBottom(prev => ({ ...prev, filtering: false }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.shiftKey) {
                            navigateSearch('filtering', 'up');
                          } else if (e.key === 'Enter') {
                            navigateSearch('filtering', 'down');
                          }
                        }}
                        className="w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                      />
                      {logSearchMatches.filtering.indices.length > 0 && (
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
                          {logSearchMatches.filtering.current + 1}/{logSearchMatches.filtering.indices.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div 
                  ref={logRefs.filtering} 
                  className="h-96 overflow-y-auto p-4 font-mono text-xs"
                  onScroll={() => checkScrollPosition('filtering')}
                >
                  {logs.filtering.length === 0 ? (
                    <div className="text-zinc-500 dark:text-zinc-400">No filtering logs yet</div>
                  ) : (
                    logs.filtering.map((log, index) => {
                      const isCurrentMatch = logSearchMatches.filtering.current >= 0 && logSearchMatches.filtering.indices[logSearchMatches.filtering.current] === index;
                      return (
                        <div 
                          key={log.id} 
                          className={`mb-1 text-zinc-700 dark:text-zinc-300 ${isCurrentMatch ? 'bg-yellow-200 dark:bg-yellow-800' : ''}`}
                        >
                          <span className="text-zinc-500 dark:text-zinc-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>{' '}
                          {highlightText(log.message, logSearch.filtering)}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Queued Logs */}
              <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 bg-green-50 px-4 py-2 dark:border-zinc-700 dark:bg-green-900/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-green-800 dark:text-green-200">
                        ✅ Queued
                      </h3>
                      <div className="text-xs text-green-700 dark:text-green-300">
                        {queueStatus ? (
                          <>
                            <span className="font-medium">Redis Queue: {queueStatus.total}</span>
                            {' '}(waiting: {queueStatus.waiting}, active: {queueStatus.active}
                            {queueStatus.delayed > 0 && `, delayed: ${queueStatus.delayed}`})
                            {' '}• Historical logs: {logs.queued.length}
                          </>
                        ) : (
                          `Historical logs: ${logs.queued.length}`
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search..."
                        value={logSearch.queued}
                        onChange={(e) => {
                          setLogSearch(prev => ({ ...prev, queued: e.target.value }));
                          setIsAtBottom(prev => ({ ...prev, queued: false }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.shiftKey) {
                            navigateSearch('queued', 'up');
                          } else if (e.key === 'Enter') {
                            navigateSearch('queued', 'down');
                          }
                        }}
                        className="w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                      />
                      {logSearchMatches.queued.indices.length > 0 && (
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
                          {logSearchMatches.queued.current + 1}/{logSearchMatches.queued.indices.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div 
                  ref={logRefs.queued} 
                  className="h-96 overflow-y-auto p-4 font-mono text-xs"
                  onScroll={() => checkScrollPosition('queued')}
                >
                  {logs.queued.length === 0 ? (
                    <div className="text-zinc-500 dark:text-zinc-400">No queued logs yet</div>
                  ) : (
                    logs.queued.map((log, index) => {
                      const isCurrentMatch = logSearchMatches.queued.current >= 0 && logSearchMatches.queued.indices[logSearchMatches.queued.current] === index;
                      return (
                        <div 
                          key={log.id} 
                          className={`mb-1 text-zinc-700 dark:text-zinc-300 ${isCurrentMatch ? 'bg-yellow-200 dark:bg-yellow-800' : ''}`}
                        >
                          <span className="text-zinc-500 dark:text-zinc-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>{' '}
                          {highlightText(log.message, logSearch.queued)}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Crawled Logs */}
              <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 bg-purple-50 px-4 py-2 dark:border-zinc-700 dark:bg-purple-900/20">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-purple-800 dark:text-purple-200">
                      🕷️ Crawled ({logs.crawled.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search..."
                        value={logSearch.crawled}
                        onChange={(e) => {
                          setLogSearch(prev => ({ ...prev, crawled: e.target.value }));
                          setIsAtBottom(prev => ({ ...prev, crawled: false }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.shiftKey) {
                            navigateSearch('crawled', 'up');
                          } else if (e.key === 'Enter') {
                            navigateSearch('crawled', 'down');
                          }
                        }}
                        className="w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                      />
                      {logSearchMatches.crawled.indices.length > 0 && (
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
                          {logSearchMatches.crawled.current + 1}/{logSearchMatches.crawled.indices.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div 
                  ref={logRefs.crawled} 
                  className="h-96 overflow-y-auto p-4 font-mono text-xs"
                  onScroll={() => checkScrollPosition('crawled')}
                >
                  {logs.crawled.length === 0 ? (
                    <div className="text-zinc-500 dark:text-zinc-400">No crawled logs yet</div>
                  ) : (
                    logs.crawled.map((log, index) => {
                      const isCurrentMatch = logSearchMatches.crawled.current >= 0 && logSearchMatches.crawled.indices[logSearchMatches.crawled.current] === index;
                      return (
                        <div 
                          key={log.id} 
                          className={`mb-1 text-zinc-700 dark:text-zinc-300 ${isCurrentMatch ? 'bg-yellow-200 dark:bg-yellow-800' : ''}`}
                        >
                          <span className="text-zinc-500 dark:text-zinc-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>{' '}
                          {highlightText(log.message, logSearch.crawled)}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Skipped Logs */}
              <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                <div className="border-b border-zinc-200 bg-yellow-50 px-4 py-2 dark:border-zinc-700 dark:bg-yellow-900/20">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-yellow-800 dark:text-yellow-200">
                      ⏭️ Skipped ({logs.skipped.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search..."
                        value={logSearch.skipped}
                        onChange={(e) => {
                          setLogSearch(prev => ({ ...prev, skipped: e.target.value }));
                          setIsAtBottom(prev => ({ ...prev, skipped: false }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.shiftKey) {
                            navigateSearch('skipped', 'up');
                          } else if (e.key === 'Enter') {
                            navigateSearch('skipped', 'down');
                          }
                        }}
                        className="w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                      />
                      {logSearchMatches.skipped.indices.length > 0 && (
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
                          {logSearchMatches.skipped.current + 1}/{logSearchMatches.skipped.indices.length}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div 
                  ref={logRefs.skipped} 
                  className="h-96 overflow-y-auto p-4 font-mono text-xs"
                  onScroll={() => checkScrollPosition('skipped')}
                >
                  {logs.skipped.length === 0 ? (
                    <div className="text-zinc-500 dark:text-zinc-400">No skipped logs yet</div>
                  ) : (
                    logs.skipped.map((log, index) => {
                      const isCurrentMatch = logSearchMatches.skipped.current >= 0 && logSearchMatches.skipped.indices[logSearchMatches.skipped.current] === index;
                      return (
                        <div 
                          key={log.id} 
                          className={`mb-1 text-zinc-700 dark:text-zinc-300 ${isCurrentMatch ? 'bg-yellow-200 dark:bg-yellow-800' : ''}`}
                        >
                          <span className="text-zinc-500 dark:text-zinc-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>{' '}
                          {highlightText(log.message, logSearch.skipped)}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pages List */}
        <div>
          <h2 className="mb-4 text-2xl font-semibold text-black dark:text-zinc-50">
            Crawled Pages ({crawlResultsPagination?.total || crawlResults.length})
          </h2>
          {crawlResults.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
              <p className="text-zinc-500 dark:text-zinc-400">No pages crawled yet</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {crawlResults.map((page) => (
                  <Link
                    key={page.id}
                    href={`/crawls/${page.id}`}
                    className="block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="mb-1 truncate font-medium text-black dark:text-zinc-50">
                          {page.title || page.url}
                        </div>
                        <div className="mb-2 truncate text-sm text-zinc-600 dark:text-zinc-400">
                          {page.url}
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                          <span>Status: {page.statusCode}</span>
                          <span>{page.h1Count + page.h2Count + page.h3Count} headings</span>
                          <span>{page.imagesCount} images</span>
                          <span>{page.internalLinksCount + page.externalLinksCount} links</span>
                          <span>{page.responseTimeMs}ms</span>
                          <span>{new Date(page.crawledAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="ml-4 text-zinc-400">→</div>
                    </div>
                  </Link>
                ))}
              </div>
              {crawlResultsPagination && crawlResultsPagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setCrawlResultsPage(prev => Math.max(1, prev - 1))}
                    disabled={crawlResultsPage === 1}
                    className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
                  >
                    ← Previous
                  </button>
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    Page {crawlResultsPage} of {crawlResultsPagination.totalPages}
                  </span>
                  <button
                    onClick={() => setCrawlResultsPage(prev => Math.min(crawlResultsPagination!.totalPages, prev + 1))}
                    disabled={crawlResultsPage === crawlResultsPagination.totalPages}
                    className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

