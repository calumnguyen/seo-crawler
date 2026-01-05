/**
 * Proxy-Aware Fetch Wrapper
 * Provides fetch functionality with proxy support for Node.js environments
 */

import { getProxyManager, type ProxyConfig } from './proxy-manager';
import { detectCaptchaFromResponse, type CaptchaDetectionResult } from './captcha-detector';
import { getBrowserHeaders } from './browser-headers';
import { getCookieManager } from './cookie-manager';
import { getCaptchaSolver, extractReCaptchaSiteKey } from './captcha-solver';

export interface FetchWithProxyOptions extends RequestInit {
  proxy?: ProxyConfig | null;
  retries?: number;
  retryDelay?: number;
  timeout?: number;
  skipCaptchaDetection?: boolean;
  aggressiveRetry?: boolean; // If true, try all proxies before giving up
  minDelayBetweenRetries?: number; // Minimum delay between retries (ms)
}

export interface FetchWithProxyResult {
  response: Response;
  html: string;
  captchaDetection?: CaptchaDetectionResult;
  proxyUsed?: ProxyConfig | null;
}

/**
 * Fetch with proxy support and CAPTCHA detection
 * 
 * In Node.js environments, uses https-proxy-agent when proxies are configured
 * Falls back to standard fetch when no proxies are available
 */
