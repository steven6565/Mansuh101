#!/usr/bin/env bash
# Visitor — Ubuntu VPS provisioner (Organic SEO & site growth platform)
# Usage:  sudo DOMAIN=automation.example.com bash deploy/install.sh
# Re-runnable: preserves .env, data/ and screenshots.
set -euo pipefail

APP_USER="${APP_USER:-visitor}"
APP_DIR="${APP_DIR:-/opt/visitor}"
DOMAIN="${DOMAIN:-}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root: sudo DOMAIN=your.domain bash deploy/install.sh" >&2
  exit 1
fi

ARCH="$(uname -m)"
export DEBIAN_FRONTEND=noninteractive

log "Installing base packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg git rsync nginx sqlite3 ufw openssl jq

log "Installing Node.js 24"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if (( NODE_MAJOR >= 22 )); then NODE_OK=1; fi
fi
if (( NODE_OK == 0 )); then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
ok "Node $(node -v)"

log "Installing pnpm and PM2"
if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm@latest
fi
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
ok "pnpm $(pnpm -v) · pm2 $(pm2 -v)"

log "Installing Chromium"
CHROME_BIN="$(command -v chromium || command -v chromium-browser || command -v google-chrome-stable || command -v google-chrome || true)"
if [[ -z "${CHROME_BIN}" ]]; then
  if apt-get install -y chromium >/dev/null 2>&1; then
    CHROME_BIN="$(command -v chromium || true)"
  fi
fi
if [[ -z "${CHROME_BIN}" ]]; then
  if apt-get install -y chromium-browser >/dev/null 2>&1; then
    CHROME_BIN="$(command -v chromium-browser || command -v chromium || true)"
  fi
fi
if [[ -z "${CHROME_BIN}" && "${ARCH}" == "x86_64" ]]; then
  warn "No distro Chromium found — installing Google Chrome stable (.deb)"
  curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /var/tmp/google-chrome.deb
  apt-get install -y /var/tmp/google-chrome.deb
  CHROME_BIN="$(command -v google-chrome-stable || true)"
fi
if [[ -z "${CHROME_BIN}" ]]; then
  warn "Chromium could not be installed automatically (architecture: ${ARCH})."
  warn "Install it manually, then set CHROMIUM_PATH in ${APP_DIR}/.env."
else
  ok "Browser: ${CHROME_BIN}"
fi

log "Creating application user and directory"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${APP_USER}"
fi
mkdir -p "${APP_DIR}" "${APP_DIR}/data/logs" "${APP_DIR}/data/screenshots"

if [[ "$(realpath "${SRC_DIR}")" != "$(realpath "${APP_DIR}")" ]]; then
  log "Copying application files to ${APP_DIR}"
  rsync -a --exclude node_modules --exclude data --exclude .env --exclude dist \
    --exclude '.git' "${SRC_DIR}/" "${APP_DIR}/"
fi

log "Writing environment file"
GENERATED_PASSWORD=""
if [[ ! -f "${APP_DIR}/.env" ]]; then
  GENERATED_PASSWORD="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 24)"
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  sed -i "s|^APP_PASSWORD=.*|APP_PASSWORD=${GENERATED_PASSWORD}|" "${APP_DIR}/.env"
  sed -i "s|^NODE_ENV=.*|NODE_ENV=production|" "${APP_DIR}/.env"
  sed -i "s|^PORT=.*|PORT=4000|" "${APP_DIR}/.env"
  if [[ -n "${DOMAIN}" ]]; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://${DOMAIN}|" "${APP_DIR}/.env"
  else
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=|" "${APP_DIR}/.env"
  fi
  if [[ -n "${CHROME_BIN}" ]]; then
    sed -i "s|^CHROMIUM_PATH=.*|CHROMIUM_PATH=${CHROME_BIN}|" "${APP_DIR}/.env"
  fi
  ok "Generated .env with a random dashboard password"
else
  warn ".env already exists — leaving it untouched"
  if [[ -n "${CHROME_BIN}" ]] && ! grep -q '^CHROMIUM_PATH=.' "${APP_DIR}/.env"; then
    sed -i "s|^CHROMIUM_PATH=.*|CHROMIUM_PATH=${CHROME_BIN}|" "${APP_DIR}/.env"
  fi
fi

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
chmod 600 "${APP_DIR}/.env"

log "Installing dependencies and building the dashboard"
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && pnpm install --allow-build=esbuild"
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && pnpm build"

log "Starting with PM2"
if [[ "${APP_DIR}" != "/opt/visitor" ]]; then
  sed -i "s|/opt/visitor|${APP_DIR}|g" "${APP_DIR}/deploy/ecosystem.config.cjs"
fi
sudo -u "${APP_USER}" bash -lc "cd '${APP_DIR}' && pm2 start deploy/ecosystem.config.cjs --update-env && pm2 save"
pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" >/dev/null || warn "pm2 startup failed — check systemd"
sudo -u "${APP_USER}" bash -lc "pm2 save" >/dev/null

log "Configuring Nginx (HTTP bootstrap)"
NGINX_SITE=/etc/nginx/sites-available/visitor
sed "s|visitor.example.com|${DOMAIN:-_}|g" "${APP_DIR}/deploy/nginx-http.conf" > "${NGINX_SITE}"
ln -sf "${NGINX_SITE}" /etc/nginx/sites-enabled/visitor
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx

log "Verifying application health"
HEALTH_OK=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:4000/api/health >/dev/null 2>&1; then HEALTH_OK=1; break; fi
  sleep 1
done
if (( HEALTH_OK == 1 )); then ok "Backend healthy on 127.0.0.1:4000"; else warn "Health check failed — inspect: pm2 logs visitor"; fi

printf '\n'
printf '\033[1;32m══════════════════════════════════════════════════════════════\033[0m\n'
printf '\033[1;32m  Visitor installed\033[0m\n'
printf '\033[1;32m══════════════════════════════════════════════════════════════\033[0m\n'
if [[ -n "${DOMAIN}" ]]; then
  printf '  Dashboard : http://%s\n' "${DOMAIN}"
else
  printf '  Dashboard : http://<VPS_PUBLIC_IP>\n'
fi
if [[ -n "${GENERATED_PASSWORD}" ]]; then
  printf '  Password  : %s\n' "${GENERATED_PASSWORD}"
  printf '  (stored in %s/.env — change it anytime)\n' "${APP_DIR}"
else
  printf '  Password  : unchanged (see %s/.env)\n' "${APP_DIR}"
fi
printf '  PM2       : pm2 status / pm2 logs visitor / pm2 restart visitor\n'
printf '\n  Next steps:\n'
if [[ -n "${DOMAIN}" ]]; then
  printf '   1. Point DNS A record to this server.\n'
  printf '   2. sudo apt install certbot python3-certbot-nginx\n'
  printf '      sudo certbot --nginx -d %s\n' "${DOMAIN}"
else
  printf '   1. (Recommended) set a domain and run certbot for HTTPS.\n'
fi
printf '   3. Set PUBLIC_URL=https://your.domain in %s/.env, then\n' "${APP_DIR}"
printf '      pm2 restart visitor --update-env\n'
printf '   4. Self-test browser: cd %s && pnpm run doctor --launch\n' "${APP_DIR}"
printf '   5. Firewall: ufw allow OpenSSH && ufw allow "Nginx Full" && ufw enable\n'
printf '\033[1;32m══════════════════════════════════════════════════════════════\033[0m\n\n'
