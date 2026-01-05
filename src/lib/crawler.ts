import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import type { SEOData, ImageData, LinkData, OGTags, PerformanceMetrics, MobileMetrics } from '@/types/seo';
import { fetchWithProxy } from './proxy-fetch';
import { getProxyManager } from './proxy-manager';
import { getBrowserHeaders } from './browser-headers';
import { isHoneypotLink } from './honeypot-detector';

const MAX_REDIRECTS = 10;

// Helper function to follow redirects manually and track the chain (with proxy support)
async function fetchWithRedirectTracking(
  url: string,
  options: RequestInit = {},
  maxRedirects = MAX_REDIRECTS,
  auditId?: string
): Promise<{
  response: Response;
  finalUrl: string;
  redirectChain: string[];
  redirectCount: number;
  proxyUsed?: string | null;
  html: string;
}> {
  const redirectChain: string[] = [url];
  let currentUrl = url;
  let redirectCount = 0;
  let lastProxyUsed: string | null = null;

  const proxyManager = getProxyManager();
  const useProxies = proxyManager.hasProxies();

  for (let i = 0; i < maxRedirects; i++) {
    // Check for redirect loops
    if (redirectChain.slice(0, -1).includes(currentUrl)) {
      throw new Error(`Redirect loop detected: ${currentUrl}`);
    }

    let response: Response;
    let html: string;
    const timeout = 15000; // 15 second timeout - if exceeded, likely IP blocked

    // Strategy: Try direct connection first (save money), only use proxy on failure/timeout
    try {
      // Try direct connection first
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        // Use realistic browser headers for direct connection
        const browserHeaders = getBrowserHeaders({ url: currentUrl });
        const headersWithBrowser = {
          ...browserHeaders,
          ...(options.headers || {}),
        };
        
        response = await fetch(currentUrl, {
          ...options,
          headers: headersWithBrowser,
          redirect: 'manual',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        html = await response.text();
        
        // Success with direct connection - no proxy needed
        if (auditId) {
          const { addAuditLog } = await import('./audit-logs');
          addAuditLog(auditId, 'crawled', `✅ Direct connection successful for ${new URL(currentUrl).pathname}`, {
            url: currentUrl,
            proxy: null,
            method: 'direct',
          } as any);
        }
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
        
        if (isTimeout && useProxies) {
          // Timeout/connection error - likely IP blocked, try with proxy
          const proxy = proxyManager.getNextProxy();
          const proxyInfo = proxy ? `${proxy.host}:${proxy.port}` : null;
          
          if (auditId) {
            const { addAuditLog } = await import('./audit-logs');
            addAuditLog(auditId, 'crawled', `⏱️ Timeout/connection error, retrying with proxy: ${proxyInfo || 'none'}`, {
              url: currentUrl,
              proxy: proxyInfo,
              error: directError instanceof Error ? directError.message : String(directError),
              method: 'proxy-retry',
            } as any);
          }
          
          if (proxy) {
            try {
              const result = await fetchWithProxy(currentUrl, {
                ...options,
                retries: 2, // More retries for general crawls
                retryDelay: 2000,
                skipCaptchaDetection: true,
                timeout: Math.max(timeout, 45000), // At least 45 seconds for slow sites
                aggressiveRetry: true, // Try all proxies if one fails
                minDelayBetweenRetries: 2000, // 2 second minimum delay
              });

              response = result.response;
              html = result.html;
              lastProxyUsed = result.proxyUsed ? `${result.proxyUsed.host}:${result.proxyUsed.port}` : null;

              // Record proxy success/failure
              if (result.proxyUsed) {
                if (response.ok) {
                  proxyManager.recordSuccess(result.proxyUsed);
                } else if (response.status >= 400 && response.status !== 429) {
                  proxyManager.recordFailure(result.proxyUsed, `HTTP ${response.status}`);
                }
              }
            } catch (proxyError) {
              // Proxy also failed, throw original error
              throw directError;
            }
          } else {
            // No proxies available, throw original error
            throw directError;
          }
        } else {
          // Not a timeout or no proxies - throw error
          throw directError;
        }
      }
    } catch (error) {
      // Final fallback: if we have proxies and haven't tried them yet, try now
      if (useProxies && !lastProxyUsed) {
        const proxy = proxyManager.getNextProxy();
        if (proxy) {
          if (auditId) {
            const { addAuditLog } = await import('./audit-logs');
            addAuditLog(auditId, 'crawled', `🔄 Direct connection failed, trying proxy: ${proxy.host}:${proxy.port}`, {
              url: currentUrl,
              proxy: `${proxy.host}:${proxy.port}`,
              error: error instanceof Error ? error.message : String(error),
              method: 'proxy-fallback',
            } as any);
          }
          
          try {
            const result = await fetchWithProxy(currentUrl, {
              ...options,
              retries: 1,
              retryDelay: 1000,
              skipCaptchaDetection: true,
              timeout: timeout,
            });

            response = result.response;
            html = result.html;
            lastProxyUsed = result.proxyUsed ? `${result.proxyUsed.host}:${result.proxyUsed.port}` : null;

            if (result.proxyUsed) {
              if (response.ok) {
                proxyManager.recordSuccess(result.proxyUsed);
              } else if (response.status >= 400 && response.status !== 429) {
                proxyManager.recordFailure(result.proxyUsed, `HTTP ${response.status}`);
              }
            }
          } catch (proxyError) {
            // Both direct and proxy failed
            throw error;
          }
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    // If not a redirect, return
    if (![301, 302, 307, 308].includes(response.status)) {
      return {
        response,
        finalUrl: currentUrl,
        redirectChain,
        redirectCount,
        proxyUsed: lastProxyUsed,
        html,
      };
    }

    // Handle redirect
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`Redirect ${response.status} without Location header`);
    }

    redirectCount++;
    // Resolve relative URLs
    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new Error(`Invalid redirect URL: ${location}`);
    }

    redirectChain.push(currentUrl);
  }

  throw new Error(`Maximum redirects (${maxRedirects}) exceeded`);
}

// Calculate word count from text content
function calculateWordCount($: cheerio.CheerioAPI): number {
  const bodyText = $('body').text() || '';
  // Remove extra whitespace and split by whitespace
  const words = bodyText.trim().split(/\s+/).filter((word) => word.length > 0);
  return words.length;
}

// Calculate content quality score (0-1)
function calculateContentQualityScore(seoData: Partial<SEOData>): number {
  let score = 0;
  let maxScore = 0;

  // Title (required, high weight)
  maxScore += 15;
  if (seoData.title && seoData.title.length > 0) {
    score += Math.min(15, (seoData.title.length / 60) * 15); // Optimal 50-60 chars
  }

  // Meta description (important)
  maxScore += 15;
  if (seoData.metaDescription) {
    const descLength = seoData.metaDescription.length;
    if (descLength >= 120 && descLength <= 160) {
      score += 15; // Optimal length
    } else if (descLength > 0) {
      score += Math.max(5, 15 - Math.abs(descLength - 140) / 10); // Partial credit
    }
  }

  // H1 (critical)
  maxScore += 15;
  if (seoData.h1 && seoData.h1.length > 0) {
    score += seoData.h1.length === 1 ? 15 : Math.max(5, 15 - (seoData.h1.length - 1) * 5); // Prefer single H1
  }

  // Word count (content depth indicator)
  maxScore += 15;
  const wordCount = seoData.wordCount || 0;
  if (wordCount >= 300) {
    score += 15; // Good content depth
  } else if (wordCount >= 150) {
    score += 10; // Adequate
  } else if (wordCount >= 50) {
    score += 5; // Minimal
  }

  // Images with alt text (accessibility + SEO)
  maxScore += 10;
  if (seoData.images && seoData.images.length > 0) {
    const imagesWithAlt = seoData.images.filter((img) => img.alt && img.alt.length > 0).length;
    score += (imagesWithAlt / seoData.images.length) * 10;
  } else {
    score += 10; // No images is fine for text-only pages
  }

  // Canonical URL (prevents duplicate content)
  maxScore += 10;
  if (seoData.canonicalUrl) score += 10;

  // Structured data (rich results)
  maxScore += 10;
  if (seoData.structuredData && seoData.structuredData.length > 0) score += 10;

  // Internal links (site structure)
  maxScore += 5;
  const internalLinks = seoData.links?.filter((l) => !l.isExternal).length || 0;
  if (internalLinks >= 5) score += 5;
  else if (internalLinks >= 2) score += 3;
  else if (internalLinks > 0) score += 1;

  return maxScore > 0 ? score / maxScore : 0;
}

// Calculate content depth score (how comprehensive the content is)
function calculateContentDepthScore(seoData: Partial<SEOData>): number {
  let score = 0;
  let factors = 0;

  // Word count (primary indicator)
  factors++;
  const wordCount = seoData.wordCount || 0;
  if (wordCount >= 2000) score += 1.0;
  else if (wordCount >= 1000) score += 0.8;
  else if (wordCount >= 500) score += 0.6;
  else if (wordCount >= 300) score += 0.4;
  else if (wordCount >= 150) score += 0.2;

  // Number of headings (structure indicates depth)
  factors++;
  const headingCount = (seoData.h1?.length || 0) + (seoData.h2?.length || 0) + (seoData.h3?.length || 0);
  if (headingCount >= 10) score += 1.0;
  else if (headingCount >= 5) score += 0.7;
  else if (headingCount >= 3) score += 0.4;
  else if (headingCount > 0) score += 0.2;

  // Number of internal links (depth of site exploration)
  factors++;
  const internalLinks = seoData.links?.filter((l) => !l.isExternal).length || 0;
  if (internalLinks >= 20) score += 1.0;
  else if (internalLinks >= 10) score += 0.7;
  else if (internalLinks >= 5) score += 0.4;
  else if (internalLinks > 0) score += 0.2;

  // Number of images (visual content depth)
  factors++;
  const imageCount = seoData.images?.length || 0;
  if (imageCount >= 10) score += 1.0;
  else if (imageCount >= 5) score += 0.7;
  else if (imageCount >= 2) score += 0.4;
  else if (imageCount > 0) score += 0.2;

  // Structured data (indicates rich, well-structured content)
  factors++;
  if (seoData.structuredData && seoData.structuredData.length > 0) score += 1.0;

  return factors > 0 ? score / factors : 0;
}

// Extract schema type from JSON-LD data
function extractSchemaType(data: any): string | null {
  if (!data) return null;
  
  // Handle arrays (multiple schemas)
  if (Array.isArray(data)) {
    return data.map(item => extractSchemaType(item)).filter(Boolean).join(', ') || null;
  }
  
  // Check @type field (most common)
  if (data['@type']) {
    const type = data['@type'];
    if (typeof type === 'string') {
      return type;
    }
    if (Array.isArray(type)) {
      return type.join(', ');
    }
  }
  
  // Check @context to infer type (schema.org)
  if (data['@context'] && typeof data['@context'] === 'string' && data['@context'].includes('schema.org')) {
    // Try to infer from structure
    if (data.name || data.headline) return 'Article';
    if (data.question || data.mainEntity) return 'FAQPage';
    if (data.step || data.totalTime) return 'HowTo';
    if (data.aggregateRating || data.reviewRating) return 'Review';
    if (data.address || data.geo) return 'LocalBusiness';
  }
  
  return null;
}

// Extract structured data (JSON-LD, microdata)
function extractStructuredData($: cheerio.CheerioAPI): any[] {
  const structuredData: any[] = [];
  const detectedSchemaTypes = new Set<string>();

  // Extract JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const jsonText = $(el).html();
      if (jsonText) {
        const parsed = JSON.parse(jsonText);
        
        // Handle arrays of schemas
        const schemas = Array.isArray(parsed) ? parsed : [parsed];
        
        for (const schema of schemas) {
          const schemaType = extractSchemaType(schema);
          
          if (schemaType) {
            // Split multiple types
            const types = schemaType.split(',').map(t => t.trim());
            types.forEach(type => detectedSchemaTypes.add(type));
          }
          
          structuredData.push({
            type: 'json-ld',
            schemaType: schemaType || 'Unknown',
            data: schema,
          });
        }
      }
    } catch (e) {
      // Invalid JSON, skip
    }
  });

  // TODO: Could also extract microdata if needed
  // For now, JSON-LD is the most common format

  return structuredData;
}

