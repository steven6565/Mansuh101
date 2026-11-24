import crypto from 'node:crypto';
import { config, googleConfig, googleConfigured, dirs } from '../config.js';
import { vault } from '../lib/vault.js';

/**
 * Google OAuth 2.0 + Search Console + Analytics 4.
 *
 * Nothing here fabricates data. When credentials are absent the module
 * reports `configured: false` and the API returns a clear setup error; the
 * dashboard shows a connect card instead of empty fake charts.
 */

const OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GSC_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';
const GA4_BASE = 'https://analyticsdata.googleapis.com/v1beta';

const stateStore = new Map(); // state -> { createdAt, redirectAfter }

export function createGoogleService({ store, bus }) {
  const entity = 'integration';
  const id = 'google';

  async function loadIntegration() {
    return (await store.getEntity(entity, id)) ?? {
      id,
      provider: 'google',
      status: 'disconnected',
      email: null,
      scopes: [],
      tokensEncrypted: null,
      connectedAt: null,
      lastSyncAt: null,
      properties: { gsc: [], ga4: [] },
      selected: { gsc: null, ga4: null },
      lastError: null,
    };
  }

  async function saveIntegration(patch) {
    const current = await loadIntegration();
    const next = { ...current, ...patch, id, provider: 'google' };
    await store.putEntity(entity, next);
    return next;
  }

  async function getAccessToken({ forceRefresh = false } = {}) {
    const integration = await loadIntegration();
    if (!integration.tokensEncrypted) {
      const error = new Error('Google account is not connected. Open Integrations and connect it first.');
      error.status = 400;
      throw error;
    }
    const tokens = JSON.parse(vault.decrypt(integration.tokensEncrypted) || '{}');
    if (!tokens.accessToken && !tokens.refreshToken) {
      const error = new Error('Stored Google tokens are unreadable. Reconnect the account.');
      error.status = 400;
      throw error;
    }
    const expiresAt = Number(tokens.expiresAt ?? 0);
    if (!forceRefresh && tokens.accessToken && expiresAt > Date.now() + 60_000) {
      return tokens.accessToken;
    }
    if (!tokens.refreshToken) {
      const error = new Error('Google access token expired and no refresh token is stored. Reconnect the account.');
      error.status = 401;
      throw error;
    }
    if (!googleConfigured) {
      const error = new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.');
      error.status = 400;
      throw error;
    }

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: googleConfig.clientId,
        client_secret: googleConfig.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      await saveIntegration({ status: 'error', lastError: payload.error_description || payload.error || 'Token refresh failed' });
      const error = new Error(`Google token refresh failed: ${payload.error_description || payload.error || response.status}`);
      error.status = 401;
      throw error;
    }
    const updated = {
      ...tokens,
      accessToken: payload.access_token,
      expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000,
    };
    await saveIntegration({ tokensEncrypted: vault.encrypt(JSON.stringify(updated)), status: 'connected' });
    return updated.accessToken;
  }

  async function googleFetch(url, { method = 'GET', body, retry = true } = {}) {
    const token = await getAccessToken();
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401 && retry) {
      await getAccessToken({ forceRefresh: true });
      return googleFetch(url, { method, body, retry: false });
    }
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 500) };
    }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.error_description || `Google API error (${response.status})`;
      const error = new Error(message);
      error.status = response.status === 403 ? 403 : response.status === 401 ? 401 : 502;
      error.googleStatus = response.status;
      error.details = payload;
      throw error;
    }
    return payload;
  }

  // ─── OAuth flow ────────────────────────────────────────────────────────
  function isConfigured() {
    return googleConfigured;
  }

  function buildAuthUrl({ redirectAfter = '/integrations' } = {}) {
    if (!googleConfigured) {
      const error = new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
      error.status = 400;
      throw error;
    }
    if (!googleConfig.redirectUri) {
      const error = new Error('GOOGLE_REDIRECT_URI (or PUBLIC_URL) must be set so Google can call back.');
      error.status = 400;
      throw error;
    }
    const state = crypto.randomBytes(24).toString('hex');
    stateStore.set(state, { createdAt: Date.now(), redirectAfter });
    // Keep the map small.
    if (stateStore.size > 50) {
      const oldest = [...stateStore.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) stateStore.delete(oldest[0]);
    }
    const params = new URLSearchParams({
      client_id: googleConfig.clientId,
      redirect_uri: googleConfig.redirectUri,
      response_type: 'code',
      scope: googleConfig.scopes.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
    });
    return { url: `${OAUTH_BASE}?${params.toString()}`, state };
  }

  function consumeState(state) {
    const entry = stateStore.get(state);
    stateStore.delete(state);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > 10 * 60 * 1000) return null;
    return entry;
  }

  async function exchangeCode(code) {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: googleConfig.clientId,
        client_secret: googleConfig.clientSecret,
        redirect_uri: googleConfig.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error_description || payload.error || 'Token exchange failed');
      error.status = 400;
      throw error;
    }
    const tokens = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      scope: payload.scope ?? '',
      expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000,
      tokenType: payload.token_type,
    };
    // Preserve an existing refresh token when Google omits it on re-consent.
    const existing = await loadIntegration();
    if (!tokens.refreshToken && existing.tokensEncrypted) {
      const previous = JSON.parse(vault.decrypt(existing.tokensEncrypted) || '{}');
      tokens.refreshToken = previous.refreshToken ?? null;
    }

    let email = null;
    try {
      const profile = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      }).then((res) => (res.ok ? res.json() : null));
      email = profile?.email ?? null;
    } catch {
      /* email is cosmetic */
    }

    const integration = await saveIntegration({
      status: 'connected',
      email,
      scopes: String(tokens.scope || '').split(' ').filter(Boolean),
      tokensEncrypted: vault.encrypt(JSON.stringify(tokens)),
      connectedAt: new Date().toISOString(),
      lastError: null,
    });
    bus.log(`GOOGLE ACCOUNT CONNECTED — ${email ?? 'unknown email'}`, { type: 'integration', level: 'success' });
    return integration;
  }

  async function disconnect() {
    const integration = await loadIntegration();
    if (integration.tokensEncrypted) {
      const tokens = JSON.parse(vault.decrypt(integration.tokensEncrypted) || '{}');
      const token = tokens.refreshToken || tokens.accessToken;
      if (token) {
        await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
      }
    }
    const next = await saveIntegration({
      status: 'disconnected',
      tokensEncrypted: null,
      scopes: [],
      email: null,
      properties: { gsc: [], ga4: [] },
      selected: { gsc: null, ga4: null },
      lastError: null,
    });
    bus.log('GOOGLE ACCOUNT DISCONNECTED', { type: 'integration', level: 'warn' });
    return next;
  }

  function publicIntegration(integration) {
    return {
      id: integration.id,
      provider: 'google',
      status: integration.status,
      email: integration.email,
      scopes: integration.scopes ?? [],
      connectedAt: integration.connectedAt,
      lastSyncAt: integration.lastSyncAt ?? null,
      lastError: integration.lastError ?? null,
      properties: integration.properties ?? { gsc: [], ga4: [] },
      selected: integration.selected ?? { gsc: null, ga4: null },
      configured: googleConfigured,
      redirectUri: googleConfig.redirectUri || null,
    };
  }

  // ─── Property discovery ────────────────────────────────────────────────
  async function listProperties() {
    const gsc = await googleFetch(`${GSC_BASE}/sites`).catch((error) => {
      if (error.googleStatus === 403) return { siteEntry: [] };
      throw error;
    });
    const gscSites = (gsc?.siteEntry ?? []).map((entry) => ({
      siteUrl: entry.siteUrl,
      permissionLevel: entry.permissionLevel,
    }));

    let ga4 = [];
    try {
      const accounts = await googleFetch('https://analyticsadmin.googleapis.com/v1alpha/accountSummaries?pageSize=200');
      for (const summary of accounts?.accountSummaries ?? []) {
        for (const property of summary.propertySummaries ?? []) {
          ga4.push({
            property: property.property, // properties/123456789
            displayName: property.displayName,
            account: summary.displayName,
          });
        }
      }
    } catch (error) {
      // A missing Analytics scope/permission must not block Search Console.
      ga4 = [];
      bus.log(`GA4 property discovery skipped — ${error.message}`, { type: 'integration', level: 'warn' });
    }

    const integration = await saveIntegration({ properties: { gsc: gscSites, ga4 } });
    return publicIntegration(integration);
  }

  async function selectProperties({ gsc, ga4 }) {
    const integration = await loadIntegration();
    const selected = {
      gsc: gsc === undefined ? integration.selected?.gsc ?? null : gsc || null,
      ga4: ga4 === undefined ? integration.selected?.ga4 ?? null : ga4 || null,
    };
    const next = await saveIntegration({ selected });
    return publicIntegration(next);
  }

  // ─── Search Console ────────────────────────────────────────────────────
  async function gscQuery({ siteUrl, startDate, endDate, dimensions = ['query'], rowLimit = 100, filters = [] }) {
    const payload = {
      startDate,
      endDate,
      dimensions,
      rowLimit: Math.min(25000, Math.max(1, Number(rowLimit) || 100)),
      dataState: 'final',
    };
    if (filters.length) payload.dimensionFilterGroups = [{ filters }];
    const response = await googleFetch(
      `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      { method: 'POST', body: payload },
    );
    return response?.rows ?? [];
  }

  /**
   * Pull Search Console data into seo_metrics for one site.
   * Stores one row per (dimension, key, date) so the dashboard can aggregate
   * by date, query, page, country or device without re-calling Google.
   */
  async function syncSearchConsole({ siteId, siteUrl, days = 28, dimension = 'all' } = {}) {
    if (!siteUrl) {
      const error = new Error('No Search Console property selected for this site.');
      error.status = 400;
      throw error;
    }
    const end = new Date(Date.now() - googleConfig.dataLagDays * 86400000);
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);

    const jobs = [];
    const wantAll = dimension === 'all';
    if (wantAll || dimension === 'query') jobs.push({ name: 'query', dimensions: ['query', 'date'], limit: 25000 });
    if (wantAll || dimension === 'page') jobs.push({ name: 'page', dimensions: ['page', 'date'], limit: 25000 });
    if (wantAll || dimension === 'country') jobs.push({ name: 'country', dimensions: ['country', 'date'], limit: 25000 });
    if (wantAll || dimension === 'device') jobs.push({ name: 'device', dimensions: ['device', 'date'], limit: 25000 });
    jobs.push({ name: 'date', dimensions: ['date'], limit: 25000 });

    let total = 0;
    const results = {};
    for (const job of jobs) {
      const rows = await gscQuery({
        siteUrl,
        startDate,
        endDate,
        dimensions: job.dimensions,
        rowLimit: job.limit,
      });
      const mapped = rows.map((row) => {
        const keys = row.keys ?? [];
        const key = job.name === 'date' ? '' : keys[0];
        const date = job.name === 'date' ? keys[0] : keys[keys.length - 1];
        return {
          siteId,
          source: 'gsc',
          dimension: job.name,
          key,
          date,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        };
      });
      const written = await store.upsertMetrics(mapped);
      results[job.name] = written;
      total += written;
    }

    await saveIntegration({ lastSyncAt: new Date().toISOString(), lastError: null });
    bus.log(`SEARCH CONSOLE SYNCED — ${total} metric rows (${startDate} → ${endDate})`, {
      type: 'integration',
      level: 'success',
    });
    return { rows: total, startDate, endDate, results };
  }

  // ─── GA4 ───────────────────────────────────────────────────────────────
  async function ga4Report({ property, startDate, endDate, dimensions, metrics, limit = 50 }) {
    const payload = {
      dateRanges: [{ startDate, endDate }],
      dimensions: dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      limit: String(limit),
      keepEmptyRows: false,
    };
    const response = await googleFetch(`${GA4_BASE}/${property}:runReport`, {
      method: 'POST',
      body: payload,
    });
    return response?.rows ?? [];
  }

  async function syncAnalytics({ siteId, property, days = 28 } = {}) {
    if (!property) {
      const error = new Error('No Google Analytics 4 property selected for this site.');
      error.status = 400;
      throw error;
    }
    const end = new Date(Date.now() - 86400000);
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    const propertyId = property.startsWith('properties/') ? property : `properties/${property}`;

    const baseMetrics = ['sessions', 'activeUsers', 'engagedSessions', 'engagementRate', 'conversions'];
    const jobs = [
      { name: 'date', dimensions: ['date'], metrics: baseMetrics },
      { name: 'landing', dimensions: ['landingPagePlusQueryString'], metrics: baseMetrics },
      { name: 'source', dimensions: ['sessionSourceMedium'], metrics: baseMetrics },
      { name: 'country', dimensions: ['country'], metrics: baseMetrics },
      { name: 'device', dimensions: ['deviceCategory'], metrics: baseMetrics },
    ];

    let total = 0;
    const results = {};
    for (const job of jobs) {
      const rows = await ga4Report({
        property: propertyId,
        startDate,
        endDate,
        dimensions: job.dimensions,
        metrics: job.metrics,
        limit: job.name === 'date' ? 400 : 200,
      });
      const mapped = rows.map((row) => {
        const dimensionValue = row.dimensionValues?.[0]?.value ?? '';
        const metrics_ = row.metricValues ?? [];
        const get = (index) => Number(metrics_[index]?.value ?? 0) || 0;
        const date = job.name === 'date'
          ? formatGa4Date(dimensionValue)
          : formatGa4Date(row.dimensionValues?.[1]?.value ?? '') || endDate;
        return {
          siteId,
          source: 'ga4',
          dimension: job.name,
          key: job.name === 'date' ? '' : dimensionValue,
          date: job.name === 'date' ? formatGa4Date(dimensionValue) : date,
          sessions: get(0),
          activeUsers: get(1),
          engagedSessions: get(2),
          engagementRate: get(3),
          conversions: get(4),
        };
      });
      const written = await store.upsertMetrics(mapped);
      results[job.name] = written;
      total += written;
    }

    await saveIntegration({ lastSyncAt: new Date().toISOString(), lastError: null });
    bus.log(`GOOGLE ANALYTICS SYNCED — ${total} metric rows (${startDate} → ${endDate})`, {
      type: 'integration',
      level: 'success',
    });
    return { rows: total, startDate, endDate, results };
  }

  return {
    isConfigured,
    loadIntegration,
    saveIntegration,
    publicIntegration,
    buildAuthUrl,
    consumeState,
    exchangeCode,
    disconnect,
    getAccessToken,
    listProperties,
    selectProperties,
    gscQuery,
    syncSearchConsole,
    syncAnalytics,
    status: () => ({ configured: googleConfigured, redirectUri: googleConfig.redirectUri, vault: vault.status() }),
  };
}

function formatGa4Date(value) {
  if (!value) return '';
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return value;
}
