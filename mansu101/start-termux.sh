#!/bin/sh
# Termux has no /usr/bin/env and macOS ships bash 3.2 as /bin/sh, so this
# script re-executes itself under bash exactly once (guarded by VISITOR_REEXEC).
if [ -z "${VISITOR_REEXEC:-}" ]; then
  VISITOR_REEXEC=1; export VISITOR_REEXEC
  exec bash "$0" "$@"
fi
# start-termux.sh — run Visitor natively on Android inside Termux (no root).
#
# Termux has no systemd, no PM2 and no root, so this script:
#   • starts the server under scripts/supervisor.mjs (auto-restart with backoff)
#   • holds a Termux wake-lock so Android does not freeze it mid-request
#   • keeps everything on 127.0.0.1 — nothing is exposed to your network
#
# Usage:
#   ./start-termux.sh                start in the background, wait for health
#   ./start-termux.sh --foreground   run in the foreground (Ctrl-C stops it)
#   ./start-termux.sh --stop         stop it
#   ./start-termux.sh --restart      restart
#   ./start-termux.sh --status       show pid, bind address, uptime
#   PORT=4100 ./start-termux.sh      use another port

set -uo pipefail
# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib/common.sh"

ACTION="start"
for arg in "$@"; do
  case "$arg" in
    --foreground|--fg) ACTION="foreground" ;;
    --stop)            ACTION="stop" ;;
    --restart)         ACTION="restart" ;;
    --status)          ACTION="status" ;;
    -h|--help)
      cat <<'HELP'
start-termux.sh — Visitor on Android via Termux (no root required)

  ./start-termux.sh                start in the background and wait for health
  ./start-termux.sh --foreground   run in the foreground (Ctrl-C stops it)
  ./start-termux.sh --stop         stop the background instance
  ./start-termux.sh --restart      stop then start
  ./start-termux.sh --status       show pid, bind address, uptime

Environment:
  PORT=4100 ./start-termux.sh      use another port (default 4000)
  HOST=0.0.0.0 ./start-termux.sh   expose on your LAN (not recommended)

Termux tips:
  • Allow Termux in Android battery settings (Unrestricted) or Android will
    freeze the process when the screen is off.
  • Use the Termux notification's "Acquire wakelock" action for long audits.
HELP
      exit 0
      ;;
    *) warn "Unknown argument: $arg (try --help)" ;;
  esac
done

export DEPLOYMENT_MODE="termux"
export HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-$(env_get PORT 4000)}"
export PORT

CTL=(node "${APP_DIR}/scripts/visitorctl.mjs")

case "${ACTION}" in
  stop)   exec "${CTL[@]}" stop ;;
  status) exec "${CTL[@]}" status ;;
esac

printf '%s\n' "${C_DIM}──────────────────────────────────────────────${C_RESET}"
printf '  Visitor · Android Termux mode\n'
printf '%s\n' "${C_DIM}──────────────────────────────────────────────${C_RESET}"

if ! detect_termux; then
  warn "Termux environment variables not found."
  dim "On a desktop use ./start-local.sh; on a server use deploy/install.sh."
  dim "Continuing anyway with DEPLOYMENT_MODE=termux."
fi

require_node
resolve_package_manager

if deps_installed; then
  ok "Dependencies present"
else
  info "Dependencies are missing — running the Termux installer first"
  "${APP_DIR}/install-termux.sh" || die "Setup failed"
  resolve_package_manager
fi

ensure_env_file "termux"
build_web

if port_in_use "${PORT}"; then
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    info "Visitor already responds on http://127.0.0.1:${PORT} — restarting"
    "${CTL[@]}" stop >/dev/null 2>&1 || true
    sleep 1
  else
    die "Port ${PORT} is in use by another process. Try: PORT=4100 ./start-termux.sh"
  fi
fi

if [[ "${ACTION}" == "restart" ]]; then
  "${CTL[@]}" stop >/dev/null 2>&1 || true
fi

# ── wake-lock ────────────────────────────────────────────────────────────
# termux-wake-lock is part of the Termux API add-on; a missing binary is fine.
WAKELOCK_HELD=0
acquire_wakelock() {
  if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock >/dev/null 2>&1 && WAKELOCK_HELD=1 && ok "Wake-lock acquired (Termux will not be frozen)"
  else
    dim "termux-wake-lock unavailable — install the Termux:API app for reliable background running"
  fi
}
release_wakelock() {
  if (( WAKELOCK_HELD )); then
    termux-wake-unlock >/dev/null 2>&1 || true
  fi
}

if [[ "${ACTION}" == "foreground" ]]; then
  acquire_wakelock
  trap release_wakelock EXIT INT TERM
  info "Starting in the foreground on http://${HOST}:${PORT} — Ctrl-C to stop"
  echo
  # Supervised even in the foreground: a crash should recover, not vanish.
  exec node "${APP_DIR}/scripts/supervisor.mjs" --mode termux --host "${HOST}" --port "${PORT}"
fi

acquire_wakelock
"${CTL[@]}" start --mode=termux
code=$?

if (( code == 0 )); then
  echo
  printf '%s  Ready:%s http://127.0.0.1:%s\n' "${C_OK}" "${C_RESET}" "${PORT}"
  dim "Stop with:    ./start-termux.sh --stop"
  dim "Follow logs:  node scripts/visitorctl.mjs logs --follow"
  printf '%s\n' "${C_DIM}──────────────────────────────────────────────${C_RESET}"
  dim "The server is supervised — it restarts itself if it crashes."
  dim "Allow Termux in Android battery settings, or Android will freeze it."
  # Termux cannot open the browser from a background script reliably; try the
  # API helper when present and ignore every failure.
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || true
  fi
else
  release_wakelock
fi

exit "${code}"
