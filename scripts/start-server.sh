#!/usr/bin/env bash
# Starts llama-server using the paths in ../.env (copy .env.example to .env first).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
cd "${LLAMA_CPP_DIR}"
exec ./build/bin/llama-server \
  -m "${MODEL_PATH/#\~/$HOME}" \
  --mmproj "${MMPROJ_PATH/#\~/$HOME}" \
  -ngl 99 --no-reasoning-preserve \
  --host "${HOST}" --port "${PORT}" --metrics \
  --image-min-tokens 1024 --ctx-size "${CTX_SIZE}"
