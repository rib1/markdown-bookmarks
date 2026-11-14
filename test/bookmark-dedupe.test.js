import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readList, readScalar } from '../src/bookmark-format.js';
import {
  applyDedupePlan,
  BookmarkDedupeError,
  createDedupePlan,
  dedupeVaultBookmarks
} from '../src/bookmark-dedupe.js';
import { addProjectBookmark, createProject, projectBookmarks } from '../src/projects.js';
import { initVault, saveBookmark } from '../src/vault.js';
import { inspectVaultStatus } from '../src/vault-status.js';

async function writeRawBookmark(root, month, filename, content) {
  const directory = path.join(root, 'bookmarks', '2026', month);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, filename);
  await fs.writeFile(file, content, 'utf8');
  return file;
}

test('dedupe previews and merges duplicate bookmarks while preserving metadata, notes, history, and project links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-dedupe-test-'));
  await initVault(root);

  const earliestFile = await writeRawBookmark(root, '08', 'early-yt.md', `---
schema_version: 2
id: "early-yt"
url: "https://youtu.be/dQw4w9WgXcQ?feature=share"
canonical_url: "https://youtu.be/dQw4w9WgXcQ?feature=share"
title: "https://youtu.be/dQw4w9WgXcQ?feature=share"
type: "bookmark"
contexts:
  - "personal"
tags:
  - "Music"
  - "synth"
share_history:
  - {"id":"share-1","sender":"Alice","channel":"Signal","received_at":"2026-08-10T09:00:00.000Z","source":"manual","confidence":"confirmed"}
capture_history:
  - {"id":"cap-1","saved_at":"2026-08-10T09:00:00.000Z","client":"browser-extension","device":"home-mac","os":"mac"}
saved_at: "2026-08-10T09:00:00.000Z"
first_saved_at: "2026-08-10T09:00:00.000Z"
last_saved_at: "2026-08-10T09:00:00.000Z"
save_count: 1
save_history:
  - "2026-08-10T09:00:00.000Z"
---

## Summary

Initial note from August.
`);

  const laterFile = await writeRawBookmark(root, '09', 'later-yt.md', `---
schema_version: 4
id: "later-yt"
url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=newsletter"
canonical_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
title: "Rick Astley - Never Gonna Give You Up"
type: "video"
contexts:
  - "hobby"
areas:
  - "music-archive"
tags:
  - "eighties"
  - "music"
duplicate:
  - "early-yt"
author: "Rick Astley"
published_at: "2009-10-25"
published_at_source: "meta"
published_at_confidence: "high"
share_history:
  - {"id":"share-2","sender":"Bob","channel":"Email","received_at":"2026-09-15T12:00:00.000Z","source":"manual","confidence":"confirmed"}
capture_history:
  - {"id":"cap-2","saved_at":"2026-09-15T12:00:00.000Z","client":"browser-extension","device":"work-win","os":"win"}
saved_at: "2026-09-15T12:00:00.000Z"
first_saved_at: "2026-09-15T12:00:00.000Z"
last_saved_at: "2026-09-16T14:00:00.000Z"
save_count: 2
save_history:
  - "2026-09-15T12:00:00.000Z"
  - "2026-09-16T14:00:00.000Z"
custom_field: "preserved-from-duplicate"
---

## Summary

Second note from September save.
`);

  const relatedBookmark = await saveBookmark({
    id: 'related-item',
    url: 'https://example.test/music-history',
    title: 'Music history',
    tags: ['music'],
    saved_at: '2026-09-20T10:00:00.000Z'
  }, root);
  await fs.writeFile(
    relatedBookmark.file,
    (await fs.readFile(relatedBookmark.file, 'utf8')).replace(
      'tags:\n',
      'references:\n  - "later-yt"\ntags:\n'
    ),
    'utf8'
  );

  await createProject({ id: 'retro-talk', title: 'Retro Talk' }, root);
  await addProjectBookmark('retro-talk', 'early-yt', root, { note: 'Opening cue' });
  await addProjectBookmark('retro-talk', 'later-yt', root, { note: 'Follow-up cue' });
  await addProjectBookmark('retro-talk', 'related-item', root);

  const beforeEarly = await fs.readFile(earliestFile, 'utf8');
  const preview = await dedupeVaultBookmarks(root);
  assert.equal(preview.applied, false);
  assert.equal(preview.bookmarkCount, 3);
  assert.equal(preview.groups.length, 1);
  assert.equal(preview.groups[0].canonicalUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(preview.groups[0].keep.id, 'early-yt');
  assert.deepEqual(preview.groups[0].remove.map((item) => item.id), ['later-yt']);
  assert.equal(preview.groups[0].notesMerged, true);
  assert.equal(preview.projectEdits.length, 1);
  assert.equal(await fs.readFile(earliestFile, 'utf8'), beforeEarly);

  const applied = await dedupeVaultBookmarks(root, { apply: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.removed.length, 1);
  await assert.rejects(() => fs.access(laterFile), { code: 'ENOENT' });

  const mergedContent = await fs.readFile(earliestFile, 'utf8');
  assert.equal(readScalar(mergedContent, 'id'), 'early-yt');
  assert.equal(readScalar(mergedContent, 'canonical_url'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(readScalar(mergedContent, 'title'), 'Rick Astley - Never Gonna Give You Up');
  assert.equal(readScalar(mergedContent, 'type'), 'video');
  assert.equal(readScalar(mergedContent, 'site'), 'youtube');
  assert.equal(readScalar(mergedContent, 'video_id'), 'dQw4w9WgXcQ');
  assert.equal(readScalar(mergedContent, 'author'), 'Rick Astley');
  assert.equal(readScalar(mergedContent, 'published_at'), '2009-10-25');
  assert.equal(readScalar(mergedContent, 'published_at_source'), 'meta');
  assert.equal(readScalar(mergedContent, 'published_at_confidence'), 'high');
  assert.equal(readScalar(mergedContent, 'custom_field'), 'preserved-from-duplicate');
  assert.equal(readScalar(mergedContent, 'first_saved_at'), '2026-08-10T09:00:00.000Z');
  assert.equal(readScalar(mergedContent, 'last_saved_at'), '2026-09-16T14:00:00.000Z');
  assert.equal(readScalar(mergedContent, 'save_count'), 3);
  assert.deepEqual(readList(mergedContent, 'save_history'), [
    '2026-08-10T09:00:00.000Z',
    '2026-09-15T12:00:00.000Z',
    '2026-09-16T14:00:00.000Z'
  ]);
  assert.deepEqual(readList(mergedContent, 'contexts'), ['personal', 'hobby']);
  assert.deepEqual(readList(mergedContent, 'areas'), ['music-archive']);
  assert.deepEqual(readList(mergedContent, 'projects'), ['retro-talk']);
  assert.deepEqual(readList(mergedContent, 'tags'), ['music', 'synth', 'eighties', 'youtube']);
  assert.deepEqual(readList(mergedContent, 'duplicate'), []);
  assert.equal(readList(mergedContent, 'share_history').length, 2);
  assert.equal(readList(mergedContent, 'capture_history').length, 2);
  assert.match(mergedContent, /Initial note from August\.\n\nSecond note from September save\./);

  const updatedRelated = await fs.readFile(relatedBookmark.file, 'utf8');
  assert.deepEqual(readList(updatedRelated, 'references'), ['early-yt']);

  const projectView = await projectBookmarks('retro-talk', root);
  assert.deepEqual(projectView.entries.map((entry) => ({
    id: entry.id,
    missing: Boolean(entry.missing),
    notes: entry.notes
  })), [
    { id: 'early-yt', missing: false, notes: ['Opening cue', 'Follow-up cue'] },
    { id: 'related-item', missing: false, notes: [] }
  ]);

  const status = await inspectVaultStatus(root);
  assert.equal(status.health.duplicateUrls, 0);

  const rerun = await dedupeVaultBookmarks(root, { apply: true });
  assert.equal(rerun.applied, false);
  assert.deepEqual(rerun.groups, []);
});

test('dedupe detects concurrent modifications and fails visibly on malformed metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-dedupe-safety-'));
  await initVault(root);
  const firstFile = await writeRawBookmark(root, '09', 'first.md', `---
id: "first"
url: "https://example.test/article#part-1"
title: "Article"
tags:
  - "news"
saved_at: "2026-09-01T10:00:00.000Z"
---

## Summary

First note.
`);
  const secondFile = await writeRawBookmark(root, '09', 'second.md', `---
id: "second"
url: "https://example.test/article?utm_source=feed"
title: "Article"
tags:
  - "reading"
saved_at: "2026-09-02T10:00:00.000Z"
---

## Summary

Second note.
`);

  const plan = await createDedupePlan(root);
  assert.equal(plan.groups.length, 1);
  await fs.appendFile(secondFile, '\nConcurrent edit before apply.\n', 'utf8');
  await assert.rejects(
    () => applyDedupePlan(plan),
    (error) => error instanceof BookmarkDedupeError && error.code === 'concurrent_change'
  );
  assert.match(await fs.readFile(secondFile, 'utf8'), /Concurrent edit before apply/);
  assert.match(await fs.readFile(firstFile, 'utf8'), /First note\./);

  await fs.writeFile(secondFile, `---
id: "second"
url: "https://example.test/article"
title: "Article"
tags:
  - "reading"
saved_at: "not-a-valid-date"
---
`, 'utf8');
  await assert.rejects(
    () => createDedupePlan(root),
    (error) => error instanceof BookmarkDedupeError && error.code === 'invalid_saved_at'
  );
});
