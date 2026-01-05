/**
 * Search Engine Query Module
 * Queries Google/Bing to discover pages that link to a target URL
 * Uses the "link:" operator to find backlinks
 * 
 * Features:
 * - Proxy rotation and management
 * - CAPTCHA detection and handling
 * - Rate limiting and retry logic
 */

import { fetchWithProxy } from './proxy-fetch';
import { getProxyManager } from './proxy-manager';
import { getBrowserHeaders } from './browser-headers';
import { getCaptchaSolver, extractReCaptchaSiteKey } from './captcha-solver';

interface SearchResult {
  url: string;
  title: string | null;
  snippet: string | null;
}

/**
 * Query Google Custom Search API to find pages that link to a target URL
 * Uses the "link:" operator: link:example.com (domain/subdomain only, no subdirectories)
 * 
 * Requires:
 * - GOOGLE_API_KEY: Your Google API key
 * - GOOGLE_CUSTOM_SEARCH_ENGINE_ID: Your Custom Search Engine ID (CX)
 */
export async function queryGoogleBacklinks(
  targetUrl: string,
  maxResults: number = 100,
  auditId?: string // Optional auditId for logging
): Promise<SearchResult[]> {
  try {
    // Check for required environment variables
    const apiKey = process.env.GOOGLE_API_KEY;
    const searchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;
    
    if (!apiKey) {
      const errorMsg = 'GOOGLE_API_KEY environment variable is not set';
      console.error(`[Search] ${errorMsg}`);
      if (auditId) {
        const { addAuditLog } = await import('./audit-logs');
        addAuditLog(auditId, 'backlink-discovery', `❌ ${errorMsg}`, {
          targetUrl,
          searchEngine: 'google',
          error: errorMsg,
        });
      }
      return [];
    }
    
    if (!searchEngineId) {
      const errorMsg = 'GOOGLE_CUSTOM_SEARCH_ENGINE_ID environment variable is not set';
      console.error(`[Search] ${errorMsg}`);
      if (auditId) {
        const { addAuditLog } = await import('./audit-logs');
        addAuditLog(auditId, 'backlink-discovery', `❌ ${errorMsg}`, {
          targetUrl,
          searchEngine: 'google',
          error: errorMsg,
        });
      }
      return [];
    }
    
    // Extract domain/subdomain only (no subdirectories)
    const urlObj = new URL(targetUrl);
    const domain = urlObj.hostname.replace(/^www\./, '');
    
    // Build search query: link:domain.com (domain and subdomain only, no paths)
    // This will match both domain.com and subdomain.domain.com, but not domain.com/path
    const query = `link:${domain}`;
    
    const allResults: SearchResult[] = [];
    const seenUrls = new Set<string>();
    
    // Log start of Google search
    if (auditId) {
      const { addAuditLog } = await import('./audit-logs');
      addAuditLog(auditId, 'backlink-discovery', `🔍 Querying Google Custom Search API for backlinks to: ${targetUrl} (domain: ${domain})`, {
        targetUrl,
        domain,
        searchEngine: 'google',
        query,
        method: 'api',
      });
    }
    
    // Google Custom Search API endpoint
    const apiUrl = 'https://www.googleapis.com/customsearch/v1';
    const resultsPerPage = 10; // Google API max is 10 per request
    let startIndex = 1;
    let totalResults = 0;
    let hasMoreResults = true;
    
    while (hasMoreResults && allResults.length < maxResults) {
      try {
        // Build API request URL
        const params = new URLSearchParams({
          key: apiKey,
          cx: searchEngineId,
          q: query,
          num: resultsPerPage.toString(),
          start: startIndex.toString(),
        });
        
        const requestUrl = `${apiUrl}?${params.toString()}`;
        
        if (auditId && startIndex === 1) {
          const { addAuditLog } = await import('./audit-logs');
          addAuditLog(auditId, 'backlink-discovery', `📡 Google API query: "${query}" (page ${Math.floor((startIndex - 1) / resultsPerPage) + 1})`, {
            query,
            searchEngine: 'google',
            method: 'api',
            page: Math.floor((startIndex - 1) / resultsPerPage) + 1,
          });
        }
        
        // Make API request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        let response: Response;
        let data: any;
        
        try {
          response = await fetch(requestUrl, {
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
            },
          });
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            const errorText = await response.text();
            let errorData: any;
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { error: { message: errorText } };
            }
            
            const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
            console.error(`[Search] Google API error: ${errorMsg}`);
            
            if (auditId) {
              const { addAuditLog } = await import('./audit-logs');
              addAuditLog(auditId, 'backlink-discovery', `❌ Google API error: ${errorMsg}`, {
                query,
                searchEngine: 'google',
                method: 'api',
                status: response.status,
                error: errorMsg,
                errorDetails: errorData.error,
              });
            }
            
            // If it's a rate limit or quota error, throw special error for fallback
            const isQuotaError = errorMsg.includes('Quota exceeded') || 
                               errorMsg.includes('quota') || 
                               response.status === 429 ||
                               errorData.error?.code === 429;
            
            if (isQuotaError) {
              const quotaError = new Error(`Google API quota exceeded: ${errorMsg}`);
              (quotaError as any).isQuotaError = true;
              throw quotaError;
            }
            
            // For other 403/429 errors, stop trying
            if (response.status === 429 || errorData.error?.code === 429 || errorData.error?.code === 403) {
              break;
            }
            
            // For other errors, try next page or stop
            hasMoreResults = false;
            continue;
          }
          
          data = await response.json();
          
        } catch (fetchError) {
          clearTimeout(timeoutId);
          const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
          console.error(`[Search] Error fetching Google API: ${errorMsg}`);
          
          if (auditId) {
            const { addAuditLog } = await import('./audit-logs');
            addAuditLog(auditId, 'backlink-discovery', `❌ Google API request failed: ${errorMsg}`, {
              query,
              searchEngine: 'google',
              method: 'api',
              error: errorMsg,
            });
          }
          
          hasMoreResults = false;
          continue;
        }
        
        // Parse API response
        if (data.error) {
          const errorMsg = data.error.message || 'Unknown API error';
          const errorCode = data.error.code;
          const isQuotaError = errorMsg.includes('Quota exceeded') || 
                               errorMsg.includes('quota') || 
                               errorCode === 429 ||
                               response.status === 429;
          
          console.error(`[Search] Google API returned error: ${errorMsg}`);
          
          if (auditId) {
            const { addAuditLog } = await import('./audit-logs');
            const logMsg = isQuotaError 
              ? `⚠️ Google API quota exceeded (10,000/day limit). Will fallback to Bing. Error: ${errorMsg}`
              : `❌ Google API error: ${errorMsg}`;
            
            addAuditLog(auditId, 'backlink-discovery', logMsg, {
              query,
              searchEngine: 'google',
              method: 'api',
              error: errorMsg,
              errorCode: errorCode,
              quotaExceeded: isQuotaError,
            });
          }
          
          // If quota exceeded, throw a special error so caller can fallback to Bing
          if (isQuotaError) {
            const quotaError = new Error(`Google API quota exceeded: ${errorMsg}`);
            (quotaError as any).isQuotaError = true;
            throw quotaError;
          }
          
          hasMoreResults = false;
          continue;
        }
        
        // Extract results from API response
        const items = data.items || [];
        totalResults = parseInt(data.searchInformation?.totalResults || '0', 10);
        
        // Convert API results to SearchResult format
        for (const item of items) {
          if (allResults.length >= maxResults) {
            break;
          }
          
          const url = item.link;
          if (!url || seenUrls.has(url)) {
            continue;
          }
          
          seenUrls.add(url);
          allResults.push({
            url,
            title: item.title || null,
            snippet: item.snippet || item.htmlSnippet || null,
          });
        }
        
        // Check if there are more results
        const nextStartIndex = data.queries?.request?.[0]?.startIndex || startIndex;
        const count = data.queries?.request?.[0]?.count || items.length;
        const nextPageStart = nextStartIndex + count;
        
        if (items.length === 0 || nextPageStart > totalResults || allResults.length >= maxResults) {
          hasMoreResults = false;
        } else {
          startIndex = nextPageStart;
          // Rate limiting: wait 1 second between API calls (Google allows 100 queries/day free, 10,000/day paid)
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Log progress
        if (auditId && items.length > 0) {
          const { addAuditLog } = await import('./audit-logs');
          addAuditLog(auditId, 'backlink-discovery', `✅ Google API found ${items.length} result(s) on page ${Math.floor((startIndex - count - 1) / resultsPerPage) + 1} (total so far: ${allResults.length})`, {
            query,
            searchEngine: 'google',
            method: 'api',
            pageResults: items.length,
            totalSoFar: allResults.length,
            totalAvailable: totalResults,
          });
        }
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Search] Error querying Google API: ${errorMsg}`);
        if (auditId) {
          const { addAuditLog } = await import('./audit-logs');
          addAuditLog(auditId, 'backlink-discovery', `❌ Google API query error: ${errorMsg}`, {
            query,
            error: errorMsg,
            searchEngine: 'google',
            method: 'api',
            errorType: error instanceof Error ? error.constructor.name : 'Unknown',
          });
        }
        hasMoreResults = false;
      }
    }
    
    // Log final summary
    if (auditId) {
      const { addAuditLog } = await import('./audit-logs');
      addAuditLog(auditId, 'backlink-discovery', `📊 Google Custom Search API complete: Found ${allResults.length} unique result(s) for ${targetUrl} (domain: ${domain})`, {
        targetUrl,
        domain,
        totalResults: allResults.length,
        searchEngine: 'google',
        method: 'api',
      });
    }
    
    return allResults.slice(0, maxResults);
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Search] Error querying Google backlinks for ${targetUrl}:`, error);
    if (auditId) {
      const { addAuditLog } = await import('./audit-logs');
      addAuditLog(auditId, 'backlink-discovery', `❌ Google search failed for ${targetUrl}: ${errorMsg}`, {
        targetUrl,
        error: errorMsg,
        searchEngine: 'google',
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
      });
    }
    return [];
  }
}

