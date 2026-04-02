#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS_NODE_LOADER="${HOME}/.local/node_modules/ts-node/esm.mjs"
TYPESCRIPT_DIR="${HOME}/.local/node_modules/typescript"

if [[ ! -f "${TS_NODE_LOADER}" || ! -d "${TYPESCRIPT_DIR}" ]]; then
  echo "Missing local TypeScript runtime."
  echo
  echo "Install it with:"
  echo "  npm install --prefix \"\$HOME/.local\" ts-node typescript"
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/node_modules/memory-card" ]]; then
  echo "Missing Wechaty runtime dependencies in ${ROOT_DIR}/node_modules."
  echo
  echo "Install them with:"
  echo "  npm install --omit=dev --ignore-scripts --no-audit --no-fund --prefer-offline --package-lock=false"
  exit 1
fi

export NODE_PATH="${HOME}/.local/node_modules"
export TS_NODE_SKIP_PROJECT=1
export TS_NODE_TRANSPILE_ONLY=1
export TS_NODE_COMPILER=typescript
export TS_NODE_COMPILER_OPTIONS='{"module":"esnext","moduleResolution":"node","target":"esnext","esModuleInterop":true,"isolatedModules":true,"experimentalDecorators":true,"emitDecoratorMetadata":true,"ignoreDeprecations":"6.0"}'

exec node \
  --no-warnings \
  --loader "${TS_NODE_LOADER}" \
  "${ROOT_DIR}/scripts/wechaty-local.mjs" \
  "$@"
