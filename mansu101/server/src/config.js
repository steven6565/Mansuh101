import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '../..');

const env = process.env;
const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  port: int(env.PORT, 4000),
  appPassword: env.APP_PASSWORD || 'mansu101',
  appPasswordWeak: !env.APP_PASSWORD
    || env.APP_PASSWORD === 'mansu101'
    || env.APP_PASSWORD === 'change-me-to-a-long-random-password'
    || env.APP_PASSWORD.length < 12,
  authDisabled: bool(env.AUTH_DISABLED, false),
  sessionTtlDays: int(env.SESSION_TTL_DAYS, 14),
  publicUrl: env.PUBLIC_URL || '',
  trustProxy: bool(env.TRUST_PROXY, true),
  dataDir: path.resolve(ROOT_DIR, env.DATA_DIR || 'data'),
  databaseUrl: env.DATABASE_URL || 'sqlite:./data/mansu101.db',
  retentionDays: int(env.RETENTION_DAYS, 30),
  chromiumPath: env.CHROMIUM_PATH || '',
  browserHeadless: bool(env.BROWSER_HEADLESS, true),
  maxConcurrency: Math.max(1, int(env.MAX_CONCURRENCY, 8)),
  browserIdleCloseMs: int(env.BROWSER_IDLE_CLOSE_MS, 180000),
  chromiumExtraArgs: (env.CHROMIUM_EXTRA_ARGS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  vncUrl: env.VNC_URL || '',
  redisUrl: env.REDIS_URL || '',
  seedFile: path.resolve(ROOT_DIR, 'config/urls.json'),
  webDist: path.resolve(ROOT_DIR, 'web/dist'),
};

export const dirs = {
  data: config.dataDir,
  screenshots: path.join(config.dataDir, 'screenshots'),
  reports: path.join(config.dataDir, 'reports'),
  logs: path.join(config.dataDir, 'logs'),
};

for (const dir of Object.values(dirs)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const screenshotsDir = dirs.screenshots;

export const BROWSER_PROFILES = {
  'desktop-chrome-windows': {
    label: 'Desktop · Chrome / Windows',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  'desktop-chrome-mac': {
    label: 'Desktop · Chrome / macOS',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1512, height: 982, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  },
  'mobile-android': {
    label: 'Mobile · Chrome / Android',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  'mobile-ios': {
    label: 'Mobile · Safari / iPhone',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  'tablet-ipad': {
    label: 'Tablet · Safari / iPad',
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    viewport: { width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  custom: {
    label: 'Custom User-Agent',
    userAgent: '',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    locale: 'en-US',
    timezoneId: 'UTC',
  },
};

export const DEFAULT_SETTINGS = {
  concurrency: 4,
  navigationTimeoutMs: 45000,
  sessionDurationMs: 120000,
  screenshotIntervalMs: 10000,
  waitAfterLoadMs: 750,
  networkIdleTimeoutMs: 8000,
  // Repeat visits: how many times each enabled URL is visited in one run.
  visitsPerUrl: 1,
  // Delay between two visits of the same URL (ms).
  repeatDelayMs: 5000,
  // When true, keep re-visiting every enabled URL until Stop is pressed.
  loopUntilStopped: false,
  // Smooth scrolling: scroll down to the bottom and back up, like a reader.
  scrollEnabled: true,
  // Pixels moved per scroll step.
  scrollStepPx: 600,
  // Pause between scroll steps (ms).
  scrollPauseMs: 1200,
  // How many down + up passes per visit.
  scrollPasses: 1,
  // Click same-site internal links (never ads) and come back.
  clickInternalLinks: false,
  // How many internal links to click per visit (0 = none).
  clicksPerVisit: 1,
  viewport: { width: 1440, height: 900 },
  profile: 'desktop-chrome-windows',
  customUserAgent: '',
  headless: config.browserHeadless,
  blockImages: false,
};

export function sanitizeSettings(input = {}, current = DEFAULT_SETTINGS) {
  const num = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const profile = BROWSER_PROFILES[input.profile] ? input.profile : current.profile;
  const viewport = {
    width: num(input.viewport?.width, 320, 3840, current.viewport.width),
    height: num(input.viewport?.height, 240, 2160, current.viewport.height),
  };
  return {
    concurrency: num(input.concurrency, 1, config.maxConcurrency, current.concurrency),
    navigationTimeoutMs: num(input.navigationTimeoutMs, 5000, 300000, current.navigationTimeoutMs),
    sessionDurationMs: num(input.sessionDurationMs, 10000, 1800000, current.sessionDurationMs),
    screenshotIntervalMs: num(input.screenshotIntervalMs, 0, 120000, current.screenshotIntervalMs),
    waitAfterLoadMs: num(input.waitAfterLoadMs, 0, 15000, current.waitAfterLoadMs),
    networkIdleTimeoutMs: num(input.networkIdleTimeoutMs, 0, 30000, current.networkIdleTimeoutMs),
    visitsPerUrl: num(input.visitsPerUrl, 1, 100, current.visitsPerUrl ?? 1),
    repeatDelayMs: num(input.repeatDelayMs, 0, 600000, current.repeatDelayMs ?? 5000),
    loopUntilStopped: typeof input.loopUntilStopped === 'boolean'
      ? input.loopUntilStopped
      : Boolean(current.loopUntilStopped ?? false),
    scrollEnabled: typeof input.scrollEnabled === 'boolean'
      ? input.scrollEnabled
      : Boolean(current.scrollEnabled ?? true),
    scrollStepPx: num(input.scrollStepPx, 200, 2000, current.scrollStepPx ?? 600),
    scrollPauseMs: num(input.scrollPauseMs, 0, 10000, current.scrollPauseMs ?? 1200),
    scrollPasses: num(input.scrollPasses, 1, 3, current.scrollPasses ?? 1),
    clickInternalLinks: typeof input.clickInternalLinks === 'boolean'
      ? input.clickInternalLinks
      : Boolean(current.clickInternalLinks ?? false),
    clicksPerVisit: num(input.clicksPerVisit, 0, 5, current.clicksPerVisit ?? 1),
    viewport,
    profile,
    customUserAgent: String(input.customUserAgent ?? current.customUserAgent ?? '').slice(0, 500),
    headless: typeof input.headless === 'boolean' ? input.headless : current.headless,
    blockImages: typeof input.blockImages === 'boolean' ? input.blockImages : current.blockImages,
  };
}

export function normalizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!url.hostname.includes('.')) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
