function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildReport({ run, sessions, events = [] }) {
  if (!run) return null;
  const totals = run.totals ?? {};
  return {
    generatedAt: new Date().toISOString(),
    application: 'MANSU101',
    run,
    summary: {
      total: totals.total ?? sessions.length,
      succeeded: totals.succeeded ?? sessions.filter((s) => s.status === 'completed').length,
      failed: totals.failed ?? sessions.filter((s) => s.status === 'failed').length,
      stopped: totals.stopped ?? 0,
      interrupted: totals.interrupted ?? 0,
      durationMs: run.startedAt
        ? new Date(run.finishedAt ?? Date.now()).getTime() - new Date(run.startedAt).getTime()
        : null,
    },
    sessions,
    events,
  };
}

export function reportToCsv(report) {
  const headers = [
    'tab',
    'url',
    'final_url',
    'status',
    'http_status',
    'title',
    'started_at',
    'finished_at',
    'duration_ms',
    'error_code',
    'error',
    'js_errors',
    'network_failures',
    'screenshot',
  ];
  const lines = [headers.join(',')];
  for (const session of report.sessions) {
    lines.push(
      [
        session.tabIndex,
        session.url,
        session.finalUrl,
        session.status,
        session.httpStatus,
        session.title,
        session.startedAt,
        session.finishedAt,
        session.durationMs,
        session.errorCode,
        session.error,
        (session.errors ?? []).length,
        (session.networkFailures ?? []).length,
        session.screenshot,
      ].map(csvCell).join(','),
    );
  }
  return lines.join('\r\n');
}
