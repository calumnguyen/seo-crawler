/**
 * CAPTCHA Solver Service Integration
 * Supports 2Captcha and AntiCaptcha services
 * 
 * Environment variables:
 * - CAPTCHA_SOLVER: '2captcha' | 'anticaptcha' | 'none' (default: 'none')
 * - CAPTCHA_API_KEY: Your API key for the selected service
 * - CAPTCHA_TIMEOUT: Timeout for solving (default: 120000 = 2 minutes)
 */

export interface CaptchaSolveResult {
  success: boolean;
  token?: string;
  error?: string;
}

export interface CaptchaSolver {
  solve(reCaptchaSiteKey: string, pageUrl: string): Promise<CaptchaSolveResult>;
  solveImageCaptcha(imageBase64: string): Promise<CaptchaSolveResult>;
  getBalance(): Promise<number>;
}

class TwoCaptchaSolver implements CaptchaSolver {
  private apiKey: string;
  private baseUrl: string = 'https://2captcha.com';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async solve(reCaptchaSiteKey: string, pageUrl: string): Promise<CaptchaSolveResult> {
    try {
      // Submit CAPTCHA for solving
      const submitResponse = await fetch(`${this.baseUrl}/in.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          key: this.apiKey,
          method: 'userrecaptcha',
          googlekey: reCaptchaSiteKey,
          pageurl: pageUrl,
          json: '1',
        }),
      });

      const submitData = await submitResponse.json();
      
      if (submitData.status !== 1) {
        const errorMsg = submitData.request || submitData.error_text || 'Failed to submit CAPTCHA';
        console.error(`[CaptchaSolver] 2Captcha submit failed: status=${submitData.status}, error="${errorMsg}"`);
        // Common errors: ERROR_ZERO_BALANCE, ERROR_WRONG_USER_KEY, ERROR_KEY_DOES_NOT_EXIST
        // 2Captcha returns blog URLs for unsupported CAPTCHA types (like Google Search reCAPTCHA)
        if (errorMsg.includes('balance') || errorMsg.includes('BALANCE')) {
          console.error(`[CaptchaSolver] ⚠️ 2Captcha account balance is zero or insufficient`);
        }
        if (errorMsg.includes('blog') || errorMsg.includes('http')) {
          console.warn(`[CaptchaSolver] ⚠️ 2Captcha doesn't support this CAPTCHA type (returned blog URL). This is expected for Google Search reCAPTCHA.`);
        }
        return { success: false, error: errorMsg };
      }

      const captchaId = submitData.request;
      const timeout = parseInt(process.env.CAPTCHA_TIMEOUT || '120000', 10);
      const startTime = Date.now();

      // Poll for result
      while (Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between polls

        const resultResponse = await fetch(
          `${this.baseUrl}/res.php?key=${this.apiKey}&action=get&id=${captchaId}&json=1`
        );
        const resultData = await resultResponse.json();

        if (resultData.status === 1) {
          return { success: true, token: resultData.request };
        }

        if (resultData.request !== 'CAPCHA_NOT_READY') {
          const errorMsg = resultData.request || resultData.error_text || 'CAPTCHA solving failed';
          console.error(`[CaptchaSolver] 2Captcha result error: status=${resultData.status}, error="${errorMsg}"`);
          return { success: false, error: errorMsg };
        }
      }

      return { success: false, error: 'CAPTCHA solving timeout' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async solveImageCaptcha(imageBase64: string): Promise<CaptchaSolveResult> {
    try {
      const submitResponse = await fetch(`${this.baseUrl}/in.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          key: this.apiKey,
          method: 'base64',
          body: imageBase64,
          json: '1',
        }),
      });

      const submitData = await submitResponse.json();
      
      if (submitData.status !== 1) {
        const errorMsg = submitData.request || submitData.error_text || 'Failed to submit image CAPTCHA';
        console.error(`[CaptchaSolver] 2Captcha image submit failed: status=${submitData.status}, error="${errorMsg}"`);
        return { success: false, error: errorMsg };
      }

      const captchaId = submitData.request;
      const timeout = parseInt(process.env.CAPTCHA_TIMEOUT || '120000', 10);
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 5000));

        const resultResponse = await fetch(
          `${this.baseUrl}/res.php?key=${this.apiKey}&action=get&id=${captchaId}&json=1`
        );
        const resultData = await resultResponse.json();

        if (resultData.status === 1) {
          return { success: true, token: resultData.request };
        }

        if (resultData.request !== 'CAPCHA_NOT_READY') {
          const errorMsg = resultData.request || resultData.error_text || 'Image CAPTCHA solving failed';
          console.error(`[CaptchaSolver] 2Captcha image result error: status=${resultData.status}, error="${errorMsg}"`);
          return { success: false, error: errorMsg };
        }
      }

      console.warn(`[CaptchaSolver] Image CAPTCHA solving timeout after ${timeout}ms`);
      return { success: false, error: 'Image CAPTCHA solving timeout' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[CaptchaSolver] Exception during image CAPTCHA solving:`, error);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  async getBalance(): Promise<number> {
    try {
      const response = await fetch(`${this.baseUrl}/res.php?key=${this.apiKey}&action=getbalance&json=1`);
      const data = await response.json();
      return data.request ? parseFloat(data.request) : 0;
    } catch {
      return 0;
    }
  }
}

class AntiCaptchaSolver implements CaptchaSolver {
  private apiKey: string;
  private baseUrl: string = 'https://api.anti-captcha.com';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async solve(reCaptchaSiteKey: string, pageUrl: string): Promise<CaptchaSolveResult> {
    try {
      // Create task
      const createResponse = await fetch(`${this.baseUrl}/createTask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientKey: this.apiKey,
          task: {
            type: 'RecaptchaV2TaskProxyless',
            websiteURL: pageUrl,
            websiteKey: reCaptchaSiteKey,
          },
        }),
      });

      const createData = await createResponse.json();
      
      if (createData.errorId !== 0) {
        return { success: false, error: createData.errorDescription || 'Failed to create task' };
      }

      const taskId = createData.taskId;
      const timeout = parseInt(process.env.CAPTCHA_TIMEOUT || '120000', 10);
      const startTime = Date.now();

      // Poll for result
      while (Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 5000));

        const resultResponse = await fetch(`${this.baseUrl}/getTaskResult`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientKey: this.apiKey,
            taskId: taskId,
          }),
        });

        const resultData = await resultResponse.json();

        if (resultData.status === 'ready') {
          return { success: true, token: resultData.solution.gRecaptchaResponse };
        }

        if (resultData.errorId !== 0) {
          return { success: false, error: resultData.errorDescription || 'CAPTCHA solving failed' };
        }
      }

      return { success: false, error: 'CAPTCHA solving timeout' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async solveImageCaptcha(imageBase64: string): Promise<CaptchaSolveResult> {
    // AntiCaptcha image CAPTCHA solving implementation
    // Similar to reCaptcha but with ImageToTextTask type
    return { success: false, error: 'Image CAPTCHA not yet implemented for AntiCaptcha' };
  }

  async getBalance(): Promise<number> {
    try {
      const response = await fetch(`${this.baseUrl}/getBalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: this.apiKey }),
      });
      const data = await response.json();
      return data.balance || 0;
    } catch {
      return 0;
    }
  }
}

class NoOpCaptchaSolver implements CaptchaSolver {
  async solve(): Promise<CaptchaSolveResult> {
    return { success: false, error: 'CAPTCHA solver not configured' };
  }

