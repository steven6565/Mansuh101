import { securityConfig } from '../config.js';

/**
 * API hardening middleware.
 *
 *  · per-IP token bucket rate limiting (cheap GETs vs expensive crawls/syncs);
 *  · same-origin enforcement for state-changing requests (CSRF);
 *  · small validation helpers so route handlers never trust raw input.
 */

export function createRateLimiter({ windowMs = 60_000, max = 300, key = 'default' } = {}) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const identity = `${key}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    const bucket = buckets.get(identity) ?? { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    buckets.set(identity, bucket);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Slow down and retry shortly.' });
    }
    if (buckets.size > 5000) {
      for (const [entry, value] of buckets) {
        if (value.resetAt < now) buckets.delete(entry);
      }
    }
    return next();
  };
}

/** Reject cross-site state changes when a browser sends an Origin header. */
export function originGuard(req, res, next) {
  if (!securityConfig.trustOrigin) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // same-origin fetch or a non-browser client
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return res.status(403).json({ error: 'Invalid Origin header' });
  }
  const requestHost = req.get('host');
  if (originHost !== requestHost) {
    return res.status(403).json({ error: 'Cross-origin request blocked' });
  }
  return next();
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export function requireFields(body, fields) {
  const missing = fields.filter((field) => body?.[field] === undefined || body?.[field] === null || body?.[field] === '');
  if (missing.length) throw new ValidationError(`Missing required field(s): ${missing.join(', ')}`);
  return body;
}

export function asString(value, { max = 500, field = 'value', optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new ValidationError(`${field} is required`);
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed && !optional) throw new ValidationError(`${field} cannot be empty`);
  if (trimmed.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return trimmed || null;
}

export function asInt(value, { min = 0, max = 1_000_000, fallback = 0, field = 'value' } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`${field} must be a number`);
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function asEnum(value, allowed, { field = 'value', fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`${field} is required`);
  }
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

export function asDate(value, { field = 'date', optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new ValidationError(`${field} is required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new ValidationError(`${field} must be formatted YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(`${field} is not a real date`);
  return String(value);
}

/** Wrap an async handler so rejected promises reach the error middleware. */
export const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
