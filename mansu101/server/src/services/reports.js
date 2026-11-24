import crypto from 'node:crypto';
import { verifyConnection } from '../lib/smtp.js';

/**
 * Report generation.
 *
 * A report is a snapshot of real data for one site and one period:
 * Search Console totals + deltas + top queries/pages, GA4 totals + top
 * sources/landings, and the latest audit score. Reports are stored as
 * entities so the dashboard can show history, and optionally delivered via
 * SMTP when EMAIL_* variables are configured.
 */
export function createReportService({ store, bus, google, sites }) {
  const KIND = 'report';

  async function collect({ siteId, days = 28 }) {
    const site = await sites.get(siteId);
    if (!site) {
      const error = new Error('Site not found');
      error.status = 404;
      throw error;
    }
    const { from, to } = range(days);
    const { from: prevFrom, to: prevTo } = previousRange(from, to);

    const [gscTotals, gscPrev, gscQueries, gscPages, gscCountries, gscDevices, ga4Totals, ga4Prev, ga4Sources, ga4Landings, ga4Countries, ga4Devices] = await Promise.all([
      store.aggregateMetrics({ siteId, source: 'gsc', dimension: 'date', groupBy: 'none', from, to }),
      store.aggregateMetrics({ siteId, source: 'gsc', dimension: 'date', groupBy: 'none', from: prevFrom, to: prevTo }),
      store.aggregateMetrics({ siteId, source: 'gsc', dimension: 'query', groupBy: 'key', from, to, limit: 10 }),
      store.aggregateMetrics({ siteId, source: 'gsc', dimension: 'page', groupBy: 'key', from, to, limit: 10 }),
      store.aggregateMetrics({ siteId, source: 'gsc', dimension: 'country', groupBy: 'key', from, to, limit: 10 }),
      store.aggregateMetrics({ siteId, source: 'gsc', dimension: 'device', groupBy: 'key', from, to, limit: 5 }),
      store.aggregateMetrics({ siteId, source: 'ga4', dimension: 'date', groupBy: 'none', from, to }),
      store.aggregateMetrics({ siteId, source: 'ga4', dimension: 'date', groupBy: 'none', from: prevFrom, to: prevTo }),
      store.aggregateMetrics({ siteId, source: 'ga4', dimension: 'source', groupBy: 'key', from, to, limit: 10, orderBy: 'sessions' }),
      store.aggregateMetrics({ siteId, source: 'ga4', dimension: 'landing', groupBy: 'key', from, to, limit: 10, orderBy: 'sessions' }),
      store.aggregateMetrics({ siteId, source: 'ga4', dimension: 'country', groupBy: 'key', from, to, limit: 10, orderBy: 'sessions' }),
      store.aggregateMetrics({ siteId, source: 'ga4', dimension: 'device', groupBy: 'key', from, to, limit: 5, orderBy: 'sessions' }),
    ]);

    const audits = await store.listEntities('audit', { limit: 100 });
    const latestAudit = audits
      .filter((audit) => audit.siteId === siteId)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] ?? null;

    return {
      site,
      range: { from, to, previousFrom: prevFrom, previousTo: prevTo, days },
      searchConsole: {
        totals: gscTotals[0] ?? null,
        previous: gscPrev[0] ?? null,
        topQueries: gscQueries,
        topPages: gscPages,
        countries: gscCountries,
        devices: gscDevices,
      },
      analytics: {
        totals: ga4Totals[0] ?? null,
        previous: ga4Prev[0] ?? null,
        sources: ga4Sources,
        landingPages: ga4Landings,
        countries: ga4Countries,
        devices: ga4Devices,
      },
      audit: latestAudit
        ? { id: latestAudit.id, startedAt: latestAudit.startedAt, score: latestAudit.score, summary: latestAudit.summary }
        : null,
      hasData: Boolean((gscTotals[0]?.impressions ?? 0) || (ga4Totals[0]?.sessions ?? 0)),
    };
  }

  async function generate({ siteId, days = 28, type = 'manual', email = null }) {
    const snapshot = await collect({ siteId, days });
    const report = {
      id: crypto.randomUUID(),
      siteId,
      type: ['manual', 'daily', 'weekly', 'scheduled'].includes(type) ? type : 'manual',
      period: snapshot.range,
      data: snapshot,
      createdAt: new Date().toISOString(),
      deliveredTo: email,
      deliveryStatus: email ? 'pending' : 'not-requested',
    };
    await store.putEntity(KIND, report);
    bus.log(`REPORT GENERATED — ${snapshot.site.name} (${snapshot.range.from} → ${snapshot.range.to})`, {
      type: 'report',
      level: 'success',
    });
    return report;
  }

  async function list({ siteId, limit = 100 } = {}) {
    const rows = await store.listEntities(KIND, { limit: 500 });
    return rows
      .filter((row) => !siteId || row.siteId === siteId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  async function get(id) {
    return store.getEntity(KIND, id);
  }

  async function remove(id) {
    const report = await store.getEntity(KIND, id);
    if (!report) return false;
    await store.deleteEntity(KIND, id);
    return true;
  }

  async function deliver(id, to) {
    const report = await store.getEntity(KIND, id);
    if (!report) {
      const error = new Error('Report not found');
      error.status = 404;
      throw error;
    }
    const recipient = String(to || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
      const error = new Error('A valid recipient email address is required');
      error.status = 400;
      throw error;
    }
    const readiness = verifyConnection();
    if (!readiness.ok) {
      const error = new Error(`Email delivery is not configured: ${readiness.reason}`);
      error.status = 400;
      throw error;
    }
    const { sendReportEmail } = await import('../lib/smtp.js');
    await sendReportEmail({ report, to: recipient });
    const next = { ...report, deliveredTo: recipient, deliveryStatus: 'sent', deliveredAt: new Date().toISOString() };
    await store.putEntity(KIND, next);
    bus.log(`REPORT EMAILED — ${recipient}`, { type: 'report', level: 'success' });
    return next;
  }

  function toMarkdown(report) {
    const data = report.data;
    const gsc = data.searchConsole.totals ?? {};
    const ga4 = data.analytics.totals ?? {};
    const pct = (value) => (value === null || value === undefined ? '—' : `${value.toFixed(1)}%`);
    const lines = [
      `# SEO report — ${data.site.name}`,
      '',
      `**Period:** ${data.range.from} → ${data.range.to}`,
      `**Site:** ${data.site.url}`,
      '',
      '## Search performance (Google Search Console)',
      '',
      '| Metric | Current |',
      '| --- | --- |',
      `| Clicks | ${gsc.clicks ?? 0} |`,
      `| Impressions | ${gsc.impressions ?? 0} |`,
      `| CTR | ${pct((gsc.ctr ?? 0) * 100)} |`,
      `| Avg. position | ${(gsc.position ?? 0).toFixed(1)} |`,
      '',
      '## Traffic (Google Analytics 4)',
      '',
      '| Metric | Current |',
      '| --- | --- |',
      `| Sessions | ${ga4.sessions ?? 0} |`,
      `| Active users | ${ga4.activeUsers ?? 0} |`,
      `| Engagement rate | ${pct((ga4.engagementRate ?? 0) * 100)} |`,
      '',
    ];
    if (data.searchConsole.topQueries.length) {
      lines.push('## Top queries', '', '| Query | Clicks | Impressions | Position |', '| --- | --- | --- | --- |');
      for (const row of data.searchConsole.topQueries) {
        lines.push(`| ${escapePipe(row.key)} | ${row.clicks} | ${row.impressions} | ${row.position.toFixed(1)} |`);
      }
      lines.push('');
    }
    if (data.searchConsole.topPages.length) {
      lines.push('## Top pages', '', '| Page | Clicks | Impressions |', '| --- | --- | --- |');
      for (const row of data.searchConsole.topPages) {
        lines.push(`| ${escapePipe(row.key)} | ${row.clicks} | ${row.impressions} |`);
      }
      lines.push('');
    }
    if (data.audit) {
      lines.push('## Latest technical audit', '', `- Score: **${data.audit.score?.value ?? '—'}/100**`, `- Issues: ${data.audit.summary?.total ?? 0}`, '');
    }
    if (!data.hasData) {
      lines.push('> No Google data for this period yet. Connect Search Console / GA4 and run a sync.', '');
    }
    return lines.join('\n');
  }

  return { collect, generate, list, get, remove, deliver, toMarkdown };
}

export function range(days) {
  const end = new Date();
  const start = new Date(end.getTime() - (Math.max(1, days) - 1) * 86400000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function previousRange(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const span = Math.round((end - start) / 86400000) + 1;
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (span - 1) * 86400000);
  return { from: prevStart.toISOString().slice(0, 10), to: prevEnd.toISOString().slice(0, 10) };
}

function escapePipe(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}