  async solveImageCaptcha(): Promise<CaptchaSolveResult> {
    return { success: false, error: 'CAPTCHA solver not configured' };
  }

  async getBalance(): Promise<number> {
    return 0;
  }
}

// Singleton instance
let captchaSolverInstance: CaptchaSolver | null = null;

export function getCaptchaSolver(): CaptchaSolver {
  if (!captchaSolverInstance) {
    const solverType = (process.env.CAPTCHA_SOLVER || 'none').toLowerCase();
    const apiKey = process.env.CAPTCHA_API_KEY || '';

    if (solverType === '2captcha' && apiKey) {
      captchaSolverInstance = new TwoCaptchaSolver(apiKey);
      console.log('[CaptchaSolver] Using 2Captcha service');
    } else if (solverType === 'anticaptcha' && apiKey) {
      captchaSolverInstance = new AntiCaptchaSolver(apiKey);
      console.log('[CaptchaSolver] Using AntiCaptcha service');
    } else {
      captchaSolverInstance = new NoOpCaptchaSolver();
      console.log('[CaptchaSolver] CAPTCHA solver disabled (set CAPTCHA_SOLVER and CAPTCHA_API_KEY to enable)');
    }
  }

  return captchaSolverInstance;
}

/**
 * Extract reCaptcha site key from HTML
 */
export function extractReCaptchaSiteKey(html: string): string | null {
  // Try to find reCaptcha site key in various formats
  const patterns = [
    /data-sitekey=["']([^"']+)["']/i,
    /sitekey["']?\s*[:=]\s*["']([^"']+)["']/i,
    /recaptcha.*?sitekey["']?\s*[:=]\s*["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

