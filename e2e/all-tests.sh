#!/bin/sh
set -eu

npm test
VAULT_PATH=/vault PORT=8787 node src/server.js &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
xvfb-run -a node test.mjs
