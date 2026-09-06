#!/bin/sh
set -eu

node --test test/vault.test.js test/cli.test.js test/find-query.test.js test/tui-arguments.test.js test/vault-git-help.test.js test/vault-directory-launcher.test.js test/server.test.js test/search-results-page.test.js test/fuzzy-search.test.js test/api-contract.test.js test/extension-compatibility.test.js
VAULT_PATH=/vault PORT=8787 node src/server.js &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
xvfb-run -a node test.mjs
