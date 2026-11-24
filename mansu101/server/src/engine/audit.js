import crypto from 'node:crypto';
import { analyzeHtml, extractSections } from '../lib/html.js';
import { fetchPage, normalizeForCompare, resolveUrl, sameOrigin } from '../lib/net.js';
import { parseRobots, robotsAllows, parseSitemap } from '../lib/robots.js';
import { crawlerConfig, config } from '../config.js';

/**
 * Site audit engine.
 *
 * Crawls only the site the user added, honours robots.txt by default, and
 * produces a scored, actionable report from real HTTP responses. Every check
 * carries its evidence so the UI can explain *why* something failed.
 *
 * There is no traffic simulation anywhere in this module: it fetches pages
 * like any SEO crawler (Screaming Frog, Ahrefs Site Audit) would.
 */

const SEVERITY_WEIGHT = { critical: 12, high: 7, medium: 3, low: 1, info: 0 };

export class AuditEngine {
  constructor({ bus, store }) {
    this.bus = bus;
    this.store = store;
    this.running = new Map(); // auditId -> AbortController
  }

  isRunning(auditId) {
    return this.running.has(auditId);
  }

  cancel(auditId) {
    const controller = this.running.get(auditId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /**
   * Run a full audit. `onProgress` receives partial state so the UI can poll
   * a live audit; the final report is persisted by the caller.
   */
  async run({
    siteId,
    startUrl,
    options = {},
    onProgress = () => {},
    signal,
  }) {
    const settings = {
      maxPages: Math.min(options.maxPages ?? 25, crawlerConfig.maxPages),
      maxDepth: Math.min(options.maxDepth ?? 2, 4),
      concurrency: Math.max(1, Math.min(options.concurrency ?? crawlerConfig.concurrency, crawlerConfig.concurrency)),
      requestTimeoutMs: Math.max(3000, options.requestTimeoutMs ?? crawlerConfig.timeoutMs),
      respectRobots: options.respectRobots !== false,
      checkExternalLinks: Boolean(options.checkExternalLinks),
    };

    const origin = new URL(startUrl).origin;
    const queue = [{ url: normalizeForCompare(startUrl), depth: 0 }];
    const visited = new Set();
    const pages = [];
    const linkChecks = new Map(); // url -> {status, ok, error}
    const issues = [];
    const startedAt = Date.now();
    const abort = new AbortController();
    const compositeSignal = combineSignals([signal, abort.signal]);
    const runId = crypto.randomUUID();
    this.running.set(runId, abort);

    let robots = null;
    let robotsStatus = null;
    let sitemapInfo = null;

    try {
      // ── robots.txt ─────────────────────────────────────────────────────
      onProgress({ phase: 'robots', message: 'Reading robots.txt', pages: 0 });
      try {
        const response = await fetchPage(`${origin}/robots.txt`, {
          timeoutMs: settings.requestTimeoutMs,
          maxBytes: 500_000,
          signal: compositeSignal,
        });
        robotsStatus = response.status;
        robots = parseRobots(response.body);
      } catch (error) {
        robotsStatus = error.code === 'TIMEOUT' ? 'timeout' : 'error';
        robots = parseRobots('');
        issues.push(makeIssue({
          id: 'robots-unreachable',
          severity: 'low',
          category: 'crawlability',
          title: 'robots.txt could not be fetched',
          detail: `${origin}/robots.txt returned ${error.message}. A missing robots.txt is not fatal, but a 5xx or timeout blocks crawlers.`,
          url: `${origin}/robots.txt`,
        }));
      }

      if (robotsStatus === 200 && robots.raw.trim() === '') {
        issues.push(makeIssue({
          id: 'robots-empty',
          severity: 'info',
          category: 'crawlability',
          title: 'robots.txt is empty',
          detail: 'An empty robots.txt allows everything. That is fine, but add a Sitemap: line so crawlers can discover your sitemap.',
          url: `${origin}/robots.txt`,
        }));
      }
      if (robotsStatus === 200 && !/sitemap\s*:/i.test(robots.raw)) {
        issues.push(makeIssue({
          id: 'robots-no-sitemap',
          severity: 'low',
          category: 'crawlability',
          title: 'robots.txt does not declare a sitemap',
          detail: 'Add "Sitemap: https://your-domain/sitemap.xml" to robots.txt to speed up discovery.',
          url: `${origin}/robots.txt`,
        }));
      }

      // ── sitemap ────────────────────────────────────────────────────────
      onProgress({ phase: 'sitemap', message: 'Validating sitemap', pages: 0 });
      const sitemapCandidates = [
        ...(robots?.sitemaps ?? []),
        `${origin}/sitemap.xml`,
        `${origin}/sitemap_index.xml`,
      ].filter((value, index, all) => value && all.indexOf(value) === index);

      for (const candidate of sitemapCandidates) {
        if (!sameOrigin(candidate, origin)) continue;
        try {
          const response = await fetchPage(candidate, {
            timeoutMs: settings.requestTimeoutMs,
            maxBytes: 3_000_000,
            signal: compositeSignal,
          });
          if (response.status === 200 && /<(urlset|sitemapindex)\b/i.test(response.body)) {
            const parsed = parseSitemap(response.body);
            sitemapInfo = {
              url: candidate,
              status: response.status,
              isIndex: parsed.isIndex,
              count: parsed.entries.length,
              entries: parsed.entries.slice(0, 500),
            };
            if (!parsed.entries.length) {
              issues.push(makeIssue({
                id: 'sitemap-empty',
                severity: 'high',
                category: 'sitemap',
                title: 'Sitemap contains no URLs',
                detail: `${candidate} is valid XML but lists zero pages.`,
                url: candidate,
              }));
            }
            break;
          }
          if (response.status === 200) {
            issues.push(makeIssue({
              id: 'sitemap-invalid',
              severity: 'high',
              category: 'sitemap',
              title: 'Sitemap is not valid XML',
              detail: `${candidate} returned 200 but does not contain a <urlset> or <sitemapindex>.`,
              url: candidate,
            }));
            sitemapInfo = { url: candidate, status: response.status, isIndex: false, count: 0, entries: [] };
            break;
          }
        } catch {
          /* try next candidate */
        }
      }
      if (!sitemapInfo) {
        issues.push(makeIssue({
          id: 'sitemap-missing',
          severity: 'high',
          category: 'sitemap',
          title: 'No XML sitemap found',
          detail: 'Publish /sitemap.xml (or declare it in robots.txt). Sitemaps are the fastest way to get new pages indexed.',
          url: `${origin}/sitemap.xml`,
        }));
      }

      // ── crawl ──────────────────────────────────────────────────────────
      const worker = async () => {
        while (queue.length) {
          if (compositeSignal.aborted) return;
          if (pages.length >= settings.maxPages) return;
          const next = queue.shift();
          const key = normalizeForCompare(next.url);
          if (visited.has(key)) continue;
          visited.add(key);

          if (settings.respectRobots && robots) {
            const verdict = robotsAllows(robots, new URL(next.url).pathname, 'VisitorSEO');
            if (!verdict.allowed) {
              issues.push(makeIssue({
                id: 'blocked-by-robots',
                severity: 'info',
                category: 'crawlability',
                title: 'URL is disallowed by robots.txt',
                detail: `${next.url} matches "${verdict.matchedRule}". Skipped by the crawler, as Google would.`,
                url: next.url,
              }));
              continue;
            }
          }

          onProgress({
            phase: 'crawl',
            message: `Fetching ${next.url}`,
            pages: pages.length,
            queued: queue.length,
          });

          let response;
          try {
            response = await fetchPage(next.url, {
              timeoutMs: settings.requestTimeoutMs,
              signal: compositeSignal,
            });
          } catch (error) {
            pages.push({
              url: next.url,
              depth: next.depth,
              status: 0,
              ok: false,
              error: error.code === 'TIMEOUT' ? 'Timeout' : String(error.message).slice(0, 200),
              contentType: '',
            });
            issues.push(makeIssue({
              id: `fetch-failed:${next.url}`,
              severity: 'critical',
              category: 'availability',
              title: 'Page could not be loaded',
              detail: `${next.url} — ${error.code === 'TIMEOUT' ? 'request timed out' : error.message}`,
              url: next.url,
            }));
            continue;
          }

          const isHtml = /text\/html|application\/xhtml/i.test(response.contentType);
          const page = {
            url: next.url,
            finalUrl: response.finalUrl,
            depth: next.depth,
            status: response.status,
            ok: response.ok,
            contentType: response.contentType,
            durationMs: response.durationMs,
            bytes: response.bytes,
            redirected: response.redirected,
            ...(isHtml ? analyzeHtml(response.body, response.finalUrl) : {}),
            isHtml,
          };
          pages.push(page);

          if (response.redirected && normalizeForCompare(response.finalUrl) !== normalizeForCompare(next.url)) {
            issues.push(makeIssue({
              id: `redirect:${next.url}`,
              severity: 'low',
              category: 'indexing',
              title: 'URL redirects',
              detail: `${next.url} redirects to ${response.finalUrl}. Link to the final URL directly to avoid wasted crawl budget.`,
              url: next.url,
            }));
          }

          if (isHtml) {
            const internal = [];
            const external = [];
            for (const link of page.links) {
              if (!link.href || link.href.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(link.href)) continue;
              const resolved = resolveUrl(response.finalUrl, link.href);
              if (!resolved) continue;
              if (sameOrigin(resolved, origin)) internal.push({ ...link, url: resolved });
              else external.push({ ...link, url: resolved });
            }
            page.internalLinks = internal;
            page.externalLinks = external;

            if (next.depth < settings.maxDepth) {
              for (const link of internal) {
                const linkKey = normalizeForCompare(link.url);
                if (visited.has(linkKey)) continue;
                if (queue.some((item) => normalizeForCompare(item.url) === linkKey)) continue;
                if (pages.length + queue.length >= settings.maxPages * 2) break;
                queue.push({ url: link.url, depth: next.depth + 1 });
              }
            }

            if (settings.checkExternalLinks) {
              for (const link of external.slice(0, 30)) {
                if (linkChecks.has(link.url)) continue;
                linkChecks.set(link.url, { status: 'pending' });
              }
            }
          }
        }
      };

      await Promise.all(Array.from({ length: settings.concurrency }, () => worker()));

      // ── external link checks (opt-in, HEAD) ────────────────────────────
      if (settings.checkExternalLinks && linkChecks.size) {
        onProgress({ phase: 'links', message: `Checking ${linkChecks.size} external links`, pages: pages.length });
        const targets = [...linkChecks.keys()].slice(0, 200);
        for (const target of targets) {
          if (compositeSignal.aborted) break;
          try {
            const head = await fetchPage(target, {
              method: 'HEAD',
              timeoutMs: Math.min(8000, settings.requestTimeoutMs),
              signal: compositeSignal,
            });
            linkChecks.set(target, { status: head.status, ok: head.ok });
          } catch (error) {
            linkChecks.set(target, { status: 0, ok: false, error: String(error.message).slice(0, 120) });
          }
        }
      }

      // ── analysis ───────────────────────────────────────────────────────
      onProgress({ phase: 'analyze', message: 'Scoring pages', pages: pages.length });
      const analysis = analyzeSite({ pages, issues, origin, sitemapInfo, robots, linkChecks, settings });

      return {
        id: runId,
        siteId,
        startUrl,
        origin,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        settings,
        robots: { status: robotsStatus, sitemaps: robots?.sitemaps ?? [], groups: robots?.groups?.length ?? 0 },
        sitemap: sitemapInfo ? { ...sitemapInfo, entries: sitemapInfo.entries.slice(0, 200) } : null,
        pages: analysis.pages,
        issues: analysis.issues,
        summary: analysis.summary,
        score: analysis.score,
        crawl: { discovered: visited.size, fetched: pages.length, aborted: compositeSignal.aborted },
      };
    } finally {
      this.running.delete(runId);
    }
  }
}

function combineSignals(signals) {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function makeIssue({ id, severity, category, title, detail, url, evidence }) {
  return {
    id,
    severity,
    category,
    title,
    detail,
    url: url ?? null,
    evidence: evidence ?? null,
    fix: FIXES[String(id).split(':')[0]] ?? null,
  };
}

/**
 * Concrete remediation guidance per rule. Kept next to the rules so an issue
 * always ships with an actionable next step instead of a vague warning.
 */
const FIXES = {
  'blocked-by-robots': 'Publish the path you want indexed in robots.txt (remove the Disallow rule), or audit it with CRAWLER_ALLOW_PRIVATE/local tooling instead.',
  'robots-unreachable': 'Make /robots.txt return 200. If it is behind auth or a WAF, allow your crawler user agent through — a 5xx or timeout blocks all crawlers.',
  'robots-empty': 'Add a Sitemap: line to robots.txt so crawlers discover your sitemap immediately instead of guessing.',
  'robots-no-sitemap': 'Add "Sitemap: https://your-domain/sitemap.xml" to robots.txt.',
  'sitemap-missing': 'Publish /sitemap.xml (or declare it in robots.txt) listing every canonical URL you want indexed.',
  'sitemap-empty': 'Populate the sitemap with your canonical URLs — an empty <urlset> tells Google there is nothing to index.',
  'sitemap-invalid': 'Return valid <urlset> or <sitemapindex> XML with correct namespaces, and check the Content-Type is XML.',
  'sitemap-missing-urls': 'Add the crawled pages to the sitemap, or remove them from the crawl scope if they should not be indexed.',
  'sitemap-no-overlap': 'Make the sitemap use the same host as the site (www vs non-www) and regenerate it from your canonical URLs.',
  'orphan-pages': 'Link to these pages from a relevant parent page, a hub page or your navigation so crawlers can reach them.',
  'title-missing': 'Add a unique <title> between 30 and 60 characters that includes the primary query.',
  'title-short': 'Expand the title with a qualifier such as the benefit or brand — aim for 30–60 characters.',
  'title-long': 'Trim the title to under 60 characters so Google does not truncate it in results.',
  'description-missing': 'Write a 120–155 character meta description that states the page benefit and a call to action.',
  'description-short': 'Lengthen the meta description to roughly 120–155 characters.',
  'description-long': 'Shorten the meta description to under 160 characters so it is not cut off.',
  'h1-missing': 'Add exactly one <h1> that matches the page topic and contains the target phrase.',
  'h1-multiple': 'Keep a single <h1>; convert the others to <h2> to preserve a clean outline.',
  'heading-skip': 'Do not skip heading levels — go h1 → h2 → h3 so assistive tech and crawlers read a logical outline.',
  'canonical-missing': 'Add a self-referencing <link rel="canonical"> to consolidate duplicate URL variants.',
  'canonical-mismatch': 'Point the canonical at the preferred URL, or remove it if this page should rank on its own.',
  'noindex': 'Remove the noindex directive if this page should appear in search, then re-submit it in Search Console.',
  thin: 'Add genuinely useful detail (examples, data, steps) or merge this page into a stronger one.',
  'img-alt': 'Describe each meaningful image in alt text; use alt="" only for purely decorative images.',
  'jsonld-invalid': 'Fix the JSON-LD so it parses and matches a supported schema.org type.',
  viewport: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>.',
  social: 'Add Open Graph (og:title, og:description, og:image) and twitter:card tags.',
  'html-heavy': 'Reduce HTML payload: defer non-critical scripts, inline less CSS, compress responses.',
  'slow-ttfb': 'Improve server response time with caching, a CDN, or a faster origin.',
  'broken-internal': 'Fix or redirect the internal link target so crawlers and users reach a working page.',
  'broken-external': 'Update or remove the dead outbound link, or replace it with a live source.',
  'title-duplicate': 'Give each of these pages a distinct title that reflects its specific intent.',
  'description-duplicate': 'Write a unique meta description per page.',
  'content-duplicate': 'Consolidate the duplicates into one canonical page and 301 the rest.',
  'canonical-cluster': 'Make sure the canonical target is the version you actually want indexed.',
  'fetch-failed': 'Confirm the URL returns 200 for a normal browser request; check auth, redirects and firewall rules.',
  redirect: 'Link directly to the final URL to avoid wasting crawl budget on redirect chains.',
};

/** Rule-based on-page analysis over the crawled pages. */
function analyzeSite({ pages, issues, origin, sitemapInfo, linkChecks, settings }) {
  const html = pages.filter((page) => page.isHtml && page.ok);
  const titles = new Map();
  const descriptions = new Map();
  const canonicals = new Map();
  const contentHashes = new Map();

  for (const page of html) {
    // Titles
    if (!page.title) {
      issues.push(makeIssue({
        id: `title-missing:${page.url}`,
        severity: 'critical',
        category: 'on-page',
        title: 'Missing title tag',
        detail: 'Every indexable page needs a unique <title>. It is the main ranking and click signal.',
        url: page.url,
      }));
    } else {
      if (page.titleLength < 30) {
        issues.push(makeIssue({
          id: `title-short:${page.url}`,
          severity: 'medium',
          category: 'on-page',
          title: 'Title tag is short',
          detail: `"${page.title}" is ${page.titleLength} characters. Aim for 30-60 to use the available space.`,
          url: page.url,
        }));
      }
      if (page.titleLength > 65) {
        issues.push(makeIssue({
          id: `title-long:${page.url}`,
          severity: 'low',
          category: 'on-page',
          title: 'Title tag may be truncated',
          detail: `"${page.title}" is ${page.titleLength} characters. Google usually shows ~60.`,
          url: page.url,
        }));
      }
      const key = page.title.toLowerCase().trim();
      if (!titles.has(key)) titles.set(key, []);
      titles.get(key).push(page.url);
    }

    // Descriptions
    if (!page.description) {
      issues.push(makeIssue({
        id: `description-missing:${page.url}`,
        severity: 'high',
        category: 'on-page',
        title: 'Missing meta description',
        detail: 'Google may write its own snippet. Add a 120-155 character description with a reason to click.',
        url: page.url,
      }));
    } else {
      if (page.descriptionLength < 70) {
        issues.push(makeIssue({
          id: `description-short:${page.url}`,
          severity: 'low',
          category: 'on-page',
          title: 'Meta description is short',
          detail: `${page.descriptionLength} characters. Aim for 120-155.`,
          url: page.url,
        }));
      }
      if (page.descriptionLength > 165) {
        issues.push(makeIssue({
          id: `description-long:${page.url}`,
          severity: 'low',
          category: 'on-page',
          title: 'Meta description may be truncated',
          detail: `${page.descriptionLength} characters. Google usually shows ~155.`,
          url: page.url,
        }));
      }
      const key = page.description.toLowerCase().trim();
      if (!descriptions.has(key)) descriptions.set(key, []);
      descriptions.get(key).push(page.url);
    }

    // Headings
    if (!page.h1?.length) {
      issues.push(makeIssue({
        id: `h1-missing:${page.url}`,
        severity: 'high',
        category: 'on-page',
        title: 'Missing H1',
        detail: 'Add one H1 that states the page topic. It anchors the heading outline for users and crawlers.',
        url: page.url,
      }));
    } else if (page.h1.length > 1) {
      issues.push(makeIssue({
        id: `h1-multiple:${page.url}`,
        severity: 'medium',
        category: 'on-page',
        title: 'Multiple H1 tags',
        detail: `${page.h1.length} H1 elements found: ${page.h1.slice(0, 3).map((text) => `"${text}"`).join(', ')}. Keep one primary H1.`,
        url: page.url,
      }));
    }
    let previousLevel = 0;
    for (const heading of page.headings) {
      if (previousLevel && heading.level > previousLevel + 1) {
        issues.push(makeIssue({
          id: `heading-skip:${page.url}:${heading.level}`,
          severity: 'low',
          category: 'on-page',
          title: 'Heading levels are skipped',
          detail: `"${heading.text.slice(0, 60)}" is an H${heading.level} directly after an H${previousLevel}. Keep the outline sequential.`,
          url: page.url,
        }));
        break;
      }
      previousLevel = heading.level;
    }

    // Canonical
    if (!page.canonical) {
      issues.push(makeIssue({
        id: `canonical-missing:${page.url}`,
        severity: 'low',
        category: 'indexing',
        title: 'No canonical URL',
        detail: 'Add rel="canonical" to prevent duplicate-URL indexing (http/https, trailing slash, query variants).',
        url: page.url,
      }));
    } else {
      const resolved = resolveUrl(page.url, page.canonical);
      if (resolved && normalizeForCompare(resolved) !== normalizeForCompare(page.url)) {
        issues.push(makeIssue({
          id: `canonical-mismatch:${page.url}`,
          severity: 'medium',
          category: 'indexing',
          title: 'Canonical points to a different URL',
          detail: `This page canonicalises to ${resolved}. Confirm that is intentional, otherwise this URL will not rank.`,
          url: page.url,
        }));
      }
      const key = resolved ? normalizeForCompare(resolved) : page.canonical;
      if (!canonicals.has(key)) canonicals.set(key, []);
      canonicals.get(key).push(page.url);
    }

    // Indexability
    if (page.noindex) {
      issues.push(makeIssue({
        id: `noindex:${page.url}`,
        severity: 'info',
        category: 'indexing',
        title: 'Page is marked noindex',
        detail: 'This page is excluded from search results. Expected for utility pages, a problem for money pages.',
        url: page.url,
      }));
    }

    // Content depth
    if (page.wordCount < 150) {
      issues.push(makeIssue({
        id: `thin:${page.url}`,
        severity: 'medium',
        category: 'content',
        title: 'Thin content',
        detail: `${page.wordCount} words in the main text. Add genuinely useful detail or consolidate the page.`,
        url: page.url,
      }));
    }

    // Duplicate content (cheap shingle hash of the text sample)
    if (page.textSample) {
      const hash = simpleHash(page.textSample.toLowerCase().replace(/\s+/g, ' '));
      if (!contentHashes.has(hash)) contentHashes.set(hash, []);
      contentHashes.get(hash).push(page.url);
    }

    // Images
    const missingAlt = page.images.filter((image) => image.alt === null || image.alt === '');
    if (missingAlt.length) {
      issues.push(makeIssue({
        id: `img-alt:${page.url}`,
        severity: missingAlt.length > 5 ? 'medium' : 'low',
        category: 'accessibility',
        title: 'Images without alt text',
        detail: `${missingAlt.length} of ${page.images.length} images have no alt attribute. Describe the image, or use alt="" for decorative images.`,
        url: page.url,
        evidence: missingAlt.slice(0, 5).map((image) => image.src),
      }));
    }

    // Structured data
    for (const block of page.jsonLd) {
      if (!block.ok) {
        issues.push(makeIssue({
          id: `jsonld-invalid:${page.url}`,
          severity: 'medium',
          category: 'structured-data',
          title: 'Invalid JSON-LD',
          detail: `Structured data failed to parse: ${block.error}`,
          url: page.url,
        }));
      }
    }

    // Viewport (mobile)
    if (!page.viewport) {
      issues.push(makeIssue({
        id: `viewport:${page.url}`,
        severity: 'high',
        category: 'mobile',
        title: 'No viewport meta tag',
        detail: 'Without <meta name="viewport" content="width=device-width, initial-scale=1"> the page renders zoomed out on phones.',
        url: page.url,
      }));
    }

    // Social preview
    if (!page.ogTitle || !page.ogImage) {
      issues.push(makeIssue({
        id: `social:${page.url}`,
        severity: 'low',
        category: 'on-page',
        title: 'Incomplete social preview tags',
        detail: 'Add og:title, og:description and og:image so shares on social and messaging apps look correct.',
        url: page.url,
      }));
    }

    // Page weight / speed proxy
    if (page.bytes > 500_000) {
      issues.push(makeIssue({
        id: `html-heavy:${page.url}`,
        severity: 'medium',
        category: 'performance',
        title: 'Very large HTML document',
        detail: `${Math.round(page.bytes / 1024)} KB of HTML (before images, CSS and JS). Reduce inline data and DOM size.`,
        url: page.url,
      }));
    }
    if (page.durationMs > 2500) {
      issues.push(makeIssue({
        id: `slow-ttfb:${page.url}`,
        severity: 'medium',
        category: 'performance',
        title: 'Slow server response',
        detail: `The HTML document took ${page.durationMs}ms to download. Aim under 800ms; check hosting, caching and database queries.`,
        url: page.url,
      }));
    }

    // Broken internal links
    for (const link of page.internalLinks ?? []) {
      const target = html.find((candidate) => normalizeForCompare(candidate.url) === normalizeForCompare(link.url));
      if (target && !target.ok) {
        issues.push(makeIssue({
          id: `broken-internal:${page.url}:${link.url}`,
          severity: 'high',
          category: 'links',
          title: 'Broken internal link',
          detail: `"${link.text || link.url}" links to ${link.url} which returns HTTP ${target.status}.`,
          url: page.url,
        }));
      }
    }
  }

  // Duplicate titles / descriptions across pages
  for (const [title, urls] of titles) {
    if (urls.length > 1) {
      issues.push(makeIssue({
        id: `title-duplicate:${simpleHash(title)}`,
        severity: 'high',
        category: 'on-page',
        title: 'Duplicate title tags',
        detail: `${urls.length} pages share the title "${title.slice(0, 80)}". Make each title unique.`,
        url: urls[0],
        evidence: urls.slice(0, 8),
      }));
    }
  }
  for (const [, urls] of descriptions) {
    if (urls.length > 1) {
      issues.push(makeIssue({
        id: `description-duplicate:${simpleHash(urls[0])}`,
        severity: 'medium',
        category: 'on-page',
        title: 'Duplicate meta descriptions',
        detail: `${urls.length} pages share the same description. Write a specific snippet per page.`,
        url: urls[0],
        evidence: urls.slice(0, 8),
      }));
    }
  }
  for (const [, urls] of contentHashes) {
    if (urls.length > 1) {
      issues.push(makeIssue({
        id: `content-duplicate:${simpleHash(urls[0])}`,
        severity: 'high',
        category: 'content',
        title: 'Near-duplicate page content',
        detail: `${urls.length} pages have identical main text. Consolidate them or add unique value, and canonicalise the variant.`,
        url: urls[0],
        evidence: urls.slice(0, 8),
      }));
    }
  }

  // Canonical conflicts (several pages canonicalise to the same target)
  for (const [target, urls] of canonicals) {
    if (urls.length > 1) {
      issues.push(makeIssue({
        id: `canonical-cluster:${simpleHash(target)}`,
        severity: 'info',
        category: 'indexing',
        title: 'Several URLs canonicalise to one page',
        detail: `${urls.length} URLs point their canonical at ${target}. Fine for variants, but verify each one is intentional.`,
        url: target,
        evidence: urls.slice(0, 8),
      }));
    }
  }

  // Sitemap coverage
  if (sitemapInfo?.entries?.length) {
    const crawled = new Set(html.map((page) => normalizeForCompare(page.url)));
    const inSitemap = sitemapInfo.entries.filter((entry) => crawled.has(normalizeForCompare(entry.loc)));
    const missing = [...crawled].filter((url) => !sitemapInfo.entries.some((entry) => normalizeForCompare(entry.loc) === url));
    if (missing.length) {
      issues.push(makeIssue({
        id: 'sitemap-missing-urls',
        severity: 'medium',
        category: 'sitemap',
        title: 'Crawled pages are missing from the sitemap',
        detail: `${missing.length} crawled page(s) are not listed in ${sitemapInfo.url}. Add them or remove them from the crawl scope.`,
        url: sitemapInfo.url,
        evidence: missing.slice(0, 10),
      }));
    }
    if (inSitemap.length === 0 && sitemapInfo.count > 0) {
      issues.push(makeIssue({
        id: 'sitemap-no-overlap',
        severity: 'high',
        category: 'sitemap',
        title: 'Sitemap URLs do not match the crawled site',
        detail: `None of the ${sitemapInfo.count} sitemap entries match ${origin}. The sitemap may belong to a different host (www vs non-www).`,
        url: sitemapInfo.url,
      }));
    }
  }

  // External link results
  for (const [url, result] of linkChecks ?? []) {
    if (result?.status === 'pending') continue;
    if (result && !result.ok) {
      issues.push(makeIssue({
        id: `broken-external:${simpleHash(url)}`,
        severity: 'low',
        category: 'links',
        title: 'External link is broken',
        detail: `${url} — ${result.status ? `HTTP ${result.status}` : result.error ?? 'unreachable'}`,
        url,
      }));
    }
  }

  // Orphan-ish signal: crawled pages nobody links to (excluding the entry page)
  if (html.length > 1) {
    const linked = new Set();
    for (const page of html) {
      for (const link of page.internalLinks ?? []) linked.add(normalizeForCompare(link.url));
    }
    const orphans = html
      .filter((page) => page.depth > 0 && !linked.has(normalizeForCompare(page.url)))
      .map((page) => page.url);
    if (orphans.length) {
      issues.push(makeIssue({
        id: 'orphan-pages',
        severity: 'medium',
        category: 'links',
        title: 'Pages with no internal links',
        detail: `${orphans.length} crawled page(s) are not linked from any other crawled page. Add contextual internal links so crawlers and users can find them.`,
        url: orphans[0],
        evidence: orphans.slice(0, 10),
      }));
    }
  }

  const summary = summarize(issues);
  const score = computeScore(issues, html.length);

  return {
    pages: html.map((page) => ({
      url: page.url,
      path: page.path,
      status: page.status,
      title: page.title,
      titleLength: page.titleLength,
      description: page.description,
      descriptionLength: page.descriptionLength,
      h1: page.h1,
      h2: page.h2,
      wordCount: page.wordCount,
      canonical: page.canonical,
      noindex: page.noindex,
      images: page.images.length,
      imagesMissingAlt: page.images.filter((image) => !image.alt).length,
      internalLinks: (page.internalLinks ?? []).length,
      externalLinks: (page.externalLinks ?? []).length,
      structuredDataTypes: page.structuredDataTypes,
      lang: page.lang,
      depth: page.depth,
      durationMs: page.durationMs,
      bytes: page.bytes,
      sections: extractSections(page.textSample).slice(0, 10),
      textSample: page.textSample,
    })),
    issues: issues.sort((a, b) => (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0)),
    summary,
    score,
  };
}

function summarize(issues) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCategory = {};
  for (const issue of issues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
  }
  return { total: issues.length, bySeverity, byCategory };
}

function computeScore(issues, pageCount) {
  if (!pageCount) return { value: 0, grade: 'n/a' };
  // Severity density per page, saturating at 100 points of penalty. This
  // keeps a small site with a handful of fixable issues from scoring 0 while
  // still punishing a site with dozens of critical problems on every page.
  const penalty = issues.reduce((sum, issue) => sum + (SEVERITY_WEIGHT[issue.severity] ?? 0), 0);
  const density = penalty / pageCount;
  const value = Math.max(0, Math.min(100, Math.round(100 - density * 1.15)));
  const grade = value >= 90 ? 'excellent' : value >= 75 ? 'good' : value >= 55 ? 'needs work' : 'poor';
  return { value, grade };
}

function simpleHash(value) {
  let hash = 5381;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}
