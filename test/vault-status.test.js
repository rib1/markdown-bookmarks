import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BOOKMARK_SCHEMA_VERSION } from '../src/migrations/index.js';
import { inspectVaultStatus, renderVaultStatus } from '../src/vault-status.js';

const localCommit = '1111111111111111111111111111111111111111';
const remoteCommit = '2222222222222222222222222222222222222222';

function bookmark({ id, title, url, first, last, tags = [] }) {
  return `---
schema_version: ${BOOKMARK_SCHEMA_VERSION}
${id ? `id: ${JSON.stringify(id)}\n` : ''}${url ? `url: ${JSON.stringify(url)}\n` : ''}title: ${JSON.stringify(title)}
tags:
${tags.map((tag) => `  - ${JSON.stringify(tag)}`).join('\n') || '  []'}
${first ? `saved_at: ${first}\nfirst_saved_at: ${first}\n` : ''}${last ? `last_saved_at: ${last}\n` : ''}---
`;
}

async function write(file, content = '') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

test('inspects vault counts, date ranges, health, instructions, and cached Git sync state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-status-'));
  await write(path.join(root, '.markdown-bookmarks.json'), `${JSON.stringify({ schema_version: BOOKMARK_SCHEMA_VERSION })}\n`);
  await write(path.join(root, 'AGENTS.md'), 'vault instructions\n');
  await write(path.join(root, '.codex', 'skills', 'markdown-bookmark-vault', 'SKILL.md'), 'skill\n');
  await write(path.join(root, 'projects', 'one.md'), '# Project\n');
  await write(path.join(root, 'events', '2026', 'one.md'), '# Event\n');
  await write(path.join(root, 'bookmarks', '2024', 'one.md'), bookmark({
    id: 'old-bookmark', title: '\u001b[31mOld bookmark', url: 'https://example.test/old',
    first: '2024-01-02T03:04:05.000Z', last: '2026-09-08T08:00:00.000Z', tags: ['shared', 'old']
  }));
  await write(path.join(root, 'bookmarks', '2026', 'two.md'), bookmark({
    id: 'new-bookmark', title: 'New bookmark', url: 'https://example.test/new',
    first: '2026-09-01T10:00:00.000Z', last: '2026-09-01T10:00:00.000Z', tags: ['shared', 'new']
  }));
  await write(path.join(root, 'bookmarks', '2025', 'duplicate.md'), bookmark({
    id: 'OLD-BOOKMARK', title: 'Duplicate bookmark', url: 'https://example.test/old/#fragment',
    first: '2025-05-01T10:00:00.000Z', last: '2025-05-01T10:00:00.000Z'
  }));
  await write(path.join(root, 'bookmarks', 'broken.md'), bookmark({ title: 'Broken bookmark' }));

  await write(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await write(path.join(root, '.git', 'refs', 'heads', 'main'), `${localCommit}\n`);
  await write(path.join(root, '.git', 'config'), `[core]
  bare = false
[branch "main"]
  remote = origin
  merge = refs/heads/main
`);
  await write(path.join(root, '.git', 'packed-refs'), `# pack-refs with: peeled fully-peeled
${localCommit} refs/remotes/origin/main
`);

  const status = await inspectVaultStatus(root);
  assert.equal(status.bookmarks, 4);
  assert.equal(status.projects, 1);
  assert.equal(status.events, 1);
  assert.equal(status.uniqueTags, 3);
  assert.equal(status.oldest.id, 'old-bookmark');
  assert.equal(status.newest.id, 'new-bookmark');
  assert.equal(status.latestActivity.id, 'old-bookmark');
  assert.deepEqual(status.health, {
    missingId: 1,
    missingUrl: 1,
    invalidOrMissingSavedAt: 1,
    duplicateIds: 1,
    duplicateUrls: 1
  });
  assert.equal(status.agentsInstalled, true);
  assert.equal(status.skillInstalled, true);
  assert.deepEqual(status.git, {
    repository: true, branch: 'main', upstream: 'origin/main', checkpoint: 'matches'
  });

  const output = renderVaultStatus(status);
  assert.match(output, new RegExp(`Vault: ${root.replaceAll('\\', '\\\\')}`));
  assert.doesNotMatch(output, /Vault \(container\):/);
  assert.match(output, /Bookmarks: 4/);
  assert.match(output, /Oldest bookmark: 2024-01-02T03:04:05\.000Z — Old bookmark \[old-book\]/);
  assert.match(output, /Newest bookmark: 2026-09-01T10:00:00\.000Z — New bookmark \[new-book\]/);
  assert.match(output, /Latest save activity: 2026-09-08T08:00:00\.000Z — Old bookmark/);
  assert.match(output, /Record checks: 5 warning\(s\)/);
  assert.match(output, /duplicate ID values 1, duplicate URL values 1/);
  assert.match(output, /matches last fetched origin\/main/);
  assert.match(output, /remote may have changed since the last fetch/);
  assert.match(output, /See vault Git help: npm run bookmark -- vault git-help/);
  assert.equal(output.includes(String.fromCharCode(27)), false);

  await write(path.join(root, '.git', 'refs', 'remotes', 'origin', 'main'), `${remoteCommit}\n`);
  assert.equal((await inspectVaultStatus(root)).git.checkpoint, 'differs');

  const dockerOutput = renderVaultStatus({ ...status, hostRoot: 'C:\\Users\\Example\\Bookmark Vault' }, {
    gitHelpCommand: 'docker compose exec bookmarkd node src/cli.js vault git-help'
  });
  assert.match(dockerOutput, /Vault \(host\): C:\\Users\\Example\\Bookmark Vault/);
  assert.match(dockerOutput, /Vault \(container\): \/tmp\/markdown-bookmarks-status-/);
  assert.doesNotMatch(dockerOutput, /^Vault: /m);
  assert.match(dockerOutput, /See vault Git help: docker compose exec bookmarkd node src\/cli\.js vault git-help/);
});

test('reports empty vault and missing Git metadata without requiring Git', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-empty-status-'));
  await write(path.join(root, '.markdown-bookmarks.json'), '{"schema_version":1}\n');
  const status = await inspectVaultStatus(root);
  assert.equal(status.bookmarks, 0);
  assert.equal(status.git.repository, false);
  const output = renderVaultStatus(status);
  assert.match(output, /Schema: 1 \(upgrade available:/);
  assert.match(output, /Oldest bookmark: none/);
  assert.match(output, /Record checks: passed \(IDs, URLs, saved dates, duplicate IDs\/URLs\)/);
  assert.match(output, /Git: not initialized \(optional; vault status is still available\)/);
  assert.match(output, /See vault Git help: npm run bookmark -- vault git-help/);

  await fs.mkdir(path.join(root, '.git'));
  const partial = await inspectVaultStatus(root);
  assert.deepEqual(partial.git, {
    repository: true, checkpoint: 'unavailable', detail: 'Git HEAD is missing'
  });
  assert.match(renderVaultStatus(partial), /Git checkpoint: unavailable \(Git HEAD is missing\)/);
});
