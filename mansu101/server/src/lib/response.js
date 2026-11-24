/**
 * Cache-Control helpers for API responses that read external Google data.
 * Keeps the UI snappy without ever serving stale numbers as if they were live.
 */
export function cacheable(res, seconds = 60) {
  res.setHeader('Cache-Control', `private, max-age=${seconds}`);
}

export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}

/** Consistent JSON envelope for list endpoints. */
export function page(items, { total, limit, offset, extra = {} } = {}) {
  return {
    items,
    total: total ?? items.length,
    limit,
    offset,
    ...extra,
  };
}

/** Parse ?from=&to= or fall back to ?days=. */
export function dateWindow(query = {}, { defaultDays = 28, maxDays = 480 } = {}) {
  const days = Math.min(maxDays, Math.max(1, Number(query.days) || defaultDays));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '')
    ? query.from
    : new Date(new Date(`${to}T00:00:00Z`).getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to, days };
}
