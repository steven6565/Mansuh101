import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { config } from '../config.js';

const CANDIDATES = [
  // Prefer real .deb installs; snap wrappers often fail under a different user.
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
  '/usr/bin/microsoft-edge',
  '/snap/bin/chromium',
  // Windows (RDP / desktop installs)
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const WINDOWS_BINARIES = ['chrome.exe', 'msedge.exe', 'chromium.exe'];

function which(binary) {
  try {
    const locator = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(locator, [binary], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

function expandWindowsEnv(value) {
  return value
    .replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
    .replace(/\//g, '\\');
}

export function findChromium() {
  if (config.chromiumPath) {
    const explicit = process.platform === 'win32' ? expandWindowsEnv(config.chromiumPath) : config.chromiumPath;
    return fs.existsSync(explicit) ? explicit : null;
  }
  for (const candidate of CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  if (process.platform === 'win32') {
    const roots = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe'),
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google\\Chrome\\Application\\chrome.exe'),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft\\Edge\\Application\\msedge.exe'),
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft\\Edge\\Application\\msedge.exe'),
    ].filter(Boolean);
    for (const candidate of roots) {
      if (fs.existsSync(candidate)) return candidate;
    }
    for (const binary of WINDOWS_BINARIES) {
      const found = which(binary);
      if (found) return found;
    }
    return null;
  }
  for (const binary of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const found = which(binary);
    if (found) return found;
  }
  return null;
}

export class BrowserManager {
  constructor({ bus }) {
    this.bus = bus;
    this.browser = null;
    this.launching = null;
    this.idleTimer = null;
    this.contexts = new Set();
    this.state = {
      status: 'offline',
      executablePath: findChromium(),
      version: null,
      launchedAt: null,
      activeContexts: 0,
      lastError: null,
      headless: config.browserHeadless,
      idleCloseMs: config.browserIdleCloseMs,
    };
  }

  snapshot() {
    return { ...this.state };
  }

  emit() {
    this.state.activeContexts = this.contexts.size;
    this.bus.emit('browser', this.snapshot());
  }

  missingBinaryMessage() {
    const configured = config.chromiumPath ? ` (CHROMIUM_PATH=${config.chromiumPath})` : '';
    const install = process.platform === 'win32'
      ? 'Install Google Chrome from https://www.google.com/chrome/ (or Microsoft Edge), then set CHROMIUM_PATH in .env to the chrome.exe path.'
      : process.platform === 'darwin'
        ? 'Install Google Chrome into /Applications, then set CHROMIUM_PATH in .env if it is not auto-detected.'
        : 'On Ubuntu install it with: sudo apt install -y chromium-browser or: sudo snap install chromium, then set CHROMIUM_PATH in .env. See deploy/install.sh.';
    return `Chromium executable not found${configured}. ${install}`;
  }

  async launch(settings = { headless: config.browserHeadless }) {
    if (this.browser?.connected) return this.browser;
    if (this.launching) return this.launching;

    const executablePath = findChromium();
    if (!executablePath) {
      const error = new Error(this.missingBinaryMessage());
      this.state = { ...this.state, status: 'error', lastError: error.message, executablePath: null };
      this.emit();
      throw error;
    }

    this.state = { ...this.state, status: 'launching', lastError: null, executablePath };
    this.emit();

    const headless = settings.headless ?? config.browserHeadless;
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--mute-audio',
      '--hide-crash-restore-bubble',
      `--window-size=${settings.viewport?.width ?? 1440},${settings.viewport?.height ?? 900}`,
      ...config.chromiumExtraArgs,
    ];
    if (!headless) args.push('--start-maximized');

    this.launching = (async () => {
      const browser = await puppeteer.launch({
        executablePath,
        headless: Boolean(headless),
        args,
        defaultViewport: null,
        protocolTimeout: 180000,
        dumpio: false,
      });
      this.browser = browser;
      this.state = {
        ...this.state,
        status: 'online',
        version: await browser.version().catch(() => null),
        launchedAt: new Date().toISOString(),
        lastError: null,
        headless: Boolean(headless),
      };
      this.bus.log(`CHROMIUM CONNECTED — ${this.state.version ?? 'unknown version'}`, {
        type: 'browser',
        level: 'success',
      });
      this.emit();

      browser.on('disconnected', () => {
        this.browser = null;
        this.contexts.clear();
        this.state = {
          ...this.state,
          status: 'offline',
          activeContexts: 0,
          version: null,
        };
        this.bus.log('CHROMIUM DISCONNECTED', { type: 'browser', level: 'error' });
        this.emit();
        this.bus.emit('browser:disconnected');
      });

      return browser;
    })();

    try {
      return await this.launching;
    } catch (error) {
      this.state = {
        ...this.state,
        status: 'error',
        lastError: error.message,
        launchedAt: null,
      };
      this.bus.log(`BROWSER LAUNCH FAILED — ${error.message}`, { type: 'browser', level: 'error' });
      this.emit();
      throw error;
    } finally {
      this.launching = null;
    }
  }

  async ensure(settings) {
    this.cancelIdleClose();
    if (this.browser?.connected) return this.browser;
    return this.launch(settings);
  }

  async createContext(settings) {
    const browser = await this.ensure(settings);
    const context = await browser.createBrowserContext();
    this.contexts.add(context);
    this.cancelIdleClose();
    this.emit();
    return context;
  }

  async releaseContext(context) {
    if (!context) return;
    this.contexts.delete(context);
    await context.close().catch(() => {});
    this.emit();
    this.scheduleIdleClose();
  }

  scheduleIdleClose() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const delay = config.browserIdleCloseMs;
    if (!delay || delay < 1000) return;
    if (this.contexts.size > 0 || !this.browser) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.contexts.size === 0 && this.browser) {
        this.bus.log('CLOSING IDLE BROWSER TO FREE MEMORY', { type: 'browser' });
        this.close('idle timeout').catch(() => {});
      }
    }, delay);
    this.idleTimer.unref?.();
  }

  cancelIdleClose() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  async close(reason = 'manual') {
    this.cancelIdleClose();
    const browser = this.browser;
    this.browser = null;
    this.contexts.clear();
    if (browser) {
      await browser.close().catch(() => {});
      this.bus.log(`BROWSER CLOSED (${reason})`, { type: 'browser' });
    }
    this.state = { ...this.state, status: 'offline', activeContexts: 0, version: null };
    this.emit();
  }
}
