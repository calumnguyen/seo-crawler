export interface SitemapUrl {
  url: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

export async function parseSitemap(sitemapUrl: string): Promise<SitemapUrl[]> {
  try {
    const response = await fetch(sitemapUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEO-Crawler/1.0)',
      },
    });

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
    const response = await fetch(robotsTxtUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEO-Crawler/1.0)',
      },
    });

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

