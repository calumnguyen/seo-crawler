/**
 * Cookie Manager
 * Manages cookies per domain/session to maintain state across requests
 * This helps bypass fingerprinting by maintaining session consistency
 */

import { CookieJar } from 'tough-cookie';

interface DomainSession {
  cookieJar: CookieJar;
  userAgent: string;
  lastUsed: number;
  proxyUrl?: string; // Proxy used for this session
}

class CookieManager {
  private sessions: Map<string, DomainSession> = new Map();
  private sessionTimeout: number = 10 * 60 * 1000; // 10 minutes (matches sticky session)
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up stale sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions();
    }, 5 * 60 * 1000);
  }

  /**
   * Get or create a session for a domain
   */
  getSession(domain: string, proxyUrl?: string): DomainSession {
    const sessionKey = this.getSessionKey(domain, proxyUrl);
    
    let session = this.sessions.get(sessionKey);
    
    if (!session || this.isSessionExpired(session)) {
      // Create new session
      session = {
        cookieJar: new CookieJar(),
        userAgent: this.generateUserAgent(),
        lastUsed: Date.now(),
        proxyUrl,
      };
      this.sessions.set(sessionKey, session);
    } else {
      // Update last used time
      session.lastUsed = Date.now();
    }
    
    return session;
  }

  /**
   * Get cookies for a URL
   */
  async getCookies(url: string, proxyUrl?: string): Promise<string> {
    try {
      const domain = new URL(url).hostname;
      const session = this.getSession(domain, proxyUrl);
      const cookies = await session.cookieJar.getCookies(url);
      return cookies.map(cookie => cookie.cookieString()).join('; ');
    } catch (error) {
      console.error(`[CookieManager] Error getting cookies for ${url}:`, error);
      return '';
    }
  }

  /**
   * Store cookies from a response
   */
  async setCookies(url: string, cookieHeader: string | null, proxyUrl?: string): Promise<void> {
    if (!cookieHeader) return;
    
    try {
      const domain = new URL(url).hostname;
      const session = this.getSession(domain, proxyUrl);
      
      // Parse Set-Cookie header
      const cookies = cookieHeader.split(',').map(c => c.trim());
      for (const cookie of cookies) {
        await session.cookieJar.setCookie(cookie, url);
      }
    } catch (error) {
      console.error(`[CookieManager] Error setting cookies for ${url}:`, error);
    }
  }

  /**
   * Store cookies from Set-Cookie headers array
   */
  async setCookiesFromHeaders(url: string, setCookieHeaders: string[], proxyUrl?: string): Promise<void> {
    if (!setCookieHeaders || setCookieHeaders.length === 0) return;
    
    try {
      const domain = new URL(url).hostname;
      const session = this.getSession(domain, proxyUrl);
      
      for (const cookieHeader of setCookieHeaders) {
        await session.cookieJar.setCookie(cookieHeader, url);
      }
    } catch (error) {
      console.error(`[CookieManager] Error setting cookies from headers for ${url}:`, error);
    }
  }

  /**
   * Get User-Agent for a domain session (consistent per session)
   */
  getUserAgent(domain: string, proxyUrl?: string): string {
    const session = this.getSession(domain, proxyUrl);
    return session.userAgent;
  }

  /**
   * Clear session for a domain
   */
  clearSession(domain: string, proxyUrl?: string): void {
    const sessionKey = this.getSessionKey(domain, proxyUrl);
    this.sessions.delete(sessionKey);
  }

  /**
   * Clear all sessions
   */
  clearAll(): void {
    this.sessions.clear();
  }

  /**
   * Generate a session key
   */
  private getSessionKey(domain: string, proxyUrl?: string): string {
    // Include proxy URL in session key to maintain separate sessions per proxy
    return proxyUrl ? `${domain}:${proxyUrl}` : domain;
  }

  /**
   * Check if session is expired
   */
  private isSessionExpired(session: DomainSession): boolean {
    return Date.now() - session.lastUsed > this.sessionTimeout;
  }

  /**
   * Generate a User-Agent (consistent per session)
   */
  private generateUserAgent(): string {
    // Use realistic browser User-Agents
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  /**
   * Clean up stale sessions
   */
  private cleanupStaleSessions(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastUsed > this.sessionTimeout) {
        this.sessions.delete(key);
      }
    }
  }

  /**
   * Get session stats
   */
  getStats(): { activeSessions: number; sessions: Array<{ domain: string; lastUsed: number }> } {
    const sessions = Array.from(this.sessions.entries()).map(([key, session]) => {
      const domain = key.split(':')[0]; // Extract domain from key
      return {
        domain,
        lastUsed: session.lastUsed,
      };
    });
    
    return {
      activeSessions: sessions.length,
      sessions,
    };
  }
}

// Singleton instance
let cookieManagerInstance: CookieManager | null = null;

export function getCookieManager(): CookieManager {
  if (!cookieManagerInstance) {
    cookieManagerInstance = new CookieManager();
  }
  return cookieManagerInstance;
}