/**
 * Parse Google search results HTML
 * Extracts URLs, titles, and snippets from Google's HTML
 * 
 * Note: Google's HTML structure may change - this is a basic parser
 */
function parseGoogleResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  
  try {
    // Google search results are in <div class="g"> containers
    // Each result has:
    // - Link: <a href="...">
    // - Title: <h3>...</h3>
    // - Snippet: <span>...</span>
    
    // Use regex to extract results (basic approach)
    // More robust would use a proper HTML parser like cheerio
    const resultPattern = /<div[^>]*class="[^"]*g[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
    const matches = html.matchAll(resultPattern);
    
    for (const match of matches) {
      const resultHtml = match[1];
      
      // Extract URL from href
      const urlMatch = resultHtml.match(/href="([^"]+)"/);
      if (!urlMatch) continue;
      
      let url = urlMatch[1];
      // Google adds redirect URLs, extract actual URL
      if (url.startsWith('/url?q=')) {
        const decoded = decodeURIComponent(url.split('&')[0].replace('/url?q=', ''));
        url = decoded;
      }
      
      // Extract title (use [\s\S] instead of . with s flag for ES2017 compatibility)
      const titleMatch = resultHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      const title = titleMatch ? stripHtmlTags(titleMatch[1]) : null;
      
      // Extract snippet
      const snippetMatch = resultHtml.match(/<span[^>]*class="[^"]*[Ss]nippet[^"]*"[^>]*>([\s\S]*?)<\/span>/);
      const snippet = snippetMatch ? stripHtmlTags(snippetMatch[1]) : null;
      
      // Validate URL
      try {
        new URL(url);
        results.push({ url, title, snippet });
      } catch {
        // Invalid URL, skip
        continue;
      }
    }
    
  } catch (error) {
    console.error('[Search] Error parsing Google results:', error);
  }
  
  return results;
}

