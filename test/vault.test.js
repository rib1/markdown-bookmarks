import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveBookmark, findBookmarks, initVault, vaultRoot } from '../src/vault.js';

test('uses the Docker VAULT_PATH when BOOKMARK_VAULT is not set', { concurrency: false }, () => {
  const previousBookmarkVault = process.env.BOOKMARK_VAULT;
  const previousVaultPath = process.env.VAULT_PATH;
  delete process.env.BOOKMARK_VAULT;
  process.env.VAULT_PATH = '/vault';
  try {
    assert.equal(vaultRoot(), '/vault');
  } finally {
    if (previousBookmarkVault === undefined) delete process.env.BOOKMARK_VAULT;
    else process.env.BOOKMARK_VAULT = previousBookmarkVault;
    if (previousVaultPath === undefined) delete process.env.VAULT_PATH;
    else process.env.VAULT_PATH = previousVaultPath;
  }
});

test('initializes a vault and installs the LLM skill without overwriting README', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-vault-'));
  const previousSkillSource = process.env.SKILL_SOURCE;
  process.env.SKILL_SOURCE = path.resolve('skills', 'markdown-bookmark-vault', 'SKILL.md');
  try {
    await initVault(root);
    for (const directory of ['bookmarks', 'projects', 'events', 'assets', 'views']) {
      const stat = await fs.stat(path.join(root, directory));
      assert.equal(stat.isDirectory(), true);
    }
    const readme = path.join(root, 'README.md');
    const skill = path.join(root, '.codex', 'skills', 'markdown-bookmark-vault', 'SKILL.md');
    const readmeContent = await fs.readFile(readme, 'utf8');
    assert.match(readmeContent, /# Private bookmark vault/);
    assert.match(readmeContent, /`bookmarks\/`/);
    assert.match(readmeContent, /`\.codex\/skills\/`/);
    assert.match(await fs.readFile(skill, 'utf8'), /Markdown bookmark vault/);
    await fs.writeFile(readme, 'my custom vault README\n', 'utf8');
    await initVault(root);
    assert.equal(await fs.readFile(readme, 'utf8'), 'my custom vault README\n');
  } finally {
    if (previousSkillSource === undefined) delete process.env.SKILL_SOURCE;
    else process.env.SKILL_SOURCE = previousSkillSource;
  }
});

test('saves tagged bookmark and finds it through the CLI index path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-'));
  const saved = await saveBookmark({ url: 'https://example.test/postgres', title: 'Postgres Guide', tags: ['work', 'database'] }, root);
  const content = await fs.readFile(saved.file, 'utf8');
  assert.match(content, /- "work"/);
  assert.match(content, /- "database"/);
  const found = await findBookmarks('postgres', root);
  assert.equal(found.length, 1);
});

test('reuses an existing bookmark and merges tags on duplicate save', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-dedupe-'));
  const first = await saveBookmark({ url: 'https://example.test/page/#section', title: 'Example', tags: ['first'] }, root);
  const second = await saveBookmark({ url: 'https://example.test/page/', title: 'Example again', tags: ['second'] }, root);
  assert.equal(second.file, first.file);
  assert.equal(second.duplicate, true);
  const content = await fs.readFile(first.file, 'utf8');
  assert.match(content, /- "first"/);
  assert.match(content, /- "second"/);
  assert.match(content, /access_count: 2/);
});

test('filters bookmark search by saved time', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-time-'));
  await saveBookmark({ id: 'old', url: 'https://example.test/old', title: 'Amiga old', saved_at: '2020-01-01T00:00:00.000Z' }, root);
  await saveBookmark({ id: 'new', url: 'https://example.test/new', title: 'Amiga new', saved_at: new Date().toISOString() }, root);
  assert.equal((await findBookmarks('amiga', root, { savedSince: '2025-01-01' })).length, 1);
  assert.equal((await findBookmarks('amiga', root, { savedWithin: 'year' })).length, 1);
});
