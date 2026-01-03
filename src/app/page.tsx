'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

interface Project {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  audits?: Audit[];
  _count?: {
    audits: number;
    backlinks: number;
  };
}

interface Audit {
  id: string;
  status: string;
  startedAt: string;
  pagesCrawled: number;
  pagesTotal: number;
  project?: {
    name: string;
    domain: string;
  };
  _count?: {
    crawlResults: number;
  };
}

interface CrawlSchedule {
  id: string;
  url: string | null;
  crawlFrequency: string;
  nextCrawlAt: string;
  lastCrawledAt: string | null;
  project: {
    name: string;
    domain: string;
  } | null;
  domain: {
    domain: string;
  } | null;
}

interface CrawlResult {
  id: string;
  url: string;
  statusCode: number;
  title: string | null;
  crawledAt: string;
  audit: {
    project: {
      name: string;
      domain: string;
    };
  };
  _count: {
    headings: number;
    images: number;
    links: number;
  };
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [scheduled, setScheduled] = useState<CrawlSchedule[]>([]);
  const [activity, setActivity] = useState<{
    activeAudits: Audit[];
    recentCrawls: CrawlResult[];
  }>({ activeAudits: [], recentCrawls: [] });
  const [crawledData, setCrawledData] = useState<{
    crawlResults: CrawlResult[];
    total: number;
  }>({ crawlResults: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [newProjectUrl, setNewProjectUrl] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [startingCrawl, setStartingCrawl] = useState<string | null>(null);
  const [optimisticAudits, setOptimisticAudits] = useState<Set<string>>(new Set()); // Track audits we've optimistically marked as in_progress
  const [actionLoading, setActionLoading] = useState<{ auditId: string; action: 'pause' | 'resume' | 'stop' } | null>(null);

  // Fetch all data
  const fetchData = async () => {
    try {
      const [projectsRes, scheduledRes, activityRes, dataRes] = await Promise.all([
        fetch('/api/projects/with-audits'),
        fetch('/api/dashboard/scheduled'),
        fetch('/api/dashboard/activity'),
        fetch('/api/dashboard/data'),
      ]);

      // Check if responses are OK and JSON
      const checkResponse = async (res: Response, name: string) => {
        const contentType = res.headers.get('content-type');
        const text = await res.text();
        
        if (!res.ok) {
          console.error(`Error in ${name}:`, res.status, text.substring(0, 500));
          // Return empty/default data instead of throwing
          return name === 'projects' ? [] : name === 'scheduled' ? [] : name === 'activity' ? { activeAudits: [], recentCrawls: [] } : { crawlResults: [], total: 0 };
        }
        
        if (!contentType?.includes('application/json')) {
          console.error(`${name} returned non-JSON (${contentType}):`, text.substring(0, 500));
          // Return empty/default data instead of throwing
          return name === 'projects' ? [] : name === 'scheduled' ? [] : name === 'activity' ? { activeAudits: [], recentCrawls: [] } : { crawlResults: [], total: 0 };
        }
        
        try {
          return JSON.parse(text);
        } catch {
          console.error(`${name} JSON parse error:`, text.substring(0, 500));
          return name === 'projects' ? [] : name === 'scheduled' ? [] : name === 'activity' ? { activeAudits: [], recentCrawls: [] } : { crawlResults: [], total: 0 };
        }
      };

      const [projectsData, scheduledData, activityData, dataData] = await Promise.all([
        checkResponse(projectsRes, 'projects'),
        checkResponse(scheduledRes, 'scheduled'),
        checkResponse(activityRes, 'activity'),
        checkResponse(dataRes, 'data'),
      ]);

      setProjects(projectsData || []);
      setScheduled(scheduledData || []);
      setActivity(activityData || { activeAudits: [], recentCrawls: [] });
      setCrawledData(dataData || { crawlResults: [], total: 0 });
    } catch (error) {
      console.error('Error fetching data:', error);
      // Set empty data on error to prevent crashes
      setProjects([]);
      setScheduled([]);
      setActivity({ activeAudits: [], recentCrawls: [] });
      setCrawledData({ crawlResults: [], total: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Trigger check-completion immediately to update pagesTotal
    fetch('/api/audits/check-completion', { method: 'POST' }).catch(() => {});
    const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds
    
    // Also check for completed audits every 10 seconds (more frequent to update pagesTotal)
    const completionCheck = setInterval(async () => {
      try {
        await fetch('/api/audits/check-completion', { method: 'POST' });
      } catch (error) {
        console.error('Error checking completion:', error);
      }
    }, 10000); // Every 10 seconds
    
    return () => {
      clearInterval(interval);
      clearInterval(completionCheck);
    };
  }, []);

  const handleCreateProject = async () => {
    if (!newProjectUrl || !newProjectName) {
      alert('Please enter both name and URL');
      return;
    }

    setCreating(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProjectName,
          baseUrl: newProjectUrl,
        }),
      });

      if (response.ok) {
        const { project, audit } = await response.json();
        
        // Optimistically update UI to show the new project and audit as in_progress
        setProjects(prevProjects => {
          const updated = [...prevProjects];
          const existingIndex = updated.findIndex(p => p.id === project.id);
          const newProject = {
            ...project,
            audits: [{ ...audit, status: 'in_progress' as const }],
          };
          if (existingIndex >= 0) {
            updated[existingIndex] = newProject;
          } else {
            updated.unshift(newProject);
          }
          return updated;
        });
        
        // Optimistically add audit to activeAudits
        setActivity(prev => ({
          ...prev,
          activeAudits: [
            { ...audit, status: 'in_progress', project: { name: project.name, domain: project.domain } },
            ...prev.activeAudits,
          ],
        }));
        
        // Mark audit as optimistically in_progress
        setOptimisticAudits(prev => new Set(prev).add(audit.id));
        
        // Automatically start the full crawl
        try {
          console.log(`[Dashboard] Starting crawl for audit ${audit.id}...`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
          
          const crawlResponse = await fetch(`/api/audits/${audit.id}/start-auto`, {
            method: 'POST',
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          console.log(`[Dashboard] Crawl start response status: ${crawlResponse.status}`);
          
          if (crawlResponse.ok) {
            const result = await crawlResponse.json();
            console.log(`[Dashboard] Crawl started successfully:`, result);
            // Immediately refresh to get actual state
            fetchData();
            alert(`✅ Project created! Starting automatic crawl...\n\n${result.message || `Found ${result.sitemapsFound || 0} sitemap(s), queued ${result.urlsQueued || 0} URLs to crawl`}`);
          } else {
            const error = await crawlResponse.json().catch(() => ({ error: 'Unknown error' }));
            console.error(`[Dashboard] Crawl start failed with status ${crawlResponse.status}:`, error);
            // Revert optimistic update on error
            setOptimisticAudits(prev => {
              const next = new Set(prev);
              next.delete(audit.id);
              return next;
            });
            fetchData(); // Refresh to show actual state
            alert(`Project created, but failed to start crawl: ${error.error || 'Unknown error'}`);
          }
        } catch (crawlError) {
          console.error('[Dashboard] Error starting crawl:', crawlError);
          // Revert optimistic update on error
          setOptimisticAudits(prev => {
            const next = new Set(prev);
            next.delete(audit.id);
            return next;
          });
          fetchData(); // Refresh to show actual state
          if (crawlError instanceof Error && crawlError.name === 'AbortError') {
            alert('Crawl start timed out. The crawl may still be starting in the background. Check the dashboard in a few moments.');
          } else {
            alert('Project created, but failed to start crawl. You can start it manually from the project list.');
          }
        }

        setNewProjectUrl('');
        setNewProjectName('');
        // fetchData() is called above after crawl response
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to create project');
      }
    } catch (error) {
      console.error('Error creating project:', error);
      alert('Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleStartAutoCrawl = async (auditId: string) => {
    if (startingCrawl === auditId) return; // Prevent double-click
    
    setStartingCrawl(auditId);
    
    // Optimistically update UI to show control buttons immediately
    setOptimisticAudits(prev => new Set(prev).add(auditId));
    setProjects(prevProjects => prevProjects.map(p => ({
      ...p,
      audits: p.audits?.map(a => 
        a.id === auditId 
          ? { ...a, status: 'in_progress' as const }
          : a
      ) || [],
    })));
    
    try {
      const response = await fetch(`/api/audits/${auditId}/start-auto`, {
        method: 'POST',
      });

      if (response.ok) {
        const result = await response.json();
        // Don't show alert, just refresh - the UI will update automatically
        fetchData();
      } else {
        const error = await response.json();
        // Revert optimistic update on error
        setOptimisticAudits(prev => {
          const next = new Set(prev);
          next.delete(auditId);
          return next;
        });
        alert(`Failed to start crawl: ${error.error}`);
        fetchData(); // Refresh to show actual state
      }
    } catch (error) {
      console.error('Error starting automatic crawl:', error);
      // Revert optimistic update on error
      setOptimisticAudits(prev => {
        const next = new Set(prev);
        next.delete(auditId);
        return next;
      });
      alert('Failed to start automatic crawl');
      fetchData(); // Refresh to show actual state
    } finally {
      setStartingCrawl(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="container mx-auto max-w-7xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="mb-2 text-4xl font-bold text-black dark:text-zinc-50">
              SEO Crawler Dashboard
            </h1>
            <p className="text-lg text-zinc-600 dark:text-zinc-400">
              Monitor your crawling activity and data
            </p>
            {user && (
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
                Logged in as {user.name} ({user.email})
              </p>
            )}
          </div>
          {user && (
            <button
              onClick={logout}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              Logout
            </button>
          )}
        </div>

        {/* Clear Queue Button */}
        <div className="mb-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-black dark:text-zinc-50">
                Redis Queue Management
              </div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">
                Clear all jobs from the Redis queue
              </div>
            </div>
            <button
              onClick={async (e) => {
                if (!confirm('Are you sure you want to clear the entire Redis queue? This will remove all waiting, active, and completed jobs.')) {
                  return;
                }
                
                // Show loading state
                const button = e.currentTarget;
                const originalText = button.textContent;
                button.disabled = true;
                button.textContent = 'Clearing...';
                
                try {
                  console.log('[Clear] Calling /api/queue/clear...');
                  
                  // Add timeout to prevent hanging
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
                  
                  const response = await fetch('/api/queue/clear', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    signal: controller.signal,
                  });
                  
                  clearTimeout(timeoutId);
                  console.log('[Clear] Response status:', response.status);
                  
                  if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                  }
                  
                  const data = await response.json();
                  console.log('[Clear] Response data:', data);
                  
                  if (response.ok) {
                    alert(`Queue cleared successfully!\n\nRemaining jobs:\n- Waiting: ${data.remaining?.waiting || 0}\n- Active: ${data.remaining?.active || 0}\n- Completed: ${data.remaining?.completed || 0}\n- Failed: ${data.remaining?.failed || 0}\n- Delayed: ${data.remaining?.delayed || 0}`);
                    fetchData(); // Refresh the dashboard
                  } else {
                    alert(`Failed to clear queue: ${data.error || 'Unknown error'}`);
                  }
                } catch (error) {
                  console.error('[Clear] Error clearing queue:', error);
                  if (error instanceof Error && error.name === 'AbortError') {
                    alert('Clear queue operation timed out after 30 seconds. The queue may still be clearing in the background. Check the server logs.');
                  } else {
                    alert(`Failed to clear queue: ${error instanceof Error ? error.message : 'Unknown error'}\n\nCheck the browser console for details.`);
                  }
                } finally {
                  // Restore button state
                  button.disabled = false;
                  button.textContent = originalText;
                }
              }}
              className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🗑️ Clear Queue
            </button>
          </div>
        </div>

        {/* Create New Project */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
            Start New Crawl
          </h2>
          <div className="flex gap-4">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project Name"
              className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
            <input
              type="url"
              value={newProjectUrl}
              onChange={(e) => setNewProjectUrl(e.target.value)}
              placeholder="https://example.com"
              className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
            <button
              onClick={handleCreateProject}
              disabled={creating}
              className="rounded-lg bg-black px-6 py-2 font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
            >
              {creating ? 'Creating...' : 'Start Crawl'}
            </button>
          </div>
        </div>

        {/* Projects and Most Recent Project Sections */}
        <div className="mb-8 grid gap-6 md:grid-cols-2">
          {/* All Projects Section */}
          <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
                Projects
              </h2>
              <Link
                href="/projects"
                className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                View All →
              </Link>
            </div>
            {projects.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No projects yet
              </p>
            ) : (
              <div className="space-y-3">
                {projects.slice(0, 5).map((project) => {
                  const lastCompletedAudit = project.audits
                    ?.filter((a) => a.status === 'completed' && (a as any).completedAt)
                    .sort((a, b) => {
                      const aDate = (a as any).completedAt ? new Date((a as any).completedAt).getTime() : 0;
                      const bDate = (b as any).completedAt ? new Date((b as any).completedAt).getTime() : 0;
                      return bDate - aDate;
                    })[0];
                  
                  return (
                    <div
                      key={project.id}
                      className="rounded border border-zinc-200 p-3 dark:border-zinc-700"
                    >
                      <div className="font-medium text-black dark:text-zinc-50">
                        {project.name}
                      </div>
                      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                        {project.baseUrl}
                      </div>
                      {lastCompletedAudit && (lastCompletedAudit as any).completedAt && (
                        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                          Last crawled: {new Date((lastCompletedAudit as any).completedAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  );
                })}
                {projects.length > 5 && (
                  <Link
                    href="/projects"
                    className="block text-center text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    +{projects.length - 5} more projects
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Most Recent Project Section */}
          <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
                Most Recent Project
              </h2>
              {projects.length > 0 && (
                <Link
                  href={`/projects`}
                  className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  View →
                </Link>
              )}
            </div>
            {projects.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No projects yet
              </p>
            ) : (
              (() => {
                const mostRecent = projects[0];
                // Include optimistic audits (those we've optimistically marked as in_progress)
                const activeAudits = mostRecent.audits?.filter((a) => 
                  a.status === 'in_progress' || a.status === 'paused' || optimisticAudits.has(a.id)
                ) || [];
                const pendingApprovalAudits = mostRecent.audits?.filter((a) => 
                  a.status === 'pending_approval'
                ) || [];
                const lastCompletedAudit = mostRecent.audits
                  ?.filter((a) => a.status === 'completed' && (a as any).completedAt)
                  .sort((a, b) => {
                    const aDate = (a as any).completedAt ? new Date((a as any).completedAt).getTime() : 0;
                    const bDate = (b as any).completedAt ? new Date((b as any).completedAt).getTime() : 0;
                    return bDate - aDate;
                  })[0];
                
                return (
                  <div>
                    <div className="mb-3">
                      <h3 className="font-semibold text-black dark:text-zinc-50">
                        {mostRecent.name}
                      </h3>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        {mostRecent.baseUrl}
                      </p>
                    </div>
                    
                    {pendingApprovalAudits.length > 0 ? (
                      <div className="mb-4 space-y-3">
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
                                      fetchData();
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
                    {(() => {
                      // Combine activeAudits from activity state with optimistic audits from project
                      const optimisticAuditsList = mostRecent.audits?.filter(a => optimisticAudits.has(a.id)).map(a => ({
                        ...a,
                        status: 'in_progress' as const,
                        project: { name: mostRecent.name, domain: mostRecent.domain },
                        pagesCrawled: 0,
                        pagesTotal: 0,
                      })) || [];
                      const allActiveAudits = [...activeAudits, ...optimisticAuditsList.filter(a => !activeAudits.some(active => active.id === a.id))];
                      return allActiveAudits.length > 0;
                    })() ? (
                      <div className="space-y-3">
                        {(() => {
                          // Combine activeAudits from activity state with optimistic audits from project
                          const optimisticAuditsList = mostRecent.audits?.filter(a => optimisticAudits.has(a.id)).map(a => ({
                            ...a,
                            status: 'in_progress' as const,
                            project: { name: mostRecent.name, domain: mostRecent.domain },
                            pagesCrawled: 0,
                            pagesTotal: 0,
                          })) || [];
                          return [...activeAudits, ...optimisticAuditsList.filter(a => !activeAudits.some(active => active.id === a.id))];
                        })().map((audit) => (
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
                                        await fetchData(); // Refresh to get actual state
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
                                  className="flex-1 rounded bg-yellow-600 px-2 py-1 text-xs font-semibold text-white hover:bg-yellow-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {actionLoading?.auditId === audit.id && actionLoading?.action === 'pause' ? '⏳...' : '⏸️ Pause'}
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
                                        await fetchData(); // Refresh to get actual state
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
                                  className="flex-1 rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {actionLoading?.auditId === audit.id && actionLoading?.action === 'resume' ? '⏳...' : '▶️ Resume'}
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
                                      await fetchData(); // Refresh to get actual state
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
                                className="flex-1 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {actionLoading?.auditId === audit.id && actionLoading?.action === 'stop' ? '⏳...' : '⏹️ Stop'}
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
                    ) : lastCompletedAudit ? (
                      <div className="rounded border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/20">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-600 dark:text-zinc-400">
                            Last completed: {lastCompletedAudit && (lastCompletedAudit as any).completedAt ? new Date((lastCompletedAudit as any).completedAt).toLocaleDateString() : 'N/A'}
                          </span>
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                            completed
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                          {lastCompletedAudit.pagesCrawled} pages crawled
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        No crawls yet
                      </p>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h3 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Total Pages Crawled
            </h3>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">
              {crawledData.total}
            </div>
            <Link
              href="/crawls"
              className="mt-2 block text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              View All →
            </Link>
          </div>

          <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h3 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Active Crawls
            </h3>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">
              {activity.activeAudits.filter((a) => 
                a.status === 'in_progress' || a.status === 'paused'
              ).length}
            </div>
          </div>

          <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h3 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Total Projects
            </h3>
            <div className="text-3xl font-bold text-black dark:text-zinc-50">
              {projects.length}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
