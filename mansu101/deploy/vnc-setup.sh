#!/usr/bin/env bash
# MANSU101 — optional visible-browser mode with secure-ish VNC.
# Installs Xvfb + x11vnc + noVNC, runs them as systemd units, and updates .env.
# Usage: sudo DOMAIN=automation.example.com bash deploy/vnc-setup.sh
set -euo pipefail

APP_USER="${APP_USER:-mansu}"
APP_DIR="${APP_DIR:-/opt/mansu101}"
DISPLAY_NUM="${DISPLAY_NUM:-:99}"
SCREEN="${SCREEN:-1600x1000x24}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"

log() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/vnc-setup.sh" >&2
  exit 1
fi

log "Installing virtual display + VNC packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y xvfb x11vnc novnc websockify apache2-utils openssl

log "Creating VNC credentials"
install -d -m 700 /etc/mansu101
VNC_PASS="${VNC_PASS:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 16)}"
x11vnc -storepasswd "${VNC_PASS}" /etc/mansu101/vnc.pass >/dev/null
chmod 600 /etc/mansu101/vnc.pass

log "Installing systemd units"
cat >/etc/systemd/system/mansu101-xvfb.service <<EOF
[Unit]
Description=MANSU101 Xvfb display ${DISPLAY_NUM}
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb ${DISPLAY_NUM} -screen 0 ${SCREEN} -nolisten tcp
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/mansu101-x11vnc.service <<EOF
[Unit]
Description=MANSU101 x11vnc bridge
After=mansu101-xvfb.service
Requires=mansu101-xvfb.service

[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -display ${DISPLAY_NUM} -rfbauth /etc/mansu101/vnc.pass -localhost -forever -shared -rfbport ${VNC_PORT} -noxdamage
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/mansu101-novnc.service <<EOF
[Unit]
Description=MANSU101 noVNC websocket bridge
After=mansu101-x11vnc.service
Requires=mansu101-x11vnc.service

[Service]
Type=simple
ExecStart=/usr/bin/websockify --web=/usr/share/novnc 127.0.0.1:${NOVNC_PORT} 127.0.0.1:${VNC_PORT}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now mansu101-xvfb.service mansu101-x11vnc.service mansu101-novnc.service

log "Updating ${APP_DIR}/.env for visible mode"
if [[ -f "${APP_DIR}/.env" ]]; then
  sed -i 's/^BROWSER_HEADLESS=.*/BROWSER_HEADLESS=false/' "${APP_DIR}/.env"
  grep -qE '^DISPLAY=' "${APP_DIR}/.env" || printf '\n# Visible Chromium needs the virtual display\nDISPLAY=%s\n' "${DISPLAY_NUM}" >> "${APP_DIR}/.env"
  PUBLIC_URL="$(grep -E '^PUBLIC_URL=' "${APP_DIR}/.env" | cut -d= -f2- || true)"
  if [[ -n "${PUBLIC_URL}" ]]; then
    VNC_URL="${PUBLIC_URL%/}/vnc/vnc.html?autoconnect=1&resize=scale&path=vnc/websockify"
    if grep -qE '^VNC_URL=' "${APP_DIR}/.env"; then
      sed -i "s|^VNC_URL=.*|VNC_URL=${VNC_URL}|" "${APP_DIR}/.env"
    else
      printf 'VNC_URL=%s\n' "${VNC_URL}" >> "${APP_DIR}/.env"
    fi
  fi
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
else
  echo "No .env found at ${APP_DIR}/.env — set BROWSER_HEADLESS=false and DISPLAY=${DISPLAY_NUM} manually."
fi

log "Next: expose noVNC through Nginx"
cat <<EOF

1. Create dashboard-level VNC credentials:
     sudo htpasswd -c /etc/nginx/.htpasswd-mansu YOUR_USER

2. Append deploy/nginx-vnc-snippet.conf inside the MANSU101 server{} block,
   then: sudo nginx -t && sudo systemctl reload nginx

3. Restart the app so it picks up the new environment:
     sudo -u ${APP_USER} bash -lc "cd ${APP_DIR} && pm2 restart mansu101 --update-env"

4. Test:
     curl -I http://127.0.0.1:${NOVNC_PORT}/vnc.html
     Open VNC_URL from .env in a browser (HTTPS via Nginx).

VNC password: ${VNC_PASS}
Store it safely — it is also in /etc/mansu101/vnc.pass (root only).

Security: VNC listens on 127.0.0.1 only. Do not expose port ${VNC_PORT}
directly to the internet; the Nginx location adds HTTPS + basic auth.

EOF
