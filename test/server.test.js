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
  assert.equal((await findBookmarks('', bookmarkVault)).length, 1);
  assert.equal((await findBookmarks('', vaultPath)).length, 0);
});
