/**
 * Browser Header Generator
 * Generates realistic browser headers to bypass fingerprinting and bot detection
 */

// Realistic browser User-Agents (updated to current versions)
const USER_AGENTS = [
  // Chrome on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  
  // Chrome on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  
  // Firefox on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  
  // Firefox on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
  
  // Safari on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  
  // Edge on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
];

// Track which User-Agent was last used to enable rotation
let lastUserAgentIndex = Math.floor(Math.random() * USER_AGENTS.length);

/**
 * Get a random or rotated User-Agent string
 */
export function getUserAgent(): string {
  // Rotate through User-Agents
  lastUserAgentIndex = (lastUserAgentIndex + 1) % USER_AGENTS.length;
  return USER_AGENTS[lastUserAgentIndex];
}

/**
 * Generate realistic browser headers to bypass fingerprinting
 * 
 * @param options - Configuration options
 * @param options.url - The URL being requested (for Referer header)
 * @param options.referer - Optional referer URL (defaults to same origin)
 * @param options.cookies - Optional cookie string to include
 * @param options.userAgent - Optional custom User-Agent (defaults to rotated one)
 * @param options.accept - Optional Accept header (defaults based on User-Agent)
 */
export function getBrowserHeaders(options: {
  url?: string;
  referer?: string | null;
  cookies?: string | null;
  userAgent?: string;
  accept?: string;
} = {}): Record<string, string> {
  const {
    url,
    referer,
    cookies,
    userAgent,
    accept,
  } = options;

  const ua = userAgent || getUserAgent();
  
  // Determine Accept header based on User-Agent
  let acceptHeader = accept;
  if (!acceptHeader) {
    if (ua.includes('Chrome') || ua.includes('Edg')) {
      acceptHeader = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
    } else if (ua.includes('Firefox')) {
      acceptHeader = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
    } else if (ua.includes('Safari')) {
      acceptHeader = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    } else {
      acceptHeader = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    }
  }

  // Determine Accept-Language (common for all browsers)
  const acceptLanguage = 'en-US,en;q=0.9';

  // Determine Accept-Encoding
  const acceptEncoding = 'gzip, deflate, br, zstd';

  // Build headers
  const headers: Record<string, string> = {
    'User-Agent': ua,
    'Accept': acceptHeader,
    'Accept-Language': acceptLanguage,
    'Accept-Encoding': acceptEncoding,
  };

  // Add Sec-Fetch-* headers (Chrome/Edge/Firefox)
  if (ua.includes('Chrome') || ua.includes('Edg')) {
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = referer && url ? (new URL(referer).origin === new URL(url).origin ? 'same-origin' : 'cross-site') : 'none';
    headers['Sec-Fetch-User'] = '?1';
    headers['Sec-Ch-Ua'] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
    headers['Sec-Ch-Ua-Mobile'] = '?0';
    headers['Sec-Ch-Ua-Platform'] = ua.includes('Windows') ? '"Windows"' : '"macOS"';
  } else if (ua.includes('Firefox')) {
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-Site'] = referer && url ? (new URL(referer).origin === new URL(url).origin ? 'same-origin' : 'cross-site') : 'none';
    headers['Sec-Fetch-User'] = '?1';
  }

  // Add Referer if provided or if we have a URL
  if (referer) {
    headers['Referer'] = referer;
  } else if (url) {
    // Use same origin as referer
    try {
      const urlObj = new URL(url);
      headers['Referer'] = `${urlObj.protocol}//${urlObj.host}/`;
    } catch {
      // Invalid URL, skip Referer
    }
  }

  // Add cookies if provided
  if (cookies) {
    headers['Cookie'] = cookies;
  }

  // Add Connection header (keep-alive for better performance)
  headers['Connection'] = 'keep-alive';

  // Add Upgrade-Insecure-Requests for HTTPS
  if (url && url.startsWith('https://')) {
    headers['Upgrade-Insecure-Requests'] = '1';
  }

  // Add DNT (Do Not Track) - some browsers send this
  if (Math.random() > 0.5) {
    headers['DNT'] = '1';
  }

  return headers;
}

/**
 * Get headers specifically for robots.txt or sitemap requests
 * These are simpler and don't need all the browser headers
 */
export function getSimpleHeaders(): Record<string, string> {
  return {
    'User-Agent': getUserAgent(),
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

