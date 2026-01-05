/**
 * CAPTCHA Detection Module
 * Detects CAPTCHA challenges in HTML responses from search engines
 */

export interface CaptchaDetectionResult {
  isCaptcha: boolean;
  captchaType?: 'google-recaptcha' | 'google-image' | 'bing' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  indicators: string[];
}

/**
 * Detect CAPTCHA in HTML content
 */
export function detectCaptcha(html: string, url: string): CaptchaDetectionResult {
  const indicators: string[] = [];
  let captchaType: CaptchaDetectionResult['captchaType'] | undefined;
  let confidence: CaptchaDetectionResult['confidence'] = 'low';

  const lowerHtml = html.toLowerCase();

  // Google reCAPTCHA indicators
  const recaptchaIndicators = [
    'recaptcha',
    'g-recaptcha',
    'recaptcha-container',
    'are you a robot',
    'verify you\'re not a robot',
    'unusual traffic',
    'automated queries',
  ];

  const hasRecaptcha = recaptchaIndicators.some(indicator => 
    lowerHtml.includes(indicator.toLowerCase())
  );

  if (hasRecaptcha) {
    indicators.push(...recaptchaIndicators.filter(indicator => 
      lowerHtml.includes(indicator.toLowerCase())
    ));
    captchaType = 'google-recaptcha';
    confidence = 'high';
  }

  // Google Image CAPTCHA indicators
  const googleImageCaptchaIndicators = [
    'select all images with',
    'select all squares with',
    'verify you\'re human',
    'captcha-image',
    'captcha-image-container',
  ];

  const hasGoogleImageCaptcha = googleImageCaptchaIndicators.some(indicator =>
    lowerHtml.includes(indicator.toLowerCase())
  );

  if (hasGoogleImageCaptcha) {
    indicators.push(...googleImageCaptchaIndicators.filter(indicator =>
      lowerHtml.includes(indicator.toLowerCase())
    ));
    captchaType = captchaType || 'google-image';
    confidence = 'high';
  }

  // Bing CAPTCHA indicators
  const bingCaptchaIndicators = [
    'bing captcha',
    'verify you are human',
    'security challenge',
    'unusual activity',
  ];

  const hasBingCaptcha = bingCaptchaIndicators.some(indicator =>
    lowerHtml.includes(indicator.toLowerCase())
  );

  if (hasBingCaptcha) {
    indicators.push(...bingCaptchaIndicators.filter(indicator =>
      lowerHtml.includes(indicator.toLowerCase())
    ));
    captchaType = 'bing';
    confidence = 'high';
  }

  // Generic CAPTCHA indicators (lower confidence)
  const genericCaptchaIndicators = [
    'captcha',
    'challenge',
    'security check',
    'verification',
    'too many requests',
    'rate limit',
    'access denied',
  ];

  if (!captchaType) {
    const hasGenericCaptcha = genericCaptchaIndicators.some(indicator =>
      lowerHtml.includes(indicator.toLowerCase())
    );

    if (hasGenericCaptcha) {
      indicators.push(...genericCaptchaIndicators.filter(indicator =>
        lowerHtml.includes(indicator.toLowerCase())
      ));
      captchaType = 'unknown';
      confidence = 'medium';
    }
  }

  // Check HTTP status codes that might indicate CAPTCHA
  // (this will be checked separately in the response handler)

  // Check for redirect to CAPTCHA page
  if (url.includes('sorry') || url.includes('captcha') || url.includes('challenge')) {
    indicators.push('captcha-url-indicator');
    captchaType = captchaType || 'unknown';
    confidence = confidence === 'low' ? 'medium' : confidence;
  }

  const isCaptcha = indicators.length > 0 && (confidence === 'high' || confidence === 'medium');

  return {
    isCaptcha,
    captchaType,
    confidence,
    indicators: [...new Set(indicators)], // Remove duplicates
  };
}

/**
 * Detect CAPTCHA from HTTP response
 */
export function detectCaptchaFromResponse(
  response: Response,
  html: string
): CaptchaDetectionResult {
  const result = detectCaptcha(html, response.url);

  // Check HTTP status codes
  if (response.status === 429) {
    // Too Many Requests - might lead to CAPTCHA
    result.isCaptcha = true;
    result.confidence = result.confidence === 'low' ? 'medium' : result.confidence;
    result.indicators.push('http-429');
  }

  if (response.status === 403) {
    // Forbidden - could be CAPTCHA
    result.confidence = result.confidence === 'low' ? 'medium' : result.confidence;
    result.indicators.push('http-403');
  }

  // Check response headers
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html') && result.isCaptcha) {
    result.confidence = 'high';
  }

  return result;
}

