#!/usr/bin/env node
/**
 * supervisor.mjs — keep the Visitor server alive on environments without a
 * process manager (Android/Termux, plain desktops).
 *
 * Responsibilities:
 *   • restart the server if it exits unexpectedly (exponential backoff)
 *   • forward SIGTERM/SIGINT for a clean shutdown instead of orphaning it
 *   • stop retrying after repeated fast crashes so a broken config is visible
 *   • exit when the server exits cleanly (code 0), so `stop` stays graceful
 *
 * This is deliberately dependency-free and is never used on a VPS, where PM2
 * owns the process lifecycle.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT, 'server', 'src', 'index.js');

function arg(name, fallback = '') {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}

const mode = arg('mode', process.env.DEPLOYMENT_MODE || 'local');
const host = arg('host', process.env.HOST || '127.0.0.1');
const port = arg('port', process.env.PORT || '4000');

const MAX_BACKOFF_MS = 60_000;
const MIN_BACKOFF_MS = 1_000;
// A run shorter than this counts as a crash, not a normal restart.
const HEALTHY_RUNTIME_MS = 30_000;
const MAX_FAST_CRASHES = 8;

let child = null;
let stopping = false;
let backoff = MIN_BACKOFF_MS;
let fastCrashes = 0;
let restarts = 0;
let timer = null;

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (message) => process.stdout.write(`[${stamp()}] [supervisor] ${message}\n`);

function launch() {
  if (stopping) return;
  const startedAt = Date.now();
  log(`starting server (mode=${mode} host=${host} port=${port})${restarts ? ` · restart #${restarts}` : ''}`);

  child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    env: { ...process.env, DEPLOYMENT_MODE: mode, HOST: host, PORT: String(port) },
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    log(`failed to spawn server: ${error.message}`);
  });

  child.on('exit', (code, signal) => {
    if (stopping) {
      log(`server exited during shutdown (code=${code} signal=${signal ?? 'none'})`);
      process.exit(0);
      return;
    }

    const runtime = Date.now() - startedAt;
    if (code === 0) {
      log('server exited cleanly — supervisor stopping');
      process.exit(0);
    }

    if (runtime >= HEALTHY_RUNTIME_MS) {
      fastCrashes = 0;
      backoff = MIN_BACKOFF_MS;
    } else {
      fastCrashes += 1;
    }

    if (fastCrashes > MAX_FAST_CRASHES) {
      log(`server crashed ${fastCrashes} times in a row within ${HEALTHY_RUNTIME_MS / 1000}s — giving up`);
      log('check the log above, then restart manually once the cause is fixed');
      process.exit(1);
      return;
    }

    restarts += 1;
    const delay = Math.min(MAX_BACKOFF_MS, backoff);
    log(`server stopped unexpectedly (code=${code} signal=${signal ?? 'none'}) — restarting in ${Math.round(delay / 1000)}s`);
    backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
    timer = setTimeout(launch, delay);
  });
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  log(`received ${signal} — stopping server`);
  if (!child || child.exitCode !== null) {
    process.exit(0);
    return;
  }
  child.kill(signal);
  // Hard stop if the child ignores the signal.
  setTimeout(() => {
    if (child && child.exitCode === null) {
      log('server did not exit in time — sending SIGKILL');
      child.kill('SIGKILL');
    }
    process.exit(0);
  }, 15_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => log('SIGHUP received — ignoring so the process keeps running'));

launch();
