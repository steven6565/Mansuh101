/**
 * Keyword + content analysis. Everything here is computed from the text the
 * user supplies or from pages the user owns; no search-volume or difficulty
 * number is invented. Where a third-party API would be required, the result
 * is explicitly marked as unavailable and the user is pointed to a real data
 * source (Search Console).
 */

const STOPWORDS = new Set(`a about above after again against all am an and any are aren't as at be because been before being below between both but by can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves`.split(/\s+/));

const INTENT_SIGNALS = {
  transactional: ['buy', 'price', 'pricing', 'cost', 'cheap', 'deal', 'discount', 'coupon', 'order', 'shop', 'purchase', 'subscription', 'plan', 'hire', 'book', 'download', 'trial', 'demo', 'quote'],
  commercial: ['best', 'top', 'review', 'reviews', 'compare', 'comparison', 'vs', 'versus', 'alternative', 'alternatives', 'software', 'tool', 'tools', 'service', 'services', 'agency', 'platform', 'provider'],
  navigational: ['login', 'log in', 'sign in', 'signin', 'account', 'dashboard', 'portal', 'app', 'official', 'support', 'contact', 'docs', 'documentation', 'api'],
  informational: ['how', 'what', 'why', 'when', 'where', 'guide', 'tutorial', 'examples', 'meaning', 'definition', 'learn', 'explained', 'tips', 'checklist', 'template', 'ideas', 'statistics', 'vs meaning'],
};

export function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\s'-]/gi, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^['-]+|['-]+$/g, ''))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function classifyIntent(keyword = '') {
  const normalized = String(keyword).toLowerCase().trim();
  if (!normalized) return { intent: 'unknown', confidence: 0, matched: [] };
  const scores = { transactional: 0, commercial: 0, navigational: 0, informational: 0 };
  const matched = [];
  for (const [intent, signals] of Object.entries(INTENT_SIGNALS)) {
    for (const signal of signals) {
      if (signal.includes(' ')) {
        if (normalized.includes(signal)) {
          scores[intent] += 2;
          matched.push(signal);
        }
      } else if (normalized.split(/\s+/).includes(signal)) {
        scores[intent] += 1;
        matched.push(signal);
      }
    }
  }
  // Question forms are strongly informational.
  if (/^(how|what|why|when|where|who|which|can|does|is|are|do)\b/.test(normalized)) {
    scores.informational += 3;
  }
  if (/\b(near me|open now|directions)\b/.test(normalized)) scores.transactional += 2;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [intent, score] = ranked[0];
  if (score === 0) return { intent: 'informational', confidence: 0.25, matched: [] };
  const total = ranked.reduce((sum, [, value]) => sum + value, 0);
  return {
    intent,
    confidence: Number((score / Math.max(total, 1)).toFixed(2)),
    matched: [...new Set(matched)].slice(0, 6),
  };
}

export function keywordDifficultyProxy(keyword = '') {
  // A transparent heuristic: longer, more specific queries are easier to rank
  // for. It is NOT Ahrefs/Semrush difficulty and is labelled as a proxy.
  const rawWords = String(keyword).trim().split(/\s+/).filter(Boolean);
  const chars = String(keyword).length;
  const specificity = Math.min(1, Math.max(0, (rawWords.length - 1) / 5));
  const lengthFactor = Math.min(1, chars / 45);
  const commercialBoost = classifyIntent(keyword).intent === 'transactional' ? 0.25 : 0;
  const proxy = Math.round(Math.min(100, 12 + (1 - specificity) * 58 + lengthFactor * 12 + commercialBoost * 40));
  return {
    score: proxy,
    label: proxy < 30 ? 'easy' : proxy < 55 ? 'moderate' : proxy < 75 ? 'hard' : 'very hard',
    method: 'heuristic-proxy',
    note: 'Heuristic only (query length + intent). Connect Search Console for measured position and CTR instead.',
  };
}

/** Cluster keywords by shared significant tokens (greedy, deterministic). */
export function groupKeywords(keywords = []) {
  const clusters = [];
  const sorted = [...keywords].filter(Boolean).sort();
  for (const keyword of sorted) {
    const tokens = new Set(tokenize(keyword));
    let placed = false;
    for (const cluster of clusters) {
      const overlap = [...tokens].filter((token) => cluster.tokens.has(token)).length;
      const similarity = overlap / Math.max(1, Math.min(tokens.size, cluster.tokens.size));
      if (similarity >= 0.5) {
        cluster.keywords.push(keyword);
        for (const token of tokens) cluster.tokens.add(token);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ label: keyword, tokens, keywords: [keyword] });
  }
  return clusters.map((cluster) => ({
    label: cluster.keywords[0],
    keywords: cluster.keywords,
    count: cluster.keywords.length,
  }));
}