// Calculate content hash for similarity detection
// Hash the main content (body text) ignoring navigation, ads, etc.
// OPTIMIZED: Limit content length for faster hashing
function calculateContentHash($: cheerio.CheerioAPI): string {
  const MAX_CONTENT_LENGTH = parseInt(process.env.MAX_CONTENT_HASH_LENGTH || '10000', 10);
  
  // Get main content - try to find article/main content, fallback to body
  let contentText = '';
  
  // Try common content containers
  const contentSelectors = ['article', 'main', '[role="main"]', '.content', '#content'];
  for (const selector of contentSelectors) {
    const element = $(selector).first();
    if (element.length > 0) {
      contentText = element.text();
      break;
    }
  }
  
  // Fallback to body if no content container found
  if (!contentText) {
    // Remove common non-content elements
    const $body = $('body').clone();
    $body.find('nav, header, footer, aside, script, style, .navigation, .sidebar, .ad, .ads').remove();
    contentText = $body.text();
  }
  
  // OPTIMIZATION: Truncate to max length for faster hashing
  if (contentText.length > MAX_CONTENT_LENGTH) {
    contentText = contentText.substring(0, MAX_CONTENT_LENGTH);
  }
  
  // Normalize: lowercase, remove extra whitespace, trim
  const normalized = contentText
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  
  // Create SHA-256 hash
  return createHash('sha256').update(normalized).digest('hex');
}

