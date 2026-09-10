#!/bin/sh
set -eu

npm test
VAULT_PATH=/vault PORT=8787 node src/server.js &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
ready=0
for attempt in $(seq 1 60); do
	if node -e "fetch('http://127.0.0.1:8787/capabilities').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"; then
		ready=1
		break
	fi
	sleep 1
done
if [ "$ready" -ne 1 ]; then
	echo 'Companion did not become ready for E2E tests.' >&2
	exit 1
fi
xvfb-run -a node test.mjs
