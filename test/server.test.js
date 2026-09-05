import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { findBookmarks } from '../src/vault.js';
import { API_PROTOCOL_VERSION } from '../src/api-contract.js';

function browserRequest(bookmark, apiProtocol = API_PROTOCOL_VERSION) {
  return {
    client: { type: 'browser-extension', version: '0.2.0', api_protocol: apiProtocol },
    bookmark
  };
}

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  listener.close();
  await once(listener, 'close');
  return port;
}

test('HTTP server prefers BOOKMARK_VAULT over VAULT_PATH', async (t) => {
  const bookmarkVault = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-server-'));
  const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-decoy-'));
  const port = await availablePort();
  const legacyDirectory = path.join(bookmarkVault, 'bookmarks', '2026', '09');
  const legacyFile = path.join(legacyDirectory, 'legacy.md');
  const resultsDirectory = path.join(bookmarkVault, 'views', '.search-results');
  const staleResult = path.join(resultsDirectory,
    'search-results-00000000-0000-4000-8000-000000000000.html');
  await fs.mkdir(legacyDirectory, { recursive: true });
  await fs.mkdir(resultsDirectory, { recursive: true });
  await fs.writeFile(staleResult, '<html>stale</html>', 'utf8');
  const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await fs.utimes(staleResult, staleDate, staleDate);
  await fs.writeFile(legacyFile, `---
id: legacy-server
url: "https://example.test/server-legacy"
title: "Server legacy"
tags:
  []
saved_at: 2026-09-01T09:00:00.000Z
first_opened_at: 2026-09-01T09:00:00.000Z
last_opened_at: 2026-09-01T09:00:00.000Z
access_count: 1
---

## Summary

`, 'utf8');
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      BOOKMARK_VAULT: bookmarkVault,
      BOOKMARK_RESULTS_DIR: resultsDirectory,
      VAULT_PATH: vaultPath,
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  t.after(async () => {
    if (server.exitCode === null) {
      server.kill();
      await once(server, 'exit');
    }
    await Promise.all([
      fs.rm(bookmarkVault, { recursive: true, force: true }),
      fs.rm(vaultPath, { recursive: true, force: true })
    ]);
  });

  server.stdout.setEncoding('utf8');
  const [message] = await once(server.stdout, 'data', { signal: AbortSignal.timeout(5000) });
  assert.match(message, /bookmark companion listening/);
  assert.match(message, new RegExp(`vault: ${bookmarkVault.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(message, /vault migration ran: 001-bookmark-schema-v1\.js; schema: 0 -> 1/);
  assert.match(message, /vault AGENTS\.md: installed/);
  assert.match(message, /stale search-result pages purged: 1/);
  assert.match(message, /schema: 1; migrated: 1/);
  await assert.rejects(() => fs.access(staleResult), { code: 'ENOENT' });
  const migratedLegacy = await fs.readFile(legacyFile, 'utf8');
  assert.match(migratedLegacy, /schema_version: 1/);
  assert.match(migratedLegacy, /save_count: 1/);
  assert.doesNotMatch(migratedLegacy, /first_opened_at:|last_opened_at:|access_count:/);

  const capabilitiesResponse = await fetch(`http://127.0.0.1:${port}/capabilities`);
  const capabilities = await capabilitiesResponse.json();
  assert.equal(capabilitiesResponse.status, 200);
  assert.equal(capabilities.api_protocol, API_PROTOCOL_VERSION);
  assert.equal(capabilities.bookmark_schema_version, 1);
  assert.equal(capabilities.features.share_history, 1);
  assert.equal(capabilities.features.capture_history, 1);

  const legacyResponse = await fetch(`http://127.0.0.1:${port}/bookmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.test/legacy-addon' })
  });
  const legacyError = await legacyResponse.json();
  assert.equal(legacyResponse.status, 409);
  assert.equal(legacyError.code, 'browser_addon_update_required');
  assert.match(legacyError.error, /Reload or update.*browser add-on/);
  assert.equal((await findBookmarks('legacy-addon', bookmarkVault)).length, 0);

  const unsupportedResponse = await fetch(`http://127.0.0.1:${port}/bookmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(browserRequest({
      url: 'https://example.test/unsupported-field', lost_field: 'must reject'
    }))
  });
  assert.equal(unsupportedResponse.status, 422);
  assert.equal((await unsupportedResponse.json()).code, 'unsupported_fields');
  assert.equal((await findBookmarks('unsupported-field', bookmarkVault)).length, 0);

  const response = await fetch(`http://127.0.0.1:${port}/bookmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(browserRequest({
      url: 'https://example.test/native-server',
      title: 'Native server vault test',
      tags: ['test'],
      shared_by: 'Alice',
      shared_via: 'Signal',
      share_event_id: 'server-capture',
      capture: {
        id: 'server-capture', os: 'mac', architecture: 'arm64',
        browser: 'Google Chrome', browser_version: '140', device: 'home-mac'
      }
    }))
  });

  assert.equal(response.status, 201);
  const savedResponse = await response.json();
  assert.deepEqual(savedResponse.warnings, []);
  assert.ok(savedResponse.processed_fields.includes('shared_by'));
  assert.ok(savedResponse.processed_fields.includes('capture'));
  assert.equal((await findBookmarks('native-server', bookmarkVault)).length, 1);
  const savedContent = (await findBookmarks('native-server', bookmarkVault))[0].content;
  assert.match(savedContent, /"sender":"Alice"/);
  assert.match(savedContent, /"channel":"Signal"/);
  assert.match(savedContent, /"device":"home-mac"/);
  assert.match(savedContent, /"extension_version":"0.2.0"/);
  assert.match(savedContent, /"os":"mac"/);
  assert.match(savedContent, /"architecture":"arm64"/);
  assert.match(savedContent, /"browser":"Google Chrome"/);
  assert.match(savedContent, /"browser_version":"140"/);
  assert.equal((await findBookmarks('', vaultPath)).length, 0);
});
