import type { CheerioAPI } from 'cheerio';

/**
 * Detects if a link is a honeypot (hidden from users but visible to crawlers)
 * 
 * Honeypots are links that are:
 * - Hidden via CSS (display: none, visibility: hidden, opacity: 0)
 * - Positioned off-screen (position: absolute; left: -9999px)
 * - Zero-sized (width: 0, height: 0, font-size: 0)
 * - Inside elements with aria-hidden="true"
 * - Using common hidden class names
 * - Using data attributes indicating honeypots
 * - Using advanced CSS techniques (clip, text-indent, color matching)
 * 
 * This helps protect crawlers from following spam/trap links that are
 * designed to identify bots or lead to malicious content.
 */
export function isHoneypotLink($link: any, $: CheerioAPI): boolean {
  // Check aria-hidden attribute (direct or on parent)
  if ($link.attr('aria-hidden') === 'true') {
    return true;
  }

  // Check data attributes that explicitly indicate honeypots
  const dataAttributes = ['data-honeypot', 'data-bot-trap', 'data-spam-trap', 'data-crawler-trap'];
  for (const attr of dataAttributes) {
    if ($link.attr(attr) === 'true' || $link.attr(attr) === '1') {
      return true;
    }
  }

  // Check if link or any parent has aria-hidden="true"
  let parent = $link.parent();
  for (let i = 0; i < 10 && parent.length > 0; i++) {
    if (parent.attr('aria-hidden') === 'true') {
      return true;
    }
    // Also check data attributes on parents
    for (const attr of dataAttributes) {
      if (parent.attr(attr) === 'true' || parent.attr(attr) === '1') {
        return true;
      }
    }
    parent = parent.parent();
  }

  // Check inline styles on the link element (enhanced patterns)
  const inlineStyle = $link.attr('style') || '';
  if (inlineStyle) {
    const styleLower = inlineStyle.toLowerCase();
    
    // Basic hiding patterns
    if (
      styleLower.includes('display:none') ||
      styleLower.includes('display: none') ||
      styleLower.includes('visibility:hidden') ||
      styleLower.includes('visibility: hidden') ||
      styleLower.includes('opacity:0') ||
      styleLower.includes('opacity: 0') ||
      styleLower.includes('opacity:0;') ||
      styleLower.includes('opacity: 0;')
    ) {
      return true;
    }

    // Off-screen positioning
    if (
      (styleLower.includes('position:absolute') || styleLower.includes('position: fixed')) &&
      (styleLower.includes('left:-9999') || styleLower.includes('left: -9999') ||
       styleLower.includes('left:-10000') || styleLower.includes('left: -10000') ||
       styleLower.includes('top:-9999') || styleLower.includes('top: -9999'))
    ) {
      return true;
    }

    // Zero-size detection
    if (
      (styleLower.includes('width:0') || styleLower.includes('width: 0') || styleLower.includes('width:0px')) &&
      (styleLower.includes('height:0') || styleLower.includes('height: 0') || styleLower.includes('height:0px'))
    ) {
      return true;
    }

    // Clip/clip-path hiding (advanced CSS techniques)
    if (
      styleLower.includes('clip:rect(0,0,0,0)') ||
      styleLower.includes('clip: rect(0,0,0,0)') ||
      styleLower.includes('clip-path:inset(100%)') ||
      styleLower.includes('clip-path: inset(100%)') ||
      styleLower.includes('clip-path: polygon(0 0)')
    ) {
      return true;
    }

    // Text-indent off-screen (common honeypot technique)
    if (
      styleLower.includes('text-indent:-9999') ||
      styleLower.includes('text-indent: -9999') ||
      styleLower.includes('text-indent:-10000') ||
      styleLower.includes('text-indent: -10000')
    ) {
      return true;
    }

    // Color matching (transparent or matching background)
    if (
      styleLower.includes('color:transparent') ||
      styleLower.includes('color: transparent') ||
      styleLower.includes('color:rgba(0,0,0,0)') ||
      styleLower.includes('color: rgba(0,0,0,0)')
    ) {
      // Only flag if combined with suspicious patterns (color alone could be legitimate)
      if (styleLower.includes('background') || styleLower.includes('bg-')) {
        return true;
      }
    }

    // Overflow hidden with zero dimensions
    if (
      styleLower.includes('overflow:hidden') &&
      (styleLower.includes('width:0') || styleLower.includes('width: 0') ||
       styleLower.includes('height:0') || styleLower.includes('height: 0'))
    ) {
      return true;
    }

    // Font-size zero (already checked, but ensure comprehensive)
    if (
      styleLower.includes('font-size:0') ||
      styleLower.includes('font-size: 0') ||
      styleLower.includes('font-size:0px')
    ) {
      return true;
    }

    // Transform scale(0) or very small scale
    if (
      styleLower.includes('transform:scale(0)') ||
      styleLower.includes('transform: scale(0)') ||
      styleLower.includes('transform:scale(0.001)')
    ) {
      return true;
    }
  }

  // Check inline styles on parent elements (up to 3 levels)
  parent = $link.parent();
  for (let i = 0; i < 3 && parent.length > 0; i++) {
    const parentStyle = parent.attr('style') || '';
    if (parentStyle) {
      const styleLower = parentStyle.toLowerCase();
      if (
        styleLower.includes('display:none') ||
        styleLower.includes('display: none') ||
        styleLower.includes('visibility:hidden') ||
        styleLower.includes('visibility: hidden')
      ) {
        return true;
      }
    }
    parent = parent.parent();
  }

  // Check for common hidden class names (expanded list)
  const classNames = $link.attr('class') || '';
  const classNamesLower = classNames.toLowerCase();
  const hiddenClasses = [
    // Basic hiding
    'hidden',
    'hide',
    'invisible',
    'no-display',
    'not-visible',
    'd-none', // Bootstrap
    'd-hide', // Common variant
    
    // Screen reader only (often legitimate, but can be honeypots)
    'sr-only',
    'screen-reader-only',
    'sr-only-focusable',
    'visually-hidden',
    'visuallyhidden',
    'a11y-only',
    'accessibility-only',
    
    // Off-screen
    'offscreen',
    'off-screen',
    'offcanvas', // Sometimes used for hidden navigation
    
    // Explicit honeypot/spam indicators
    'honeypot',
    'spam-trap',
    'bot-trap',
    'crawler-trap',
    'spam',
    'trap',
    
    // Framework-specific (Tailwind, Bootstrap, etc.)
    'hidden-xs', 'hidden-sm', 'hidden-md', 'hidden-lg', // Bootstrap responsive
    'collapse', // Bootstrap
    'd-none', // Bootstrap display none
    
    // Common patterns
    'noindex', // Sometimes used to hide from crawlers
    'nofollow-hidden',
    'skip-link', // Sometimes legitimate, but can be traps
  ];

  // Check for class names that contain hidden keywords (pattern matching)
  const hiddenPatterns = [
    /hidden/i,
    /hide/i,
    /invisible/i,
    /honeypot/i,
    /spam.*trap/i,
    /bot.*trap/i,
    /crawler.*trap/i,
  ];

  if (
    hiddenClasses.some((hiddenClass) => classNamesLower.includes(hiddenClass)) ||
    hiddenPatterns.some((pattern) => pattern.test(classNamesLower))
  ) {
    return true;
  }

  // Check parent elements for hidden classes
  parent = $link.parent();
  for (let i = 0; i < 3 && parent.length > 0; i++) {
    const parentClasses = parent.attr('class') || '';
    const parentClassesLower = parentClasses.toLowerCase();
    if (hiddenClasses.some((hiddenClass) => parentClassesLower.includes(hiddenClass))) {
      return true;
    }
    parent = parent.parent();
  }

  // Check for suspicious URL patterns in href
  const href = $link.attr('href') || '';
  if (href) {
    const hrefLower = href.toLowerCase();
    const suspiciousUrlPatterns = [
      '/honeypot',
      '/spam-trap',
      '/bot-trap',
      '/crawler-trap',
      '/trap',
      '/spam',
      'honeypot=1',
      'bot=1',
      'trap=1',
      'spam=1',
    ];
    
    if (suspiciousUrlPatterns.some((pattern) => hrefLower.includes(pattern))) {
      return true;
    }
  }

  // Check for links with zero or very small text content (common honeypot pattern)
  const linkText = $link.text().trim();
  if (linkText.length === 0) {
    // Empty link text is suspicious but not always a honeypot
    // Could be an image link, so we'll allow it but log it
    // Empty links are often honeypots, but sometimes legitimate (icon-only links)
    // For now, we'll be conservative and not filter empty text links
  }

  // Check for suspicious link text patterns (common spam/honeypot indicators)
  const suspiciousPatterns = [
    /^(click here|read more|see more)$/i,
    /^(\.|,|;|:|\||-|_)$/, // Single punctuation
    /^\s*$/, // Only whitespace
  ];

  // But these are not always honeypots, so we won't filter based on text alone

  return false;
}

/**
 * Filter out honeypot links from an array of links
 */
export function filterHoneypotLinks<T extends { href: string }>(
  links: T[],
  $: any,
  selector: string = 'a[href]'
): T[] {
  // Note: This function signature assumes links are already extracted
  // For better performance, we filter during extraction in crawler.ts
  return links; // Placeholder - actual filtering happens in crawler.ts
}

