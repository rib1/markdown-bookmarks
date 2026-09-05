import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  findBookmarks,
  initVault,
  installVaultSkill,
  saveBookmark,
  vaultRoot
} from '../src/vault.js';
import { BOOKMARK_SCHEMA_VERSION, migrateVault } from '../src/migrations/index.js';

function metadataList(content, field) {
  const match = content.match(new RegExp(`^${field}:\\n((?: {2}(?:- [^\\r\\n]*|\\[\\])\\n?)*)`, 'm'));
  if (!match) return [];
  return [...match[1].matchAll(/^ {2}- (.+)$/gm)].map((item) => JSON.parse(item[1]));
}

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
    const attributes = path.join(root, '.gitattributes');
    const ignore = path.join(root, '.gitignore');
    const schema = path.join(root, '.markdown-bookmarks.json');
    const skill = path.join(root, '.codex', 'skills', 'markdown-bookmark-vault', 'SKILL.md');
    assert.equal(await fs.readFile(attributes, 'utf8'), '* text=auto eol=lf\n');
    assert.equal(await fs.readFile(ignore, 'utf8'), '.DS_Store\n');
    assert.deepEqual(JSON.parse(await fs.readFile(schema, 'utf8')), { schema_version: BOOKMARK_SCHEMA_VERSION });
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

test('migrates legacy save attributes and repairs definite tag contamination once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-migration-'));
  const directory = path.join(root, 'bookmarks', '2026', '09');
  const file = path.join(directory, 'legacy-bookmark.md');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(root, '.gitignore'), 'local-cache/\n', 'utf8');
  await fs.writeFile(file, `---
id: legacy
url: "https://example.test/legacy#section"
title: "Legacy bookmark"
contexts:
  - "work"
tags:
  - "reference"
  - "work"
  - "2026-09-01T10:00:00.000Z"
saved_at: 2026-09-01T09:00:00.000Z
first_opened_at: 2026-09-01T09:00:00.000Z
last_opened_at: 2026-09-01T10:00:00.000Z
access_count: 2
save_history:
  - "2026-09-01T09:00:00.000Z"
  - "2026-09-01T10:00:00.000Z"
custom_field: "preserved"
---

## Summary

Legacy data.
`, 'utf8');

  const first = await migrateVault(root);
  const migrated = await fs.readFile(file, 'utf8');
  assert.equal(first.fromSchemaVersion, 0);
  assert.equal(first.schemaVersion, BOOKMARK_SCHEMA_VERSION);
  assert.deepEqual(first.migrationsRun, [{
    script: '001-bookmark-schema-v1.js',
    fromVersion: 0,
    toVersion: 1
  }]);
  assert.equal(first.scanned, 1);
  assert.equal(first.migrated, 1);
  assert.equal(first.repairedTags, 1);
  assert.equal(first.ambiguousContextTags, 1);
  assert.equal(first.skipped, false);
  assert.match(migrated, new RegExp(`schema_version: ${BOOKMARK_SCHEMA_VERSION}`));
  assert.match(migrated, /canonical_url: "https:\/\/example\.test\/legacy"/);
  assert.match(migrated, /type: "bookmark"/);
  assert.match(migrated, /first_saved_at: "2026-09-01T09:00:00.000Z"/);
  assert.match(migrated, /last_saved_at: "2026-09-01T10:00:00.000Z"/);
  assert.match(migrated, /save_count: 2/);
  assert.match(migrated, /custom_field: "preserved"/);
  assert.doesNotMatch(migrated, /first_opened_at:|last_opened_at:|access_count:/);
  assert.deepEqual(metadataList(migrated, 'tags'), ['reference', 'work']);
  assert.deepEqual(metadataList(migrated, 'contexts'), ['work']);
  assert.equal(await fs.readFile(path.join(root, '.gitignore'), 'utf8'), 'local-cache/\n.DS_Store\n');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, '.markdown-bookmarks.json'), 'utf8')),
    { schema_version: BOOKMARK_SCHEMA_VERSION });

  const second = await migrateVault(root);
  assert.equal(second.skipped, true);
  assert.deepEqual(second.migrationsRun, []);
  assert.equal(second.scanned, 0);
  assert.equal(second.migrated, 0);
  assert.equal(await fs.readFile(file, 'utf8'), migrated);
});

test('does not advance the vault schema checkpoint when a migration fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-failed-migration-'));
  const directory = path.join(root, 'bookmarks');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'invalid.md'), `---
id: invalid
url: "https://example.test/invalid"
title: "Missing saved date"
tags:
  []
---
`, 'utf8');
  await assert.rejects(() => migrateVault(root), /without saved_at/);
  await assert.rejects(() => fs.access(path.join(root, '.markdown-bookmarks.json')), { code: 'ENOENT' });
});