export async function fetchWithProxy(
  url: string,
  options: FetchWithProxyOptions = {}
): Promise<FetchWithProxyResult> {
  const {
    proxy: explicitProxy,
    retries = 3,
    retryDelay = 2000,
    timeout = 45000, // Increased default timeout to 45 seconds for slow sites
    skipCaptchaDetection = false,
    aggressiveRetry = false, // Try all proxies if enabled
    minDelayBetweenRetries = 1000, // Minimum 1 second between retries
    ...fetchOptions
  } = options;

  const proxyManager = getProxyManager();
  const timeoutMs = timeout || Math.max(proxyManager.getTimeout(), 45000); // At least 45 seconds

  // Determine which proxy to use
  let proxy = explicitProxy !== undefined 
    ? explicitProxy 
    : proxyManager.getNextProxy();

  // If aggressive retry is enabled and we have proxies, get all proxies to try
  const allProxies = aggressiveRetry && proxyManager.hasProxies() && !explicitProxy
    ? proxyManager.getAllProxies()
    : proxy ? [proxy] : [];
  
  let proxyIndex = 0;

  // Build fetch options with proxy support
  const finalOptions: RequestInit = {
    ...fetchOptions,
    signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs),
  };

  // Add realistic browser headers if not provided
  if (!finalOptions.headers) {
    finalOptions.headers = {};
  }

  const headers = finalOptions.headers as Record<string, string>;
  
  // Get cookie manager for this domain/proxy session
  const cookieManager = getCookieManager();
  const domain = new URL(url).hostname;

  // Retry logic
  let lastError: Error | null = null;
  let lastResponse: Response | null = null;
  let lastHtml: string | null = null;

  // Calculate max attempts: if aggressive retry, try all proxies; otherwise use retries
  const maxAttempts = aggressiveRetry && allProxies.length > 0
    ? Math.max(retries + 1, allProxies.length) // Try at least all proxies
    : retries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Select proxy for this attempt
    if (aggressiveRetry && allProxies.length > 0) {
      // Try each proxy in rotation
      proxy = allProxies[proxyIndex % allProxies.length];
      proxyIndex++;
      console.log(`[ProxyFetch] Aggressive retry attempt ${attempt + 1}/${maxAttempts}: Trying proxy ${proxy.host}:${proxy.port}`);
    } else if (!proxy && proxyManager.hasProxies()) {
      // Get next proxy if current one failed
      proxy = proxyManager.getNextProxy();
    }
    
    // Get session User-Agent and cookies for this domain/proxy (per attempt)
    const proxyUrl = proxy?.url;
    const sessionUserAgent = cookieManager.getUserAgent(domain, proxyUrl);
    const cookies = await cookieManager.getCookies(url, proxyUrl);
    
    // Use realistic browser headers to bypass fingerprinting
    // Only override if headers weren't explicitly provided
    const browserHeaders = getBrowserHeaders({ 
      url,
      userAgent: sessionUserAgent, // Use session User-Agent for consistency
    });
    
    // Build headers for this attempt (merge browser headers with existing)
    const attemptHeaders: Record<string, string> = { ...headers };
    for (const [key, value] of Object.entries(browserHeaders)) {
      if (!attemptHeaders[key]) {
        attemptHeaders[key] = value;
      }
    }
    
    // Add cookies if we have any (merge with existing Cookie header if present)
    if (cookies) {
      if (attemptHeaders['Cookie']) {
        attemptHeaders['Cookie'] = `${attemptHeaders['Cookie']}; ${cookies}`;
      } else {
        attemptHeaders['Cookie'] = cookies;
      }
    }
    
    // Update finalOptions with headers for this attempt
    const attemptOptions: RequestInit = {
      ...finalOptions,
      headers: attemptHeaders,
    };
    
    try {
      let response: Response;

      // Use proxy-aware fetch in Node.js environment
      if (proxy && typeof window === 'undefined') {
        try {
          // Use undici for proxy support (available in Node.js 18+)
          const { fetch: undiciFetch, ProxyAgent } = await import('undici');
          
          const proxyAgent = new ProxyAgent(proxy.url);
          console.log(`[ProxyFetch] Attempt ${attempt + 1}/${retries + 1}: Using proxy: ${proxy.host}:${proxy.port}`);
          
          // undici's fetch returns a compatible Response, cast for TypeScript
          // Runtime compatibility is fine, TypeScript types differ slightly
          response = (await undiciFetch(url, {
            ...attemptOptions,
            dispatcher: proxyAgent,
          } as Record<string, unknown>)) as unknown as Response;
        } catch {
          // Fallback to https-proxy-agent with node-fetch if undici fails
          try {
            const { HttpsProxyAgent } = await import('https-proxy-agent');
            const { default: nodeFetch } = await import('node-fetch');
            
            const agent = new HttpsProxyAgent(proxy.url);
            console.log(`[ProxyFetch] Attempt ${attempt + 1}/${retries + 1}: Using proxy with node-fetch: ${proxy.host}:${proxy.port}`);
            
            const nodeResponse = await nodeFetch(url, {
              ...attemptOptions,
              agent: agent as unknown,
            } as Record<string, unknown>);
            
            // Convert node-fetch Response to standard Response
            response = new Response(nodeResponse.body as unknown as BodyInit, {
              status: nodeResponse.status,
              statusText: nodeResponse.statusText,
              headers: nodeResponse.headers as unknown as HeadersInit,
            });
          } catch {
            // Final fallback: use standard fetch (proxy won't work but request will proceed)
            console.warn('[ProxyFetch] Proxy libraries not available, using direct connection');
            response = await fetch(url, attemptOptions);
          }
        }
      } else {
        // No proxy or browser environment - use standard fetch
        response = await fetch(url, attemptOptions);
      }

      // Store cookies from response (Set-Cookie headers)
      // Check for Set-Cookie header (can appear multiple times)
      const setCookieHeaders: string[] = [];
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') {
          setCookieHeaders.push(value);
        }
      });
      
      if (setCookieHeaders.length > 0) {
        await cookieManager.setCookiesFromHeaders(url, setCookieHeaders, proxyUrl);
      }

      // Get response text (can only be read once)
      const html = await response.text();

      // Check response
      if (!response.ok && response.status !== 429) {
        // For non-429 errors, record failure and retry with different proxy
        if (proxy) {
          proxyManager.recordFailure(proxy, `HTTP ${response.status}`);
        }
        
        if (attempt < retries) {
          // Try different proxy on retry
          const nextProxy = proxyManager.getNextProxy();
          if (nextProxy && nextProxy.url !== proxy?.url) {
            console.log(`[ProxyFetch] Retrying with different proxy (attempt ${attempt + 1}/${retries})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
            continue;
          }
        }
        
        lastResponse = response;
        lastHtml = html;
        break;
      }

      // Detect CAPTCHA
      let captchaDetection: CaptchaDetectionResult | undefined;
      if (!skipCaptchaDetection) {
        captchaDetection = detectCaptchaFromResponse(response, html);
      }

      // If CAPTCHA detected, try to solve it (if solver is configured)
      if (captchaDetection?.isCaptcha) {
        const captchaSolver = getCaptchaSolver();
        
        // Try solving reCAPTCHA if detected and solver is configured
        if (captchaDetection.captchaType === 'google-recaptcha' && captchaSolver) {
          try {
            const siteKey = extractReCaptchaSiteKey(html);
            if (siteKey) {
              console.log(`[ProxyFetch] Attempting to solve reCAPTCHA (site key: ${siteKey.substring(0, 20)}...)`);
              const solveResult = await captchaSolver.solve(siteKey, url);
              
              if (solveResult.success && solveResult.token) {
                console.log(`[ProxyFetch] ✅ CAPTCHA solved successfully`);
                // For search engines, we can't submit the token directly, so we'll still rotate proxies
                // But for form-based CAPTCHAs, the token could be used (future enhancement)
                // For now, log success and continue with proxy rotation
              } else {
                console.warn(`[ProxyFetch] ⚠️ CAPTCHA solving failed: ${solveResult.error}`);
              }
            }
          } catch (solveError) {
            console.error(`[ProxyFetch] Error solving CAPTCHA:`, solveError);
          }
        }
        
        // Rotate to different proxy for next attempt
        if (attempt < maxAttempts - 1) {
          if (proxy) {
            proxyManager.recordFailure(proxy, `CAPTCHA detected (${captchaDetection.captchaType})`);
          }
          
          console.warn(
            `[ProxyFetch] CAPTCHA detected (${captchaDetection.captchaType}, confidence: ${captchaDetection.confidence}), rotating proxy`
          );

          // Try different proxy
          const nextProxy = aggressiveRetry && allProxies.length > 0
            ? allProxies[proxyIndex % allProxies.length]
            : proxyManager.getNextProxy();
          
          if (nextProxy && nextProxy.url !== proxy?.url) {
            proxyIndex++; // Advance for aggressive retry
            console.log(`[ProxyFetch] Retrying with different proxy due to CAPTCHA (attempt ${attempt + 1}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, Math.max(retryDelay * (attempt + 1), minDelayBetweenRetries)));
            continue;
          }
        }
      }

      // Success - record it
      if (proxy) {
        proxyManager.recordSuccess(proxy);
      }

      return {
        response,
        html,
        captchaDetection,
        proxyUsed: proxy,
      };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Record proxy failure
      if (proxy) {
        proxyManager.recordFailure(proxy, lastError.message);
      }

      // Retry with exponential backoff (but respect min delay)
      if (attempt < maxAttempts - 1) {
        const baseDelay = Math.max(retryDelay * Math.pow(2, attempt), minDelayBetweenRetries);
        const delay = Math.min(baseDelay, 10000); // Cap at 10 seconds
        const proxyInfo = proxy ? `${proxy.host}:${proxy.port}` : 'none';
        console.warn(`[ProxyFetch] Request failed with proxy ${proxyInfo} (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delay}ms:`, lastError.message);
        
        // If not using aggressive retry, try different proxy
        if (!aggressiveRetry) {
          const nextProxy = proxyManager.getNextProxy();
          if (nextProxy && nextProxy.url !== proxy?.url) {
            console.log(`[ProxyFetch] Rotating to next proxy: ${nextProxy.host}:${nextProxy.port}`);
            proxy = nextProxy; // Update proxy for next attempt
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  // All retries exhausted
  if (lastError) {
    throw lastError;
  }

  if (lastResponse && lastHtml !== null) {
    return {
      response: lastResponse,
      html: lastHtml,
      captchaDetection: undefined,
      proxyUsed: proxy,
    };
  }

  throw new Error('Fetch failed after all retries');
}