/**
 * Strip HTML tags from text
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Query Bing to find pages that link to a target URL
 * Alternative to Google if Google blocks queries
 */
export async function queryBingBacklinks(
  targetUrl: string,
  maxResults: number = 100,
  auditId?: string // Optional auditId for logging
): Promise<SearchResult[]> {
  try {
    const urlObj = new URL(targetUrl);
    const domain = urlObj.hostname.replace(/^www\./, '');
    const path = urlObj.pathname;
    
    const query = `link:${domain}${path}`;
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=100`;
    
    // Log start of Bing search
    if (auditId) {
      const { addAuditLog } = await import('./audit-logs');
      addAuditLog(auditId, 'backlink-discovery', `🔍 Querying Bing for backlinks to: ${targetUrl}`, {
        targetUrl,
        searchEngine: 'bing',
        query,
      });
    }
    
    if (auditId) {
      const { addAuditLog } = await import('./audit-logs');
      addAuditLog(auditId, 'backlink-discovery', `📡 Bing query: "${query}"`, {
        query,
        searchUrl,
        searchEngine: 'bing',
      });
    }
    
    // Use proxy-aware fetch with CAPTCHA detection
    const { response, html, captchaDetection, proxyUsed } = await fetchWithProxy(searchUrl, {
      retries: 3,
      retryDelay: 3000,
      timeout: 45000, // 45 second timeout for slow/blocked sites
      aggressiveRetry: true, // Try all proxies if one fails
      minDelayBetweenRetries: 2000, // 2 second minimum delay
    });
    
    // Log proxy usage immediately
    if (proxyUsed && auditId) {
      const { addAuditLog } = await import('./audit-logs');
      const proxyInfo = `${proxyUsed.host}:${proxyUsed.port}`;
      const status = response.ok ? '✅' : '❌';
      const statusText = response.ok 
        ? (captchaDetection?.isCaptcha ? 'succeeded (but CAPTCHA detected)' : 'succeeded')
        : `failed (HTTP ${response.status})`;
      addAuditLog(auditId, 'backlink-discovery', `${status} Proxy ${proxyInfo} ${statusText} for Bing query: "${query}"`, {
        query,
        proxy: proxyInfo,
        searchEngine: 'bing',
        httpStatus: response.status,
        proxySuccess: response.ok,
        captchaDetected: captchaDetection?.isCaptcha || false,
      } as any);
    }
    
    // Handle CAPTCHA detection
    if (captchaDetection?.isCaptcha) {
      const captchaMsg = `CAPTCHA detected (${captchaDetection.captchaType}, confidence: ${captchaDetection.confidence})`;
      console.warn(`[Search] ${captchaMsg} for query: "${query}"`);
      
      // Try to solve CAPTCHA if solver is configured
      const captchaSolver = getCaptchaSolver();
      let captchaSolved = false;
      
      if (captchaDetection.captchaType === 'google-recaptcha' && captchaSolver) {
        try {
          const siteKey = extractReCaptchaSiteKey(html);
          if (siteKey) {
            if (auditId) {
              const { addAuditLog } = await import('./audit-logs');
              addAuditLog(auditId, 'backlink-discovery', `🔧 Attempting to solve CAPTCHA for Bing query: "${query}"`, {
                query,
                captchaType: captchaDetection.captchaType,
                searchEngine: 'bing',
                solving: true,
              } as any);
            }
            
            console.log(`[Search] Attempting to solve reCAPTCHA for Bing query: "${query}"`);
            const solveResult = await captchaSolver.solve(siteKey, searchUrl);
            
            if (solveResult.success && solveResult.token) {
              console.log(`[Search] ✅ CAPTCHA solved successfully for Bing query: "${query}"`);
              if (auditId) {
                const { addAuditLog } = await import('./audit-logs');
                addAuditLog(auditId, 'backlink-discovery', `✅ CAPTCHA solved successfully for Bing query: "${query}"`, {
                  query,
                  captchaType: captchaDetection.captchaType,
                  searchEngine: 'bing',
                  solved: true,
                } as any);
              }
              captchaSolved = true;
            } else {
              console.warn(`[Search] ⚠️ CAPTCHA solving failed: ${solveResult.error}`);
              if (auditId) {
                const { addAuditLog } = await import('./audit-logs');
                addAuditLog(auditId, 'backlink-discovery', `⚠️ CAPTCHA solving failed for Bing query: "${query}": ${solveResult.error}`, {
                  query,
                  captchaType: captchaDetection.captchaType,
                  searchEngine: 'bing',
                  solved: false,
                  error: solveResult.error,
                } as any);
              }
            }
          }
        } catch (solveError) {
          console.error(`[Search] Error solving CAPTCHA:`, solveError);
        }
      }
      
      if (auditId) {
        const { addAuditLog } = await import('./audit-logs');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        addAuditLog(auditId, 'backlink-discovery', `🛡️ ${captchaMsg}${captchaSolved ? ' (solved)' : ''} for query: "${query}"`, {
          query,
          captchaType: captchaDetection.captchaType || 'unknown',
          confidence: captchaDetection.confidence,
          indicators: captchaDetection.indicators,
          searchEngine: 'bing',
          proxyUsed: proxyUsed ? `${proxyUsed.host}:${proxyUsed.port}` : null,
          captchaSolved,
          error: true,
        } as any);
      }
      return [];
    }
    
    if (!response.ok) {
      const errorMsg = `Bing query failed: HTTP ${response.status}`;
      console.warn(`[Search] ${errorMsg}`);
      if (auditId) {
        const { addAuditLog } = await import('./audit-logs');
        addAuditLog(auditId, 'backlink-discovery', `⚠️ ${errorMsg} for query: "${query}"`, {
          query,
          status: response.status,
          searchEngine: 'bing',
          proxyUsed: proxyUsed ? `${proxyUsed.host}:${proxyUsed.port}` : null,
          error: true,
        });
      }
      return [];
    }
    
    const results = parseBingResults(html);
    
    // Log results found
    if (auditId) {
      const { addAuditLog } = await import('./audit-logs');
      addAuditLog(auditId, 'backlink-discovery', `📊 Bing search complete: Found ${results.length} result(s) for ${targetUrl}`, {
        targetUrl,
        totalResults: results.length,
        searchEngine: 'bing',
      });
    }
    
    return results;
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Search] Error querying Bing backlinks for ${targetUrl}:`, error);
    if (auditId) {
      const { addAuditLog } = await import('./audit-logs');
      addAuditLog(auditId, 'backlink-discovery', `❌ Bing search failed for ${targetUrl}: ${errorMsg}`, {
        targetUrl,
        error: errorMsg,
        searchEngine: 'bing',
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
      });
    }
    return [];
  }
}