test('rejects a vault schema newer than the application supports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-future-schema-'));
  await fs.writeFile(path.join(root, '.markdown-bookmarks.json'),
    `${JSON.stringify({ schema_version: BOOKMARK_SCHEMA_VERSION + 1 })}\n`, 'utf8');
  await assert.rejects(() => migrateVault(root), /newer than supported/);
});

test('installs the LLM skill inside the selected vault', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-skill-'));
  const previousSkillSource = process.env.SKILL_SOURCE;
  process.env.SKILL_SOURCE = path.resolve('skills', 'markdown-bookmark-vault', 'SKILL.md');
  try {
    const target = await installVaultSkill(root);
    assert.equal(target, path.join(root, '.codex', 'skills', 'markdown-bookmark-vault', 'SKILL.md'));
    assert.equal((await fs.stat(target)).isFile(), true);
  } finally {
    if (previousSkillSource === undefined) delete process.env.SKILL_SOURCE;
    else process.env.SKILL_SOURCE = previousSkillSource;
  }
});

test('saves tagged bookmark and finds it through the CLI index path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-'));
  const saved = await saveBookmark({ url: 'https://example.test/postgres', title: 'Postgres Guide', tags: ['work', 'database'] }, root);
  const content = await fs.readFile(saved.file, 'utf8');
  assert.match(content, new RegExp(`schema_version: ${BOOKMARK_SCHEMA_VERSION}`));
  assert.match(content, /- "work"/);
  assert.match(content, /- "database"/);
  assert.match(content, /first_saved_at:/);
  assert.match(content, /last_saved_at:/);
  assert.doesNotMatch(content, /first_opened_at:|last_opened_at:/);
  const found = await findBookmarks('postgres', root);
  assert.equal(found.length, 1);
});

test('reuses an existing bookmark and merges tags on duplicate save', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-dedupe-'));
  const first = await saveBookmark({
    url: 'https://example.test/page/#section', title: 'Example', contexts: ['work'], tags: ['first']
  }, root);
  const second = await saveBookmark({
    url: 'https://example.test/page/', title: 'Example again', contexts: ['travel'], tags: ['second']
  }, root);
  assert.equal(second.file, first.file);
  assert.equal(second.duplicate, true);
  const content = await fs.readFile(first.file, 'utf8');
  assert.match(content, /- "first"/);
  assert.match(content, /- "second"/);
  assert.match(content, /save_count: 2/);
  assert.match(content, /save_history:\n(?: {2}- .*\n){2}/);
  assert.doesNotMatch(content, /access_count:/);
  assert.deepEqual(metadataList(content, 'tags'), ['first', 'second']);
  assert.deepEqual(metadataList(content, 'contexts'), ['work', 'travel']);
  assert.equal(metadataList(content, 'tags').some((tag) => metadataList(content, 'save_history').includes(tag)), false);
});

test('records each save timestamp in save history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-history-'));
  const saved = await saveBookmark({ url: 'https://example.test/history', title: 'History' }, root);
  const first = await fs.readFile(saved.file, 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 2));
  await saveBookmark({ url: 'https://example.test/history', title: 'History' }, root);
  const second = await fs.readFile(saved.file, 'utf8');
  assert.match(first, /save_count: 1/);
  assert.match(second, /save_count: 2/);
  const firstHistory = first.match(/^save_history:\n((?: {2}- .*\n)+)/m)?.[1];
  const secondHistory = second.match(/^save_history:\n((?: {2}- .*\n)+)/m)?.[1];
  assert.equal((secondHistory?.match(/^ {2}- /gm) || []).length, 2);
  assert.notEqual(firstHistory, secondHistory);
});

test('filters bookmark search by saved time', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-time-'));
  await saveBookmark({ id: 'old', url: 'https://example.test/old', title: 'Amiga old', saved_at: '2020-01-01T00:00:00.000Z' }, root);
  await saveBookmark({ id: 'new', url: 'https://example.test/new', title: 'Amiga new', saved_at: new Date().toISOString() }, root);
  assert.equal((await findBookmarks('amiga', root, { savedSince: '2025-01-01' })).length, 1);
  assert.equal((await findBookmarks('amiga', root, { savedWithin: 'year' })).length, 1);
});

test('stores non-LLM page metadata and context', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-metadata-'));
  const saved = await saveBookmark({
    url: 'https://example.test/article', title: 'Article', contexts: ['work'], tags: ['reference'],
    author: 'Example Author', published_at: '2026-08-28', published_at_source: 'article-meta',
    published_at_confidence: 'high', summary: 'A deterministic page summary.'
  }, root);
  const content = await fs.readFile(saved.file, 'utf8');
  assert.match(content, /contexts:\n {2}- "work"/);
  assert.match(content, /author: "Example Author"/);
  assert.match(content, /published_at: 2026-08-28/);
  assert.match(content, /published_at_source: article-meta/);
  assert.match(content, /A deterministic page summary/);
});

