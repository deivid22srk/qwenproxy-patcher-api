/*
 * File: playwright.ts (COOKIE PATCHED VERSION)
 * =============================================
 * This file replaces the original Playwright-based service.
 * Instead of launching a browser, it reads cookies from environment
 * variables or a cookies.json file and makes direct HTTP requests.
 *
 * How to use:
 *   1. Login to chat.qwen.ai in your browser
 *   2. Open DevTools → Application → Cookies
 *   3. Copy all cookies as a string: "name=value; name2=value2"
 *   4. Set the QWEN_COOKIES environment variable OR create a cookies.json file
 */

import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { config } from '../core/config.ts';
import type { QwenAccount } from '../core/accounts.ts';

export type BrowserType = 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'edge';

// ============================================================
// Cookie Configuration
// ============================================================

interface CookieConfig {
  cookies: string;
  userAgent: string;
  bxV: string;
  bxUa?: string;
  bxUmidtoken?: string;
}

function loadCookieConfig(): CookieConfig {
  // Priority 1: Environment variable QWEN_COOKIES
  if (process.env.QWEN_COOKIES) {
    return {
      cookies: process.env.QWEN_COOKIES,
      userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      bxV: process.env.BX_V || '2.5.36',
      bxUa: process.env.BX_UA,
      bxUmidtoken: process.env.BX_UMIDTOKEN,
    };
  }

  // Priority 2: cookies.json file
  const cookiePaths = [
    path.resolve('cookies.json'),
    path.resolve('data/cookies.json'),
    path.resolve('config/cookies.json'),
  ];

  for (const cp of cookiePaths) {
    if (fs.existsSync(cp)) {
      try {
        const data = JSON.parse(fs.readFileSync(cp, 'utf-8'));
        return {
          cookies: data.cookies || data.token || '',
          userAgent: data.userAgent || config.browser.userAgent,
          bxV: data.bxV || '2.5.36',
          bxUa: data.bxUa,
          bxUmidtoken: data.bxUmidtoken,
        };
      } catch (e) {
        console.error(`[Cookies] Failed to parse ${cp}:`, e);
      }
    }
  }

  // Priority 3: .env QWEN_EMAIL + QWEN_PASSWORD (try API login)
  if (process.env.QWEN_EMAIL && process.env.QWEN_PASSWORD) {
    console.warn('[Cookies] No cookies found, but credentials present. Login will be attempted at runtime.');
    return {
      cookies: '',
      userAgent: config.browser.userAgent,
      bxV: '2.5.36',
    };
  }

  throw new Error(
    'No cookies found. Please set the QWEN_COOKIES environment variable or create a cookies.json file.\n\n' +
    'To get your cookies:\n' +
    '  1. Open Chrome/Firefox and login to https://chat.qwen.ai\n' +
    '  2. Open DevTools (F12) → Application → Cookies\n' +
    '  3. Copy all cookies as: "cookie1=value1; cookie2=value2"\n' +
    '  4. Export as env: export QWEN_COOKIES="your-cookies-here"\n' +
    '  OR create cookies.json with format: { "cookies": "your-cookies-here" }'
  );
}

// ============================================================
// Header Cache
// ============================================================

interface AccountHeaderCache {
  currentHeaders: Record<string, string>;
  cachedQwenHeaders: { headers: Record<string, string>, chatSessionId: string, parentMessageId: string | null } | null;
  lastHeadersTime: number;
  refreshTimeout: NodeJS.Timeout | null;
}

const accountHeaderCaches = new Map<string, AccountHeaderCache>();

function getAccountHeaderCache(accountId: string): AccountHeaderCache {
  let cache = accountHeaderCaches.get(accountId);
  if (!cache) {
    cache = {
      currentHeaders: {},
      cachedQwenHeaders: null,
      lastHeadersTime: 0,
      refreshTimeout: null,
    };
    accountHeaderCaches.set(accountId, cache);
  }
  return cache;
}

const HEADERS_TTL = 30 * 60 * 1000; // 30 minutes
const REFRESH_THRESHOLD = 0.7;

// ============================================================
// Mutex (kept from original for compatibility)
// ============================================================

