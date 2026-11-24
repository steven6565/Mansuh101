import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE_NAME = 'visitor_sid';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function timingSafeEqual(a, b) {
  const left = sha256(String(a));
  const right = sha256(String(b));
  return crypto.timingSafeEqual(left, right);
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export class AuthService {
  constructor({ store, bus }) {
    this.store = store;
    this.bus = bus;
    this.attempts = new Map(); // ip -> { count, blockedUntil }
    this.cookieName = COOKIE_NAME;
  }

  isSecureRequest(req) {
    if (config.publicUrl.startsWith('https://')) return true;
    return Boolean(req?.secure);
  }

  cookieOptions(req) {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureRequest(req),
      path: '/',
      maxAge: config.sessionTtlDays * 86400000,
    };
  }

  get disabled() {
    return config.authDisabled;
  }

  checkRateLimit(ip) {
    const entry = this.attempts.get(ip);
    if (!entry) return { blocked: false };
    if (entry.blockedUntil && entry.blockedUntil > Date.now()) {
      return { blocked: true, retryIn: Math.ceil((entry.blockedUntil - Date.now()) / 1000) };
    }
    return { blocked: false };
  }

  recordFailure(ip) {
    const entry = this.attempts.get(ip) ?? { count: 0, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= 6) {
      entry.blockedUntil = Date.now() + 15 * 60 * 1000;
      entry.count = 0;
    }
    this.attempts.set(ip, entry);
  }

  clearFailures(ip) {
    this.attempts.delete(ip);
  }

  async login(password, ip) {
    const limit = this.checkRateLimit(ip);
    if (limit.blocked) {
      const error = new Error(`Too many attempts. Try again in ${limit.retryIn}s.`);
      error.status = 429;
      throw error;
    }
    if (!timingSafeEqual(password ?? '', config.appPassword)) {
      this.recordFailure(ip);
      const error = new Error('Invalid password.');
      error.status = 401;
      throw error;
    }
    this.clearFailures(ip);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86400000).toISOString();
    await this.store.saveToken(sha256(token).toString('hex'), expiresAt);
    return { token, expiresAt };
  }

  async tokenIsValid(token) {
    if (!token) return false;
    const row = await this.store.getToken(sha256(token).toString('hex'));
    if (!row) return false;
    if (new Date(row.expires_at ?? row.expiresAt).getTime() < Date.now()) {
      await this.store.deleteToken(sha256(token).toString('hex')).catch(() => {});
      return false;
    }
    return true;
  }

  async authenticateRequest(req, res, next) {
    if (this.disabled) {
      req.isAdmin = true;
      return next();
    }
    const token = req.cookies?.[this.cookieName];
    if (await this.tokenIsValid(token)) {
      req.isAdmin = true;
      req.authToken = token;
      return next();
    }
    return res.status(401).json({ error: 'Authentication required' });
  }

  async socketAuthenticate(socket, next) {
    if (this.disabled) return next();
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie || '');
      const token = cookies[this.cookieName];
      if (await this.tokenIsValid(token)) return next();
      const error = new Error('Authentication required');
      error.data = { code: 'UNAUTHORIZED' };
      return next(error);
    } catch (error) {
      return next(error);
    }
  }

  async logout(req, res) {
    const token = req.cookies?.[this.cookieName];
    if (token) await this.store.deleteToken(sha256(token).toString('hex')).catch(() => {});
    res.clearCookie(this.cookieName, { path: '/' });
  }

  async me(req) {
    if (this.disabled) return { authenticated: true, authDisabled: true };
    return { authenticated: await this.tokenIsValid(req.cookies?.[this.cookieName]) };
  }
}
