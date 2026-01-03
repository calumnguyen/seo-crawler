import * as cheerio from 'cheerio';
import type { SEOData, ImageData, LinkData, OGTags } from '@/types/seo';

export async function crawlUrl(url: string): Promise<SEOData> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEO-Crawler/1.0)',
      },
    });

    const statusCode = response.status;
    const html = await response.text();
    const $ = cheerio.load(html);
    const responseTime = Date.now() - startTime;

    // Extract basic SEO data
    const title = $('title').first().text().trim() || null;
    const metaDescription = $('meta[name="description"]').attr('content') || null;
    const metaKeywords = $('meta[name="keywords"]').attr('content') || null;
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

    // Extract images
    const images: ImageData[] = $('img')
      .map((_, el) => {
        const $img = $(el);
        const src = $img.attr('src') || $img.attr('data-src') || '';
        return {
          src: src.startsWith('http') ? src : new URL(src, url).toString(),
          alt: $img.attr('alt') || null,
          title: $img.attr('title') || null,
        };
      })
      .get()
      .filter((img) => img.src.length > 0);

    // Extract links
    const baseUrl = new URL(url);
    const links: LinkData[] = $('a[href]')
      .map((_, el) => {
        const $link = $(el);
        const href = $link.attr('href') || '';
        let fullUrl: string;
        try {
          fullUrl = href.startsWith('http') ? href : new URL(href, url).toString();
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

    return {
      url,
      title,
      metaDescription,
      metaKeywords,
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
    };
  } catch (error) {
    throw new Error(
      `Failed to crawl ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

