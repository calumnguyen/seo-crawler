/**
 * Search Engine Query Module
 * Queries Google/Bing to discover pages that link to a target URL
 * Uses the "link:" operator to find backlinks
 */

interface SearchResult {
  url: string;
  title: string | null;
  snippet: string | null;
}

/**
 * Query Google to find pages that link to a target URL
 * Uses the "link:" operator: link:example.com/page
 * 
 * Note: Google has rate limits and may show CAPTCHAs
 * This is a basic implementation - may need proxies/rotation for scale
 */
export async function queryGoogleBacklinks(
  targetUrl: string,
  maxResults: number = 100,
  auditId?: string // Optional auditId for logging
): Promise<SearchResult[]> {
  try {
    // Extract domain and path from target URL
    const urlObj = new URL(targetUrl);
    const domain = urlObj.hostname.replace(/^www\./, '');
    const path = urlObj.pathname;
    
    // Build search query: link:domain.com/path or link:domain.com
    // Try both with and without path for better coverage
    const queries = [
      `link:${domain}${path}`,
      `link:${domain}`,
    ];
    
    const allResults: SearchResult[] = [];
    const seenUrls = new Set<string>();
    
    // Log start of Google search
    if (auditId) {
      const { addAuditLog } = await import('./audit-logs');
      addAuditLog(auditId, 'backlink-discovery', `🔍 Querying Google for backlinks to: ${targetUrl}`, {
        targetUrl,
        searchEngine: 'google',
        queries: queries,
      });
    }
    
    for (const query of queries) {
      try {
        // Query Google search
        // Note: Google may block automated queries - this is a basic implementation
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=100`;
        
        if (auditId) {
          const { addAuditLog } = await import('./audit-logs');
          addAuditLog(auditId, 'backlink-discovery', `📡 Google query: "${query}"`, {
            query,
            searchUrl,
            searchEngine: 'google',
          });
        }
        
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
        });
        
        if (!response.ok) {
          const errorMsg = `Google query failed: HTTP ${response.status}`;
          console.warn(`[Search] ${errorMsg} for ${query}`);
          if (auditId) {
            const { addAuditLog } = await import('./audit-logs');
            addAuditLog(auditId, 'backlink-discovery', `⚠️ ${errorMsg} for query: "${query}"`, {
              query,
              status: response.status,
              searchEngine: 'google',
              error: true,
            });
          }
          continue;
        }
        
        const html = await response.text();
        const results = parseGoogleResults(html);
        
        // Log results found
        if (auditId && results.length > 0) {
          const { addAuditLog } = await import('./audit-logs');
          addAuditLog(auditId, 'backlink-discovery', `✅ Google found ${results.length} result(s) for query: "${query}"`, {
            query,
            resultsCount: results.length,
            searchEngine: 'google',
          });
        }
        
        // Add unique results
        for (const result of results) {
          if (!seenUrls.has(result.url) && allResults.length < maxResults) {
            seenUrls.add(result.url);
            allResults.push(result);
          }
        }
        
        // Rate limiting: wait between queries
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Search] Error querying Google for ${query}:`, error);
        if (auditId) {
          const { addAuditLog } = await import('./audit-logs');
          addAuditLog(auditId, 'backlink-discovery', `❌ Google query error for "${query}": ${errorMsg}`, {
            query,
            error: errorMsg,
            searchEngine: 'google',
            errorType: error instanceof Error ? error.constructor.name : 'Unknown',
          });
        }
        // Continue with next query
      }
    }
    
    // Log final summary
    if (auditId) {
      const { addAuditLog } = await import('./audit-logs');
      addAuditLog(auditId, 'backlink-discovery', `📊 Google search complete: Found ${allResults.length} unique result(s) for ${targetUrl}`, {
        targetUrl,
        totalResults: allResults.length,
        searchEngine: 'google',
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
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    
    if (!response.ok) {
      const errorMsg = `Bing query failed: HTTP ${response.status}`;
      console.warn(`[Search] ${errorMsg}`);
      if (auditId) {
        const { addAuditLog } = await import('./audit-logs');
        addAuditLog(auditId, 'backlink-discovery', `⚠️ ${errorMsg} for query: "${query}"`, {
          query,
          status: response.status,
          searchEngine: 'bing',
          error: true,
        });
      }
      return [];
    }
    
    const html = await response.text();
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

