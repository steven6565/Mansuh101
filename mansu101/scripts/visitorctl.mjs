#!/usr/bin/env node
/**
 * visitorctl — start / stop / restart / status / logs for Visitor.
 *
 * One implementation for every deployment mode. It only manages a local
 * process; it never touches PM2, systemd or Nginx, so VPS deployments keep
 * using deploy/ecosystem.config.cjs unchanged.
 *
 * Usage:
 *   node scripts/visitorctl.mjs start [--mode=local|termux|vps] [--supervise] [--foreground]
 *   node scripts/visitorctl.mjs stop [--timeout=15000]
 *   node scripts/visitorctl.mjs restart [...]
 *   node scripts/visitorctl.mjs status
 *   node scripts/visitorctl.mjs logs [--follow]
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isTermux, resolveMode, resolveHost, displayUrl } from '../server/src/runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RUN_DIR = path.join(ROOT, 'data', '.run');
const PID_FILE = path.join(RUN_DIR, 'visitor.pid');
const LOG_DIR = path.join(ROOT, 'data', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'visitor.log');
const SERVER_ENTRY = path.join(ROOT, 'server', 'src', 'index.js');
const SUPERVISOR_ENTRY = path.join(__dirname, 'supervisor.mjs');

const COLOURS = { info: '\x1b[36m', ok: '\x1b[32m', warn: '\x1b[33m', err: '\x1b[31m', dim: '\x1b[2m' };
const R = '\x1b[0m';
const say = (kind, message) => process.stdout.write(`${COLOURS[kind] ?? ''}${message}${R}\n`);
const fail = (message, code = 1) => {
  say('err', message);
  process.exit(code);
};

// ── .env loading (no dependency on the server's dotenv instance) ──────────
function readEnvFile() {
  const file = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = readEnvFile();
const envValue = (key) => (process.env[key] !== undefined && process.env[key] !== ''
  ? process.env[key]
  : fileEnv[key]);

function resolveSettings(modeOverride) {
  const mode = modeOverride || resolveMode({ ...fileEnv, ...process.env });
  const host = resolveHost(mode, { ...fileEnv, ...process.env, HOST: envValue('HOST') });
  const port = Number.parseInt(envValue('PORT') || '4000', 10) || 4000;
  return { mode, host, port, url: displayUrl(host, port) };
}

// ── arguments ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const command = argv[0] || 'status';
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback = null) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

// ── pid file helpers ─────────────────────────────────────────────────────
function ensureDirs() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function readPidFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    if (parsed && Number.isInteger(parsed.pid)) return parsed;
  } catch {
    /* missing or corrupt */
  }
  return null;
}

function writePidFile(info) {
  ensureDirs();
  fs.writeFileSync(PID_FILE, JSON.stringify(info, null, 2), { mode: 0o644 });
}

function removePidFile() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* already gone */
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForAlive(pid, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return false;
    return true;
  }
  return isAlive(pid);
}

async function waitForDeath(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(150);
  }
  return !isAlive(pid);
}

async function probeHealth(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/api/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status };
    const body = await response.json();
    return { ok: true, body };
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probeHealth(url);
    if (last.ok) return last;
    await sleep(300);
  }
  return last ?? { ok: false, error: 'no response' };
}

function portInUse(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Find a PID listening on a TCP port (best-effort, Linux /proc or lsof). */
async function findPortOwner(port) {
  const proc = '/proc/net/tcp';
  try {
    if (fs.existsSync(proc)) {
      const hex = port.toString(16).toUpperCase().padStart(4, '0');
      const sockets = new Set();
      for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(1)) {
          const cols = line.trim().split(/\s+/);
          if (cols.length < 10) continue;
          const local = cols[1];
          if (local && local.split(':')[1] === hex) sockets.add(cols[9]);
        }
      }
      for (const inode of sockets) {
        for (const pidDir of fs.readdirSync('/proc')) {
          if (!/^\d+$/.test(pidDir)) continue;
          const fdDir = `/proc/${pidDir}/fd`;
          let fds;
          try {
            fds = fs.readdirSync(fdDir);
          } catch {
            continue;
          }
          for (const fd of fds) {
            let target;
            try {
              target = fs.readlinkSync(path.join(fdDir, fd));
            } catch {
              continue;
            }
            if (target === `socket:[${inode}]`) return Number(pidDir);
          }
        }
      }
    }
  } catch {
    /* best effort only */
  }
  return null;
}

