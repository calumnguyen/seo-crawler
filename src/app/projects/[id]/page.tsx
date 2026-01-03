'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Project {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
}

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
}

interface CrawlResult {
  id: string;
  url: string;
  statusCode: number;
  title: string | null;
  metaDescription: string | null;
  crawledAt: string;
  responseTimeMs: number;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  imagesCount: number;
  internalLinksCount: number;
  externalLinksCount: number;
  completenessScore: number | null;
  auditId: string | null;
}

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;
  
  const [project, setProject] = useState<Project | null>(null);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [crawlResults, setCrawlResults] = useState<CrawlResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'audits' | 'pages'>('audits');
  const [auditFilter, setAuditFilter] = useState<'all' | 'completed' | 'in_progress' | 'pending' | 'pending_approval'>('all');
  const [pageFilter, setPageFilter] = useState<'all' | 'recent'>('recent');

  useEffect(() => {
    fetchProjectData();
    const interval = setInterval(fetchProjectData, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const fetchProjectData = async () => {
    try {
      const [projectRes, auditsRes, pagesRes] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/projects/${projectId}/audits`),
        fetch(`/api/projects/${projectId}/crawl-results`),
      ]);

      if (projectRes.ok) {
        const projectData = await projectRes.json();
        setProject(projectData);
      }

      if (auditsRes.ok) {
        const auditsData = await auditsRes.json();
        setAudits(auditsData);
      }

      if (pagesRes.ok) {
        const pagesData = await pagesRes.json();
        setCrawlResults(pagesData);
      }
    } catch (error) {
      console.error('Error fetching project data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredAudits = audits.filter((audit) => {
    if (auditFilter === 'all') return true;
    return audit.status === auditFilter;
  });

  const filteredPages = crawlResults.filter((page) => {
    if (pageFilter === 'all') return true;
    if (pageFilter === 'recent') {
      // Show last 50 pages
      return crawlResults.indexOf(page) < 50;
    }
    return true;
  });

  // Only show full loading screen on initial load
  // After that, show partial content even if some data is still loading
  if (loading && !project && audits.length === 0 && crawlResults.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl">Loading project...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl">Project not found</div>
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
              href="/projects"
              className="mb-2 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              ← Back to All Projects
            </Link>
            <h1 className="mb-2 text-4xl font-bold text-black dark:text-zinc-50">
              {project.name}
            </h1>
            <p className="text-lg text-zinc-600 dark:text-zinc-400">
              {project.baseUrl}
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
              Created {new Date(project.createdAt).toLocaleDateString()}
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Stats */}
        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Total Audits</div>
            <div className="mt-1 text-2xl font-bold text-black dark:text-zinc-50">
              {audits.length}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Total Pages</div>
            <div className="mt-1 text-2xl font-bold text-black dark:text-zinc-50">
              {crawlResults.length}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">Completed</div>
            <div className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
              {audits.filter((a) => a.status === 'completed').length}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">In Progress</div>
            <div className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400">
              {audits.filter((a) => a.status === 'in_progress').length}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-4 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('audits')}
              className={`border-b-2 px-4 py-2 font-medium transition-colors ${
                activeTab === 'audits'
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
              }`}
            >
              Crawl Attempts ({audits.length})
            </button>
            <button
              onClick={() => setActiveTab('pages')}
              className={`border-b-2 px-4 py-2 font-medium transition-colors ${
                activeTab === 'pages'
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
              }`}
            >
              All Pages ({crawlResults.length})
            </button>
          </div>
        </div>

        {/* Audits Tab */}
        {activeTab === 'audits' && (
          <div>
            {/* Filter */}
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setAuditFilter('all')}
                className={`rounded px-3 py-1 text-sm ${
                  auditFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setAuditFilter('completed')}
                className={`rounded px-3 py-1 text-sm ${
                  auditFilter === 'completed'
                    ? 'bg-green-600 text-white'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                Completed
              </button>
              <button
                onClick={() => setAuditFilter('in_progress')}
                className={`rounded px-3 py-1 text-sm ${
                  auditFilter === 'in_progress'
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                In Progress
              </button>
              <button
                onClick={() => setAuditFilter('pending')}
                className={`rounded px-3 py-1 text-sm ${
                  auditFilter === 'pending'
                    ? 'bg-yellow-600 text-white'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                Pending
              </button>
              <button
                onClick={() => setAuditFilter('pending_approval')}
                className={`rounded px-3 py-1 text-sm ${
                  auditFilter === 'pending_approval'
                    ? 'bg-orange-600 text-white'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                Needs Approval
              </button>
            </div>

            {/* Audits List */}
            {filteredAudits.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-zinc-500 dark:text-zinc-400">No audits found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredAudits.map((audit) => (
                  <div
                    key={audit.id}
                    className={`relative block rounded-lg border p-4 shadow-sm transition-colors ${
                      audit.status === 'pending_approval'
                        ? 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20'
                        : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-3">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-medium ${
                              audit.status === 'completed'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : audit.status === 'in_progress'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                  : audit.status === 'pending_approval'
                                    ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
                                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                            }`}
                          >
                            {audit.status}
                          </span>
                          <span className="text-sm text-zinc-600 dark:text-zinc-400">
                            Started {new Date(audit.startedAt).toLocaleString()}
                          </span>
                          {audit.completedAt && (
                            <span className="text-sm text-zinc-600 dark:text-zinc-400">
                              • Completed {new Date(audit.completedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                        <div className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
                          Pages: {audit.pagesCrawled} / {audit.pagesTotal || '?'}
                        </div>
                        {audit.status === 'in_progress' && audit.pagesTotal > 0 && (
                          <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                            <div
                              className="h-full bg-blue-500 transition-all"
                              style={{
                                width: `${(audit.pagesCrawled / audit.pagesTotal) * 100}%`,
                              }}
                            />
                          </div>
                        )}
                        {(audit.overallScore !== null || audit.technicalScore !== null) && (
                          <div className="mt-2 flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                            {audit.overallScore !== null && (
                              <span>Overall: {audit.overallScore.toFixed(1)}</span>
                            )}
                            {audit.technicalScore !== null && (
                              <span>Technical: {audit.technicalScore.toFixed(1)}</span>
                            )}
                            {audit.contentScore !== null && (
                              <span>Content: {audit.contentScore.toFixed(1)}</span>
                            )}
                            {audit.performanceScore !== null && (
                              <span>Performance: {audit.performanceScore.toFixed(1)}</span>
                            )}
                          </div>
                        )}
                        {audit.status === 'pending_approval' && (
                          <div className="mt-3 rounded border border-orange-300 bg-orange-100 p-2 dark:border-orange-700 dark:bg-orange-900/30">
                            <div className="mb-2 text-xs text-orange-800 dark:text-orange-200">
                              ⚠️ robots.txt check failed or timed out. Please approve to continue crawling.
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!confirm('Approve this crawl? This will skip robots.txt check and start crawling immediately.')) return;
                                  try {
                                    const res = await fetch(`/api/audits/${audit.id}/approve`, { method: 'POST' });
                                    if (res.ok) {
                                      fetchProjectData();
                                    } else {
                                      const error = await res.json();
                                      alert(error.error || 'Failed to approve crawl');
                                    }
                                  } catch (error) {
                                    console.error('Error approving crawl:', error);
                                    alert('Failed to approve crawl');
                                  }
                                }}
                                className="rounded bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700"
                              >
                                ✅ Approve & Start Crawl
                              </button>
                              <Link
                                href={`/audits/${audit.id}`}
                                className="rounded bg-blue-600 px-3 py-1 text-center text-xs font-semibold text-white hover:bg-blue-700"
                              >
                                View Details →
                              </Link>
                            </div>
                          </div>
                        )}
                      </div>
                      {audit.status !== 'pending_approval' && (
                        <div className="ml-4 text-zinc-400">→</div>
                      )}
                    </div>
                    {audit.status !== 'pending_approval' && (
                      <Link
                        href={`/audits/${audit.id}`}
                        className="absolute inset-0"
                        aria-label={`View audit ${audit.id}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Pages Tab */}
        {activeTab === 'pages' && (
          <div>
            {/* Filter */}
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setPageFilter('recent')}
                className={`rounded px-3 py-1 text-sm ${
                  pageFilter === 'recent'
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                Recent (50)
              </button>
              <button
                onClick={() => setPageFilter('all')}
                className={`rounded px-3 py-1 text-sm ${
                  pageFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                All ({crawlResults.length})
              </button>
            </div>

            {/* Pages List */}
            {filteredPages.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <p className="text-zinc-500 dark:text-zinc-400">No pages crawled yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredPages.map((page) => (
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
                        {page.metaDescription && (
                          <div className="mb-2 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-500">
                            {page.metaDescription}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                          <span>Status: {page.statusCode}</span>
                          <span>{page.h1Count + page.h2Count + page.h3Count} headings</span>
                          <span>{page.imagesCount} images</span>
                          <span>{page.internalLinksCount + page.externalLinksCount} links</span>
                          <span>{page.responseTimeMs}ms</span>
                          {page.completenessScore !== null && (
                            <span>Score: {(page.completenessScore * 100).toFixed(0)}%</span>
                          )}
                          <span>{new Date(page.crawledAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="ml-4 text-zinc-400">→</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

