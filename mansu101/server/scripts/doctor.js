/**
 * MANSU101 preflight / doctor.
 * Verifies runtime, storage, Chromium and — with --launch — a real browser
 * launch, page render and screenshot round-trip.
 *
 * Run: pnpm doctor [--launch]
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, dirs } from '../src/config.js';
import { findChromium } from '../src/engine/browser.js';
import { createStore } from '../src/store/index.js';

const launchTest = process.argv.includes('--launch');
let failures = 0;

function check(label, ok, detail = '') {
  const icon = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${icon} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
}

console.log('\nMANSU101 doctor\n───────────────');
console.log(`  Node            ${process.version} (${process.platform}/${process.arch})`);
console.log(`  Environment     ${config.env}`);
console.log(`  Data directory  ${config.dataDir}`);
console.log(`  Database        ${config.databaseUrl}`);
console.log('');

const [major, minor] = process.versions.node.split('.').map(Number);
check('Node >= 22.5 (node:sqlite support)', major > 22 || (major === 22 && minor >= 5));

try {
  const probe = path.join(dirs.data, `.write-test-${process.pid}`);
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);
  check('Data directory writable', true);
} catch (error) {
  check('Data directory writable', false, error.message);
}

const chromium = findChromium();
check(
  'Chromium executable',
  Boolean(chromium),
  chromium || 'not found — install chromium or set CHROMIUM_PATH',
);
if (chromium) {
  try {
    const { execFileSync } = await import('node:child_process');
    const version = execFileSync(chromium, ['--version'], { encoding: 'utf8' }).trim();
    console.log(`      version: ${version}`);
  } catch {
    // version probing is best-effort
  }
}

check(
  'Dashboard password changed',
  !config.appPasswordWeak,
  config.appPasswordWeak ? 'default or too short — set a long random APP_PASSWORD' : 'configured',
);

if (!config.authDisabled) check('Authentication enabled', true);
else check('Authentication enabled', false, 'AUTH_DISABLED=true');

try {
  const { store, engine } = await createStore({
    info: () => {},
    warn: (message) => console.log(`  ! ${message}`),
    error: (message) => console.log(`  ! ${message}`),
  });
  const urls = await store.listUrls();
  const runs = await store.countRuns();
  await store.close();
  check('Database reachable', true, `${engine} · ${urls.length} URL(s) · ${runs} run(s)`);
} catch (error) {
  check('Database reachable', false, error.message);
}

if (launchTest) {
  console.log('\nLaunching a real Chromium render test…');
  const { BrowserManager } = await import('../src/engine/browser.js');
  const { bus } = await import('../src/bus.js');
  const manager = new BrowserManager({ bus });
  let browser;
  try {
    browser = await manager.launch({ headless: config.browserHeadless, viewport: { width: 800, height: 600 } });
    const page = await browser.newPage();
    await page.goto('data:text/html,<title>MANSU101 doctor</title><h1>Chromium OK</h1>', { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 });
    await page.close();
    check('Browser launch + render + screenshot', title === 'MANSU101 doctor' && screenshot.length > 1000, `${screenshot.length} bytes`);
  } catch (error) {
    check('Browser launch + render + screenshot', false, error.message);
  } finally {
    await manager.close('doctor').catch(() => {});
  }
} else {
  console.log('\n  (Run with --launch to verify an actual Chromium render.)');
}

console.log('');
if (failures > 0) {
  console.log(`\x1b[31m${failures} check(s) failed.\x1b[0m See README.md → Troubleshooting.\n`);
  process.exit(1);
}
console.log('\x1b[32mAll checks passed.\x1b[0m\n');