// Extract mobile-specific metrics
function extractMobileMetrics($: cheerio.CheerioAPI): MobileMetrics {
  const viewportMeta = $('meta[name="viewport"]').attr('content') || null;
  const hasViewportMeta = viewportMeta !== null;
  
  // Check if mobile-friendly based on viewport
  let isMobileFriendly: boolean | null = null;
  let touchTargetSize: 'good' | 'needs-improvement' | 'poor' | null = null;
  let textReadability: 'good' | 'needs-improvement' | 'poor' | null = null;
  let contentWidth: number | null = null;
  
  if (viewportMeta) {
    // Check for width=device-width (required for mobile-friendly)
    isMobileFriendly = viewportMeta.includes('width=device-width') || viewportMeta.includes('width=initial-scale');
    
    // Check for user-scalable restrictions (bad for accessibility but common)
    const noScale = viewportMeta.includes('user-scalable=no');
    
    // Try to extract initial scale
    const initialScaleMatch = viewportMeta.match(/initial-scale=([\d.]+)/);
    const initialScale = initialScaleMatch ? parseFloat(initialScaleMatch[1]) : 1;
    
    // Estimate content width (based on typical mobile viewport)
    // This is an estimate - actual width would need rendering
    if (isMobileFriendly) {
      contentWidth = 375; // Typical mobile width
      touchTargetSize = noScale ? 'needs-improvement' : 'good';
    }
  }
  
  // Check text size - look for font-size in CSS or inline styles
  // This is basic - full check would need rendering
  const bodyFontSize = $('body').css('font-size') || '';
  if (bodyFontSize) {
    const fontSizeMatch = bodyFontSize.match(/(\d+)px/);
    if (fontSizeMatch) {
      const fontSize = parseInt(fontSizeMatch[1], 10);
      textReadability = fontSize >= 16 ? 'good' : fontSize >= 14 ? 'needs-improvement' : 'poor';
    }
  }
  
  return {
    hasViewportMeta,
    viewportContent: viewportMeta,
    isMobileFriendly,
    touchTargetSize,
    textReadability,
    contentWidth,
  };
}

