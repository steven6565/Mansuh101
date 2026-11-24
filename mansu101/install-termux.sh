#!/bin/sh
# Termux has no /usr/bin/env and macOS ships bash 3.2 as /bin/sh, so this
# script re-executes itself under bash exactly once (guarded by VISITOR_REEXEC).
if [ -z "${VISITOR_REEXEC:-}" ]; then
  VISITOR_REEXEC=1; export VISITOR_REEXEC
  exec bash "$0" "$@"
fi
# install-termux.sh — one-time setup for Visitor inside Termux (Android, no root).
#
# Installs only what Termux can actually provide from its own repository:
#   nodejs-lts  (Node >= 22.5, ships node:sqlite — no native build step)
#   git         (only if you cloned from a repo and want to update later)
#
# Deliberately does NOT use sudo/apt/systemd/PM2/Chromium-packages: none of
# them exist (or work without root) on Android.
#
# Usage:
#   ./install-termux.sh              install and verify
#   ./install-termux.sh --no-build   skip the dashboard build
#   ./install-termux.sh --check      only report what is missing, change nothing

set -uo pipefail
# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/lib/common.sh"

DO_BUILD=1
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --check)    CHECK_ONLY=1 ;;
    -h|--help)
      cat <<'HELP'
install-termux.sh — prepare Visitor for Android/Termux (no root)

  ./install-termux.sh              install dependencies, build the dashboard
  ./install-termux.sh --no-build   install dependencies only
  ./install-termux.sh --check      report missing pieces without changing anything

What it installs from the Termux repo: nodejs-lts, git.
What it never touches: sudo, apt, systemd, PM2, Nginx.
HELP
      exit 0
      ;;
    *) warn "Unknown argument: $arg (try --help)" ;;
  esac
done

printf '%s\n' "${C_DIM}──────────────────────────────────────────────${C_RESET}"
printf '  Visitor · Android Termux setup\n'
printf '%s\n' "${C_DIM}──────────────────────────────────────────────${C_RESET}"

if ! detect_termux; then
  err "This does not look like Termux."
  dim "Install Termux from F-Droid: https://f-droid.org/packages/com.termux/"
  dim "On a desktop use ./start-local.sh, on a server use deploy/install.sh."
  exit 1
fi
ok "Termux detected${TERMUX_VERSION:+ (v${TERMUX_VERSION})}"

if ! is_android; then
  warn "Kernel does not report Android — continuing anyway (Termux environment variables present)."
fi

ARCH="$(uname -m)"
ok "Architecture: ${ARCH} ($(uname -s))"
case "${ARCH}" in
  aarch64|arm64|armv7l|armv8l|i686|x86_64) ;;
  *) warn "Untested architecture ${ARCH} — Node packages are pure JS, so it will probably work." ;;
esac

# ── what is missing? ─────────────────────────────────────────────────────
MISSING=()
command -v node >/dev/null 2>&1 || MISSING+=(nodejs-lts)
node_ok || { [[ " ${MISSING[*]:-} " == *" nodejs-lts "* ]] || MISSING+=(nodejs-lts); }
command -v curl >/dev/null 2>&1 || MISSING+=(curl)

if (( ${#MISSING[@]} )); then
  info "Missing Termux packages: ${MISSING[*]}"
else
  ok "Required Termux packages present"
fi

if (( CHECK_ONLY )); then
  command -v node >/dev/null 2>&1 && info "node: $(node -v)"
  command -v pnpm >/dev/null 2>&1 && info "pnpm: $(pnpm -v)" || dim "pnpm: not installed (corepack or npm will be used)"
  deps_installed && ok "node_modules present" || warn "node_modules missing — run ./install-termux.sh"
  web_built && ok "web/dist present" || warn "web/dist missing — run ./install-termux.sh"
  [[ -f "${APP_DIR}/.env" ]] && ok ".env present" || warn ".env missing — it is created on first start"
  exit 0
fi

# ── install via pkg (never apt/sudo) ─────────────────────────────────────
if (( ${#MISSING[@]} )); then
  if ! command -v pkg >/dev/null 2>&1; then
    die "pkg is unavailable — this is not a normal Termux install. Reinstall Termux from F-Droid."
  fi
  info "Running: pkg update"
  pkg update -y || warn "pkg update reported a problem — continuing"
  info "Installing: ${MISSING[*]}"
  # nodejs-lts tracks a supported LTS line; plain `nodejs` is often older.
  pkg install -y "${MISSING[@]}" || die "pkg install failed. Try: pkg update && pkg install nodejs-lts"
fi

require_node
resolve_package_manager

if deps_installed; then
  ok "Dependencies already installed"
else
  install_deps
fi

if (( DO_BUILD )); then
  if web_built; then
    ok "Dashboard already built (web/dist)"
  else
    build_web
  fi
fi

ensure_env_file "termux"

# Scheduler defaults to a slower tick on Android; make it explicit in .env
# only when the user has not chosen a value themselves.
if ! grep -qE '^SCHEDULER_TICK_MS=' "${APP_DIR}/.env" 2>/dev/null; then
  printf '\n# Android suspends background work — check for due jobs once a minute.\nSCHEDULER_TICK_MS=60000\n' >>"${APP_DIR}/.env"
fi

# ── Android-specific guidance ────────────────────────────────────────────
echo
ok "Termux setup complete"
if [[ -n "${GENERATED_PASSWORD:-}" ]]; then
  printf '%s  Dashboard password:%s %s\n' "${C_OK}" "${C_RESET}" "${GENERATED_PASSWORD}"
  dim "Stored in ${APP_DIR}/.env — change it there any time."
fi
echo
info "Next steps"
dim "1. Start it:            ./start-termux.sh"
dim "2. Open the dashboard:  http://127.0.0.1:4000 on this device"
dim "3. Keep it alive:       allow Termux in Android battery settings"
dim "                        (Settings → Apps → Termux → Battery → Unrestricted)"
echo
info "Notes for Android"
dim "• No root, no systemd: ./start-termux.sh runs a built-in supervisor."
dim "• Rendered audits need a Chromium build; HTTP audits always work."
dim "• Install the Termux:Boot add-on to auto-start after a reboot:"
dim "  mkdir -p ~/.termux/boot && ln -sf ${APP_DIR}/start-termux.sh ~/.termux/boot/visitor.sh"
