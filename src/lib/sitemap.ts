export interface SitemapUrl {
  url: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

export async function parseSitemap(sitemapUrl: string): Promise<SitemapUrl[]> {
  try {
    const { fetchWithProxy } = await import('./proxy-fetch');
    const { getProxyManager } = await import('./proxy-manager');
    const { getSimpleHeaders } = await import('./browser-headers');
    const proxyManager = getProxyManager();
    const hasProxies = proxyManager.hasProxies();

    let response: Response;

    // Try direct connection first (to save proxy bandwidth)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      try {
        // Use realistic browser headers to bypass fingerprinting
        const browserHeaders = getSimpleHeaders();
        
        response = await fetch(sitemapUrl, {
          headers: browserHeaders,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (directError) {
        clearTimeout(timeoutId);
        const isTimeout = directError instanceof Error && (
          directError.name === 'AbortError' ||
          directError.message.includes('timeout') ||
          directError.message.includes('aborted')
        );
        
        // If timeout or connection error, try with proxy if available
        if (isTimeout && hasProxies) {
          // fetchWithProxy will automatically add browser headers
          const result = await fetchWithProxy(sitemapUrl, {
            retries: 3,
            retryDelay: 2000,
            timeout: 45000, // 45 second timeout for slow/blocked sites
            aggressiveRetry: true, // Try all proxies if one fails
            minDelayBetweenRetries: 2000, // 2 second minimum delay
          });
          response = result.response;
        } else {
          throw directError;
        }
      }
    } catch (error) {
      // Final fallback: try proxy if available
      if (hasProxies) {
        // fetchWithProxy will automatically add browser headers
        const result = await fetchWithProxy(sitemapUrl, {
          retries: 3,
          retryDelay: 2000,
          timeout: 45000, // 45 second timeout for slow/blocked sites
          aggressiveRetry: true, // Try all proxies if one fails
          minDelayBetweenRetries: 2000, // 2 second minimum delay
        });
        response = result.response;
      } else {
        throw error;
      }
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch sitemap: ${response.status}`);
    }

    const xml = await response.text();
    return parseSitemapXml(xml, sitemapUrl);
  } catch (error) {
    console.error(`Error parsing sitemap ${sitemapUrl}:`, error);
    throw error;
  }
}

async function parseSitemapXml(xml: string, baseUrl?: string): Promise<SitemapUrl[]> {
  const urls: SitemapUrl[] = [];
  
  // Parse sitemap index
  const sitemapIndexMatch = xml.match(/<sitemapindex[^>]*>([\s\S]*?)<\/sitemapindex>/i);
  if (sitemapIndexMatch) {
    // This is a sitemap index, recursively fetch child sitemaps
    const sitemapMatches = xml.matchAll(/<sitemap>[\s\S]*?<loc>(.*?)<\/loc>[\s\S]*?<\/sitemap>/gi);
    for (const match of sitemapMatches) {
      const childSitemapUrl = match[1].trim();
      try {
        // Recursively parse child sitemap
        const childUrls = await parseSitemap(childSitemapUrl);
        urls.push(...childUrls);
      } catch (error) {
        console.error(`Error parsing child sitemap ${childSitemapUrl}:`, error);
      }
    }
    return urls;
  }

  // Parse regular sitemap
  const urlMatches = xml.matchAll(/<url>([\s\S]*?)<\/url>/gi);
  
  for (const match of urlMatches) {
    const urlBlock = match[1];
    const locMatch = urlBlock.match(/<loc>(.*?)<\/loc>/i);
    if (!locMatch) continue;

    const url = locMatch[1].trim();
    const lastmodMatch = urlBlock.match(/<lastmod>(.*?)<\/lastmod>/i);
    const changefreqMatch = urlBlock.match(/<changefreq>(.*?)<\/changefreq>/i);
    const priorityMatch = urlBlock.match(/<priority>(.*?)<\/priority>/i);

    urls.push({
      url,
      lastmod: lastmodMatch?.[1].trim(),
      changefreq: changefreqMatch?.[1].trim().toLowerCase(),
      priority: priorityMatch ? parseFloat(priorityMatch[1].trim()) : undefined,
    });
  }

  return urls;
}

export async function fetchSitemapsFromRobotsTxt(robotsTxtUrl: string): Promise<string[]> {
  try {
    const { fetchWithProxy } = await import('./proxy-fetch');
    const { getProxyManager } = await import('./proxy-manager');
    const { getSimpleHeaders } = await import('./browser-headers');
    const proxyManager = getProxyManager();
    const hasProxies = proxyManager.hasProxies();

    let response: Response;

    // Try direct connection first (to save proxy bandwidth)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      try {
        // Use realistic browser headers to bypass fingerprinting
        const browserHeaders = getSimpleHeaders();
        
        response = await fetch(robotsTxtUrl, {
          headers: browserHeaders,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (directError) {
        clearTimeout(timeoutId);
        const isTimeout = directError instanceof Error && (
          directError.name === 'AbortError' ||
          directError.message.includes('timeout') ||
          directError.message.includes('aborted')
        );
        
        // If timeout or connection error, try with proxy if available
        if (isTimeout && hasProxies) {
          // fetchWithProxy will automatically add browser headers
          const result = await fetchWithProxy(robotsTxtUrl, {
            retries: 3,
            retryDelay: 2000,
            timeout: 45000, // 45 second timeout for slow/blocked sites
            aggressiveRetry: true, // Try all proxies if one fails
            minDelayBetweenRetries: 2000, // 2 second minimum delay
          });
          response = result.response;
        } else {
          throw directError;
        }
      }
    } catch (error) {
      // Final fallback: try proxy if available
      if (hasProxies) {
        // fetchWithProxy will automatically add browser headers
        const result = await fetchWithProxy(robotsTxtUrl, {
          retries: 3,
          retryDelay: 2000,
          timeout: 45000, // 45 second timeout for slow/blocked sites
          aggressiveRetry: true, // Try all proxies if one fails
          minDelayBetweenRetries: 2000, // 2 second minimum delay
        });
        response = result.response;
      } else {
        throw error;
      }
    }

    if (!response.ok) {
      return [];
    }

    const text = await response.text();
    const sitemaps: string[] = [];
    
    // Extract Sitemap: directives (case-insensitive)
    const sitemapMatches = text.matchAll(/^sitemap:\s*(.+)$/gim);
    for (const match of sitemapMatches) {
      sitemaps.push(match[1].trim());
    }

    return sitemaps;
  } catch (error) {
    console.error(`Error fetching robots.txt ${robotsTxtUrl}:`, error);
    return [];
  }
}

export async function discoverSitemaps(baseUrl: string): Promise<string[]> {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname;
    const protocol = url.protocol;
    
    const sitemaps: string[] = [];
    const checkedUrls = new Set<string>();
    
    // Generate all possible robots.txt URLs to try
    const robotsTxtUrls: string[] = [];
    robotsTxtUrls.push(`${protocol}//${host}/robots.txt`);
    
    // Try with/without www
    if (host.startsWith('www.')) {
      robotsTxtUrls.push(`${protocol}//${host.replace(/^www\./, '')}/robots.txt`);
    } else {
      robotsTxtUrls.push(`${protocol}//www.${host}/robots.txt`);
    }
    
    // Try HTTP/HTTPS variations
    if (protocol === 'https:') {
      robotsTxtUrls.push(`http://${host}/robots.txt`);
      if (!host.startsWith('www.')) {
        robotsTxtUrls.push(`http://www.${host}/robots.txt`);
      } else {
        robotsTxtUrls.push(`http://${host.replace(/^www\./, '')}/robots.txt`);
      }
    } else if (protocol === 'http:') {
      robotsTxtUrls.push(`https://${host}/robots.txt`);
      if (!host.startsWith('www.')) {
        robotsTxtUrls.push(`https://www.${host}/robots.txt`);
      } else {
        robotsTxtUrls.push(`https://${host.replace(/^www\./, '')}/robots.txt`);
      }
    }
    
    // Fetch sitemaps from all robots.txt variations
    for (const robotsTxtUrl of robotsTxtUrls) {
      try {
        const robotsSitemaps = await fetchSitemapsFromRobotsTxt(robotsTxtUrl);
        for (const sitemap of robotsSitemaps) {
          if (!checkedUrls.has(sitemap)) {
            sitemaps.push(sitemap);
            checkedUrls.add(sitemap);
          }
        }
      } catch {
        // Ignore errors, continue trying other robots.txt locations
      }
    }
    
    // Generate all possible sitemap URLs to try
    const sitemapVariations: string[] = [];
    
    // Common sitemap locations for each host/protocol variation
    const hostsToTry: string[] = [host];
    if (host.startsWith('www.')) {
      hostsToTry.push(host.replace(/^www\./, ''));
    } else {
      hostsToTry.push(`www.${host}`);
    }
    
    const protocolsToTry: string[] = [protocol];
    if (protocol === 'https:') {
      protocolsToTry.push('http:');
    } else if (protocol === 'http:') {
      protocolsToTry.push('https:');
    }
    
    // Generate all combinations
    for (const testProtocol of protocolsToTry) {
      for (const testHost of hostsToTry) {
        const base = `${testProtocol}//${testHost}`;
        sitemapVariations.push(
          `${base}/sitemap.xml`,
          `${base}/sitemap_index.xml`,
          `${base}/sitemap1.xml`,
          `${base}/sitemap-index.xml`,
          `${base}/sitemap-news.xml`,
          `${base}/sitemap-products.xml`,
          `${base}/sitemap-pages.xml`,
          `${base}/sitemap-posts.xml`,
        );
      }
    }
    
    // Remove duplicates
    const uniqueSitemapUrls = [...new Set(sitemapVariations)];
    
    console.log(`[Sitemap] Trying ${uniqueSitemapUrls.length} sitemap locations...`);
    
    // Check if common sitemaps exist (with timeout per attempt)
    for (const sitemapUrl of uniqueSitemapUrls) {
      if (checkedUrls.has(sitemapUrl)) continue; // Already found via robots.txt
      
      try {
        const response = await fetch(sitemapUrl, { 
          method: 'HEAD',
          signal: AbortSignal.timeout(5000), // 5 second timeout per attempt
        });
        if (response.ok && !sitemaps.includes(sitemapUrl)) {
          sitemaps.push(sitemapUrl);
          checkedUrls.add(sitemapUrl);
          console.log(`[Sitemap] ✅ Found sitemap: ${sitemapUrl}`);
        }
      } catch {
        // Ignore errors, continue trying other locations
      }
    }

    return sitemaps;
  } catch (error) {
    console.error(`Error discovering sitemaps for ${baseUrl}:`, error);
    return [];
  }
}