export class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>(resolve => {
      this.queue.push(() => {
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

const uiMutex = new Mutex();

// ============================================================
// Cookie-based API functions
// ============================================================

/**
 * Returns the cookie string from the configuration.
 */
export async function getCookies(accountId?: string): Promise<string> {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return 'token=mock';
  const cfg = loadCookieConfig();
  return cfg.cookies;
}

/**
 * Returns basic headers for making requests to Qwen.
 */
export async function getBasicHeaders(accountId?: string): Promise<{ cookie: string, userAgent: string, bxV: string, bxUa?: string, bxUmidtoken?: string }> {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return { cookie: 'token=mock', userAgent: 'mock', bxV: '2.5.36' };
  const cfg = loadCookieConfig();
  return {
    cookie: cfg.cookies,
    userAgent: cfg.userAgent,
    bxV: cfg.bxV,
    bxUa: cfg.bxUa,
    bxUmidtoken: cfg.bxUmidtoken,
  };
}

/**
 * No-op: Playwright is not needed.
 */
export async function initPlaywright(headless = true, browserType: BrowserType = 'chromium') {
  console.log('[Cookies] Playwright browser initialization skipped. Using cookie-based requests.');
}

/**
 * No-op: Nothing to close.
 */
export async function closePlaywright() {
  // Clear all caches
  for (const cache of accountHeaderCaches.values()) {
    if (cache.refreshTimeout) {
      clearTimeout(cache.refreshTimeout);
      cache.refreshTimeout = null;
    }
  }
  accountHeaderCaches.clear();
  console.log('[Cookies] Session cache cleared.');
}

/**
 * Performs login to Qwen using the API directly (no browser needed).
 * This is useful for getting fresh cookies from credentials.
 */
export async function loginToQwen(email: string, password: string): Promise<boolean> {
  console.log(`[Cookies] Attempting API login for ${email}...`);

  const crypto = await import('crypto');
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

  try {
    const response = await fetch('https://chat.qwen.ai/api/v2/auths/signin', {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'source': 'web',
        'timezone': new Date().toString().split(' (')[0],
        'x-request-id': uuidv4(),
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({ email, password: hashedPassword, login_type: 'email' }),
    });

    const data = await response.json();
    if (response.ok) {
      console.log(`[Cookies] Login successful for ${email}.`);
      return true;
    }
    console.error(`[Cookies] Login failed for ${email}:`, data);
    return false;
  } catch (err: any) {
    console.error(`[Cookies] Login error for ${email}:`, err.message);
    return false;
  }
}

/**
 * Gets Qwen headers required for API requests.
 * Instead of intercepting browser requests, we construct the headers
 * from the cookie configuration and make a test request to get a session.
 */
export async function getQwenHeaders(
  forceNew = false,
  accountId?: string
): Promise<{ headers: Record<string, string>, chatSessionId: string, parentMessageId: string | null }> {
  const cacheKey = accountId || 'global';
  const cache = getAccountHeaderCache(cacheKey);

  if (!forceNew && cache.cachedQwenHeaders && (Date.now() - cache.lastHeadersTime < HEADERS_TTL * REFRESH_THRESHOLD)) {
    return cache.cachedQwenHeaders;
  }

  const release = await uiMutex.acquire();
  try {
    if (!forceNew && cache.cachedQwenHeaders && (Date.now() - cache.lastHeadersTime < HEADERS_TTL)) {
      return cache.cachedQwenHeaders;
    }
    return await getQwenHeadersInternal(forceNew, accountId);
  } finally {
    release();
  }
}

async function getQwenHeadersInternal(
  forceNew = false,
  accountId?: string
): Promise<{ headers: Record<string, string>, chatSessionId: string, parentMessageId: string | null }> {
  const cacheKey = accountId || 'global';
  const cache = getAccountHeaderCache(cacheKey);

  if (process.env.TEST_MOCK_PLAYWRIGHT) {
    const mockSessionId = process.env.TEST_SESSION_ID || 'mock-session';
    return {
      headers: {
        'authorization': 'Bearer MOCK',
        'cookie': 'token=mock',
        'user-agent': 'mock',
        'bx-v': '2.5.36',
      },
      chatSessionId: mockSessionId,
      parentMessageId: null,
    };
  }

  if (!forceNew && cache.cachedQwenHeaders && (Date.now() - cache.lastHeadersTime < HEADERS_TTL)) {
    return cache.cachedQwenHeaders;
  }

  const cfg = loadCookieConfig();

  // Construct headers from cookie configuration
  const headers: Record<string, string> = {
    'cookie': cfg.cookies,
    'user-agent': cfg.userAgent,
    'bx-v': cfg.bxV,
  };

  if (cfg.bxUa) headers['bx-ua'] = cfg.bxUa;
  if (cfg.bxUmidtoken) headers['bx-umidtoken'] = cfg.bxUmidtoken;

  // Try to get a chat session by making a test request and listing/creating chats
  let chatSessionId = '';
  let parentMessageId: string | null = null;

  try {
    // First, check if we can reach the Qwen API by fetching models
    const modelsResponse = await fetch('https://chat.qwen.ai/api/models', {
      headers: {
        'accept': 'application/json',
        'cookie': cfg.cookies,
        'referer': 'https://chat.qwen.ai/',
        'user-agent': cfg.userAgent,
        'x-request-id': uuidv4(),
        'bx-v': cfg.bxV,
      },
    });

    if (!modelsResponse.ok) {
      console.warn(`[Cookies] Models API returned ${modelsResponse.status}. Cookies may be expired.`);
    } else {
      const modelsData = await modelsResponse.json();
      console.log(`[Cookies] Successfully connected to Qwen API. Models available: ${modelsData?.data?.length || 0}`);
    }

    if (forceNew) {
      console.log('[Cookies] forceNew is true. Creating a brand new chat session...');
      const newChatResponse = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'cookie': cfg.cookies,
          'referer': 'https://chat.qwen.ai/',
          'user-agent': cfg.userAgent,
          'x-request-id': uuidv4(),
          'bx-v': cfg.bxV,
        },
        body: JSON.stringify({}),
      });

      if (newChatResponse.ok) {
        const newChatData = await newChatResponse.json();
        if (newChatData?.success && newChatData.data?.id) {
          chatSessionId = newChatData.data.id;
          console.log(`[Cookies] Successfully created new chat session: ${chatSessionId}`);
        } else {
          console.warn('[Cookies] Failed to create new chat session (success false/no ID):', newChatData);
        }
      } else {
        console.warn(`[Cookies] Failed to create new chat session: status ${newChatResponse.status}`);
      }
    } else {
      // Fetch the latest chat session ID from the user's account
      const chatsResponse = await fetch('https://chat.qwen.ai/api/v2/chats?page=1&pageSize=1', {
        headers: {
          'accept': 'application/json',
          'cookie': cfg.cookies,
          'referer': 'https://chat.qwen.ai/',
          'user-agent': cfg.userAgent,
          'x-request-id': uuidv4(),
          'bx-v': cfg.bxV,
        },
      });

      if (chatsResponse.ok) {
        const chatsData = await chatsResponse.json();
        if (chatsData?.success && chatsData.data && chatsData.data.length > 0) {
          chatSessionId = chatsData.data[0].id;
          console.log(`[Cookies] Automatically resolved active chat session ID: ${chatSessionId}`);
        } else {
          console.log('[Cookies] No active chats found in user account. Creating a brand new one...');
          const newChatResponse = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'content-type': 'application/json',
              'cookie': cfg.cookies,
              'referer': 'https://chat.qwen.ai/',
              'user-agent': cfg.userAgent,
              'x-request-id': uuidv4(),
              'bx-v': cfg.bxV,
            },
            body: JSON.stringify({}),
          });

          if (newChatResponse.ok) {
            const newChatData = await newChatResponse.json();
            if (newChatData?.success && newChatData.data?.id) {
              chatSessionId = newChatData.data.id;
              console.log(`[Cookies] Successfully created brand new chat session: ${chatSessionId}`);
            }
          }
        }
      } else {
        console.warn(`[Cookies] Chats API returned status ${chatsResponse.status}.`);
      }
    }
  } catch (err: any) {
    console.warn('[Cookies] Failed to initialize Qwen connection / manage chat session:', err.message);
  }

  headers['x-request-id'] = uuidv4();

  cache.currentHeaders = headers;
  cache.cachedQwenHeaders = { headers, chatSessionId, parentMessageId };
  cache.lastHeadersTime = Date.now();

  return cache.cachedQwenHeaders;
}

