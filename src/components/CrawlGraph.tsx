'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

// Dynamically import react-force-graph-2d to avoid SSR issues
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
});

interface Node {
  id: string;
  url: string;
  title: string;
  statusCode: number;
  internalLinksCount: number;
  depth: number;
  isRoot: boolean;
  value: number;
  directory?: string;
  color?: string;
}

interface Link {
  source: string | Node;
  target: string | Node;
  id: string;
}

interface GraphData {
  nodes: Node[];
  links: Link[];
  rootId?: string;
}

interface CrawlGraphProps {
  projectId: string;
}

// Generate a large palette of distinct colors (150+ colors)
// Using HSL color space with good distribution
function generateColorPalette(count: number): string[] {
  const colors: string[] = [];
  
  // Generate colors using various strategies for maximum distinction
  for (let i = 0; i < count; i++) {
    // Strategy 1: Use golden ratio for hue distribution (creates visually distinct hues)
    const goldenRatio = 0.618033988749895;
    const hue = (i * goldenRatio * 360) % 360;
    
    // Vary saturation and lightness in patterns for better distinction
    // Create 3 saturation levels and 4 lightness levels = 12 base variations
    const satLevel = Math.floor(i / 12) % 3;
    const lightLevel = (i % 4);
    
    const saturation = 60 + satLevel * 15; // 60, 75, 90
    const lightness = 40 + lightLevel * 8; // 40, 48, 56, 64
    
    colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
  }
  
  return colors;
}

// Pre-generate a large palette
const COLOR_PALETTE = generateColorPalette(150);

// Map a string to a color index (consistent for same string)
function stringToColorIndex(str: string, paletteSize: number): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % paletteSize;
}

// Get color for a directory (ensures same directory always gets same color)
function getColorForDirectory(directory: string): string {
  const index = stringToColorIndex(directory, COLOR_PALETTE.length);
  return COLOR_PALETTE[index];
}

