/**
 * robots.txt parser (RFC 9309 subset) + sitemap discovery/validation.
 * Used by the crawler so respectRobots is real, not decorative.
 */

export function parseRobots(text = '') {
  const groups = [];
  let current = null;
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const index = line.indexOf(':');
    if (index === -1) continue;
    const field = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (field === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [], sitemaps: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      if (!current) {
        current = { agents: ['*'], rules: [], sitemaps: [] };
        groups.push(current);
      }
      current.rules.push({ type: field, path: value });
    } else if (field === 'sitemap') {
      const target = groups[groups.length - 1] ?? (current = { agents: ['*'], rules: [], sitemaps: [] });
      if (!groups.length) groups.push(current);
      target.sitemaps.push(value);
    } else if (field === 'crawl-delay') {
      if (current) current.crawlDelay = Number(value) || null;
    }
  }
  const sitemaps = [...new Set(groups.flatMap((group) => group.sitemaps).filter(Boolean))];
  return { groups, sitemaps, raw: String(text) };
}

function patternToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\\\$$/, '$');
  return new RegExp(`^${escaped}`);
}

/** Returns { allowed, matchedRule, crawlDelay }. Longest match wins. */
export function robotsAllows(robots, path, userAgent = 'VisitorSEO') {
  if (!robots || !robots.groups?.length) return { allowed: true, matchedRule: null };
  const ua = String(userAgent).toLowerCase();
  let group = robots.groups.find((candidate) =>
    candidate.agents.some((agent) => agent !== '*' && ua.includes(agent)));
  if (!group) group = robots.groups.find((candidate) => candidate.agents.includes('*'));
  if (!group) return { allowed: true, matchedRule: null };

  const target = path || '/';
  let best = null;
  for (const rule of group.rules) {
    if (!rule.path) {
      if (rule.type === 'disallow' && (!best || best.path.length === 0)) {
        best = { ...rule, length: 0 };
      }
      continue;
    }
    if (patternToRegex(rule.path).test(target)) {
      if (!best || rule.path.length > best.length) {
        best = { ...rule, length: rule.path.length };
      }
    }
  }
  if (!best) return { allowed: true, matchedRule: null, crawlDelay: group.crawlDelay ?? null };
  return {
    allowed: best.type === 'allow',
    matchedRule: `${best.type}: ${best.path}`,
    crawlDelay: group.crawlDelay ?? null,
  };
}

/** Extract <loc> values (and metadata) from a sitemap or sitemap index. */
export function parseSitemap(xml = '') {
  const body = String(xml);
  const isIndex = /<sitemapindex\b/i.test(body);
  const entries = [];
  const blockRe = isIndex
    ? /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi
    : /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
  let match;
  while ((match = blockRe.exec(body)) && entries.length < 50000) {
    const block = match[1];
    const loc = decodeXml((block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1] ?? '');
    if (!loc) continue;
    entries.push({
      loc,
      lastmod: decodeXml((block.match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1] ?? ''),
      changefreq: decodeXml((block.match(/<changefreq>\s*([\s\S]*?)\s*<\/changefreq>/i) || [])[1] ?? ''),
      priority: decodeXml((block.match(/<priority>\s*([\s\S]*?)\s*<\/priority>/i) || [])[1] ?? ''),
    });
  }
  return { isIndex, entries };
}

function decodeXml(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/** Build a valid sitemap XML from a list of URLs. */
export function buildSitemap(urls = []) {
  const rows = urls
    .map((entry) => {
      const loc = typeof entry === 'string' ? entry : entry?.loc;
      if (!loc || !/^https?:\/\//i.test(loc)) return null;
      const lastmod = (typeof entry === 'object' && entry.lastmod) || new Date().toISOString().slice(0, 10);
      const priority = (typeof entry === 'object' && entry.priority) || '';
      const changefreq = (typeof entry === 'object' && entry.changefreq) || '';
      return [
        '  <url>',
        `    <loc>${escapeXml(loc)}</loc>`,
        `    <lastmod>${escapeXml(String(lastmod))}</lastmod>`,
        changefreq ? `    <changefreq>${escapeXml(changefreq)}</changefreq>` : null,
        priority ? `    <priority>${escapeXml(String(priority))}</priority>` : null,
        '  </url>',
      ].filter(Boolean).join('\n');
    })
    .filter(Boolean);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    '</urlset>',
    '',
  ].join('\n');
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