/**
 * No-op for account-specific browser initialization.
 */
export async function initPlaywrightForAccount(account: QwenAccount, headless = true, browserType: BrowserType = 'chromium') {
  console.log(`[Cookies] Account "${account.email}" initialized. Playwright not needed — using cookies.`);
}

/**
 * Opens a browser for manual login (falls back to instructing the user).
 */
export async function launchManualLoginAccount(accountId: string, browserType: BrowserType = 'chromium'): Promise<{ context: any, page: any }> {
  console.log(`
  ============================================================
  MANUAL LOGIN INSTRUCTIONS
  ============================================================
  1. Open your browser and go to https://chat.qwen.ai
  2. Login to your account
  3. Open DevTools (F12) → Application → Cookies
  4. Copy all cookies as a string
  5. Set the QWEN_COOKIES environment variable:
     export QWEN_COOKIES="your-cookies-here"
  6. Or create a cookies.json file:
     echo '{"cookies": "your-cookies-here"}' > cookies.json
  7. Restart the server
  ============================================================
  `);
  throw new Error('Manual browser login not supported in cookie mode. Please provide cookies via QWEN_COOKIES env or cookies.json file.');
}

/**
 * Returns account info from context (not applicable in cookie mode).
 */
export async function extractAccountInfoFromContext(page: any): Promise<{ email: string | null, hasSession: boolean }> {
  const cfg = loadCookieConfig();
  return {
    email: process.env.QWEN_EMAIL || null,
    hasSession: cfg.cookies.length > 0,
  };
}

/**
 * No-op: nothing to close per account.
 */
export async function closePlaywrightForAccount(accountId: string) {
  // Nothing to close
}

// Re-export and placeholders for compatibility
export let activePage: any = null;
export const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
export const CHROME_CLIENT_HINTS = '"Chromium";v="137", "Google Chrome";v="137", "Not/A)Brand";v="99"';

export async function getGuestHeaders(): Promise<Record<string, string>> {
  const qwenHeaders = await getQwenHeaders(false, 'guest');
  return qwenHeaders.headers;
}

export function getPageForAccount(accountId?: string): any {
  return null;
}

export async function browserFetch(page: any, url: string, options: any): Promise<any> {
  throw new Error('browserFetch is not supported in cookie mode.');
}

export async function browserStreamFetch(page: any, url: string, options: any): Promise<any> {
  throw new Error('browserStreamFetch is not supported in cookie mode.');
}
