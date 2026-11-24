/**
 * Visitor self-test — no network, no Chromium, no credentials required.
 *
 * Exercises the pure logic that every feature depends on: robots.txt
 * parsing/allowing, sitemap parsing/building, HTML analysis, keyword intent +
 * clustering, campaign URL construction, report markdown, and the store's
 * metric aggregation (including the "no data" path that must never invent
 * numbers).
 *
 * Run: pnpm test
 *      pnpm test:sqlite    (same suite against the SQLite store)
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const useSqlite = process.argv.includes('--sqlite');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visitor-selftest-'));
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.AUTH_DISABLED = 'true';
process.env.SCHEDULER_ENABLED = 'false';
// Default run exercises the JSON fallback store; --sqlite exercises SQLite.
process.env.DATABASE_URL = useSqlite
  ? `sqlite:${path.join(tempDir, 'test.db')}`
  : path.join(tempDir, 'store.json');

const { parseRobots, robotsAllows, parseSitemap, buildSitemap } = await import('../src/lib/robots.js');
const { analyzeHtml } = await import('../src/lib/html.js');
const {
  classifyIntent, groupKeywords, longTailSuggestions, keywordDifficultyProxy, keywordCoverage, contentBrief,
} = await import('../src/lib/keywords.js');
const { buildTrackingUrl } = await import('../src/services/campaigns.js');
const { createStore } = await import('../src/store/index.js');
const { normalizeUrl, siteOrigin, sanitizeSettings, DEFAULT_SETTINGS } = await import('../src/config.js');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (error) {
    failures.push({ name, error });
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n      ${error.message}\n`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
  } catch (error) {
    failures.push({ name, error });
    process.stdout.write(`  \x1b[31m✗\x1b[0m ${name}\n      ${error.message}\n`);
  }
}

console.log(`\nVisitor self-test (${useSqlite ? 'sqlite' : 'default store'})\n${'─'.repeat(40)}`);

// ── URL normalisation ────────────────────────────────────────────────────
console.log('\nURL handling');
test('normalizeUrl adds a scheme and strips the hash', () => {
  assert.equal(normalizeUrl('example.com/path#frag'), 'https://example.com/path');
});
test('normalizeUrl rejects non-http protocols', () => {
  assert.equal(normalizeUrl('ftp://example.com'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
});
test('siteOrigin reduces to the origin', () => {
  assert.equal(siteOrigin('https://www.example.com/a/b?c=1'), 'https://www.example.com');
});

// ── robots.txt ───────────────────────────────────────────────────────────
console.log('\nrobots.txt');
const robots = parseRobots([
  'User-agent: *',
  'Disallow: /admin',
  'Allow: /admin/public',
  'Sitemap: https://example.com/sitemap.xml',
  '',
  'User-agent: VisitorSEO',
  'Disallow: /private',
].join('\n'));

test('discovers the declared sitemap', () => {
  assert.deepEqual(robots.sitemaps, ['https://example.com/sitemap.xml']);
});
test('blocks a disallowed path', () => {
  assert.equal(robotsAllows(robots, '/admin/secret', 'AnotherBot/1.0').allowed, false);
});
test('longest match wins (allow overrides disallow)', () => {
  assert.equal(robotsAllows(robots, '/admin/public/page', 'AnotherBot/1.0').allowed, true);
});
test('a specific user-agent group overrides the wildcard group', () => {
  // RFC 9309: a matching named group replaces "*" entirely, so /admin is not
  // blocked for our crawler while /private is.
  assert.equal(robotsAllows(robots, '/private/x', 'VisitorSEO/2.0').allowed, false);
  assert.equal(robotsAllows(robots, '/admin/secret', 'VisitorSEO/2.0').allowed, true);
});
test('unlisted paths are allowed', () => {
  assert.equal(robotsAllows(robots, '/blog/post').allowed, true);
});
test('empty robots.txt allows everything', () => {
  assert.equal(robotsAllows(parseRobots(''), '/anything').allowed, true);
});

// ── sitemaps ─────────────────────────────────────────────────────────────
console.log('\nSitemaps');
test('parses a urlset', () => {
  const parsed = parseSitemap('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + '<url><loc>https://example.com/</loc></url><url><loc>https://example.com/about</loc></url></urlset>');
  assert.equal(parsed.isIndex, false);
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[1].loc, 'https://example.com/about');
});
test('parses a sitemap index', () => {
  const parsed = parseSitemap('<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>');
  assert.equal(parsed.isIndex, true);
  assert.equal(parsed.entries.length, 1);
});
test('buildSitemap escapes and validates URLs', () => {
  const xml = buildSitemap([{ loc: 'https://example.com/a?b=1&c=2' }, { loc: 'not-a-url' }]);
  assert.match(xml, /<urlset/);
  assert.match(xml, /b=1&amp;c=2/);
  assert.equal((xml.match(/<url>/g) ?? []).length, 1);
});

// ── HTML analysis ────────────────────────────────────────────────────────
console.log('\nHTML analysis');
const analysed = analyzeHtml(`<!doctype html><html lang="en"><head>
  <title>Technical SEO audit guide for small teams</title>
  <meta name="description" content="${'A practical guide to running a technical SEO audit, with checklists and examples. '.repeat(2)}">
  <link rel="canonical" href="https://example.com/guide">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Guide"}</script>
</head><body>
  <h1>Technical SEO audit</h1><h2>Why it matters</h2><h3>How to start</h3>
  <p>${'Real content about technical SEO auditing. '.repeat(30)}</p>
  <img src="/a.png" alt="A described image"><img src="/b.png">
  <a href="/internal">Internal</a><a href="https://other.example/x">External</a>
</body></html>`, 'https://example.com/guide');

test('extracts title and length', () => {
  assert.equal(analysed.title, 'Technical SEO audit guide for small teams');
  assert.equal(analysed.titleLength, analysed.title.length);
});
test('extracts meta description', () => {
  assert.ok(analysed.description.startsWith('A practical guide'));
});
test('extracts canonical and lang', () => {
  assert.equal(analysed.canonical, 'https://example.com/guide');
  assert.equal(analysed.lang, 'en');
});
test('collects headings in order', () => {
  assert.deepEqual(analysed.h1, ['Technical SEO audit']);
  assert.equal(analysed.h2[0], 'Why it matters');
  assert.equal(analysed.headings[0].level, 1);
});
test('flags images without alt text', () => {
  assert.equal(analysed.images.length, 2);
  assert.equal(analysed.images.filter((image) => !image.alt).length, 1);
});
test('collects anchors with their hrefs', () => {
  assert.equal(analysed.links.length, 2);
  assert.equal(analysed.links[0].href, '/internal');
  assert.equal(analysed.links[1].href, 'https://other.example/x');
});
test('reads structured data types', () => {
  assert.ok(analysed.structuredDataTypes.includes('Article'));
});
test('detects the viewport tag', () => {
  assert.ok(String(analysed.viewport).includes('width=device-width'));
});
test('counts words', () => {
  assert.ok(analysed.wordCount > 50, `got ${analysed.wordCount}`);
});

// ── keywords ─────────────────────────────────────────────────────────────
console.log('\nKeyword engine');
test('classifies transactional intent', () => {
  assert.equal(classifyIntent('buy seo audit software').intent, 'transactional');
});
test('classifies informational intent', () => {
  assert.equal(classifyIntent('what is a canonical tag').intent, 'informational');
});
test('difficulty proxy is labelled a heuristic', () => {
  const difficulty = keywordDifficultyProxy('seo');
  assert.equal(difficulty.method, 'heuristic-proxy');
  assert.ok(difficulty.note.toLowerCase().includes('heuristic'));
});
test('long-tail suggestions are grammatical and include the seed', () => {
  const suggestions = longTailSuggestions('technical seo', 5);
  assert.equal(suggestions.length, 5);
  for (const suggestion of suggestions) assert.ok(suggestion.includes('technical seo'), suggestion);
});
test('clusters related keywords together', () => {
  const clusters = groupKeywords(['technical seo audit', 'technical seo checklist', 'pricing page copy']);
  const technical = clusters.find((cluster) => cluster.keywords.includes('technical seo audit'));
  assert.ok(technical.keywords.includes('technical seo checklist'));
});
test('keyword coverage reports missing terms honestly', () => {
  const coverage = keywordCoverage('technical seo audit', {
    title: 'Technical SEO audit guide', text: 'technical seo audit checklist',
  });
  assert.equal(coverage.score > 0, true);
  assert.ok(Array.isArray(coverage.signals));
  assert.equal(coverage.signals.find((signal) => signal.id === 'title').present, true);
  assert.equal(coverage.signals.find((signal) => signal.id === 'h1').present, false);
});
test('content brief includes an outline and title', () => {
  const brief = contentBrief({ keyword: 'technical seo audit' });
  assert.ok(brief.suggestedTitle.length > 0);
  assert.ok(brief.suggestedDescription.length > 0);
  assert.ok(brief.outline.length >= 3);
});

// ── campaigns ────────────────────────────────────────────────────────────
console.log('\nCampaign tracking');
test('builds a UTM-tagged URL', () => {
  const url = buildTrackingUrl('https://example.com/pricing', {
    source: 'Newsletter', medium: 'Email', campaign: 'Spring Launch',
  });
  assert.equal(url, 'https://example.com/pricing?utm_source=newsletter&utm_medium=email&utm_campaign=spring-launch');
});
test('preserves existing query parameters', () => {
  const url = buildTrackingUrl('https://example.com/p?ref=1', { source: 'x', medium: 'social', campaign: 'y' });
  assert.match(url, /ref=1/);
  assert.match(url, /utm_source=x/);
});
test('rejects an invalid destination', () => {
  assert.throws(() => buildTrackingUrl('not a url', { source: 'a', medium: 'email', campaign: 'b' }));
});

// ── settings ─────────────────────────────────────────────────────────────
console.log('\nSettings validation');
test('clamps out-of-range numbers', () => {
  const settings = sanitizeSettings({ maxPages: 9999, maxDepth: 99, concurrency: 0 }, DEFAULT_SETTINGS);
  assert.equal(settings.maxPages, 200);
  assert.equal(settings.maxDepth, 4);
  assert.equal(settings.concurrency, 1);
});
test('ignores unknown browser profiles', () => {
  const settings = sanitizeSettings({ profile: 'netscape-navigator' }, DEFAULT_SETTINGS);
  assert.equal(settings.profile, DEFAULT_SETTINGS.profile);
});

// ── store: metrics + entities ────────────────────────────────────────────
console.log('\nStore');
const { store } = await createStore({ info: () => {}, warn: () => {}, error: () => {} });
await store.initSeo?.();

await testAsync('returns zeroed totals when no metrics exist (never invents data)', async () => {
  const [totals] = await store.aggregateMetrics({ siteId: 'missing', source: 'gsc', dimension: 'date', groupBy: 'none' });
  assert.equal(totals.clicks, 0);
  assert.equal(totals.impressions, 0);
  assert.equal(totals.ctr, 0);
});

await testAsync('upserts and aggregates metrics by date', async () => {
  await store.upsertMetrics([
    { siteId: 's1', source: 'gsc', dimension: 'date', key: '2026-01-01', date: '2026-01-01', clicks: 10, impressions: 100, position: 5 },
    { siteId: 's1', source: 'gsc', dimension: 'date', key: '2026-01-02', date: '2026-01-02', clicks: 30, impressions: 300, position: 3 },
  ]);
  const [totals] = await store.aggregateMetrics({ siteId: 's1', source: 'gsc', dimension: 'date', groupBy: 'none' });
  assert.equal(totals.clicks, 40);
  assert.equal(totals.impressions, 400);
  assert.ok(Math.abs(totals.ctr - 0.1) < 1e-9);
});

await testAsync('re-upserting the same day replaces rather than duplicates', async () => {
  await store.upsertMetrics([
    { siteId: 's1', source: 'gsc', dimension: 'date', key: '2026-01-02', date: '2026-01-02', clicks: 50, impressions: 500, position: 2 },
  ]);
  const [totals] = await store.aggregateMetrics({ siteId: 's1', source: 'gsc', dimension: 'date', groupBy: 'none' });
  assert.equal(totals.clicks, 60);
});

await testAsync('groups by key for dimension tables', async () => {
  await store.upsertMetrics([
    { siteId: 's1', source: 'gsc', dimension: 'query', key: 'seo audit', date: '2026-01-01', clicks: 5, impressions: 50 },
    { siteId: 's1', source: 'gsc', dimension: 'query', key: 'seo tools', date: '2026-01-01', clicks: 15, impressions: 150 },
  ]);
  const rows = await store.aggregateMetrics({ siteId: 's1', source: 'gsc', dimension: 'query', groupBy: 'key', orderBy: 'clicks' });
  assert.equal(rows[0].key, 'seo tools');
  assert.equal(rows.length, 2);
});

await testAsync('scopes metrics to the requested date window', async () => {
  const [totals] = await store.aggregateMetrics({
    siteId: 's1', source: 'gsc', dimension: 'date', groupBy: 'none', from: '2026-01-02', to: '2026-01-02',
  });
  assert.equal(totals.clicks, 50);
});

await testAsync('reports the latest metric date', async () => {
  assert.equal(await store.latestMetricDate({ siteId: 's1', source: 'gsc' }), '2026-01-02');
});

await testAsync('stores and lists entities newest-first', async () => {
  await store.putEntity('site', { id: 'a', name: 'A', updatedAt: '2026-01-01T00:00:00.000Z' });
  await store.putEntity('site', { id: 'b', name: 'B', updatedAt: '2026-02-01T00:00:00.000Z' });
  const sites = await store.listEntities('site');
  assert.equal(sites[0].id, 'b');
});

await testAsync('deletes entities', async () => {
  await store.deleteEntity('site', 'a');
  assert.equal(await store.getEntity('site', 'a'), null);
});

await testAsync('prunes metrics before a cutoff', async () => {
  await store.deleteMetrics({ before: '2026-01-02' });
  assert.equal(await store.latestMetricDate({ siteId: 's1', source: 'gsc' }), '2026-01-02');
});

await testAsync('stores and lists activity events oldest-first', async () => {
  await store.addEvent({ level: 'info', type: 'test', message: 'first', at: '2026-01-01T00:00:00.000Z' });
  await store.addEvent({ level: 'warn', type: 'test', message: 'second', at: '2026-01-01T00:00:01.000Z' });
  const events = await store.listEvents({ limit: 10 });
  assert.equal(events.length, 2);
  assert.equal(events[0].message, 'first');
  assert.equal(events[1].level, 'warn');
  assert.equal(await store.countEvents(), 2);
});

await testAsync('retention removes events older than the cutoff', async () => {
  await store.pruneOldData(1);
  assert.equal(await store.countEvents(), 0);
});

await testAsync('login sessions are stored, read and pruned by expiry', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  await store.saveToken('token-live', future);
  await store.saveToken('token-expired', past);
  assert.ok(await store.getToken('token-live'));
  await store.pruneTokens();
  assert.equal(await store.getToken('token-expired'), null);
  assert.ok(await store.getToken('token-live'));
  await store.deleteToken('token-live');
  assert.equal(await store.getToken('token-live'), null);
});

// ── deployment-mode resolution (shared by all modes) ─────────────────────
const { resolveMode, resolveHost, DEFAULT_HOSTS, isAndroid } = await import('../src/runtime.js');
test('mode: DEPLOYMENT_MODE is authoritative', () => {
  assert.equal(resolveMode({ DEPLOYMENT_MODE: 'termux' }), 'termux');
  assert.equal(resolveMode({ DEPLOYMENT_MODE: 'local', NODE_ENV: 'production' }), 'local');
});

test('mode: inference order termux > production > local', () => {
  const expected = isAndroid() ? 'termux' : 'local';
  assert.equal(resolveMode({}), expected);
  if (!isAndroid()) assert.equal(resolveMode({ NODE_ENV: 'production' }), 'vps');
  assert.equal(resolveMode({ DEPLOYMENT_MODE: 'termux', NODE_ENV: '' }), 'termux');
});

test('mode: default hosts — only VPS binds all interfaces', () => {
  assert.equal(resolveHost('vps', {}), '0.0.0.0');
  assert.equal(resolveHost('local', {}), '127.0.0.1');
  assert.equal(resolveHost('termux', {}), '127.0.0.1');
  assert.equal(DEFAULT_HOSTS.vps, '0.0.0.0');
});

test('mode: HOST always overrides the per-mode default', () => {
  assert.equal(resolveHost('vps', { HOST: '0.0.0.0' }), '0.0.0.0');
  assert.equal(resolveHost('local', { HOST: '192.168.1.5' }), '192.168.1.5');
});

await store.close().catch(() => {});

console.log(`\n${'─'.repeat(40)}`);
if (failures.length) {
  console.log(`\x1b[31m${failures.length} failed\x1b[0m, ${passed} passed\n`);
  process.exit(1);
}
console.log(`\x1b[32mAll ${passed} checks passed.\x1b[0m\n`);
