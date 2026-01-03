'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Project {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  audits?: Array<{
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    pagesCrawled: number;
    pagesTotal: number;
  }>;
  _count?: {
    audits: number;
    backlinks: number;
  };
}

export default function AllProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingCrawl, setStartingCrawl] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects/with-audits');
      if (response.ok) {
        const data = await response.json();
        setProjects(data || []);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartAutoCrawl = async (projectId: string) => {
    if (startingCrawl === projectId) return;
    
    setStartingCrawl(projectId);
    try {
      // Find or create a pending audit for this project
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;

      // Check if there's a pending audit
      const pendingAudit = project.audits?.find((a) => a.status === 'pending');
      
      if (pendingAudit) {
        const response = await fetch(`/api/audits/${pendingAudit.id}/start-auto`, {
          method: 'POST',
          signal: AbortSignal.timeout(10000), // 10 second timeout (should be fast now)
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log('Crawl started:', result);
          fetchProjects(); // Refresh immediately
        } else {
          const error = await response.json().catch(() => ({ error: 'Unknown error' }));
          if (response.status === 409) {
            // Conflict - already in progress
            alert('Crawl is already in progress for this project');
          } else {
            alert(`Failed to start crawl: ${error.error || 'Unknown error'}`);
          }
          fetchProjects(); // Refresh to show current state
        }
      } else {
        // Create new audit and start crawl
        const createResponse = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: project.name,
            baseUrl: project.baseUrl,
          }),
        });
        
        if (createResponse.ok) {
          const { audit } = await createResponse.json();
          const startResponse = await fetch(`/api/audits/${audit.id}/start-auto`, {
            method: 'POST',
            signal: AbortSignal.timeout(30000), // 30 second timeout
          });
          
          if (startResponse.ok) {
            const result = await startResponse.json();
            console.log('Crawl started:', result);
            fetchProjects();
          } else {
            const error = await startResponse.json().catch(() => ({ error: 'Unknown error' }));
            alert(`Failed to start crawl: ${error.error || 'Unknown error'}`);
          }
        } else {
          alert('Failed to create audit');
        }
      }
    } catch (error) {
      console.error('Error starting crawl:', error);
      alert('Failed to start crawl');
    } finally {
      setStartingCrawl(null);
    }
  };

  const getLastCrawledDate = (project: Project): string | null => {
    if (!project.audits || project.audits.length === 0) return null;
    
    // First, try to find a completed audit with completedAt date
    const completedAudits = project.audits
      .filter((a) => a.status === 'completed' && a.completedAt)
      .sort((a, b) => 
        new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
      );
    
    if (completedAudits.length > 0) {
      return completedAudits[0].completedAt;
    }
    
    // Fallback: Find any audit that has pages crawled (even if not completed)
    // Use startedAt as a proxy for "last crawled" if there's no completedAt
    const auditsWithPages = project.audits
      .filter((a) => a.pagesCrawled > 0)
      .sort((a, b) => 
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
    
    if (auditsWithPages.length > 0) {
      return auditsWithPages[0].startedAt;
    }
    
    // Last resort: Use the most recent audit's startedAt
    const mostRecentAudit = project.audits
      .sort((a, b) => 
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      )[0];
    
    return mostRecentAudit?.startedAt || null;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl">Loading projects...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-4xl font-bold text-black dark:text-zinc-50">
              All Projects
            </h1>
            <p className="text-lg text-zinc-600 dark:text-zinc-400">
              Manage all your crawling projects
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-sm dark:bg-zinc-900">
            <p className="text-zinc-500 dark:text-zinc-400">
              No projects yet. Create your first project from the dashboard!
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const lastCrawled = getLastCrawledDate(project);
              const hasPendingAudit = project.audits?.some((a) => a.status === 'pending');
              const activeAudits = project.audits?.filter((a) => a.status === 'in_progress') || [];
              const pendingApprovalAudits = project.audits?.filter((a) => a.status === 'pending_approval') || [];
              
              return (
                  <div
                    key={project.id}
                    className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <Link
                      href={`/projects/${project.id}`}
                      className="block"
                    >
                      <div className="mb-4">
                        <h3 className="text-xl font-semibold text-black dark:text-zinc-50">
                          {project.name}
                        </h3>
                        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                          {project.baseUrl}
                        </p>
                      </div>

                      <div className="mb-4 space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-zinc-600 dark:text-zinc-400">Audits:</span>
                          <span className="font-medium text-black dark:text-zinc-50">
                            {project._count?.audits || 0}
                          </span>
                        </div>
                        {lastCrawled && (
                          <div className="flex justify-between">
                            <span className="text-zinc-600 dark:text-zinc-400">Last Crawled:</span>
                            <span className="font-medium text-black dark:text-zinc-50">
                              {new Date(lastCrawled).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                        {activeAudits.length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-zinc-600 dark:text-zinc-400">Active:</span>
                            <span className="font-medium text-blue-600 dark:text-blue-400">
                              {activeAudits.length} crawl(s)
                            </span>
                          </div>
                        )}
                      </div>
                    </Link>

                    {pendingApprovalAudits.length > 0 ? (
                      // Show approval buttons for pending_approval audits
                      <div className="mt-4 space-y-2">
                        {pendingApprovalAudits.map((audit) => (
                          <div
                            key={audit.id}
                            className="rounded border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-900/20"
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-xs font-medium text-black dark:text-zinc-50">
                                ⚠️ Approval Required
                              </span>
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                                pending_approval
                              </span>
                            </div>
                            <div className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">
                              robots.txt check failed or timed out. Please approve to continue crawling.
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!confirm('Approve this crawl? This will skip robots.txt check and start crawling immediately.')) return;
                                  try {
                                    const res = await fetch(`/api/audits/${audit.id}/approve`, { method: 'POST' });
                                    if (res.ok) {
                                      fetchProjects();
                                    } else {
                                      const error = await res.json();
                                      alert(error.error || 'Failed to approve crawl');
                                    }
                                  } catch (error) {
                                    console.error('Error approving crawl:', error);
                                    alert('Failed to approve crawl');
                                  }
                                }}
                                className="flex-1 rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700"
                              >
                                ✅ Approve & Start Crawl
                              </button>
                              <Link
                                href={`/audits/${audit.id}`}
                                className="flex-1 rounded bg-blue-600 px-2 py-1 text-center text-xs font-semibold text-white hover:bg-blue-700"
                              >
                                View Details →
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {activeAudits.length > 0 ? (
                      // Show control buttons for active audits
                      <div className="mt-4 space-y-2">
                        {activeAudits.map((audit) => (
                          <div
                            key={audit.id}
                            className={`rounded border p-3 ${
                              audit.status === 'paused'
                                ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20'
                                : 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
                            }`}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-xs font-medium text-black dark:text-zinc-50">
                                {audit.status === 'paused' ? 'Paused' : 'Crawling...'}
                              </span>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                audit.status === 'paused'
                                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                  : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                              }`}>
                                {audit.status}
                              </span>
                            </div>
                            <div className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">
                              {audit.pagesCrawled} / {audit.pagesTotal || '?'} pages
                            </div>
                            <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                              <div
                                className="h-full bg-blue-500 transition-all"
                                style={{
                                  width: `${
                                    audit.pagesTotal && audit.pagesTotal > 0
                                      ? (audit.pagesCrawled / audit.pagesTotal) * 100
                                      : 0
                                  }%`,
                                }}
                              />
                            </div>
                            {/* Control Buttons */}
                            <div className="flex flex-wrap gap-2">
                              {audit.status === 'in_progress' && (
                                <button
                                  onClick={async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (!confirm('Pause the crawl? It can be resumed later.')) return;
                                    try {
                                      const res = await fetch(`/api/audits/${audit.id}/pause`, { method: 'POST' });
                                      if (res.ok) {
                                        fetchProjects();
                                      } else {
                                        const error = await res.json();
                                        alert(error.error || 'Failed to pause crawl');
                                      }
                                    } catch (error) {
                                      console.error('Error pausing crawl:', error);
                                      alert('Failed to pause crawl');
                                    }
                                  }}
                                  className="flex-1 rounded bg-yellow-600 px-2 py-1 text-xs font-semibold text-white hover:bg-yellow-700"
                                >
                                  ⏸️ Pause
                                </button>
                              )}
                              {audit.status === 'paused' && (
                                <button
                                  onClick={async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    try {
                                      const res = await fetch(`/api/audits/${audit.id}/resume`, { method: 'POST' });
                                      if (res.ok) {
                                        fetchProjects();
                                      } else {
                                        const error = await res.json();
                                        alert(error.error || 'Failed to resume crawl');
                                      }
                                    } catch (error) {
                                      console.error('Error resuming crawl:', error);
                                      alert('Failed to resume crawl');
                                    }
                                  }}
                                  className="flex-1 rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700"
                                >
                                  ▶️ Resume
                                </button>
                              )}
                              <button
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!confirm('Stop the crawl? All queued jobs will be removed and this crawl CANNOT be resumed. Use Pause if you want to resume later.')) return;
                                  try {
                                    const res = await fetch(`/api/audits/${audit.id}/stop`, { method: 'POST' });
                                    if (res.ok) {
                                      fetchProjects();
                                    } else {
                                      const error = await res.json();
                                      alert(error.error || 'Failed to stop crawl');
                                    }
                                  } catch (error) {
                                    console.error('Error stopping crawl:', error);
                                    alert('Failed to stop crawl');
                                  }
                                }}
                                className="flex-1 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700"
                              >
                                ⏹️ Stop
                              </button>
                              <Link
                                href={`/audits/${audit.id}`}
                                className="flex-1 rounded bg-blue-600 px-2 py-1 text-center text-xs font-semibold text-white hover:bg-blue-700"
                              >
                                View Details →
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      // Show start crawl button when no active audits
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (startingCrawl === project.id) {
                            return; // Prevent duplicate clicks
                          }
                          handleStartAutoCrawl(project.id);
                        }}
                        disabled={startingCrawl === project.id}
                        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {startingCrawl === project.id
                          ? 'Starting...'
                          : '🚀 Start Automatic Crawl'}
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </main>
    </div>
  );
}