// Extract directory grouping key from URL
// Pages in same subdirectory get grouped together
// Examples: /cost, /cost/france, /cost/srilanka -> all grouped under "/cost"
// /application, /application/a123, /application/321 -> all grouped under "/application"
function extractDirectory(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // If root path, return '/'
    if (pathname === '/' || pathname === '') {
      return '/';
    }
    
    // Remove trailing slash
    const cleanPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    
    // Split path into segments
    const parts = cleanPath.split('/').filter(p => p);
    
    if (parts.length === 0) {
      return '/';
    }
    
    // For grouping: use the first segment as the group
    // So /cost, /cost/france, /cost/srilanka all group under "/cost"
    return '/' + parts[0];
  } catch {
    // If URL parsing fails, try to extract from string
    const match = url.match(/https?:\/\/[^\/]+(\/[^?#]*)/);
    if (match && match[1]) {
      const pathname = match[1];
      const cleanPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      const parts = cleanPath.split('/').filter(p => p);
      if (parts.length === 0) return '/';
      return '/' + parts[0];
    }
    return '/';
  }
}

export default function CrawlGraph({ projectId }: CrawlGraphProps) {
  const router = useRouter();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fgRef = useRef<any>(null);
  const hasCenteredRef = useRef(false);

  useEffect(() => {
    fetchGraphData();
  }, [projectId]);


  const fetchGraphData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/projects/${projectId}/graph`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch graph data');
      }
      
      const data = await response.json();
      
      // Collect all unique directories
      const directories = new Set<string>();
      data.nodes.forEach((node: Node) => {
        const directory = extractDirectory(node.url);
        directories.add(directory);
      });
      
      // Assign unique colors to each directory from the palette
      // Use a Set to track used color indices to avoid duplicates
      const directoryColorMap = new Map<string, string>();
      const usedColorIndices = new Set<number>();
      const sortedDirs = Array.from(directories).sort();
      
      sortedDirs.forEach((dir) => {
        // Get the color index for this directory
        let colorIndex = stringToColorIndex(dir, COLOR_PALETTE.length);
        
        // If this color index is already used by a different directory, find the next available one
        // This ensures each directory gets a unique color
        let attempts = 0;
        while (usedColorIndices.has(colorIndex) && attempts < COLOR_PALETTE.length) {
          colorIndex = (colorIndex + 1) % COLOR_PALETTE.length;
          attempts++;
        }
        
        // If we've exhausted the palette (unlikely with 150 colors), just use the hash-based index
        // In practice, this should never happen with reasonable numbers of directories
        usedColorIndices.add(colorIndex);
        directoryColorMap.set(dir, COLOR_PALETTE[colorIndex]);
      });
      
      // Add directory and color information to nodes
      const nodesWithDirectory = data.nodes.map((node: Node) => {
        const directory = extractDirectory(node.url);
        const color = directoryColorMap.get(directory) || COLOR_PALETTE[0]; // Fallback to first color
        return {
          ...node,
          directory,
          color,
        };
      });
      
      setGraphData({
        ...data,
        nodes: nodesWithDirectory,
      });
      
      // Reset centering flag when new data is loaded
      hasCenteredRef.current = false;
    } catch (err) {
      console.error('Error fetching graph data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="text-zinc-600 dark:text-zinc-400">Loading graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="text-center">
          <p className="mb-4 text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={fetchGraphData}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="text-center">
          <p className="text-zinc-600 dark:text-zinc-400">
            No crawled pages found. Start a crawl to see the graph visualization.
          </p>
        </div>
      </div>
    );
  }

  // Group nodes by directory
  const directoryGroups = new Map<string, Node[]>();
  graphData.nodes.forEach(node => {
    const dir = node.directory || '/';
    if (!directoryGroups.has(dir)) {
      directoryGroups.set(dir, []);
    }
    directoryGroups.get(dir)!.push(node);
  });

  // Prepare graph data with grouping
  const hasLinks = graphData.links.length > 0;
  const rootNode = graphData.nodes.find(n => n.id === graphData.rootId) || graphData.nodes[0];
  
  const graphDataForRender = {
    nodes: graphData.nodes.map((node, index) => {
      // Always pin root at center
      if (node.isRoot || node.id === graphData.rootId || node.id === rootNode?.id) {
        return { ...node, fx: 0, fy: 0 };
      }
      
      // If no links, arrange nodes by directory groups
      if (!hasLinks) {
        const dir = node.directory || '/';
        const groupNodes = directoryGroups.get(dir) || [node];
        const groupIndex = groupNodes.indexOf(node);
        const groupSize = groupNodes.length;
        
        // Calculate angle based on directory and position within directory
        // Each directory gets a slice of the circle
        const directories = Array.from(directoryGroups.keys()).sort();
        const dirIndex = directories.indexOf(dir);
        const dirCount = directories.length;
        
        // Base angle for this directory's slice
        const dirAngleStart = (dirIndex * 2 * Math.PI) / dirCount;
        const dirAngleRange = (2 * Math.PI) / dirCount;
        
        // Position within the directory's slice
        const angleInSlice = groupSize > 1 
          ? (groupIndex / (groupSize - 1)) * dirAngleRange * 0.8 + dirAngleRange * 0.1
          : dirAngleRange * 0.5;
        
        const angle = dirAngleStart + angleInSlice;
        const radius = 250;
        
        return {
          ...node,
          fx: Math.cos(angle) * radius,
          fy: Math.sin(angle) * radius,
        };
      }
      
      // With links, let force simulation position nodes
      return node;
    }),
    links: graphData.links,
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      {/* Controls */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="flex items-center gap-4">
          <h3 className="font-semibold text-black dark:text-zinc-50">
            Crawled Pages Graph
          </h3>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {graphData.nodes.length} pages, {graphData.links.length} links
          </span>
          {graphData.rootId && (
            <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              Root: {rootNode.title?.substring(0, 35) || 'Homepage'}...
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fgRef.current?.zoomToFit(400, 20)}
            className="rounded bg-zinc-100 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            title="Fit to screen"
          >
            Fit
          </button>
          <button
            onClick={() => {
              if (fgRef.current) {
                fgRef.current.zoom(1.5);
              }
            }}
            className="rounded bg-zinc-100 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => {
              if (fgRef.current) {
                fgRef.current.zoom(0.75);
              }
            }}
            className="rounded bg-zinc-100 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            title="Zoom out"
          >
            −
          </button>
        </div>
      </div>

      {/* Graph */}
      <div className="relative h-[600px] w-full overflow-hidden bg-zinc-50 dark:bg-zinc-950">
        <ForceGraph2D
          ref={fgRef}
          graphData={graphDataForRender}
          nodeLabel={(node: Node) => {
            const title = node.title || node.url;
            const shortTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;
            const shortUrl = node.url.length > 60 ? node.url.substring(0, 60) + '...' : node.url;
            return `
              <div style="background: rgba(0, 0, 0, 0.9); color: white; padding: 10px 12px; border-radius: 6px; border: 1px solid #374151; max-width: 320px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
                <div style="font-weight: 600; margin-bottom: 6px; font-size: 13px; color: #f9fafb;">${shortTitle}</div>
                <div style="font-size: 11px; color: #d1d5db; word-break: break-all; margin-bottom: 6px;">${shortUrl}</div>
                <div style="font-size: 10px; color: #9ca3af; border-top: 1px solid #374151; padding-top: 6px; margin-top: 6px;">
                  Directory: ${node.directory || '/'} | Links: ${node.internalLinksCount}
                  ${node.isRoot ? ' | <span style="color: #60a5fa;">ROOT</span>' : ''}
                </div>
              </div>
            `;
          }}
          nodeVal={(node: Node) => {
            if (node.isRoot) return 20;
            return Math.max(8, Math.min(16, 8 + (node.internalLinksCount / 5)));
          }}
          linkColor={() => 'rgba(107, 114, 128, 0.5)'}
          linkWidth={1.5}
          linkDirectionalArrowLength={6}
          linkDirectionalArrowRelPos={1}
          cooldownTicks={150}
          onEngineStop={() => {
            // Only center once on initial load, not on every engine stop
            // This prevents the graph from auto-centering when user is panning/zooming
            if (!hasCenteredRef.current && fgRef.current && graphData && graphData.nodes.length > 0) {
              hasCenteredRef.current = true;
              // Wait for the simulation to fully settle
              setTimeout(() => {
                if (fgRef.current) {
                  // Use zoomToFit with very large padding to zoom out and show all nodes
                  // This will center the view and fit all nodes
                  fgRef.current.zoomToFit(500, 250);
                }
              }, 600);
            }
          }}
          onNodeHover={(node) => {
            if (node) {
              document.body.style.cursor = 'pointer';
            } else {
              document.body.style.cursor = 'default';
            }
          }}
          onNodeClick={(node: Node) => {
            if (node && node.id) {
              router.push(`/crawls/${node.id}`);
            }
          }}
          nodeCanvasObject={(node: Node & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const label = node.title || node.url;
            const fontSize = node.isRoot ? 11 : 9;
            const nodeSize = node.isRoot ? 20 : Math.max(8, Math.min(16, 8 + (node.internalLinksCount / 5)));
            
            // Get node color (should already be set, but fallback if needed)
            const nodeColor = node.color || getColorForDirectory(node.directory || extractDirectory(node.url || ''));
            
            // Draw the colored circle
            ctx.beginPath();
            ctx.arc(node.x || 0, node.y || 0, nodeSize, 0, 2 * Math.PI, false);
            ctx.fillStyle = nodeColor;
            ctx.fill();
            
            // Add stroke for root node
            if (node.isRoot) {
              ctx.strokeStyle = '#1f2937';
              ctx.lineWidth = 3;
              ctx.stroke();
            }
            
            // Draw white text on the node when zoomed in enough
            if (globalScale > 0.6) {
              const text = label.length > 18 ? label.substring(0, 18) + '...' : label;
              ctx.font = `${node.isRoot ? 'bold ' : ''}${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              
              // Add text stroke for better visibility
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
              ctx.lineWidth = 4;
              ctx.strokeText(text, node.x || 0, node.y || 0);
              
              ctx.fillStyle = '#ffffff';
              ctx.fillText(text, node.x || 0, node.y || 0);
            }
          }}
          d3Force={{
            charge: { strength: -400 },
            link: { distance: 100 },
            center: { strength: 0.1 },
            collision: { strength: 0.9, radius: (node: Node) => node.isRoot ? 35 : 25 },
          }}
          enableZoomInteraction={true}
          enablePanInteraction={true}
        />
      </div>

      {/* Legend */}
      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Nodes are colored by directory path</span>
          <div className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
            Click nodes to view details • Drag to pan • Scroll to zoom
          </div>
        </div>
      </div>
    </div>
  );
}
