export interface SEOData {
  url: string;
  title: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  metaRobots: string | null; // e.g., "noindex, nofollow"
  h1: string[];
  h2: string[];
  h3: string[];
  images: ImageData[];
  links: LinkData[];
  canonicalUrl: string | null;
  ogTags: OGTags;
  language: string | null;
  crawledAt: Date;
  statusCode: number;
  responseTime: number;
  // Redirect tracking
  redirectChain?: string[];
  redirectCount?: number;
  finalUrl?: string | null;
  // HTTP headers
  headers?: Record<string, string>;
  contentLength?: number | null;
  lastModified?: string | null;
  etag?: string | null;
  // Structured data
  structuredData?: any[]; // JSON-LD, microdata, etc.
  // Content metrics
  wordCount?: number;
  contentQualityScore?: number;
  contentDepthScore?: number;
  // Content hash for similarity detection
  contentHash?: string;
  // Performance metrics
  performanceMetrics?: PerformanceMetrics;
  // Mobile-specific metrics
  mobileMetrics?: MobileMetrics;
  // Full HTML for analysis (optional, not always needed)
  html?: string | null;
}

export interface PerformanceMetrics {
  // Core Web Vitals
  largestContentfulPaint?: number | null; // LCP in ms
  firstInputDelay?: number | null; // FID in ms
  cumulativeLayoutShift?: number | null; // CLS score
  firstContentfulPaint?: number | null; // FCP in ms
  timeToInteractive?: number | null; // TTI in ms
  totalBlockingTime?: number | null; // TBT in ms
  speedIndex?: number | null; // SI score
  // AI SEO Effectiveness (0-1 score)
  aiSeoScore?: number | null;
}

export interface MobileMetrics {
  hasViewportMeta?: boolean;
  viewportContent?: string | null;
  isMobileFriendly?: boolean | null;
  touchTargetSize?: 'good' | 'needs-improvement' | 'poor' | null;
  textReadability?: 'good' | 'needs-improvement' | 'poor' | null;
  contentWidth?: number | null; // Actual content width in pixels
}

export interface ImageData {
  src: string;
  alt: string | null;
  title: string | null;
  width?: number | null;
  height?: number | null;
}

export interface LinkData {
  href: string;
  text: string;
  isExternal: boolean;
  rel: string | null;
}

export interface OGTags {
  title: string | null;
  description: string | null;
  image: string | null;
  type: string | null;
  url: string | null;
}


