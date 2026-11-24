import crypto from 'node:crypto';
import { contentBrief, keywordCoverage, classifyIntent, titleCase } from '../lib/keywords.js';

/**
 * Content growth workflow: outlines, briefs, internal-link suggestions and a
 * publishing calendar. Suggestions are derived from the user's own site
 * (crawled pages + Search Console queries). The module never writes a whole
 * article automatically; it produces a brief a human editor can act on,
 * which is what keeps output useful instead of mass-generated filler.
 */
export function createContentService({ store, bus }) {
  const KIND = 'content';

  async function list({ siteId } = {}) {
    const rows = await store.listEntities(KIND, { limit: 1000 });
    return rows
      .filter((row) => !siteId || row.siteId === siteId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function create(input = {}) {
    const keyword = String(input.keyword || '').trim();
    if (!keyword) {
      const error = new Error('A primary keyword or topic is required.');
      error.status = 400;
      throw error;
    }
    const analysis = classifyIntent(keyword);
    const now = new Date().toISOString();
    const brief = contentBrief({
      keyword,
      intent: input.intent || analysis.intent,
      sections: input.sections ?? [],
      competitors: input.internalTargets ?? [],
    });
    const doc = {
      id: crypto.randomUUID(),
      siteId: input.siteId ?? null,
      keyword,
      title: String(input.title || brief.suggestedTitle).slice(0, 200),
      metaDescription: String(input.metaDescription || brief.suggestedDescription).slice(0, 200),
      intent: brief.intent,
      status: ['idea', 'outline', 'drafting', 'review', 'scheduled', 'published'].includes(input.status)
        ? input.status
        : 'idea',
      outline: Array.isArray(input.outline) && input.outline.length ? input.outline : brief.outline,
      brief,
      targetUrl: input.targetUrl || null,
      internalLinks: Array.isArray(input.internalLinks) ? input.internalLinks.slice(0, 40) : [],
      publishDate: input.publishDate || null,
      wordCountTarget: Number(input.wordCountTarget) || brief.wordCountTarget,
      author: String(input.author || '').slice(0, 80),
      notes: String(input.notes || '').slice(0, 3000),
      createdAt: now,
      updatedAt: now,
    };
    await store.putEntity(KIND, doc);
    bus.log(`CONTENT BRIEF CREATED — ${doc.title}`, { type: 'content', level: 'success' });
    return doc;
  }

  async function update(id, patch = {}) {
    const doc = await store.getEntity(KIND, id);
    if (!doc) {
      const error = new Error('Content item not found');
      error.status = 404;
      throw error;
    }
    const next = { ...doc };
    const fields = ['title', 'metaDescription', 'targetUrl', 'publishDate', 'author', 'notes', 'keyword'];
    for (const field of fields) {
      if (patch[field] !== undefined) {
        next[field] = typeof patch[field] === 'string' ? patch[field].slice(0, field === 'notes' ? 3000 : 200) : patch[field];
      }
    }
    if (patch.status !== undefined && ['idea', 'outline', 'drafting', 'review', 'scheduled', 'published'].includes(patch.status)) {
      next.status = patch.status;
    }
    if (Array.isArray(patch.outline)) next.outline = patch.outline.slice(0, 60);
    if (Array.isArray(patch.internalLinks)) next.internalLinks = patch.internalLinks.slice(0, 40);
    if (patch.wordCountTarget !== undefined) next.wordCountTarget = Number(patch.wordCountTarget) || next.wordCountTarget;
    next.updatedAt = new Date().toISOString();
    await store.putEntity(KIND, next);
    return next;
  }

  async function remove(id) {
    const doc = await store.getEntity(KIND, id);
    if (!doc) return false;
    await store.deleteEntity(KIND, id);
    return true;
  }

  /**
   * Content gaps: Search Console queries with demand but no dedicated page.
   * Matching is token-based against crawled page titles/URLs, so a query is a
   * "gap" only when no crawled page covers all of its significant terms.
   */
  function contentGaps({ queries = [], pages = [] } = {}) {
    const corpus = pages.map((page) => ({
      url: page.url,
      text: [
        page.title ?? '',
        (page.h1 ?? []).join(' '),
        (page.h2 ?? []).join(' '),
        page.path ?? '',
      ].join(' ').toLowerCase(),
    }));
    return queries
      .filter((row) => row.impressions >= 20)
      .map((row) => {
        const query = String(row.key || '');
        const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
        const covering = corpus.filter((page) => terms.every((term) => page.text.includes(term)));
        return {
          query,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
          intent: classifyIntent(query).intent,
          coveringPages: covering.length,
          isGap: covering.length === 0,
          suggestedTitle: `${titleCase(query)} — Complete Guide`,
        };
      })
      .filter((row) => row.isGap)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 40);
  }

  /** Internal link suggestions: target page + anchor text + source pages. */
  function internalLinkSuggestions({ pages = [] } = {}) {
    const suggestions = [];
    for (const page of pages) {
      for (const heading of page.h2 ?? []) {
        if (!heading || heading.length < 12) continue;
        const tokens = heading.toLowerCase().split(/\s+/).slice(0, 6).join(' ');
        const matches = pages.filter((candidate) =>
          candidate.url !== page.url
          && `${candidate.title ?? ''} ${(candidate.h1 ?? []).join(' ')}`.toLowerCase().includes(tokens));
        if (matches.length) {
          suggestions.push({
            from: page.url,
            section: heading,
            to: matches[0].url,
            anchor: String(matches[0].title || matches[0].url).slice(0, 80),
            reason: 'The section heading overlaps with the target page topic.',
          });
        }
        if (suggestions.length >= 40) return suggestions;
      }
    }
    return suggestions;
  }

  /** Publishing calendar grouped by month for a site. */
  function calendar(items = []) {
    const buckets = new Map();
    for (const item of items) {
      if (!item.publishDate) continue;
      const month = String(item.publishDate).slice(0, 7);
      if (!buckets.has(month)) buckets.set(month, []);
      buckets.get(month).push(item);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, entries]) => ({ month, items: entries.sort((a, b) => String(a.publishDate).localeCompare(String(b.publishDate))) }));
  }

  function optimize({ keyword, page }) {
    return {
      keyword,
      coverage: keywordCoverage(keyword, page),
      titleSuggestion: keyword ? `${titleCase(keyword)}: ${page?.h1?.[0] ? titleCase(page.h1[0]) : 'Practical Guide'}`.slice(0, 65) : null,
      descriptionSuggestion: keyword
        ? `Everything you need to know about ${keyword}. Tested steps, examples and the mistakes to avoid.`.slice(0, 158)
        : null,
    };
  }

  return { list, create, update, remove, contentGaps, internalLinkSuggestions, calendar, optimize };
}
