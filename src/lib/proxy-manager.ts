/**
 * Proxy Manager
 * Handles proxy rotation, health tracking, and CAPTCHA detection
 * 
 * Configuration via environment variables:
 * - PROXY_LIST: Comma-separated list of proxies (format: http://user:pass@host:port or http://host:port)
 * - PROXY_ROTATION: 'round-robin' | 'random' | 'least-used' (default: 'round-robin')
 * - PROXY_TIMEOUT: Timeout in ms (default: 30000)
 * - PROXY_MAX_FAILURES: Max failures before disabling proxy (default: 3)
 * - PROXY_COOLDOWN: Cooldown period in ms after failure (default: 60000)
 */

export interface ProxyConfig {
  url: string;
  username?: string;
  password?: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
}

export interface ProxyHealth {
  proxy: ProxyConfig;
  failures: number;
  successes: number;
  lastUsed: number;
  lastFailure: number | null;
  isDisabled: boolean;
  disabledUntil: number | null;
}

export type RotationStrategy = 'round-robin' | 'random' | 'least-used' | 'success-based';

class ProxyManager {
  private proxies: ProxyHealth[] = [];
  private currentIndex: number = 0;
  private rotationStrategy: RotationStrategy = 'round-robin';
  private timeout: number = 30000;
  private maxFailures: number = 3;
  private cooldown: number = 60000;

  constructor() {
    this.loadProxies();
    this.rotationStrategy = (process.env.PROXY_ROTATION as RotationStrategy) || 'success-based'; // Default to success-based for better reliability
    this.timeout = parseInt(process.env.PROXY_TIMEOUT || '30000', 10);
    this.maxFailures = parseInt(process.env.PROXY_MAX_FAILURES || '3', 10);
    this.cooldown = parseInt(process.env.PROXY_COOLDOWN || '60000', 10);
  }

  /**
   * Load proxies from environment variable
   * Format: http://user:pass@host:port,http://host:port,...
   */
  private loadProxies(): void {
    const proxyList = process.env.PROXY_LIST;
    
    if (!proxyList || proxyList.trim() === '') {
      console.log('[ProxyManager] No proxies configured. Direct connections will be used.');
      return;
    }

    const proxyUrls = proxyList.split(',').map(url => url.trim()).filter(Boolean);
    
    for (const proxyUrl of proxyUrls) {
      try {
        const proxy = this.parseProxyUrl(proxyUrl);
        if (proxy) {
          this.proxies.push({
            proxy,
            failures: 0,
            successes: 0,
            lastUsed: 0,
            lastFailure: null,
            isDisabled: false,
            disabledUntil: null,
          });
        }
      } catch (error) {
        console.error(`[ProxyManager] Invalid proxy URL: ${proxyUrl}`, error);
      }
    }

    console.log(`[ProxyManager] Loaded ${this.proxies.length} proxy(ies)`);
  }

  /**
   * Parse proxy URL into ProxyConfig
   */
  private parseProxyUrl(proxyUrl: string): ProxyConfig | null {
    try {
      const url = new URL(proxyUrl);
      const protocol = url.protocol.replace(':', '') as 'http' | 'https';
      
      if (protocol !== 'http' && protocol !== 'https') {
        throw new Error(`Unsupported protocol: ${protocol}`);
      }

      return {
        url: proxyUrl,
        username: url.username || undefined,
        password: url.password || undefined,
        host: url.hostname,
        port: parseInt(url.port || (protocol === 'https' ? '443' : '80'), 10),
        protocol,
      };
    } catch (error) {
      console.error(`[ProxyManager] Error parsing proxy URL: ${proxyUrl}`, error);
      return null;
    }
  }

  /**
   * Get the next proxy based on rotation strategy
   */
  getNextProxy(): ProxyConfig | null {
    if (this.proxies.length === 0) {
      return null; // No proxies, use direct connection
    }

    // Filter out disabled proxies that are still in cooldown
    const now = Date.now();
    const availableProxies = this.proxies.filter(ph => {
      if (!ph.isDisabled) return true;
      if (ph.disabledUntil && now < ph.disabledUntil) return false;
      // Cooldown expired, re-enable
      ph.isDisabled = false;
      ph.disabledUntil = null;
      ph.failures = 0; // Reset failures after cooldown
      return true;
    });

    if (availableProxies.length === 0) {
      // All proxies are in cooldown, use any proxy
      console.warn('[ProxyManager] All proxies in cooldown, using any available proxy');
      return this.proxies[0]?.proxy || null;
    }

    let selected: ProxyHealth;

    switch (this.rotationStrategy) {
      case 'round-robin':
        selected = availableProxies[this.currentIndex % availableProxies.length];
        this.currentIndex = (this.currentIndex + 1) % availableProxies.length;
        break;

      case 'random':
        selected = availableProxies[Math.floor(Math.random() * availableProxies.length)];
        break;

      case 'least-used':
        selected = availableProxies.reduce((prev, curr) => 
          curr.lastUsed < prev.lastUsed ? curr : prev
        );
        break;

      case 'success-based':
        // Select proxy with highest success rate (most reliable)
        selected = availableProxies.reduce((prev, curr) => {
          const prevRate = prev.successes + prev.failures > 0 
            ? prev.successes / (prev.successes + prev.failures) 
            : 0.5;
          const currRate = curr.successes + curr.failures > 0
            ? curr.successes / (curr.successes + curr.failures)
            : 0.5;
          
          // If rates are similar, prefer less used
          if (Math.abs(prevRate - currRate) < 0.1) {
            return curr.lastUsed < prev.lastUsed ? curr : prev;
          }
          
          return currRate > prevRate ? curr : prev;
        });
        break;

      default:
        selected = availableProxies[0];
    }

    selected.lastUsed = now;
    return selected.proxy;
  }