// ── commands ─────────────────────────────────────────────────────────────
async function start() {
  const modeOverride = option('mode');
  const settings = resolveSettings(modeOverride);
  const supervised = flag('supervise') || (settings.mode === 'termux' && !flag('no-supervise'));
  const foreground = flag('foreground') || flag('fg');

  const existing = readPidFile();
  if (existing && isAlive(existing.pid)) {
    const existingHost = existing.host ?? settings.host;
    const existingPort = existing.port ?? settings.port;
    const existingUrl = displayUrl(existingHost, existingPort);
    const health = await probeHealth(existingUrl);
    if (existingPort !== settings.port || existingHost !== settings.host) {
      // One instance per checkout: the pid file is the source of truth, so a
      // second port would silently shadow the first.
      say('err', `Visitor is already running on ${existingUrl} (pid ${existing.pid}, ${existing.mode ?? 'unknown'} mode).`);
      say('dim', '  Stop it first to switch ports: node scripts/visitorctl.mjs stop');
      return 1;
    }
    say('warn', `Visitor is already running (pid ${existing.pid}, ${existing.mode ?? 'unknown'} mode).`);
    if (health.ok) say('dim', `  ${existingUrl} · uptime ${health.body?.uptimeSeconds ?? '?'}s`);
    say('dim', '  Use "node scripts/visitorctl.mjs restart" to reload, or "stop" first.');
    return 0;
  }
  if (existing) {
    say('dim', `Removing stale pid file for ${existing.pid}.`);
    removePidFile();
  }

  if (!fs.existsSync(SERVER_ENTRY)) fail(`Server entry not found: ${SERVER_ENTRY}`);

  const busy = await portInUse(settings.host, settings.port);
  if (busy) {
    const owner = await findPortOwner(settings.port);
    fail(
      `Port ${settings.port} is already in use${owner ? ` by pid ${owner}` : ''}.\n`
      + `  Set a different port:  PORT=4100 ${process.argv[1]} start\n`
      + '  Or stop the other process first.',
    );
  }

  const childEnv = { ...process.env, DEPLOYMENT_MODE: settings.mode, HOST: settings.host, PORT: String(settings.port) };
  ensureDirs();

  if (foreground) {
    say('info', `Starting Visitor in ${settings.mode} mode on ${settings.url} (foreground)`);
    const child = spawn(process.execPath, [SERVER_ENTRY], { cwd: ROOT, env: childEnv, stdio: 'inherit' });
    const forward = (signal) => child.kill(signal);
    process.on('SIGINT', () => forward('SIGINT'));
    process.on('SIGTERM', () => forward('SIGTERM'));
    child.on('exit', (code) => {
      removePidFile();
      process.exit(code ?? 0);
    });
    return null;
  }

  const entry = supervised ? SUPERVISOR_ENTRY : SERVER_ENTRY;
  const args = supervised
    ? [entry, '--mode', settings.mode, '--host', settings.host, '--port', String(settings.port)]
    : [entry];

  const logStream = fs.openSync(LOG_FILE, 'a');
  const stamp = new Date().toISOString();
  fs.writeSync(logStream, `\n===== start ${stamp} · mode=${settings.mode} host=${settings.host} port=${settings.port}${supervised ? ' (supervised)' : ''} =====\n`);

  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: childEnv,
    detached: true,
    stdio: ['ignore', logStream, logStream],
  });
  child.unref();

  writePidFile({
    pid: child.pid,
    mode: settings.mode,
    host: settings.host,
    port: settings.port,
    supervised,
    entry,
    startedAt: stamp,
  });

  say('info', `Starting Visitor in ${settings.mode} mode${supervised ? ' (supervised)' : ''} …`);

  const health = await waitForHealth(settings.url, 20_000);
  if (!health.ok) {
    const tail = tailLog(12);
    say('err', `Server did not become healthy: ${health.error ?? `HTTP ${health.status}`}`);
    if (tail) {
      say('dim', '--- last log lines ---');
      process.stdout.write(`${tail}\n`);
    }
    if (isAlive(child.pid)) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(child.pid, 'SIGTERM');
        } catch {
          /* ignore */
        }
      }
    }
    removePidFile();
    return 1;
  }

  say('ok', `Visitor is running — ${settings.url}`);
  say('dim', `  pid ${child.pid} · ${health.body?.app ?? 'Visitor'} ${health.body?.version ?? ''} · log: data/logs/visitor.log`);
  if (settings.host === '127.0.0.1') {
    say('dim', '  Bound to loopback only. Set HOST=0.0.0.0 to expose it on your network.');
  }
  return 0;
}

async function stop() {
  const timeout = Number.parseInt(option('timeout', '15000'), 10) || 15000;
  const info = readPidFile();

  if (!info) {
    const settings = resolveSettings();
    const health = await probeHealth(settings.url);
    if (health.ok) {
      fail(`Visitor responds on ${settings.url} but has no pid file (started outside visitorctl, e.g. PM2).\n  Use "pm2 stop visitor" for VPS deployments.`);
    }
    say('dim', 'Visitor is not running.');
    return 0;
  }

  if (!isAlive(info.pid)) {
    say('dim', `Process ${info.pid} is gone — clearing stale pid file.`);
    removePidFile();
    return 0;
  }

  say('info', `Stopping Visitor (pid ${info.pid}) …`);
  const signalGroup = (signal) => {
    // Supervised runs create a process group; signal the whole group so the
    // server child and the supervisor both shut down.
    try {
      process.kill(-info.pid, signal);
      return true;
    } catch {
      try {
        process.kill(info.pid, signal);
        return true;
      } catch {
        return false;
      }
    }
  };

  signalGroup('SIGTERM');
  let dead = await waitForDeath(info.pid, timeout);

  if (!dead) {
    say('warn', `Graceful stop timed out after ${timeout}ms — sending SIGKILL.`);
    signalGroup('SIGKILL');
    dead = await waitForDeath(info.pid, 5000);
  }

  removePidFile();
  if (!dead) fail('Could not stop the process. Check for a stuck child with "ps -ef | grep index.js".');
  say('ok', 'Visitor stopped.');
  return 0;
}

