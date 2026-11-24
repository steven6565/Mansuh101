/**
 * Dependency-free HTML inspection for SEO audits.
 *
 * It is a tolerant scanner, not a browser: it extracts exactly the fields an
 * on-page audit needs (title, meta, headings, links, images, structured data,
 * canonical, hreflang, word count). Rendering-dependent checks are handled by
 * the optional Chromium pass instead.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

export function decodeEntities(value = '') {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    const key = String(code).toLowerCase();
    if (key.startsWith('#x')) return safeChar(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return safeChar(parseInt(key.slice(1), 10));
    return ENTITIES[key] ?? match;
  });
}

function safeChar(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

export function stripTags(html = '') {
  return decodeEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function attrs(tag = '') {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;
  while ((match = re.exec(tag))) {
    out[match[1].toLowerCase()] = decodeEntities(match[3] ?? match[4] ?? match[5] ?? '');
  }
  return out;
}

function findMeta(html, name) {
  const re = new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`, 'i');
  const match = html.match(re);
  if (!match) return null;
  return attrs(match[0]).content ?? '';
}

function findTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim() : null;
}

function collectHeadings(html) {
  const headings = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = re.exec(html)) && headings.length < 200) {
    headings.push({ level: Number(match[1]), text: stripTags(match[2]).slice(0, 300) });
  }
  return headings;
}

function collectLinks(html) {
  const links = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) && links.length < 3000) {
    const attributes = attrs(match[1]);
    const href = attributes.href;
    if (!href) continue;
    links.push({
      href,
      text: stripTags(match[2]).slice(0, 300),
      rel: attributes.rel ?? '',
      target: attributes.target ?? '',
      title: attributes.title ?? '',
    });
  }
  return links;
}

function collectImages(html) {
  const images = [];
  const re = /<img\b([^>]*)>/gi;
  let match;
  while ((match = re.exec(html)) && images.length < 1000) {
    const attributes = attrs(match[1]);
    images.push({
      src: attributes.src ?? '',
      alt: attributes.alt ?? null,
      width: attributes.width ?? null,
      height: attributes.height ?? null,
      loading: attributes.loading ?? null,
    });
  }
  return images;
}

function collectJsonLd(html) {
  const blocks = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while (match = re.exec(html)) {
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        blocks.push({ ok: true, types: extractTypes(entry), raw: raw.slice(0, 4000) });
      }
    } catch (error) {
      blocks.push({ ok: false, types: [], error: error.message, raw: raw.slice(0, 400) });
    }
  }
  return blocks;
}

function extractTypes(node, depth = 0) {
  if (!node || depth > 3) return [];
  if (Array.isArray(node)) return node.flatMap((item) => extractTypes(item, depth + 1));
  if (typeof node !== 'object') return [];
  const types = [];
  if (node['@type']) types.push(...(Array.isArray(node['@type']) ? node['@type'] : [node['@type']]));
  if (node['@graph']) types.push(...extractTypes(node['@graph'], depth + 1));
  return types.map(String);
}

function findCanonical(html) {
  const match = html.match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i);
  return match ? attrs(match[0]).href ?? null : null;
}

function findHreflang(html) {
  const out = [];
  const re = /<link\b([^>]*)>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attributes = attrs(match[1]);
    if ((attributes.rel || '').toLowerCase().includes('alternate') && attributes.hreflang) {
      out.push({ hreflang: attributes.hreflang, href: attributes.href ?? '' });
    }
  }
  return out;
}

export function analyzeHtml(html, url) {
  const safe = String(html ?? '');
  const title = findTitle(safe);
  const description = findMeta(safe, 'description');
  const robots = findMeta(safe, 'robots') ?? '';
  const viewport = findMeta(safe, 'viewport');
  const ogTitle = findMeta(safe, 'og:title');
  const ogImage = findMeta(safe, 'og:image');
  const twitterCard = findMeta(safe, 'twitter:card');
  const headings = collectHeadings(safe);
  const links = collectLinks(safe);
  const images = collectImages(safe);
  const jsonLd = collectJsonLd(safe);
  const text = stripTags(safe);
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const canonical = findCanonical(safe);
  const hreflang = findHreflang(safe);

  let path = '/';
  try {
    path = new URL(url).pathname || '/';
  } catch {
    /* keep default */
  }

  return {
    url,
    path,
    title: title ?? null,
    titleLength: title ? title.length : 0,
    description: description ?? null,
    descriptionLength: description ? description.length : 0,
    robots,
    noindex: /noindex/i.test(robots),
    nofollow: /nofollow/i.test(robots),
    viewport: viewport ?? null,
    lang: (safe.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i) || [])[1] ?? null,
    canonical,
    hreflang,
    headings,
    h1: headings.filter((heading) => heading.level === 1).map((heading) => heading.text),
    h2: headings.filter((heading) => heading.level === 2).map((heading) => heading.text),
    h3: headings.filter((heading) => heading.level === 3).map((heading) => heading.text),
    links,
    internalLinks: [],
    externalLinks: [],
    images,
    jsonLd,
    structuredDataTypes: [...new Set(jsonLd.flatMap((block) => block.types))],
    wordCount: words.length,
    textSample: text.slice(0, 600),
    ogTitle,
    ogImage,
    twitterCard,
    hasFavicon: /<link\b[^>]*rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(safe),
    hasAmpLink: /<link\b[^>]*rel\s*=\s*["']amphtml["']/i.test(safe),
    htmlBytes: Buffer.byteLength(safe, 'utf8'),
  };
}

/** Very small, deterministic readability-style extractor for content briefs. */
export function extractSections(html) {
  const sections = [];
  const re = /<(h1|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = re.exec(String(html ?? ''))) && sections.length < 60) {
    sections.push({ level: Number(match[1].slice(1)), text: stripTags(match[2]).slice(0, 200) });
  }
  return sections;
}
