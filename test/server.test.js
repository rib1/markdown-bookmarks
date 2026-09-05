import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { findBookmarks } from '../src/vault.js';

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
  await fs.mkdir(legacyDirectory, { recursive: true });
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
  assert.match(message, /schema: 1; migrated: 1/);
  const migratedLegacy = await fs.readFile(legacyFile, 'utf8');
  assert.match(migratedLegacy, /schema_version: 1/);
  assert.match(migratedLegacy, /save_count: 1/);
  assert.doesNotMatch(migratedLegacy, /first_opened_at:|last_opened_at:|access_count:/);

  const response = await fetch(`http://127.0.0.1:${port}/bookmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.test/native-server',
      title: 'Native server vault test',
      tags: ['test']
    })
  });

  assert.equal(response.status, 201);
  assert.equal((await findBookmarks('native-server', bookmarkVault)).length, 1);
  assert.equal((await findBookmarks('', vaultPath)).length, 0);
});
