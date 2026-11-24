#!/bin/sh
# Termux has no /usr/bin/env and macOS ships bash 3.2 as /bin/sh, so this
# script re-executes itself under bash exactly once (guarded by VISITOR_REEXEC).
if [ -z "${VISITOR_REEXEC:-}" ]; then
  VISITOR_REEXEC=1; export VISITOR_REEXEC
  exec bash "$0" "$@"
fi
# start-local.sh — run Visitor on a desktop/laptop (Linux, macOS, Windows Git Bash).
#
# Binds 127.0.0.1 by default so nothing is exposed on your network.
# Use HOST=0.0.0.0 to open it up deliberately.
#
# Usage:
#   ./start-local.sh                 start in the background, wait for health, print URL
#   ./start-local.sh --foreground    run in the foreground (Ctrl-C to stop)
#   ./start-local.sh --stop          stop a background instance
#   ./start-local.sh --restart       restart
#   ./start-local.sh --status        show state
#   PORT=4100 ./start-local.sh       use another port
#   HOST=0.0.0.0 ./start-local.sh    expose on the LAN (behind a firewall)

set -uo pipefail
# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib/common.sh"

MODE="local"
ACTION="start"

for arg in "$@"; do
  case "$arg" in
    --foreground|--fg) ACTION="foreground" ;;
    --stop)            ACTION="stop" ;;
    --restart)         ACTION="restart" ;;
    --status)          ACTION="status" ;;
    -h|--help)
      cat <<'HELP'
start-local.sh — Visitor on a desktop or laptop

  ./start-local.sh                start in the background and wait for health
  ./start-local.sh --foreground   run in the foreground (Ctrl-C stops it)
  ./start-local.sh --stop         stop the background instance
  ./start-local.sh --restart      stop then start
  ./start-local.sh --status       show pid, mode, bind address, uptime

Environment:
  PORT=4100 ./start-local.sh      use another port (default 4000)
  HOST=0.0.0.0 ./start-local.sh   expose on your LAN instead of loopback
HELP
      exit 0
      ;;
    *) warn "Unknown argument: $arg (try --help)" ;;
  esac
done

export DEPLOYMENT_MODE="local"
export HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-$(env_get PORT 4000)}"
export PORT

CTL=(node "${APP_DIR}/scripts/visitorctl.mjs")

# ── stop / status need no setup ──────────────────────────────────────────
case "${ACTION}" in
  stop)   exec "${CTL[@]}" stop ;;
  status) exec "${CTL[@]}" status ;;
esac

printf '%s\n' "${C_DIM}──────────────────────────────────────────────${C_RESET}"
printf '  Visitor · %s mode\n' "${MODE}"
printf '%s\n' "${C_DIM}──────────────────────────────────────────────${C_RESET}"

require_node
resolve_package_manager

if deps_installed; then
  ok "Dependencies present"
else
  install_deps
fi

ensure_env_file "${MODE}"
build_web

if port_in_use "${PORT}"; then
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    info "Visitor already responds on http://127.0.0.1:${PORT} — restarting"
    "${CTL[@]}" stop >/dev/null 2>&1 || true
    sleep 1
  else
    die "Port ${PORT} is in use by another process. Try: PORT=4100 ./start-local.sh"
  fi
fi

if [[ "${ACTION}" == "restart" ]]; then
  "${CTL[@]}" stop >/dev/null 2>&1 || true
fi

if [[ "${ACTION}" == "foreground" ]]; then
  info "Starting in the foreground on http://${HOST}:${PORT} — Ctrl-C to stop"
  echo
  exec node "${APP_DIR}/server/src/index.js"
fi

"${CTL[@]}" start --mode=local
code=$?

if (( code == 0 )); then
  echo
  printf '%s  Ready:%s http://127.0.0.1:%s\n' "${C_OK}" "${C_RESET}" "${PORT}"
  dim "Stop with:    ./start-local.sh --stop"
  dim "Follow logs:  node scripts/visitorctl.mjs logs --follow"
  printf '%s\n' "${C_DIM}──────────────────────────────────────────────${C_RESET}"
  if [[ "${HOST}" != "127.0.0.1" && "${HOST}" != "localhost" ]]; then
    dim "Bound to ${HOST} — reachable from other devices on this network."
  fi
  if command -v xdg-open >/dev/null 2>&1 && [[ -n "${DISPLAY:-}" ]]; then
    xdg-open "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || true
  fi
fi

exit "${code}"
