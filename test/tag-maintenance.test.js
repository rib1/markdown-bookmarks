import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readList } from '../src/bookmark-format.js';
import {
  applyTagFixPlan,
  createTagFixPlan,
  fixVaultTags,
  lintVaultTags,
  TagMaintenanceError
} from '../src/tag-maintenance.js';

function bookmark(id, tags) {
  return `---\nid: ${id}\ntags:\n${tags.map((tag) => `  - ${JSON.stringify(tag)}`).join('\n') || '  []'}\n---\n\nNotes stay unchanged.\n`;
}

async function fixture(records) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-tag-maintenance-'));
  const directory = path.join(root, 'bookmarks', '2026', '09');
  await fs.mkdir(directory, { recursive: true });
  const files = {};
  for (const [id, tags] of records) {
    const file = path.join(directory, `${id}.md`);
    await fs.writeFile(file, bookmark(id, tags), 'utf8');
    files[id] = file;
  }
  return { root, files };
}

test('vault tag lint reports counts, IDs, relative files, and overlap without writing', async () => {
  const { root, files } = await fixture([
    ['one', ['wordpres', 'wordpress']],
    ['two', ['wordpres']],
    ['three', ['wordpress']],
    ['four', ['wordpress']],
    ['five', ['wordpress']]
  ]);
  const before = await fs.readFile(files.one, 'utf8');
  const report = await lintVaultTags(root);
  assert.equal(report.bookmarkCount, 5);
  assert.equal(report.tagCount, 2);
  assert.equal(report.candidates.length, 1);
  assert.equal(report.likelyCandidates.length, 1);
  assert.equal(report.candidates[0].source.tag, 'wordpres');
  assert.deepEqual(report.candidates[0].overlap.map((record) => record.id), ['one']);
  assert.match(report.candidates[0].left.records[0].file, /^bookmarks\/2026\/09\//);
  assert.equal(await fs.readFile(files.one, 'utf8'), before);
});

test('tag fix previews, replaces, removes duplicates, and reruns idempotently', async () => {
  const { root, files } = await fixture([
    ['one', ['wordpres', 'wordpress', 'reference']],
    ['two', ['wordpres', 'cms']],
    ['three', ['wordpress']]
  ]);
  const before = await fs.readFile(files.one, 'utf8');
  const preview = await fixVaultTags(root, { from: 'wordpres', to: 'wordpress' });
  assert.equal(preview.applied, false);
  assert.deepEqual(preview.edits.map((edit) => edit.action), ['remove-duplicate', 'replace']);
  assert.equal(await fs.readFile(files.one, 'utf8'), before);

  const applied = await fixVaultTags(root, { from: 'wordpres', to: 'wordpress', apply: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.changed.length, 2);
  assert.deepEqual(readList(await fs.readFile(files.one, 'utf8'), 'tags'), ['wordpress', 'reference']);
  assert.deepEqual(readList(await fs.readFile(files.two, 'utf8'), 'tags'), ['wordpress', 'cms']);
  assert.match(await fs.readFile(files.two, 'utf8'), /Notes stay unchanged/);

  const rerun = await fixVaultTags(root, { from: 'wordpres', to: 'wordpress', apply: true });
  assert.equal(rerun.applied, false);
  assert.deepEqual(rerun.edits, []);
});

test('tag fix rejects unsafe pairs and detects changes made after preview', async () => {
  const { root, files } = await fixture([
    ['one', ['dowload']],
    ['two', ['download']],
    ['three', ['unrelated']]
  ]);
  await assert.rejects(
    () => createTagFixPlan(root, { from: 'dowload', to: 'missing' }),
    (error) => error instanceof TagMaintenanceError && error.code === 'target_not_found'
  );
  await assert.rejects(
    () => createTagFixPlan(root, { from: 'dowload', to: 'unrelated' }),
    (error) => error instanceof TagMaintenanceError && error.code === 'not_lint_candidate'
  );

  const plan = await createTagFixPlan(root, { from: 'dowload', to: 'download' });
  await fs.appendFile(files.one, '\nConcurrent note.\n', 'utf8');
  await assert.rejects(
    () => applyTagFixPlan(plan),
    (error) => error instanceof TagMaintenanceError && error.code === 'concurrent_change'
  );
  assert.match(await fs.readFile(files.one, 'utf8'), /Concurrent note/);
});

test('tag lint fails visibly instead of skipping malformed bookmark metadata', async () => {
  const { root, files } = await fixture([['one', ['valid']]]);
  await fs.writeFile(files.one, '---\nid: one\n---\n', 'utf8');
  await assert.rejects(
    () => lintVaultTags(root),
    (error) => error instanceof TagMaintenanceError && error.code === 'invalid_tags'
  );
});