async function restart() {
  const settings = resolveSettings(option('mode'));
  await stop();
  const code = await start();
  return code ?? 0;
}

async function status() {
  const info = readPidFile();
  const settings = resolveSettings();

  if (!info) {
    const health = await probeHealth(settings.url);
    if (health.ok) {
      say('warn', `Visitor is responding on ${settings.url} but was not started by visitorctl.`);
      say('dim', '  This is normal on a VPS — check with "pm2 status".');
      return 0;
    }
    say('warn', 'Visitor is not running.');
    say('dim', `  Start it: node scripts/visitorctl.mjs start --mode=${settings.mode}`);
    return 3;
  }

  const alive = isAlive(info.pid);
  const url = displayUrl(info.host ?? settings.host, info.port ?? settings.port);
  const health = alive ? await probeHealth(url) : { ok: false };

  if (!alive) {
    say('err', `Visitor is not running (stale pid ${info.pid}).`);
    say('dim', '  Clean up with: node scripts/visitorctl.mjs stop');
    return 3;
  }

  say('ok', `Visitor is running — ${url}`);
  console.log(`  pid        ${info.pid}${info.supervised ? ' (supervised)' : ''}`);
  console.log(`  mode       ${info.mode}`);
  console.log(`  bind       ${info.host}:${info.port}`);
  console.log(`  started    ${info.startedAt}`);
  if (health.ok) {
    console.log(`  uptime     ${health.body?.uptimeSeconds ?? '?'}s`);
    console.log(`  store      ${health.body?.scheduler ? 'scheduler ' + (health.body.scheduler.enabled ? 'on' : 'off') : 'n/a'}`);
  } else {
    say('warn', `  health check failed: ${health.error ?? `HTTP ${health.status}`}`);
  }
  console.log(`  log        ${path.relative(ROOT, LOG_FILE)}`);
  return 0;
}

function tailLog(lines = 40) {
  if (!fs.existsSync(LOG_FILE)) return '';
  const content = fs.readFileSync(LOG_FILE, 'utf8').trimEnd().split('\n');
  return content.slice(-lines).join('\n');
}

async function logs() {
  if (!fs.existsSync(LOG_FILE)) {
    say('dim', `No log file yet at ${path.relative(ROOT, LOG_FILE)}.`);
    return 0;
  }
  if (!flag('follow') && !flag('f')) {
    process.stdout.write(`${tailLog(Number.parseInt(option('lines', '40'), 10) || 40)}\n`);
    return 0;
  }
  say('dim', `Following ${path.relative(ROOT, LOG_FILE)} — Ctrl-C to stop.`);
  let offset = fs.statSync(LOG_FILE).size - Math.min(4096, fs.statSync(LOG_FILE).size);
  const print = () => {
    const size = fs.statSync(LOG_FILE).size;
    if (size < offset) offset = 0; // truncated/rotated
    if (size === offset) return;
    const stream = fs.createReadStream(LOG_FILE, { start: offset, end: size - 1 });
    stream.on('data', (chunk) => process.stdout.write(chunk));
    offset = size;
  };
  print();
  const watcher = fs.watch(LOG_FILE, print);
  const stopWatching = () => {
    watcher.close();
    process.exit(0);
  };
  process.on('SIGINT', stopWatching);
  process.on('SIGTERM', stopWatching);
  return null;
}

// ── dispatch ─────────────────────────────────────────────────────────────
const commands = {
  start, stop, restart, status, logs,
  'help': async () => {
    console.log(`Visitor control — ${ROOT}

Commands:
  start    [--mode=local|termux|vps] [--supervise] [--foreground] [--no-supervise]
  stop     [--timeout=15000]
  restart  [--mode=…]
  status
  logs     [--follow] [--lines=40]

Environment:
  PORT              port to bind (default 4000)
  HOST              bind address (default 127.0.0.1 for local/termux, 0.0.0.0 for vps)
  DEPLOYMENT_MODE   vps | local | termux (auto-detected when unset)

On a VPS with PM2, keep using: pm2 start deploy/ecosystem.config.cjs
Termux: node scripts/visitorctl.mjs start --mode=termux  (supervised by default)
`);
    return 0;
  },
};

const handler = commands[command];
if (!handler) {
  say('err', `Unknown command "${command}". Try: node scripts/visitorctl.mjs help`);
  process.exit(2);
}

const result = await handler();
if (typeof result === 'number' && result !== 0) process.exit(result);