// Calculate AI SEO effectiveness score (how well the page is optimized for AI search engines)
// Based on FAQ schema, HowTo schema, answer-focused content, etc.
function calculateAiSeoScore(seoData: Partial<SEOData>): number {
  let score = 0;
  let maxScore = 0;

  // FAQ Schema (highly valued for AI answers)
  maxScore += 30;
  const hasFaqSchema = seoData.structuredData?.some((item: any) => 
    item.schemaType?.toLowerCase().includes('faq') || 
    item.data?.['@type']?.toLowerCase().includes('faq') ||
    item.data?.mainEntity?.['@type'] === 'ItemList'
  );
  if (hasFaqSchema) score += 30;

  // HowTo Schema (valuable for AI answers)
  maxScore += 25;
  const hasHowToSchema = seoData.structuredData?.some((item: any) => 
    item.schemaType?.toLowerCase().includes('howto') || 
    item.data?.['@type']?.toLowerCase().includes('howto')
  );
  if (hasHowToSchema) score += 25;

  // Article Schema with good structure
  maxScore += 15;
  const hasArticleSchema = seoData.structuredData?.some((item: any) => 
    item.schemaType?.toLowerCase().includes('article') || 
    item.data?.['@type']?.toLowerCase().includes('article')
  );
  if (hasArticleSchema) score += 15;

  // Answer-focused content patterns (questions in headings, Q&A format)
  maxScore += 15;
  const headings = [...(seoData.h1 || []), ...(seoData.h2 || []), ...(seoData.h3 || [])];
  const questionPattern = /^(what|how|why|when|where|who|can|does|is|are|do|did|will|would|should|could)\s+/i;
  const questionHeadings = headings.filter(h => questionPattern.test(h.trim()));
  if (questionHeadings.length >= 3) score += 15;
  else if (questionHeadings.length >= 1) score += 8;

  // Definition/list structures (good for AI extraction)
  maxScore += 10;
  const wordCount = seoData.wordCount || 0;
  if (wordCount >= 500) {
    // Check for list patterns in content (would need full HTML, estimate based on structure)
    score += 10;
  } else if (wordCount >= 300) {
    score += 5;
  }

  // Structured data in general (any schema helps)
  maxScore += 5;
  if (seoData.structuredData && seoData.structuredData.length > 0) {
    score += Math.min(5, seoData.structuredData.length * 1); // Up to 5 points
  }

  return maxScore > 0 ? score / maxScore : 0;
}

