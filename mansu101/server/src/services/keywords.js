import crypto from 'node:crypto';
import {
  classifyIntent,
  groupKeywords,
  keywordCoverage,
  keywordDifficultyProxy,
  longTailSuggestions,
  tokenize,
} from '../lib/keywords.js';

/**
 * Keyword tracking.
 *
 * Two sources of truth, both real:
 *  1. Keywords the user adds (organic research) — intent and a labelled
 *     difficulty *proxy* only. No invented volume.
 *  2. Search Console data for keywords that actually earned impressions —
 *     clicks, impressions, CTR and average position measured by Google.
 *
 * There is no ranking scraper: position comes from Search Console, which is
 * the only legitimate first-party source for a site's own keywords.
 */
export function createKeywordService({ store, bus }) {
  const KIND = 'keyword';

  async function list({ siteId, intent, tag } = {}) {
    const rows = await store.listEntities(KIND, { limit: 2000 });
    return rows
      .filter((row) => (!siteId || row.siteId === siteId))
      .filter((row) => (!intent || row.intent === intent))
      .filter((row) => (!tag || (row.tags ?? []).includes(tag)))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function create(input = {}) {
    const phrase = String(input.keyword || '').trim().slice(0, 200);
    if (!phrase) {
      const error = new Error('Keyword is required.');
      error.status = 400;
      throw error;
    }
    const existing = await store.listEntities(KIND, { limit: 5000 });
    if (existing.some((row) => row.siteId === input.siteId && row.keyword.toLowerCase() === phrase.toLowerCase())) {
      const error = new Error('This keyword is already tracked for this site.');
      error.status = 409;
      throw error;
    }
    const analysis = classifyIntent(phrase);
    const now = new Date().toISOString();
    const keyword = {
      id: crypto.randomUUID(),
      siteId: input.siteId ?? null,
      keyword: phrase,
      intent: input.intent || analysis.intent,
      intentConfidence: analysis.confidence,
      difficulty: keywordDifficultyProxy(phrase),
      tags: Array.isArray(input.tags) ? input.tags.slice(0, 12).map(String) : [],
      targetUrl: input.targetUrl || null,
      status: ['tracking', 'planned', 'published', 'archived'].includes(input.status) ? input.status : 'tracking',
      notes: String(input.notes || '').slice(0, 1000),
      createdAt: now,
      updatedAt: now,
    };
    await store.putEntity(KIND, keyword);
    return keyword;
  }

  async function update(id, patch = {}) {
    const keyword = await store.getEntity(KIND, id);
    if (!keyword) {
      const error = new Error('Keyword not found');
      error.status = 404;
      throw error;
    }
    const next = { ...keyword };
    if (patch.keyword !== undefined) {
      const phrase = String(patch.keyword).trim().slice(0, 200);
      if (!phrase) {
        const error = new Error('Keyword cannot be empty');
        error.status = 400;
        throw error;
      }
      next.keyword = phrase;
      next.difficulty = keywordDifficultyProxy(phrase);
      const analysis = classifyIntent(phrase);
      next.intent = analysis.intent;
      next.intentConfidence = analysis.confidence;
    }
    if (patch.intent !== undefined) next.intent = patch.intent;
    if (patch.targetUrl !== undefined) next.targetUrl = patch.targetUrl || null;
    if (patch.status !== undefined && ['tracking', 'planned', 'published', 'archived'].includes(patch.status)) {
      next.status = patch.status;
    }
    if (patch.tags !== undefined) next.tags = Array.isArray(patch.tags) ? patch.tags.slice(0, 12).map(String) : [];
    if (patch.notes !== undefined) next.notes = String(patch.notes).slice(0, 1000);
    next.updatedAt = new Date().toISOString();
    await store.putEntity(KIND, next);
    return next;
  }

  async function remove(id) {
    const keyword = await store.getEntity(KIND, id);
    if (!keyword) return false;
    await store.deleteEntity(KIND, id);
    return true;
  }

  /**
   * Merge tracked keywords with measured Search Console performance.
   * `gscQueries` rows are aggregated by date-range; matching is
   * case-insensitive on the exact query string.
   */
  async function withPerformance(siteId, gscQueries = []) {
    const tracked = await list({ siteId });
    const measured = new Map();
    for (const row of gscQueries) {
      const key = String(row.key || '').toLowerCase();
      if (!key) continue;
      measured.set(key, row);
    }
    const merged = tracked.map((keyword) => {
      const match = measured.get(keyword.keyword.toLowerCase());
      return {
        ...keyword,
        performance: match
          ? {
            clicks: match.clicks ?? 0,
            impressions: match.impressions ?? 0,
            ctr: match.ctr ?? 0,
            position: match.position ?? 0,
            source: 'search-console',
          }
          : null,
      };
    });

    // Surface search queries that earn impressions but are not tracked yet.
    const opportunities = gscQueries
      .filter((row) => row.impressions >= 10 && !tracked.some((keyword) => keyword.keyword.toLowerCase() === String(row.key).toLowerCase()))
      .slice(0, 50)
      .map((row) => ({
        keyword: row.key,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        intent: classifyIntent(String(row.key)).intent,
        reason: row.position > 10 && row.position <= 30
          ? 'Ranking on page 2-3 with impressions — a small improvement moves it to page 1.'
          : row.impressions >= 100 && row.ctr < 0.02
            ? 'High impressions but low CTR — improve the title and meta description.'
            : 'Receives impressions but is not tracked yet.',
      }));

    return { keywords: merged, opportunities };
  }

  /** Research helpers — all derived, nothing simulated. */
  function research({ seed = '', keywords = [] } = {}) {
    const source = Array.isArray(keywords) && keywords.length ? keywords : (seed ? [seed] : []);
    return {
      intents: source.map((keyword) => ({ keyword, ...classifyIntent(keyword) })),
      clusters: groupKeywords(source),
      longTail: seed ? longTailSuggestions(seed).map((keyword) => ({
        keyword,
        intent: classifyIntent(keyword).intent,
        difficulty: keywordDifficultyProxy(keyword),
      })) : [],
      tokens: seed ? tokenize(seed) : [],
    };
  }

  function coverage(keyword, page) {
    return keywordCoverage(keyword, page);
  }

  /** Real ranking history from stored Search Console rows for one query. */
  async function history({ siteId, keyword }) {
    const rows = await store.aggregateMetrics({
      siteId,
      source: 'gsc',
      dimension: 'query',
      key: keyword,
      groupBy: 'date',
      limit: 400,
    });
    return rows.map((row) => ({
      date: row.date,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }));
  }

  return { list, create, update, remove, withPerformance, research, coverage, history };
}
