'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AnimatedFolder from '@/components/ui/3d-folder';
import TetrisLoading from '@/components/ui/tetris-loader';

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
  const [optimisticAudits, setOptimisticAudits] = useState<Set<string>>(new Set()); // Track audits we've optimistically marked as in_progress
  const [actionLoading, setActionLoading] = useState<{ auditId: string; action: 'pause' | 'resume' | 'stop' } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 5000);
    return () => clearInterval(interval);
  }, []);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

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
        // Optimistically update UI to show control buttons immediately
        setOptimisticAudits(prev => new Set(prev).add(pendingAudit.id));
        setProjects(prevProjects => prevProjects.map(p => {
          if (p.id === projectId && p.audits) {
            return {
              ...p,
              audits: p.audits.map(a => 
                a.id === pendingAudit.id 
                  ? { ...a, status: 'in_progress' as const }
                  : a
              ),
            };
          }
          return p;
        }));
        
        const response = await fetch(`/api/audits/${pendingAudit.id}/start-auto`, {
          method: 'POST',
          signal: AbortSignal.timeout(10000), // 10 second timeout (should be fast now)
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log('Crawl started:', result);
          fetchProjects(); // Refresh to get actual state
        } else {
          const error = await response.json().catch(() => ({ error: 'Unknown error' }));
          // Revert optimistic update on error
          setOptimisticAudits(prev => {
            const next = new Set(prev);
            next.delete(pendingAudit.id);
            return next;
          });
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
          
          // Optimistically update UI to show control buttons immediately
          setOptimisticAudits(prev => new Set(prev).add(audit.id));
          setProjects(prevProjects => prevProjects.map(p => {
            if (p.id === projectId) {
              return {
                ...p,
                audits: [
                  { ...audit, status: 'in_progress' as const },
                  ...(p.audits || []),
                ],
              };
            }
            return p;
          }));
          
          const startResponse = await fetch(`/api/audits/${audit.id}/start-auto`, {
            method: 'POST',
            signal: AbortSignal.timeout(30000), // 30 second timeout
          });
          
          if (startResponse.ok) {
            const result = await startResponse.json();
            console.log('Crawl started:', result);
            fetchProjects(); // Refresh to get actual state
          } else {
            const error = await startResponse.json().catch(() => ({ error: 'Unknown error' }));
            // Revert optimistic update on error
            setOptimisticAudits(prev => {
              const next = new Set(prev);
              next.delete(audit.id);
              return next;
            });
            alert(`Failed to start crawl: ${error.error || 'Unknown error'}`);
            fetchProjects(); // Refresh to show current state
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

  const getTotalPagesCrawled = (project: Project): number => {
    if (!project.audits || project.audits.length === 0) return 0;
    // Get the maximum pages crawled from all audits (most recent/comprehensive crawl)
    return Math.max(...project.audits.map(a => a.pagesCrawled || 0), 0);
  };

  // Filter projects based on search query
  const filteredProjects = useMemo(() => {
    if (!debouncedSearchQuery.trim()) {
      return projects;
    }

    const query = debouncedSearchQuery.toLowerCase().trim();
    return projects.filter((project) => {
      const nameMatch = project.name.toLowerCase().includes(query);
      const domainMatch = project.domain.toLowerCase().includes(query);
      const baseUrlMatch = project.baseUrl.toLowerCase().includes(query);
      return nameMatch || domainMatch || baseUrlMatch;
    });
  }, [projects, debouncedSearchQuery]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <TetrisLoading size="md" speed="normal" loadingText="Loading..." />
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

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <input
              type="text"
              placeholder="Search by project name or domain..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 pl-10 text-sm text-black placeholder:text-zinc-500 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-400 dark:focus:border-blue-400"
            />
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-sm dark:bg-zinc-900">
            <p className="text-zinc-500 dark:text-zinc-400">
              No projects yet. Create your first project from the dashboard!
            </p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-sm dark:bg-zinc-900">
            <p className="text-zinc-500 dark:text-zinc-400">
              No projects found matching "{debouncedSearchQuery}"
            </p>
          </div>
        ) : (
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 justify-items-center">
            {filteredProjects.map((project) => {
              const lastCrawled = getLastCrawledDate(project);
              const totalPagesCrawled = getTotalPagesCrawled(project);
              const hasPendingAudit = project.audits?.some((a) => a.status === 'pending');
              // Include optimistic audits (those we've optimistically marked as in_progress)
              const activeAudits = project.audits?.filter((a) => 
                a.status === 'in_progress' || optimisticAudits.has(a.id)
              ) || [];
              const pendingApprovalAudits = project.audits?.filter((a) => a.status === 'pending_approval') || [];
              
              // Generate gradient based on project index for visual variety
              const gradients = [
                "linear-gradient(135deg, #e73827, #f85032)",
                "linear-gradient(to right, #f7b733, #fc4a1a)",
                "linear-gradient(135deg, #00c6ff, #0072ff)",
                "linear-gradient(to right, #414345, #232526)",
                "linear-gradient(135deg, #8e2de2, #4a00e0)",
                "linear-gradient(135deg, #f80759, #bc4e9c)",
              ];
              const gradient = gradients[parseInt(project.id.slice(-1) || '0', 16) % gradients.length];
              
              return (
                  <div
                    key={project.id}
                    className="w-full max-w-sm"
                  >
                    <AnimatedFolder
                      id={project.id}
                      name={project.name}
                      domain={project.domain}
                      baseUrl={project.baseUrl}
                      pagesCrawled={totalPagesCrawled}
                      lastCrawled={lastCrawled}
                      gradient={gradient}
                      href={`/projects/${project.id}`}
                      className="w-full"
                    >
                      {pendingApprovalAudits.length > 0 ? (
                        // Show approval buttons for pending_approval audits
                        <div className="space-y-2">
                          {pendingApprovalAudits.map((audit) => (
                            <div
                              key={audit.id}
                              className="rounded border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-900/20"
                            >
                              <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-medium text-black dark:text-zinc-50">
                                  Approval Required
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
                                  className="flex-1 rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700 relative z-20 cursor-pointer"
                                >
                                  Approve & Start Crawl
                                </button>
                                <button
                                  onClick={async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (!confirm(`Delete project "${project.name}"? This will permanently delete the project and all its audits. This action cannot be undone.`)) return;
                                    try {
                                      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
                                      if (res.ok) {
                                        fetchProjects();
                                      } else {
                                        const error = await res.json();
                                        alert(error.error || 'Failed to delete project');
                                      }
                                    } catch (error) {
                                      console.error('Error deleting project:', error);
                                      alert('Failed to delete project');
                                    }
                                  }}
                                  className="flex-1 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 relative z-20 cursor-pointer"
                                >
                                  🗑️ Delete Project
                                </button>
                                <Link
                                  href={`/audits/${audit.id}`}
                                  className="flex-1 rounded bg-blue-600 px-2 py-1 text-center text-xs font-semibold text-white hover:bg-blue-700 relative z-20 cursor-pointer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  View Details
                                </Link>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : activeAudits.length > 0 ? (
                        // Show control buttons for active audits
                        <div className="space-y-2">
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
                                    
                                    setActionLoading({ auditId: audit.id, action: 'pause' });
                                    try {
                                      const res = await fetch(`/api/audits/${audit.id}/pause`, { method: 'POST' });
                                      if (res.ok) {
                                        await fetchProjects(); // Refresh to get actual state
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
                                  className="flex-1 rounded bg-yellow-600 px-2 py-1 text-xs font-semibold text-white hover:bg-yellow-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 relative z-20"
                                >
                                  {actionLoading?.auditId === audit.id && actionLoading?.action === 'pause' ? 'Loading...' : 'Pause'}
                                </button>
                              )}
                              {audit.status === 'paused' && (
                                <button
                                  onClick={async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    
                                    setActionLoading({ auditId: audit.id, action: 'resume' });
                                    try {
                                      const res = await fetch(`/api/audits/${audit.id}/resume`, { method: 'POST' });
                                      if (res.ok) {
                                        await fetchProjects(); // Refresh to get actual state
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
                                  className="flex-1 rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 relative z-20"
                                >
                                  {actionLoading?.auditId === audit.id && actionLoading?.action === 'resume' ? 'Loading...' : 'Resume'}
                                </button>
                              )}
                              <button
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!confirm('Stop the crawl? All queued jobs will be removed and this crawl CANNOT be resumed. Use Pause if you want to resume later.')) return;
                                  
                                  setActionLoading({ auditId: audit.id, action: 'stop' });
                                  try {
                                    const res = await fetch(`/api/audits/${audit.id}/stop`, { method: 'POST' });
                                    if (res.ok) {
                                      await fetchProjects(); // Refresh to get actual state
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
                                className="flex-1 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 relative z-20"
                              >
                                {actionLoading?.auditId === audit.id && actionLoading?.action === 'stop' ? 'Loading...' : 'Stop'}
                              </button>
                              <Link
                                href={`/audits/${audit.id}`}
                                className="flex-1 rounded bg-blue-600 px-2 py-1 text-center text-xs font-semibold text-white hover:bg-blue-700 relative z-20 cursor-pointer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                View Details
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
                          disabled={startingCrawl === project.id || optimisticAudits.has(project.audits?.[0]?.id || '')}
                          className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:brightness-110 hover:shadow-xl hover:shadow-[var(--accent)]/50 hover:scale-105 hover:-translate-y-0.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 disabled:hover:shadow-none disabled:hover:scale-100 disabled:hover:translate-y-0 relative z-20"
                        >
                          {startingCrawl === project.id
                            ? 'Starting...'
                            : 'Start Automatic Crawl'}
                        </button>
                      )}
                    </AnimatedFolder>
                  </div>
                );
              })}
          </div>
        )}
      </main>
    </div>
  );
}

