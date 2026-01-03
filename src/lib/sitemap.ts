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
    const robotsTxtUrl = `${url.protocol}//${url.host}/robots.txt`;
    
    const sitemaps = await fetchSitemapsFromRobotsTxt(robotsTxtUrl);
    
    // Also try common sitemap locations
    const commonSitemaps = [
      `${url.protocol}//${url.host}/sitemap.xml`,
      `${url.protocol}//${url.host}/sitemap_index.xml`,
    ];

    // Check if common sitemaps exist
    for (const sitemapUrl of commonSitemaps) {
      try {
        const response = await fetch(sitemapUrl, { method: 'HEAD' });
        if (response.ok && !sitemaps.includes(sitemapUrl)) {
          sitemaps.push(sitemapUrl);
        }
      } catch {
        // Ignore errors
      }
    }

    return sitemaps;
  } catch (error) {
    console.error(`Error discovering sitemaps for ${baseUrl}:`, error);
    return [];
  }
}

