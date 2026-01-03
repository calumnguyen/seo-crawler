export interface SEOData {
  url: string;
  title: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
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
}

export interface ImageData {
  src: string;
  alt: string | null;
  title: string | null;
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

