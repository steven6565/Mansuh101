const parseJson = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export function mapUrl(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    enabled: Boolean(row.enabled),
    position: Number(row.position ?? 0),
    createdAt: row.created_at ?? row.createdAt,
  };
}

export function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at ?? row.startedAt ?? null,
    finishedAt: row.finished_at ?? row.finishedAt ?? null,
    settings: parseJson(row.settings, {}),
    totals: parseJson(row.totals, {}),
  };
}

export function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id ?? row.runId,
    url: row.url,
    status: row.status,
    tabIndex: Number(row.tab_index ?? row.tabIndex ?? 0),
    title: row.title ?? null,
    finalUrl: row.final_url ?? row.finalUrl ?? null,
    httpStatus: row.http_status ?? row.httpStatus ?? null,
    error: row.error ?? null,
    errorCode: row.error_code ?? row.errorCode ?? null,
    startedAt: row.started_at ?? row.startedAt ?? null,
    finishedAt: row.finished_at ?? row.finishedAt ?? null,
    durationMs: row.duration_ms ?? row.durationMs ?? null,
    screenshot: row.screenshot ?? null,
    errors: parseJson(row.errors, []),
    networkFailures: parseJson(row.network_failures ?? row.networkFailures, []),
    attempts: Number(row.attempts ?? 0),
    progress: Number(row.progress ?? 0),
    createdAt: row.created_at ?? row.createdAt ?? null,
  };
}

export function mapEvent(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    runId: row.run_id ?? row.runId ?? null,
    sessionId: row.session_id ?? row.sessionId ?? null,
    level: row.level ?? 'info',
    type: row.type ?? null,
    message: row.message,
    at: row.at,
  };
}

export function runRow(run) {
  return {
    id: run.id,
    status: run.status,
    started_at: run.startedAt ?? null,
    finished_at: run.finishedAt ?? null,
    settings: JSON.stringify(run.settings ?? {}),
    totals: JSON.stringify(run.totals ?? {}),
  };
}

export function sessionRow(session) {
  return {
    id: session.id,
    run_id: session.runId ?? null,
    url: session.url ?? null,
    status: session.status ?? 'queued',
    tab_index: session.tabIndex ?? 0,
    title: session.title ?? null,
    final_url: session.finalUrl ?? null,
    http_status: session.httpStatus ?? null,
    error: session.error ?? null,
    error_code: session.errorCode ?? null,
    started_at: session.startedAt ?? null,
    finished_at: session.finishedAt ?? null,
    duration_ms: session.durationMs ?? null,
    screenshot: session.screenshot ?? null,
    errors: JSON.stringify(session.errors ?? []),
    network_failures: JSON.stringify(session.networkFailures ?? []),
    attempts: session.attempts ?? 0,
    progress: session.progress ?? 0,
    created_at: session.createdAt ?? new Date().toISOString(),
  };
}

export function eventRow(event) {
  return {
    run_id: event.runId ?? null,
    session_id: event.sessionId ?? null,
    level: event.level ?? 'info',
    type: event.type ?? null,
    message: event.message ?? '',
    at: event.at ?? new Date().toISOString(),
  };
}