// Calculate basic performance metrics
// Note: Full Core Web Vitals require browser automation (Lighthouse, Puppeteer)
// This provides basic metrics from HTTP response
function calculatePerformanceMetrics(
  responseTime: number,
  contentLength: number,
  headers: Record<string, string>,
  aiSeoScore?: number | null
): PerformanceMetrics {
  // Basic metrics from HTTP response
  // For full Core Web Vitals (LCP, FID, CLS), you'd need browser automation
  
  // Estimate FCP based on response time (very rough)
  const firstContentfulPaint = responseTime > 0 ? responseTime : null;
  
  // Estimate based on content size (rough heuristics)
  let largestContentfulPaint: number | null = null;
  if (contentLength > 0) {
    // Rough estimate: LCP ≈ response time + (content length / bandwidth)
    // Assuming ~1MB/s bandwidth for estimate
    const bandwidthBytesPerMs = 1024 * 1024 / 1000; // 1MB/s = ~1KB/ms
    largestContentfulPaint = Math.round(responseTime + (contentLength / bandwidthBytesPerMs));
  }
  
  // Check cache headers for performance hints
  const cacheControl = headers['cache-control'] || '';
  const hasCache = cacheControl.includes('max-age') || cacheControl.includes('public');
  
  // CLS and FID cannot be calculated without browser rendering
  // These would need browser automation (Lighthouse API, Puppeteer, etc.)
  
  return {
    firstContentfulPaint,
    largestContentfulPaint,
    firstInputDelay: null, // Requires browser interaction
    cumulativeLayoutShift: null, // Requires browser rendering
    timeToInteractive: null, // Requires JavaScript execution
    totalBlockingTime: null, // Requires JavaScript execution
    speedIndex: null, // Requires browser rendering
    aiSeoScore: aiSeoScore !== undefined ? aiSeoScore : null,
  };
}