/**
 * Parse Bing search results HTML
 */
function parseBingResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  
  try {
    // Bing results are in <li class="b_algo"> containers
    const resultPattern = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
    const matches = html.matchAll(resultPattern);
    
    for (const match of matches) {
      const resultHtml = match[1];
      
      // Extract URL
      const urlMatch = resultHtml.match(/href="([^"]+)"/);
      if (!urlMatch) continue;
      const url = urlMatch[1];
      
      // Extract title (use [\s\S] instead of . with s flag for ES2017 compatibility)
      const titleMatch = resultHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
      const title = titleMatch ? stripHtmlTags(titleMatch[1]) : null;
      
      // Extract snippet
      const snippetMatch = resultHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const snippet = snippetMatch ? stripHtmlTags(snippetMatch[1]) : null;
      
      try {
        new URL(url);
        results.push({ url, title, snippet });
      } catch {
        continue;
      }
    }
    
  } catch (error) {
    console.error('[Search] Error parsing Bing results:', error);
  }
  
  return results;
}

/**
 * Query multiple search engines and combine results
 * Tries Google first, falls back to Bing if needed
 */
export async function discoverBacklinkSources(
  targetUrl: string,
  maxResults: number = 100
): Promise<SearchResult[]> {
  const allResults: SearchResult[] = [];
  const seenUrls = new Set<string>();
  
  // Try Google first
  try {
    const googleResults = await queryGoogleBacklinks(targetUrl, maxResults);
    for (const result of googleResults) {
      if (!seenUrls.has(result.url)) {
        seenUrls.add(result.url);
        allResults.push(result);
      }
    }
  } catch (error) {
    console.warn('[Search] Google query failed, trying Bing:', error);
  }
  
  // If we need more results, try Bing
  if (allResults.length < maxResults) {
    try {
      const bingResults = await queryBingBacklinks(targetUrl, maxResults - allResults.length);
      for (const result of bingResults) {
        if (!seenUrls.has(result.url)) {
          seenUrls.add(result.url);
          allResults.push(result);
        }
      }
    } catch (error) {
      console.warn('[Search] Bing query failed:', error);
    }
  }
  
  return allResults.slice(0, maxResults);
}

