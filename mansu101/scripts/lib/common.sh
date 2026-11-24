#!/usr/bin/env bash
# Shared helpers for start-local.sh / start-termux.sh / install-termux.sh.
# Sourced, never executed directly.
#
# Provides: colour logging, .env bootstrap, node/pnpm checks, port helpers and
# a single place for the "is this Termux?" test so the shell and Node layers
# cannot disagree.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$(cd "${LIB_DIR}/.." && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_INFO=$'\033[36m'; C_OK=$'\033[32m'
  C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_INFO=''; C_OK=''; C_WARN=''; C_ERR=''; C_DIM=''
fi

info() { printf '%s==>%s %s\n' "${C_INFO}" "${C_RESET}" "$*"; }
ok()   { printf '%s  ✓%s %s\n' "${C_OK}" "${C_RESET}" "$*"; }
warn() { printf '%s  !%s %s\n' "${C_WARN}" "${C_RESET}" "$*"; }
err()  { printf '%s  ✗%s %s\n' "${C_ERR}" "${C_RESET}" "$*" >&2; }
dim()  { printf '%s    %s%s\n' "${C_DIM}" "$*" "${C_RESET}"; }

die() { err "$*"; exit 1; }

# ── environment detection ────────────────────────────────────────────────
detect_termux() {
  [[ -n "${TERMUX_VERSION:-}" ]] && return 0
  [[ -n "${TERMUX_APP_PID:-}" ]] && return 0
  [[ "${PREFIX:-}" == *com.termux* ]] && return 0
  return 1
}

is_android() {
  [[ "$(uname -o 2>/dev/null || true)" == "Android" ]] && return 0
  [[ -n "${ANDROID_DATA:-}" ]] && return 0
  return 1
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major minor
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  minor="$(node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0)"
  (( major > 22 )) || { (( major == 22 )) && (( minor >= 5 )); }
}

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    err "Node.js is not installed."
    dim "Termux:  pkg install nodejs-lts"
    dim "Debian:  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs"
    dim "macOS:   brew install node@22"
    exit 1
  fi
  if ! node_ok; then
    err "Node $(node -v) is too old — Visitor needs >= 22.5 (node:sqlite)."
    dim "Termux: pkg install nodejs-lts   (or: pkg upgrade nodejs)"
    exit 1
  fi
  ok "Node $(node -v)"
}

# pnpm is the package manager the lockfile was generated with. Fall back to
# corepack (ships with Node) and finally to npm so a fresh Termux install works
# without extra steps.
PNPM_CMD=()
resolve_package_manager() {
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=(pnpm)
    ok "pnpm $(pnpm -v)"
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    info "Enabling pnpm through corepack"
    if corepack enable >/dev/null 2>&1 && corepack prepare pnpm@latest --activate >/dev/null 2>&1; then
      PNPM_CMD=(pnpm)
      ok "pnpm $(pnpm -v) (via corepack)"
      return 0
    fi
    warn "corepack could not activate pnpm — falling back to npm"
  fi
  if command -v npm >/dev/null 2>&1; then
    PNPM_CMD=(npm)
    warn "pnpm not found — using npm $(npm -v). Install pnpm for lockfile-exact installs."
    return 0
  fi
  die "Neither pnpm nor npm is available. Install Node.js first."
}

# ── .env bootstrap ───────────────────────────────────────────────────────
ensure_env_file() {
  local mode="$1"
  if [[ -f "${APP_DIR}/.env" ]]; then
    ok ".env present"
    return 0
  fi
  [[ -f "${APP_DIR}/.env.example" ]] || die ".env.example is missing — cannot create .env"
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env" 2>/dev/null || true

  local password
  password="$(generate_password)"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' "s|^APP_PASSWORD=.*|APP_PASSWORD=${password}|" "${APP_DIR}/.env"
    sed -i '' "s|^DEPLOYMENT_MODE=.*|DEPLOYMENT_MODE=${mode}|" "${APP_DIR}/.env" 2>/dev/null || true
  else
    sed -i "s|^APP_PASSWORD=.*|APP_PASSWORD=${password}|" "${APP_DIR}/.env"
    sed -i "s|^DEPLOYMENT_MODE=.*|DEPLOYMENT_MODE=${mode}|" "${APP_DIR}/.env" 2>/dev/null || true
  fi
  ok "Created .env with a generated dashboard password"
  dim "Password: ${password}"
  dim "Change it any time in ${APP_DIR}/.env"
  GENERATED_PASSWORD="${password}"
}

generate_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 28
  else
    node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url').slice(0,28))"
  fi
}

env_get() {
  local key="$1" fallback="${2:-}"
  local value
  value="$(grep -E "^${key}=" "${APP_DIR}/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  [[ -n "${value}" ]] && printf '%s' "${value}" || printf '%s' "${fallback}"
}

# ── build / install ──────────────────────────────────────────────────────
deps_installed() {
  [[ -d "${APP_DIR}/node_modules" ]] \
    && [[ -d "${APP_DIR}/server/node_modules" ]] \
    && [[ -d "${APP_DIR}/web/node_modules" ]]
}

install_deps() {
  info "Installing dependencies"
  local args=(install)
  # esbuild's postinstall downloads a platform binary; pnpm >= 10 blocks build
  # scripts unless explicitly allowed.
  if [[ "${PNPM_CMD[0]}" == "pnpm" ]]; then
    args+=(--allow-build=esbuild)
  fi
  ( cd "${APP_DIR}" && "${PNPM_CMD[@]}" "${args[@]}" ) || die "Dependency install failed"
  ok "Dependencies installed"
}

web_built() {
  [[ -f "${APP_DIR}/web/dist/index.html" ]]
}

build_web() {
  if web_built; then
    ok "Frontend already built (web/dist)"
    return 0
  fi
  info "Building the dashboard (this takes ~10s)"
  ( cd "${APP_DIR}" && "${PNPM_CMD[@]}" run build ) || die "Frontend build failed"
  ok "Frontend built"
}

# ── port helpers ─────────────────────────────────────────────────────────
port_in_use() {
  local port="$1"
  if command -v node >/dev/null 2>&1; then
    node -e "
const net=require('net');
const socket=net.connect({host:'127.0.0.1',port:Number(process.argv[1])});
const done=(v)=>{socket.destroy();process.exit(v?0:1)};
socket.setTimeout(600);
socket.once('connect',()=>done(true));
socket.once('timeout',()=>done(false));
socket.once('error',()=>done(false));
" "$port" >/dev/null 2>&1
    return $?
  fi
  return 1
}

wait_for_health() {
  local url="$1" attempts="${2:-40}"
  local i
  for (( i = 1; i <= attempts; i++ )); do
    if curl -fsS --max-time 2 "${url}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}