export async function crawlUrl(url: string, auditId?: string): Promise<SEOData> {
  const startTime = Date.now();
  
  try {
    // Fetch with redirect tracking (with proxy support)
    // Use realistic browser headers to bypass fingerprinting
    const browserHeaders = getBrowserHeaders({ url });
    
    const { response, finalUrl, redirectChain, redirectCount, proxyUsed, html } = await fetchWithRedirectTracking(
      url,
      {
        headers: browserHeaders,
      },
      MAX_REDIRECTS,
      auditId
    );

    const statusCode = response.status;
    
    // Extract HTTP headers early (needed for error case)
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    const responseTime = Date.now() - startTime;
    const performanceMetrics = calculatePerformanceMetrics(responseTime, 0, headers, null);
    
    // Only process HTML content
    if (statusCode >= 400) {
      // For error pages, return minimal data
      const performanceMetrics = calculatePerformanceMetrics(responseTime, 0, headers, null);
      return {
        url,
        title: null,
        metaDescription: null,
        metaKeywords: null,
        metaRobots: null,
        h1: [],
        h2: [],
        h3: [],
        images: [],
        links: [],
        canonicalUrl: null,
        ogTags: {
          title: null,
          description: null,
          image: null,
          type: null,
          url: null,
        },
        language: null,
        crawledAt: new Date(),
        statusCode,
        responseTime: Date.now() - startTime,
        redirectChain: redirectCount > 0 ? redirectChain : undefined,
        redirectCount: redirectCount > 0 ? redirectCount : undefined,
        finalUrl: redirectCount > 0 ? finalUrl : undefined,
        headers,
        contentLength: null,
        lastModified: response.headers.get('last-modified') || null,
        etag: response.headers.get('etag') || null,
        structuredData: [],
        wordCount: 0,
        contentQualityScore: 0,
        contentDepthScore: 0,
        contentHash: '',
        performanceMetrics,
        mobileMetrics: {
          hasViewportMeta: false,
          viewportContent: null,
          isMobileFriendly: null,
          touchTargetSize: null,
          textReadability: null,
          contentWidth: null,
        },
      };
    }

    // HTML was already fetched by fetchWithRedirectTracking (either via proxy or direct)
    const contentLength = html.length;
    const $ = cheerio.load(html);
    
    // Extract basic SEO data
    const title = $('title').first().text().trim() || null;
    const metaDescription = $('meta[name="description"]').attr('content') || null;
    const metaKeywords = $('meta[name="keywords"]').attr('content') || null;
    const metaRobots = $('meta[name="robots"]').attr('content') || null;
    const canonicalUrl = $('link[rel="canonical"]').attr('href') || null;
    const language = $('html').attr('lang') || null;

    // Extract headings
    const h1 = $('h1')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((text) => text.length > 0);
    const h2 = $('h2')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((text) => text.length > 0);
    const h3 = $('h3')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((text) => text.length > 0);

    // Extract images with dimensions
    const images: ImageData[] = $('img')
      .map((_, el) => {
        const $img = $(el);
        const src = $img.attr('src') || $img.attr('data-src') || '';
        const widthAttr = $img.attr('width');
        const heightAttr = $img.attr('height');
        
        return {
          src: src.startsWith('http') ? src : new URL(src, finalUrl || url).toString(),
          alt: $img.attr('alt') || null,
          title: $img.attr('title') || null,
          width: widthAttr ? parseInt(widthAttr, 10) || null : null,
          height: heightAttr ? parseInt(heightAttr, 10) || null : null,
        };
      })
      .get()
      .filter((img) => img.src.length > 0);

    // Extract links (filtering out honeypots)
    const baseUrl = new URL(finalUrl || url);
    const links: LinkData[] = $('a[href]')
      .map((_, el) => {
        const $link = $(el);
        
        // Skip honeypot links (hidden links designed to trap crawlers)
        if (isHoneypotLink($link, $)) {
          return null;
        }
        
        const href = $link.attr('href') || '';
        let fullUrl: string;
        try {
          fullUrl = href.startsWith('http') ? href : new URL(href, finalUrl || url).toString();
        } catch {
          return null;
        }
        const linkUrl = new URL(fullUrl);
        const isExternal = linkUrl.origin !== baseUrl.origin;

        return {
          href: fullUrl,
          text: $link.text().trim(),
          isExternal,
          rel: $link.attr('rel') || null,
        };
      })
      .get()
      .filter((link): link is LinkData => link !== null);

    // Extract Open Graph tags
    const ogTags: OGTags = {
      title: $('meta[property="og:title"]').attr('content') || null,
      description: $('meta[property="og:description"]').attr('content') || null,
      image: $('meta[property="og:image"]').attr('content') || null,
      type: $('meta[property="og:type"]').attr('content') || null,
      url: $('meta[property="og:url"]').attr('content') || null,
    };

    // Extract structured data
    const structuredData = extractStructuredData($);

    // Calculate metrics
    const wordCount = calculateWordCount($);
    const contentHash = calculateContentHash($);
    const mobileMetrics = extractMobileMetrics($);
    
    // Build partial SEO data for score calculation
    const partialSeoData: Partial<SEOData> = {
      title,
      metaDescription,
      h1,
      h2,
      h3,
      images,
      links,
      canonicalUrl,
      structuredData,
      wordCount,
    };

    // Calculate scores
    const qualityScore = calculateContentQualityScore(partialSeoData);
    const depthScore = calculateContentDepthScore(partialSeoData);
    const aiSeoScore = calculateAiSeoScore(partialSeoData);

    // Recalculate performance metrics with AI SEO score
    const performanceMetricsWithAiSeo = calculatePerformanceMetrics(
      responseTime, 
      contentLength, 
      headers, 
      aiSeoScore
    );

    return {
      url,
      title,
      metaDescription,
      metaKeywords,
      metaRobots,
      h1,
      h2,
      h3,
      images,
      links,
      canonicalUrl,
      ogTags,
      language,
      crawledAt: new Date(),
      statusCode,
      responseTime,
      redirectChain: redirectCount > 0 ? redirectChain : undefined,
      redirectCount: redirectCount > 0 ? redirectCount : undefined,
      finalUrl: redirectCount > 0 ? finalUrl : undefined,
      headers,
      contentLength,
      lastModified: response.headers.get('last-modified') || null,
      etag: response.headers.get('etag') || null,
      structuredData,
      wordCount,
      contentQualityScore: qualityScore,
      contentDepthScore: depthScore,
      contentHash,
      performanceMetrics: performanceMetricsWithAiSeo,
      mobileMetrics,
    };
  } catch (error) {
    throw new Error(
      `Failed to crawl ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

