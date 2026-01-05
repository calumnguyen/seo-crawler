import robotsParser from 'robots-parser';

export interface RobotsTxtData {
  isAllowed: (url: string) => boolean;
  getCrawlDelay: () => number | null;
  getSitemaps: () => string[];
}

const robotsCache = new Map<string, { data: RobotsTxtData; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function getRobotsTxt(
  baseUrl: string,
  userAgent: string = 'SEO-Crawler/1.0'
): Promise<RobotsTxtData> {
  try {
    const url = new URL(baseUrl);
    const robotsTxtUrl = `${url.protocol}//${url.host}/robots.txt`;
    const cacheKey = `${robotsTxtUrl}:${userAgent}`;

    // Check cache
    const cached = robotsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    // Use proxy-aware fetch with "direct first, proxy on failure" strategy
    const { fetchWithProxy } = await import('./proxy-fetch');
    const { getProxyManager } = await import('./proxy-manager');
    const { getSimpleHeaders } = await import('./browser-headers');
    const proxyManager = getProxyManager();
    const hasProxies = proxyManager.hasProxies();

    let response: Response;
    const timeout = 15000; // 15 second timeout for direct connection

    // Try direct connection first (save proxy bandwidth)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        const browserHeaders = getSimpleHeaders();
        response = await fetch(robotsTxtUrl, {
          headers: {
            ...browserHeaders,
            'User-Agent': userAgent, // Override with provided userAgent
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (directError) {
        clearTimeout(timeoutId);
        
        // Check if it's a timeout or connection error (likely IP blocked)
        const isTimeout = directError instanceof Error && (
          directError.name === 'AbortError' ||
          directError.message.includes('timeout') ||
          directError.message.includes('aborted') ||
          directError.message.includes('ECONNRESET') ||
          directError.message.includes('ECONNREFUSED')
        );
        
        // If timeout/error and proxies available, retry with proxy
        if (isTimeout && hasProxies) {
          const result = await fetchWithProxy(robotsTxtUrl, {
            headers: {
              'User-Agent': userAgent,
            },
            retries: 3,
            retryDelay: 2000,
            timeout: 45000, // 45 second timeout for slow/blocked sites
            aggressiveRetry: true, // Try all proxies if one fails
            minDelayBetweenRetries: 2000,
          });
          response = result.response;
        } else {
          throw directError;
        }
      }
    } catch (error) {
      // Final fallback: try proxy if available
      if (hasProxies) {
        const result = await fetchWithProxy(robotsTxtUrl, {
          headers: {
            'User-Agent': userAgent,
          },
          retries: 3,
          retryDelay: 2000,
          timeout: 45000,
          aggressiveRetry: true,
          minDelayBetweenRetries: 2000,
        });
        response = result.response;
      } else {
        throw error;
      }
    }

    let robotsContent = '';
    if (response.ok) {
      robotsContent = await response.text();
      console.log(`[Robots] ✅ Fetched robots.txt from ${robotsTxtUrl} (${robotsContent.length} bytes)`);
    } else if (response.status === 404) {
      // No robots.txt - log and allow all
      console.log(`[Robots] ⚠️  robots.txt not found at ${robotsTxtUrl} (404) - allowing all`);
      robotsContent = 'User-agent: *\nAllow: /';
    } else {
      // Error fetching - log error but allow all (fail open)
      console.log(`[Robots] ⚠️  Error fetching robots.txt from ${robotsTxtUrl}: ${response.status} ${response.statusText} - allowing all`);
      robotsContent = 'User-agent: *\nAllow: /';
    }

    // Parse robots.txt
    const robots = robotsParser(robotsTxtUrl, robotsContent);

    const data: RobotsTxtData = {
      isAllowed: (url: string) => {
        try {
          // Extract path from URL for checking
          let urlPath: string;
          try {
            const urlObj = new URL(url);
            urlPath = urlObj.pathname;
          } catch {
            // If URL parsing fails, do basic check
            const allowed = robots.isAllowed(url, userAgent);
            if (allowed === false) {
              console.log(`[Robots] 🚫 Disallowed: ${url}`);
            }
            return allowed ?? true;
          }
          
          // CRITICAL: Check exact path first (with and without trailing slash)
          // This catches rules like "Disallow: /applications/" which should match both
          // "/applications" and "/applications/"
          const exactCheck = robots.isAllowed(url, userAgent);
          const pathWithSlash = urlPath.endsWith('/') ? urlPath : urlPath + '/';
          const pathWithoutSlash = urlPath.endsWith('/') ? urlPath.slice(0, -1) : urlPath;
          
          // Build URLs with both slash variants
          const urlWithSlash = url.replace(urlPath, pathWithSlash);
          const urlWithoutSlash = url.replace(urlPath, pathWithoutSlash);
          
          const checkWithSlash = robots.isAllowed(urlWithSlash, userAgent);
          const checkWithoutSlash = robots.isAllowed(urlWithoutSlash, userAgent);
          
          // If ANY variant is explicitly disallowed, disallow
          if (exactCheck === false || checkWithSlash === false || checkWithoutSlash === false) {
            console.log(`[Robots] 🚫 Disallowed: ${url} (exact: ${exactCheck}, withSlash: ${checkWithSlash}, withoutSlash: ${checkWithoutSlash})`);
            return false;
          }
          
          // CRITICAL: Check parent path for subdirectory rules
          // Rule: If parent path is disallowed, subdirectories are also disallowed
          if (urlPath.includes('/') && urlPath !== '/') {
            const pathSegments = urlPath.split('/').filter(s => s);
            if (pathSegments.length > 1) {
              // Check parent path (e.g., for /check-requirement/slug, check /check-requirement)
              const parentPath = '/' + pathSegments.slice(0, -1).join('/');
              const parentUrl = url.replace(urlPath, parentPath);
              
              // Check parent path with and without trailing slash
              const parentWithSlash = parentPath.endsWith('/') ? parentPath : parentPath + '/';
              const parentWithoutSlash = parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath;
              
              const parentUrlWithSlash = url.replace(urlPath, parentWithSlash);
              const parentUrlWithoutSlash = url.replace(urlPath, parentWithoutSlash);
              
              // Check parent variants
              const parentAllowed = robots.isAllowed(parentUrl, userAgent);
              const parentWithSlashAllowed = robots.isAllowed(parentUrlWithSlash, userAgent);
              const parentWithoutSlashAllowed = robots.isAllowed(parentUrlWithoutSlash, userAgent);
              
              // If ANY parent variant is explicitly disallowed, disallow subdirectory
              if (parentAllowed === false || parentWithSlashAllowed === false || parentWithoutSlashAllowed === false) {
                console.log(`[Robots] 🚫 Disallowed (parent path): ${url} (parent ${parentPath} is disallowed)`);
                return false;
              }
            }
          }
          
          // If we get here, the URL is allowed
          // Only log if it was initially questionable (for debugging)
          if (exactCheck === undefined) {
            console.log(`[Robots] ✅ Allowed (undefined check, defaulting to allow): ${url}`);
          }
          
          return true;
        } catch (error) {
          console.error(`[Robots] Error checking if ${url} is allowed:`, error);
          return true; // Fail open
        }
      },
      getCrawlDelay: () => {
        try {
          return robots.getCrawlDelay(userAgent) ?? null;
        } catch {
          return null;
        }
      },
      getSitemaps: () => {
        try {
          return robots.getSitemaps() ?? [];
        } catch {
          return [];
        }
      },
    };

    // Cache the result
    robotsCache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data;
  } catch (error) {
    console.error(`[Robots] ❌ Error fetching robots.txt for ${baseUrl}:`, error);
    // Return permissive default on error, but log it
    return {
      isAllowed: () => {
        console.log(`[Robots] ⚠️  Allowing ${baseUrl} (robots.txt fetch failed)`);
        return true;
      },
      getCrawlDelay: () => null,
      getSitemaps: () => [],
    };
  }
}

export function normalizeUrl(url: string, baseUrl?: string): string {
  try {
    const urlObj = new URL(url, baseUrl);
    
    // Remove default ports
    if (urlObj.port === '80' || urlObj.port === '443') {
      urlObj.port = '';
    }
    
    // Remove trailing slash (except for root)
    if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    
    // Remove fragment
    urlObj.hash = '';
    
    // Sort query parameters
    if (urlObj.search) {
      const params = new URLSearchParams(urlObj.search);
      const sortedParams = new URLSearchParams();
      Array.from(params.keys())
        .sort()
        .forEach((key) => {
          sortedParams.set(key, params.get(key)!);
        });
      urlObj.search = sortedParams.toString();
    }
    
    return urlObj.toString();
  } catch {
    return url;
  }
}