export function longTailSuggestions(seed = '', limit = 20) {
  const base = String(seed).trim().toLowerCase();
  if (!base) return [];
  // Templates are chosen so every result reads like a real query for both
  // noun phrases ("technical seo") and verb phrases ("improve seo").
  const templates = [
    '{k} guide', '{k} for beginners', '{k} checklist', '{k} best practices',
    'best {k}', '{k} examples', '{k} tools', '{k} tutorial',
    '{k} mistakes', '{k} case study', '{k} template', '{k} pricing',
    'what is {k}', '{k} statistics', '{k} vs alternatives',
    '{k} for small business', 'free {k}', 'is {k} worth it',
    '{k} step by step', '{k} audit',
  ];
  return templates.slice(0, limit).map((template) => template.replace('{k}', base));
}

/** Coverage of a keyword across on-page signals, with concrete fixes. */
export function keywordCoverage(keyword, page = {}) {
  const terms = tokenize(keyword);
  if (!terms.length) return { score: 0, signals: [], recommendations: [] };
  const text = tokenize(`${page.title ?? ''} ${page.description ?? ''} ${(page.h1 ?? []).join(' ')} ${page.textSample ?? ''}`);
  const haystack = text.join(' ');
  const phrase = String(keyword).toLowerCase().trim();
  const title = String(page.title ?? '').toLowerCase();
  const h1 = (page.h1 ?? []).join(' ').toLowerCase();
  const description = String(page.description ?? '').toLowerCase();

  const signals = [
    { id: 'title', label: 'In title tag', present: title.includes(phrase) || terms.every((term) => title.includes(term)) },
    { id: 'h1', label: 'In H1', present: h1.includes(phrase) || terms.every((term) => h1.includes(term)) },
    { id: 'description', label: 'In meta description', present: description.includes(phrase) || terms.every((term) => description.includes(term)) },
    { id: 'body', label: 'In body copy', present: terms.every((term) => haystack.includes(term)) },
    { id: 'url', label: 'In URL slug', present: terms.some((term) => String(page.path ?? '').toLowerCase().includes(term)) },
  ];
  const present = signals.filter((signal) => signal.present).length;
  const recommendations = signals.filter((signal) => !signal.present).map((signal) => {
    switch (signal.id) {
      case 'title': return `Rewrite the title to include "${keyword}" naturally near the front.`;
      case 'h1': return `Use "${keyword}" (or a close variant) in the single H1.`;
      case 'description': return `Mention "${keyword}" in the meta description and add a reason to click.`;
      case 'body': return `Cover "${keyword}" in the opening paragraph and in at least one H2.`;
      default: return `Consider a slug containing "${terms[0]}" if this page is the canonical target for the keyword.`;
    }
  });
  return { score: Math.round((present / signals.length) * 100), signals, recommendations };
}

export function contentBrief({ keyword, intent, sections = [], competitors = [] }) {
  const analysis = classifyIntent(keyword);
  const resolvedIntent = intent || analysis.intent;
  const outline = [
    { level: 1, text: keyword ? titleCase(keyword) : 'Primary topic', note: 'One H1, includes the primary keyword' },
    { level: 2, text: 'What this is and who it is for', note: 'Answer the query in the first 60 words' },
    { level: 2, text: 'Why it matters', note: 'Evidence, data, or a concrete example' },
    { level: 2, text: 'How to do it, step by step', note: 'Numbered steps with screenshots where useful' },
    { level: 3, text: 'Common mistakes', note: 'Address objections and edge cases' },
    { level: 2, text: 'Tools and options compared', note: 'Only if the intent is commercial' },
    { level: 2, text: 'FAQ', note: '3-6 real questions from Search Console queries' },
    { level: 2, text: 'Next steps', note: 'Internal link to the logical next page' },
  ];
  if (resolvedIntent === 'transactional') {
    outline.splice(4, 0, { level: 2, text: 'Pricing and what you get', note: 'Transparent pricing table' });
  }
  return {
    keyword,
    intent: resolvedIntent,
    intentConfidence: analysis.confidence,
    outline,
    suggestedTitle: keyword ? `${titleCase(keyword)}: A Practical Guide` : '',
    suggestedDescription: keyword
      ? `Learn ${keyword} with a clear, tested process. ${sections.length ? 'Covers the steps, mistakes and tools.' : 'Includes examples and a checklist.'}`.slice(0, 158)
      : '',
    internalLinkTargets: competitors.slice(0, 5),
    wordCountTarget: resolvedIntent === 'informational' ? 1200 : 900,
  };
}

export function titleCase(value = '') {
  return String(value)
    .split(/\s+/)
    .map((word, index) => (index === 0 || word.length > 3 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Extract candidate topics from titles/headings of crawled pages. */
export function topicCandidates(pages = []) {
  const seen = new Map();
  for (const page of pages) {
    const candidates = [page.title, ...(page.h2 ?? [])].filter(Boolean);
    for (const candidate of candidates) {
      const clean = String(candidate).replace(/\s*[|–—-]\s*[^|–—-]{1,40}$/, '').trim();
      if (clean.length < 12 || clean.length > 120) continue;
      const key = clean.toLowerCase();
      if (!seen.has(key)) seen.set(key, { topic: clean, source: page.url, words: tokenize(clean).length });
    }
  }
  return [...seen.values()].sort((a, b) => b.words - a.words).slice(0, 60);
}
