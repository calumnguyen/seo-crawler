'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import TetrisLoading from '@/components/ui/tetris-loader';
import CrawlGraph from '@/components/CrawlGraph';

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
  const router = useRouter();
  const projectId = params.id as string;
  
  const [project, setProject] = useState<Project | null>(null);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [crawlResults, setCrawlResults] = useState<CrawlResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'audits' | 'pages' | 'graph'>('audits');
  const [auditFilter, setAuditFilter] = useState<'all' | 'completed' | 'in_progress' | 'pending' | 'pending_approval'>('all');
  const [pageFilter, setPageFilter] = useState<'all' | 'recent'>('recent');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerTitle, setViewerTitle] = useState('');
  const [viewerContent, setViewerContent] = useState('');
  const [robotsAvailable, setRobotsAvailable] = useState(false);
  const [sitemaps, setSitemaps] = useState<Array<{ url: string; content: string }>>([]);

  useEffect(() => {
    fetchProjectData();
    const interval = setInterval(fetchProjectData, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const fetchProjectData = async () => {
    try {
      const [projectRes, auditsRes, pagesRes, robotsRes, sitemapsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/projects/${projectId}/audits`),
        fetch(`/api/projects/${projectId}/crawl-results`),
        fetch(`/api/projects/${projectId}/robots`).catch(() => ({ ok: false })),
        fetch(`/api/projects/${projectId}/sitemaps`).catch(() => ({ ok: false })),
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

      if (robotsRes.ok) {
        setRobotsAvailable(true);
      } else {
        setRobotsAvailable(false);
      }

      if (sitemapsRes.ok) {
        const sitemapsData = await sitemapsRes.json();
        setSitemaps(Array.isArray(sitemapsData) ? sitemapsData : []);
      } else {
        setSitemaps([]);
      }
    } catch (error) {
      console.error('Error fetching project data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to highlight XML syntax
  const highlightXml = (xml: string): string => {
    // Escape HTML first (do this carefully to avoid double-escaping)
    let result = xml
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // XML Declaration
    result = result.replace(/(&lt;\?xml[^?]*\?&gt;)/g, '<span class="text-purple-600 dark:text-purple-400">$1</span>');
    
    // Comments (match before tags to avoid conflicts)
    result = result.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="text-green-600 dark:text-green-400">$1</span>');
    
    // CDATA sections
    result = result.replace(/(&lt;!\[CDATA\[[\s\S]*?\]\]&gt;)/g, '<span class="text-orange-600 dark:text-orange-400">$1</span>');
    
    // Opening tags with attributes (including self-closing)
    result = result.replace(/(&lt;)([\w-:]+)((?:\s+[\w-:]+="[^"]*")*)(\s*\/?&gt;)/g, (match, open, tag, attrs, close) => {
      const attrsHighlighted = attrs.replace(/([\w-:]+)="([^"]*)"/g, '<span class="text-blue-600 dark:text-blue-400">$1</span>=<span class="text-orange-600 dark:text-orange-400">"$2"</span>');
      return `<span class="text-red-600 dark:text-red-400">${open}</span><span class="text-blue-700 dark:text-blue-300 font-semibold">${tag}</span>${attrsHighlighted}<span class="text-red-600 dark:text-red-400">${close}</span>`;
    });
    
    // Closing tags
    result = result.replace(/(&lt;\/)([\w-:]+)(&gt;)/g, '<span class="text-red-600 dark:text-red-400">$1</span><span class="text-blue-700 dark:text-blue-300 font-semibold">$2</span><span class="text-red-600 dark:text-red-400">$3</span>');
    
    // URLs in text content (common in sitemaps)
    result = result.replace(/(https?:\/\/[^\s&lt;&gt;"]+)/g, '<span class="text-blue-500 dark:text-blue-400 underline">$1</span>');
    
    return result;
  };

  // Helper function to highlight robots.txt syntax
  const highlightRobots = (text: string): string => {
    return text
      // Escape HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Comments
      .replace(/(#.*$)/gm, '<span class="text-green-600 dark:text-green-400">$1</span>')
      // User-agent
      .replace(/(User-agent:.*$)/gmi, '<span class="text-blue-600 dark:text-blue-400 font-semibold">$1</span>')
      // Allow/Disallow
      .replace(/(Allow:|Disallow:)(.*$)/gmi, (match, directive, path) => {
        const directiveClass = directive.toLowerCase() === 'allow:' 
          ? 'text-green-600 dark:text-green-400' 
          : 'text-red-600 dark:text-red-400';
        return `<span class="${directiveClass} font-semibold">${directive}</span><span class="text-zinc-700 dark:text-zinc-300">${path}</span>`;
      })
      // Sitemap
      .replace(/(Sitemap:)(.*$)/gmi, '<span class="text-purple-600 dark:text-purple-400 font-semibold">$1</span><span class="text-blue-500 dark:text-blue-400 underline">$2</span>')
      // Crawl-delay
      .replace(/(Crawl-delay:)(.*$)/gmi, '<span class="text-orange-600 dark:text-orange-400 font-semibold">$1</span><span class="text-zinc-700 dark:text-zinc-300">$2</span>');
  };

  const openViewer = async (type: 'robots' | 'sitemap', index?: number) => {
    try {
      if (type === 'robots') {
        const res = await fetch(`/api/projects/${projectId}/robots`);
        if (res.ok) {
          const data = await res.json();
          setViewerTitle('robots.txt');
          setViewerContent(data.content || '');
          setViewerOpen(true);
        }
      } else if (type === 'sitemap' && index !== undefined) {
        const res = await fetch(`/api/projects/${projectId}/sitemaps/${index}`);
        if (res.ok) {
          const data = await res.json();
          setViewerTitle(`Sitemap: ${data.url}`);
          setViewerContent(data.content || '');
          setViewerOpen(true);
        }
      }
    } catch (error) {
      console.error('Error fetching content:', error);
      alert('Failed to load content');
    }
  };

  // Compute highlighted content (only when viewerContent changes)
  const highlightedContent = useMemo(() => {
    if (!viewerContent) return '';
    const isXml = viewerContent.trim().startsWith('<?xml') || viewerContent.trim().startsWith('<');
    return isXml ? highlightXml(viewerContent) : highlightRobots(viewerContent);
  }, [viewerContent]);

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
        <TetrisLoading size="md" speed="normal" loadingText="Loading..." />
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
            href="/projects"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            ← Back to All Projects
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

        {/* Configuration Files */}
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">Configuration Files</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Robots.txt */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium text-black dark:text-zinc-50">robots.txt</h3>
                {robotsAvailable ? (
                  <span className="text-xs text-green-600 dark:text-green-400">Available</span>
                ) : (
                  <span className="text-xs text-zinc-400">Not found</span>
                )}
              </div>
              {robotsAvailable ? (
                <button
                  onClick={() => openViewer('robots')}
                  className="mt-2 w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  View robots.txt
                </button>
              ) : (
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  robots.txt has not been fetched yet. It will be available after the first crawl.
                </p>
              )}
            </div>

            {/* Sitemaps */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium text-black dark:text-zinc-50">Sitemaps</h3>
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  {sitemaps.length} found
                </span>
              </div>
              {sitemaps.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {sitemaps.map((sitemap, index) => (
                    <button
                      key={index}
                      onClick={() => openViewer('sitemap', index)}
                      className="block w-full rounded border border-zinc-300 bg-white px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <div className="truncate font-medium">{sitemap.url}</div>
                      <div className="text-xs text-zinc-500">Click to view</div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  No sitemaps found. They will be available after the first crawl.
                </p>
              )}
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
            <button
              onClick={() => setActiveTab('graph')}
              className={`border-b-2 px-4 py-2 font-medium transition-colors ${
                activeTab === 'graph'
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
              }`}
            >
              Graph View
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
                              <button
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!confirm(`Delete project "${project.name}"? This will permanently delete the project and all its audits. This action cannot be undone.`)) return;
                                  try {
                                    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
                                    if (res.ok) {
                                      router.push('/projects');
                                    } else {
                                      const error = await res.json();
                                      alert(error.error || 'Failed to delete project');
                                    }
                                  } catch (error) {
                                    console.error('Error deleting project:', error);
                                    alert('Failed to delete project');
                                  }
                                }}
                                className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                              >
                                🗑️ Delete Project
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

        {/* Graph Tab */}
        {activeTab === 'graph' && (
          <div>
            <CrawlGraph projectId={projectId} />
          </div>
        )}
      </main>

      {/* Content Viewer Modal */}
      {viewerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setViewerOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl rounded-lg bg-white shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
              <h3 className="text-lg font-semibold text-black dark:text-zinc-50">{viewerTitle}</h3>
              <button
                onClick={() => setViewerOpen(false)}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[calc(90vh-80px)] overflow-auto p-6">
              <pre className="whitespace-pre-wrap break-words rounded bg-zinc-50 p-4 text-sm dark:bg-zinc-950 font-mono">
                <code 
                  className="block"
                  dangerouslySetInnerHTML={{ __html: highlightedContent }}
                />
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

