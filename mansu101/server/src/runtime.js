/**
 * Runtime environment detection and deployment-mode resolution.
 *
 * One shared codebase runs in three places:
 *
 *   vps     — a Linux server behind Nginx/PM2 (binds 0.0.0.0)
 *   local   — a desktop/laptop for development (binds 127.0.0.1)
 *   termux  — Android via Termux, no root, no systemd (binds 127.0.0.1)
 *
 * Nothing here changes application behaviour: the same services, routes and
 * storage layer are used in every mode. Only defaults that legitimately differ
 * (bind address, SQLite path, scheduler tick, rendered-audit availability) are
 * resolved here.
 */
import os from 'node:os';
import path from 'node:path';

export const DEPLOYMENT_MODES = ['vps', 'local', 'termux'];

/**
 * True when running inside Termux on Android.
 *
 * Termux sets PREFIX=/data/data/com.termux/files/usr and TERMUX_VERSION.
 * We also accept a com.termux prefix so this works on forks (e.g. the
 * /data/user/0/... layout used by some sandboxes) without root checks.
 */
export function isTermux(env = process.env) {
  if (env.TERMUX_VERSION) return true;
  const prefix = env.PREFIX || '';
  if (/com\.termux/i.test(prefix)) return true;
  if (env.TERMUX_APP_PID) return true;
  // Fallback: Android kernel + a non-empty PREFIX that is not a normal distro.
  if (process.platform === 'android') return true;
  return Boolean(env.ANDROID_DATA && /termux/i.test(prefix));
}

export function isAndroid() {
  return process.platform === 'android' || Boolean(process.env.ANDROID_DATA);
}

/**
 * Resolve the deployment mode.
 *
 * `DEPLOYMENT_MODE` wins when set to a known value. Otherwise we infer: Termux
 * on Android is `termux`, `NODE_ENV=production` is `vps`, everything else is
 * `local`. The inference is deliberately conservative — it only picks a bind
 * address, and every mode can be overridden with HOST.
 */
export function resolveMode(env = process.env) {
  const explicit = String(env.DEPLOYMENT_MODE || '').trim().toLowerCase();
  if (DEPLOYMENT_MODES.includes(explicit)) return explicit;
  if (isTermux(env)) return 'termux';
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') return 'vps';
  return 'local';
}

/**
 * Default bind address per mode. Local tooling should never be exposed to the
 * network by accident, so only the VPS default binds all interfaces.
 */
export const DEFAULT_HOSTS = {
  vps: '0.0.0.0',
  local: '127.0.0.1',
  termux: '127.0.0.1',
};

export function resolveHost(mode, env = process.env) {
  const host = String(env.HOST || '').trim();
  if (host) return host;
  return DEFAULT_HOSTS[mode] ?? '127.0.0.1';
}

/** Human-readable URL for logs and scripts. */
export function displayUrl(host, port) {
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return `http://${shown}:${port}`;
}

/** Short description used in the boot banner and `/api/diagnostics`. */
export function describeRuntime(mode) {
  const ter = isTermux();
  return {
    mode,
    platform: process.platform,
    arch: process.arch,
    termux: ter,
    android: isAndroid(),
    hostname: os.hostname(),
    // Termux cannot install the distro Chromium package; a user-installed
    // Chromium build may still be present, so this is informational only.
    chromiumHint: ter
      ? 'Termux: rendered audits need a Chromium build or CHROMIUM_PATH; HTTP audits always work'
      : 'Linux/macOS: install Chromium or set CHROMIUM_PATH for rendered audits',
  };
}

/** Absolute path helper (mode-independent, kept here for script parity). */
export function resolveFromRoot(rootDir, relative) {
  return path.isAbsolute(relative) ? relative : path.resolve(rootDir, relative);
}
