#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "${ROOT_DIR}/node_modules/whatsapp-web.js" ]]; then
  echo "Missing MiraChat dependencies."
  echo
  echo "Install them with:"
  echo "  cd \"${ROOT_DIR}\" && npm install"
  exit 1
fi

exec node "${ROOT_DIR}/scripts/whatsapp-send-once.mjs" "$@"
