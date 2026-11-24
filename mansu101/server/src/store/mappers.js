/** Row ⇄ object mapping for the small shared SQL tables. */

export function mapEvent(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    runId: row.run_id ?? null,
    sessionId: row.session_id ?? null,
    level: row.level ?? 'info',
    type: row.type ?? null,
    message: row.message,
    at: row.at,
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
