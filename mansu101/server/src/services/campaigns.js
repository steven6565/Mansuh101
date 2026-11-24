import crypto from 'node:crypto';
import { normalizeUrl } from '../config.js';

/**
 * Campaign / referral growth management.
 *
 * This module records campaigns the user runs (links they share on social,
 * newsletters, partner sites) and measures the *real* traffic those links
 * produce in Google Analytics 4 by matching the utm_campaign /
 * utm_source / utm_medium values that GA4 records.
 *
 * It never generates visits. It builds correct tracking URLs and reconciles
 * them with analytics.
 */

const KIND = 'campaign';

const MEDIUMS = new Set(['organic', 'cpc', 'referral', 'email', 'social', 'display', 'affiliate', 'video', 'audio']);

function slug(value = '') {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function buildTrackingUrl(baseUrl, { source, medium, campaign, term, content } = {}) {
  const url = normalizeUrl(baseUrl);
  if (!url) {
    const error = new Error('A valid destination URL is required.');
    error.status = 400;
    throw error;
  }
  const parsed = new URL(url);
  const params = {
    utm_source: slug(source),
    utm_medium: slug(medium),
    utm_campaign: slug(campaign),
    utm_term: term ? slug(term) : '',
    utm_content: content ? slug(content) : '',
  };
  for (const [key, value] of Object.entries(params)) {
    if (value) parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

export function createCampaignService({ store, bus }) {
  async function list(siteId) {
    const campaigns = await store.listEntities(KIND, { limit: 500 });
    const filtered = siteId ? campaigns.filter((campaign) => campaign.siteId === siteId) : campaigns;
    return filtered.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function get(id) {
    return store.getEntity(KIND, id);
  }

  async function create(input = {}) {
    const medium = String(input.medium || 'social').toLowerCase();
    if (!MEDIUMS.has(medium)) {
      const error = new Error(`Unknown medium "${medium}". Use one of: ${[...MEDIUMS].join(', ')}`);
      error.status = 400;
      throw error;
    }
    const name = String(input.name || '').trim();
    if (!name) {
      const error = new Error('Campaign name is required.');
      error.status = 400;
      throw error;
    }
    const destination = normalizeUrl(input.destination);
    if (!destination) {
      const error = new Error('A valid destination URL is required.');
      error.status = 400;
      throw error;
    }
    const trackingUrl = buildTrackingUrl(destination, {
      source: input.source || medium,
      medium,
      campaign: input.campaignSlug || name,
      term: input.term,
      content: input.content,
    });
    const now = new Date().toISOString();
    const campaign = {
      id: crypto.randomUUID(),
      siteId: input.siteId ?? null,
      name: name.slice(0, 120),
      destination,
      trackingUrl,
      source: slug(input.source || medium),
      medium,
      campaignSlug: slug(input.campaignSlug || name),
      term: input.term ? slug(input.term) : null,
      content: input.content ? slug(input.content) : null,
      status: ['active', 'paused', 'completed', 'draft'].includes(input.status) ? input.status : 'active',
      startDate: input.startDate || now.slice(0, 10),
      endDate: input.endDate || null,
      budget: Number(input.budget) || 0,
      notes: String(input.notes || '').slice(0, 2000),
      createdAt: now,
      updatedAt: now,
    };
    await store.putEntity(KIND, campaign);
    bus.log(`CAMPAIGN CREATED — ${campaign.name} (${campaign.medium}/${campaign.source})`, {
      type: 'campaign',
      level: 'success',
    });
    return campaign;
  }

  async function update(id, patch = {}) {
    const campaign = await store.getEntity(KIND, id);
    if (!campaign) {
      const error = new Error('Campaign not found');
      error.status = 404;
      throw error;
    }
    const next = { ...campaign };
    if (patch.name !== undefined) next.name = String(patch.name).slice(0, 120);
    if (patch.status !== undefined && ['active', 'paused', 'completed', 'draft'].includes(patch.status)) {
      next.status = patch.status;
    }
    if (patch.endDate !== undefined) next.endDate = patch.endDate || null;
    if (patch.budget !== undefined) next.budget = Number(patch.budget) || 0;
    if (patch.notes !== undefined) next.notes = String(patch.notes).slice(0, 2000);
    if (patch.destination !== undefined || patch.source !== undefined || patch.medium !== undefined || patch.campaignSlug !== undefined) {
      const destination = normalizeUrl(patch.destination ?? campaign.destination);
      if (!destination) {
        const error = new Error('Invalid destination URL');
        error.status = 400;
        throw error;
      }
      const medium = String(patch.medium ?? campaign.medium).toLowerCase();
      if (!MEDIUMS.has(medium)) {
        const error = new Error('Invalid medium');
        error.status = 400;
        throw error;
      }
      next.destination = destination;
      next.medium = medium;
      next.source = slug(patch.source ?? campaign.source);
      next.campaignSlug = slug(patch.campaignSlug ?? campaign.campaignSlug);
      next.trackingUrl = buildTrackingUrl(destination, {
        source: next.source,
        medium,
        campaign: next.campaignSlug,
        term: campaign.term,
        content: campaign.content,
      });
    }
    next.updatedAt = new Date().toISOString();
    await store.putEntity(KIND, next);
    return next;
  }

  async function remove(id) {
    const campaign = await store.getEntity(KIND, id);
    if (!campaign) return false;
    await store.deleteEntity(KIND, id);
    bus.log(`CAMPAIGN REMOVED — ${campaign.name}`, { type: 'campaign', level: 'warn' });
    return true;
  }

  /**
   * Reconcile campaigns with GA4 "session source/medium" rows.
   *
   * GA4 reports source/medium as "google / organic" while a campaign has
   * separate source and medium fields, so we match on
   * `source / medium` first and fall back to a medium-level total when the
   * exact pair is not present. Conversions and sessions are attached; when
   * GA4 has no data the campaign is reported as "no data" rather than 0.
   */
  async function attributed(siteId, metrics = []) {
    const campaigns = await list(siteId);
    const rows = metrics.filter((row) => row.dimension === 'source');
    const byPair = new Map();
    for (const row of rows) {
      byPair.set(String(row.key || '').toLowerCase().replace(/\s*\/\s*/g, '/'), row);
    }
    return campaigns.map((campaign) => {
      const pairKey = `${campaign.source}/${campaign.medium}`.toLowerCase();
      const exact = byPair.get(pairKey);
      const sameMedium = rows
        .filter((row) => String(row.key || '').toLowerCase().endsWith(`/${campaign.medium}`))
        .reduce((acc, row) => ({
          sessions: acc.sessions + (row.sessions ?? 0),
          activeUsers: acc.activeUsers + (row.activeUsers ?? 0),
          conversions: acc.conversions + (row.conversions ?? 0),
        }), { sessions: 0, activeUsers: 0, conversions: 0 });
      return {
        ...campaign,
        performance: exact
          ? {
            matched: 'source-medium',
            sessions: exact.sessions ?? 0,
            activeUsers: exact.activeUsers ?? 0,
            conversions: exact.conversions ?? 0,
            engagementRate: exact.engagementRate ?? 0,
          }
          : {
            matched: rows.length ? 'medium-only' : 'no-data',
            sessions: rows.length ? sameMedium.sessions : null,
            activeUsers: rows.length ? sameMedium.activeUsers : null,
            conversions: rows.length ? sameMedium.conversions : null,
            engagementRate: null,
          },
      };
    });
  }

  return { list, get, create, update, remove, attributed };
}

export { MEDIUMS };
