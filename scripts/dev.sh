#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.." || exit 1
if [ ! -d web/node_modules ]; then
  echo "Install dependencies first: make install" >&2
  exit 1
fi
(cd api && go run ./cmd/mockinterview) & api_pid=$!
(cd web && npm run dev) & web_pid=$!
cleanup() {
  kill "$api_pid" "$web_pid" 2>/dev/null || true
  wait "$api_pid" "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 1
done
if ! kill -0 "$api_pid" 2>/dev/null; then
  wait "$api_pid"; exit $?
fi
wait "$web_pid"; exit $?
