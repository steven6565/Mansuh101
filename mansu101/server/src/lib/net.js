import dns from 'node:dns/promises';
import net from 'node:net';
import { crawlerConfig } from '../config.js';

/**
 * Outbound HTTP helpers used by the audit crawler.
 *
 * All requests are subject to an SSRF guard: by default only public
 * hostnames may be crawled, so a user cannot point the crawler at
 * localhost / cloud metadata endpoints. CRAWLER_ALLOW_PRIVATE=true lifts
 * that for local development only.
 */

const PRIVATE_RANGES = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['0.0.0.0', 8],
  ['100.64.0.0', 10],
  ['192.0.0.0', 24],
  ['198.18.0.0', 15],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
];

function ipToBigInt(ip) {
  if (net.isIPv4(ip)) {
    return ip.split('.').reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
  }
  const parts = ip.split('::');
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts[1] ? parts[1].split(':') : [];
  const groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  return groups.reduce((acc, group) => (acc << 16n) + BigInt(parseInt(group || '0', 16)), 0n);
}

function inRange(ip, base, bits) {
  try {
    const value = ipToBigInt(ip);
    const baseValue = ipToBigInt(base);
    const width = net.isIPv4(ip) ? 32 : 128;
    const shift = BigInt(width - bits);
    return (value >> shift) === (baseValue >> shift);
  } catch {
    return false;
  }
}

export function isPrivateAddress(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    return PRIVATE_RANGES.some(([base, bits]) => net.isIPv4(base) && inRange(ip, base, bits));
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return PRIVATE_RANGES.some(([base, bits]) => net.isIPv6(base) && inRange(ip, base, bits));
  }
  return true;
}

export class UnsafeTargetError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = 'UNSAFE_TARGET';
  }
}

export async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeTargetError('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UnsafeTargetError('Only http and https URLs can be crawled');
  }
  const host = url.hostname;
  if (crawlerConfig.allowPrivateTargets) return url;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new UnsafeTargetError('Refusing to crawl a private hostname');
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeTargetError('Refusing to crawl a private IP address');
    return url;
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new UnsafeTargetError(`DNS lookup failed for ${host}`);
  }
  if (!records.length) throw new UnsafeTargetError(`DNS lookup failed for ${host}`);
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new UnsafeTargetError('Refusing to crawl a hostname that resolves to a private address');
    }
  }
  return url;
}

export async function fetchPage(url, {
  timeoutMs = crawlerConfig.timeoutMs,
  userAgent = crawlerConfig.userAgent,
  maxBytes = crawlerConfig.maxHtmlBytes,
  method = 'GET',
  allowPrivate = crawlerConfig.allowPrivateTargets,
  redirect = 'follow',
} = {}) {
  if (!allowPrivate) await assertPublicUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method,
      redirect,
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const contentType = response.headers.get('content-type') || '';
    let body = '';
    let truncated = false;
    if (method !== 'HEAD') {
      const reader = response.body?.getReader();
      if (reader) {
        const chunks = [];
        let size = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            chunks.push(value.slice(0, Math.max(0, maxBytes - (size - value.byteLength))));
            truncated = true;
            await reader.cancel().catch(() => {});
            break;
          }
          chunks.push(value);
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
    }
    return {
      url,
      finalUrl: response.url || url,
      status: response.status,
      ok: response.ok,
      redirected: response.redirected,
      headers: Object.fromEntries(response.headers.entries()),
      contentType,
      body,
      truncated,
      durationMs: Date.now() - startedAt,
      bytes: Buffer.byteLength(body, 'utf8'),
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeout = new Error(`Request timed out after ${timeoutMs}ms`);
      timeout.code = 'TIMEOUT';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url, options = {}) {
  const response = await fetchPage(url, { ...options, maxBytes: options.maxBytes ?? 2_000_000 });
  return response;
}

export function resolveUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function normalizeForCompare(raw) {
  try {
    const url = new URL(raw);
    url.hash = '';
    // Sort query params so ?a=1&b=2 and ?b=2&a=1 compare equal.
    const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    url.search = new URLSearchParams(params).toString();
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return raw;
  }
}
