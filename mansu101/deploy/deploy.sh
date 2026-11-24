#!/usr/bin/env bash
# Push the current working copy to a VPS and reload it.
# Usage: ./deploy/deploy.sh visitor@YOUR_VPS_IP [app_dir]
set -euo pipefail

TARGET="${1:-}"
APP_DIR="${2:-/opt/visitor}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${TARGET}" ]]; then
  echo "Usage: $0 user@host [remote_dir]" >&2
  exit 1
fi

echo "==> Syncing source to ${TARGET}:${APP_DIR}"
rsync -az --delete \
  --exclude node_modules \
  --exclude data \
  --exclude .env \
  --exclude dist \
  --exclude .git \
  "${SRC_DIR}/" "${TARGET}:${APP_DIR}/"

echo "==> Installing dependencies and building"
ssh "${TARGET}" "cd '${APP_DIR}' && pnpm install --allow-build=esbuild && pnpm build"

echo "==> Zero-downtime PM2 reload"
ssh "${TARGET}" "cd '${APP_DIR}' && pm2 reload deploy/ecosystem.config.cjs --update-env && pm2 save"

echo "==> Health check"
ssh "${TARGET}" "curl -fsS http://127.0.0.1:4000/api/health"
echo
echo "Deployment complete."