test('applies GitHub and YouTube site plugins', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-sites-'));
  const github = await saveBookmark({ url: 'https://github.com/rib1/uade-docker/tree/main/.agents', title: 'UADE agents', tags: ['amiga'] }, root);
  const youtube = await saveBookmark({ url: 'https://www.youtube.com/watch?v=abc123', title: 'Amiga demo', tags: ['music'] }, root);
  const githubContent = await fs.readFile(github.file, 'utf8');
  const youtubeContent = await fs.readFile(youtube.file, 'utf8');
  assert.match(githubContent, /type: bookmark/);
  assert.match(githubContent, /site: github/);
  assert.match(githubContent, /repository: "rib1\/uade-docker"/);
  assert.match(githubContent, /author: "rib1"/);
  assert.match(githubContent, /- "github"/);
  assert.match(youtubeContent, /type: video/);
  assert.match(youtubeContent, /site: youtube/);
  assert.match(youtubeContent, /video_id: "abc123"/);
  assert.match(youtubeContent, /- "youtube"/);
});

test('backfills site metadata when a legacy bookmark is saved again', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-legacy-site-'));
  const saved = await saveBookmark({ url: 'https://github.com/rib1/uade-docker', title: 'UADE' }, root);
  let content = await fs.readFile(saved.file, 'utf8');
  content = content.replace(/^type:.*\n|^site:.*\n|^repository:.*\n|^author:.*\n/gm, '');
  await fs.writeFile(saved.file, content, 'utf8');
  await saveBookmark({ url: 'https://github.com/rib1/uade-docker', title: 'UADE' }, root);
  content = await fs.readFile(saved.file, 'utf8');
  assert.match(content, /site: "github"/);
  assert.match(content, /repository: "rib1\/uade-docker"/);
  assert.match(content, /author: "rib1"/);
});

test('Mural bookmarks default to work context', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-mural-'));
  const saved = await saveBookmark({ url: 'https://app.mural.co/t/team123/m/team456', title: 'Project workshop' }, root);
  let content = await fs.readFile(saved.file, 'utf8');
  assert.match(content, /type: whiteboard/);
  assert.match(content, /site: mural/);
  assert.match(content, /contexts:\n {2}- "work"/);
  assert.match(content, /- "mural"/);

  await saveBookmark({ url: 'https://app.mural.co/t/team123/m/team456', title: 'Project workshop', contexts: ['personal'] }, root);
  content = await fs.readFile(saved.file, 'utf8');
  assert.match(content, /- "work"/);
  assert.match(content, /- "personal"/);
});

test('applies Confluence and Jira site plugins', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-atlassian-'));
  const confluence = await saveBookmark({
    url: 'https://team.atlassian.net/wiki/spaces/ENG/pages/12345/Release+notes', title: 'Release notes'
  }, root);
  const jira = await saveBookmark({
    url: 'https://team.atlassian.net/browse/ENG-42', title: 'Fix bookmark sync', tags: ['important']
  }, root);
  const confluenceContent = await fs.readFile(confluence.file, 'utf8');
  const jiraContent = await fs.readFile(jira.file, 'utf8');
  assert.match(confluenceContent, /site: confluence/);
  assert.match(confluenceContent, /type: page/);
  assert.match(confluenceContent, /contexts:\n {2}- "work"/);
  assert.match(confluenceContent, /space_key: "ENG"/);
  assert.match(confluenceContent, /page_id: "12345"/);
  assert.match(confluenceContent, /- "confluence"/);
  assert.match(jiraContent, /site: jira/);
  assert.match(jiraContent, /type: issue/);
  assert.match(jiraContent, /contexts:\n {2}- "work"/);
  assert.match(jiraContent, /issue_key: "ENG-42"/);
  assert.match(jiraContent, /project_key: "ENG"/);
  assert.match(jiraContent, /- "jira"/);
  assert.match(jiraContent, /- "important"/);

  const personalJira = await saveBookmark({
    url: 'https://team.atlassian.net/browse/ENG-43', title: 'Personal issue', contexts: ['personal']
  }, root);
  const personalContent = await fs.readFile(personalJira.file, 'utf8');
  assert.match(personalContent, /contexts:\n {2}- "personal"/);
  assert.doesNotMatch(personalContent, /contexts:\n {2}- "work"/);
});

test('backfills Jira metadata on duplicate save', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-jira-legacy-'));
  const saved = await saveBookmark({ url: 'https://team.atlassian.net/browse/OPS-7', title: 'Incident' }, root);
  let content = await fs.readFile(saved.file, 'utf8');
  content = content.replace(/^type:.*\n|^site:.*\n|^issue_key:.*\n|^project_key:.*\n/gm, '');
  await fs.writeFile(saved.file, content, 'utf8');
  await saveBookmark({ url: 'https://team.atlassian.net/browse/OPS-7', title: 'Incident' }, root);
  content = await fs.readFile(saved.file, 'utf8');
  assert.match(content, /site: "jira"/);
  assert.match(content, /issue_key: "OPS-7"/);
  assert.match(content, /project_key: "OPS"/);
});