  /**
   * Record a successful proxy usage
   */
  recordSuccess(proxy: ProxyConfig): void {
    const proxyHealth = this.proxies.find(ph => ph.proxy.url === proxy.url);
    if (proxyHealth) {
      proxyHealth.successes++;
      proxyHealth.lastUsed = Date.now();
      // Reset failures on success (gradual recovery)
      if (proxyHealth.successes % 3 === 0 && proxyHealth.failures > 0) {
        proxyHealth.failures = Math.max(0, proxyHealth.failures - 1);
      }
    }
  }

  /**
   * Record a proxy failure
   */
  recordFailure(proxy: ProxyConfig, reason?: string): void {
    const proxyHealth = this.proxies.find(ph => ph.proxy.url === proxy.url);
    if (proxyHealth) {
      proxyHealth.failures++;
      proxyHealth.lastFailure = Date.now();
      
      if (proxyHealth.failures >= this.maxFailures) {
        proxyHealth.isDisabled = true;
        proxyHealth.disabledUntil = Date.now() + this.cooldown;
        console.warn(
          `[ProxyManager] Proxy ${proxy.host}:${proxy.port} disabled after ${proxyHealth.failures} failures${reason ? `: ${reason}` : ''}`
        );
      }
    }
  }

  /**
   * Get proxy stats for monitoring
   */
  getStats(): Array<{
    proxy: string;
    successes: number;
    failures: number;
    isDisabled: boolean;
    successRate: number;
  }> {
    return this.proxies.map(ph => ({
      proxy: `${ph.proxy.host}:${ph.proxy.port}`,
      successes: ph.successes,
      failures: ph.failures,
      isDisabled: ph.isDisabled,
      successRate: ph.successes + ph.failures > 0 
        ? ph.successes / (ph.successes + ph.failures) 
        : 0,
    }));
  }

  /**
   * Get timeout value
   */
  getTimeout(): number {
    return this.timeout;
  }

  /**
   * Check if proxies are available
   */
  hasProxies(): boolean {
    return this.proxies.length > 0;
  }

  /**
   * Test a proxy by making a test request
   * Returns true if proxy is working, false otherwise
   */
  async testProxy(proxy: ProxyConfig, testUrl: string = 'https://httpbin.org/ip'): Promise<boolean> {
    try {
      const { fetchWithProxy } = await import('./proxy-fetch');
      const result = await fetchWithProxy(testUrl, {
        proxy,
        retries: 0, // No retries for testing
        timeout: 10000, // 10 second timeout for testing
        skipCaptchaDetection: true,
      });
      return result.response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get all available proxies (including disabled ones that are out of cooldown)
   */
  getAllProxies(): ProxyConfig[] {
    return this.proxies.map(ph => ph.proxy);
  }

  /**
   * Reset proxy health (useful for testing)
   */
  resetProxyHealth(proxy: ProxyConfig): void {
    const proxyHealth = this.proxies.find(ph => ph.proxy.url === proxy.url);
    if (proxyHealth) {
      proxyHealth.failures = 0;
      proxyHealth.isDisabled = false;
      proxyHealth.disabledUntil = null;
    }
  }

  /**
   * Build proxy agent URL for fetch
   * Note: Node.js fetch doesn't natively support proxies
   * This will need to use an HTTP client that supports proxies, or we can use
   * the proxy URL in the fetch options (if supported by runtime)
   */
  buildProxyUrl(proxy: ProxyConfig): string {
    return proxy.url;
  }
}

// Singleton instance
let proxyManagerInstance: ProxyManager | null = null;

export function getProxyManager(): ProxyManager {
  if (!proxyManagerInstance) {
    proxyManagerInstance = new ProxyManager();
  }
  return proxyManagerInstance;
}

/**
 * Create fetch options with proxy support
 * Note: Standard fetch API doesn't support proxies directly
 * This function prepares proxy configuration that can be used with custom fetch implementations
 * or HTTP libraries that support proxies
 */
export function createFetchOptionsWithProxy(
  proxy: ProxyConfig | null,
  additionalHeaders: Record<string, string> = {}
): {
  headers: Record<string, string>;
  proxy?: ProxyConfig;
} {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    ...additionalHeaders,
  };

  return {
    headers,
    proxy: proxy || undefined,
  };
}

