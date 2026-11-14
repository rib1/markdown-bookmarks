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
  dedupeVaultBookmarks,
  validateBookmarkContent
} from '../src/bookmark-dedupe.js';
import { addProjectBookmark, createProject, projectBookmarks } from '../src/projects.js';
import { initVault, saveBookmark } from '../src/vault.js';
import { withVaultLock } from '../src/vault-lock.js';
import { inspectVaultStatus } from '../src/vault-status.js';

async function writeRawBookmark(root, month, filename, content) {
  const directory = path.join(root, 'bookmarks', '2026', month);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, filename);
  await fs.writeFile(file, content, 'utf8');
  return file;
}

async function listAllFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listAllFiles(full));
    } else {
      files.push(full);
    }
  }
  return files.sort();
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

test('dedupe preserves replacement-pattern tokens ($&, $$, $`, $\') in custom and standard metadata and validates output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-dedupe-dollars-'));
  await initVault(root);

  const firstFile = await writeRawBookmark(root, '08', 'first.md', `---
id: "first"
url: "https://example.test/pricing#tier"
title: "https://example.test/pricing#tier"
tags:
  - "pricing"
saved_at: "2026-08-01T10:00:00.000Z"
keep_custom: "keep $& $$ $\` $' value"
---

## Summary

Note with $& and $$ tokens.
`);

  await writeRawBookmark(root, '09', 'second.md', `---
id: "second"
url: "https://example.test/pricing?utm_source=ads"
title: "Pricing $& $$ $\` $' Guide"
author: "Author $& $$ $\` $'"
tags:
  - "tier-$&-$$"
saved_at: "2026-09-01T10:00:00.000Z"
custom_amp: "price $& 10"
custom_double: "cost $$ 20"
custom_backtick: "prefix $\` 30"
custom_quote: "suffix $' 40"
custom_list:
  - "item $& 1"
  - "item $$ 2"
  - "item $\` 3"
  - "item $' 4"
custom_object:
  nested_token: "nested $& $$ $\` $' end"
---

## Summary

Second note with $\` and $' tokens.
`);

  const result = await dedupeVaultBookmarks(root, { apply: true });
  assert.equal(result.applied, true);

  const merged = await fs.readFile(firstFile, 'utf8');
  assert.doesNotThrow(() => validateBookmarkContent(merged, 'bookmarks/2026/08/first.md'));
  assert.equal(readScalar(merged, 'title'), 'Pricing $& $$ $` $\' Guide');
  assert.equal(readScalar(merged, 'author'), 'Author $& $$ $` $\'');
  assert.equal(readScalar(merged, 'keep_custom'), 'keep $& $$ $` $\' value');
  assert.equal(readScalar(merged, 'custom_amp'), 'price $& 10');
  assert.equal(readScalar(merged, 'custom_double'), 'cost $$ 20');
  assert.equal(readScalar(merged, 'custom_backtick'), 'prefix $` 30');
  assert.equal(readScalar(merged, 'custom_quote'), 'suffix $\' 40');
  assert.deepEqual(readList(merged, 'custom_list'), [
    'item $& 1',
    'item $$ 2',
    'item $` 3',
    'item $\' 4'
  ]);
  assert.match(merged, /custom_object:\n {2}nested_token: "nested \$& \$\$ \$` \$' end"\n/);

  await assert.rejects(
    async () => {
      const brokenPlan = await createDedupePlan(root);
      brokenPlan.bookmarkEdits = [{
        id: 'first',
        file: 'bookmarks/2026/08/first.md',
        absoluteFile: firstFile,
        originalContent: merged,
        content: merged.replace('custom_amp: "price $& 10"', 'custom_amp: "price custom_amp: "price $& 10" 10"')
      }];
      await applyDedupePlan(brokenPlan);
    },
    (error) => error instanceof BookmarkDedupeError && error.code === 'invalid_frontmatter'
  );
  assert.equal(await fs.readFile(firstFile, 'utf8'), merged);
});

test('dedupe detects concurrent edits injected during rename and deletion without losing data and coordinates with vault lock', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-dedupe-concurrent-'));
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

  const originalFirst = await fs.readFile(firstFile, 'utf8');
  const originalSecond = await fs.readFile(secondFile, 'utf8');

  // 1. Inject note append to duplicate right when rename is called for removal
  const planRenameRace = await createDedupePlan(root);
  let injectedOnRemovalRename = false;
  await assert.rejects(
    () => applyDedupePlan(planRenameRace, {
      fsOps: {
        ...fs,
        rename: async (oldPath, newPath) => {
          if (!injectedOnRemovalRename && oldPath === secondFile) {
            injectedOnRemovalRename = true;
            await fs.appendFile(secondFile, '\nAppended note during rename.\n', 'utf8');
          }
          return fs.rename(oldPath, newPath);
        }
      }
    }),
    (error) => error instanceof BookmarkDedupeError && error.code === 'concurrent_change'
  );
  assert.equal(await fs.readFile(firstFile, 'utf8'), originalFirst);
  assert.equal(await fs.readFile(secondFile, 'utf8'), `${originalSecond}\nAppended note during rename.\n`);

  // Restore secondFile and test injecting note append during unlink (backup deletion)
  await fs.writeFile(secondFile, originalSecond, 'utf8');
  const planUnlinkRace = await createDedupePlan(root);
  let injectedOnUnlink = false;
  await assert.rejects(
    () => applyDedupePlan(planUnlinkRace, {
      fsOps: {
        ...fs,
        unlink: async (targetPath) => {
          if (!injectedOnUnlink) {
            injectedOnUnlink = true;
            await fs.appendFile(secondFile, '\nAppended note during deletion.\n', 'utf8');
          }
          return fs.unlink(targetPath);
        }
      }
    }),
    (error) => error instanceof BookmarkDedupeError && error.code === 'concurrent_change'
  );
  assert.equal(await fs.readFile(firstFile, 'utf8'), originalFirst);
  assert.equal(await fs.readFile(secondFile, 'utf8'), `${originalSecond}\nAppended note during deletion.\n`);

  // Restore secondFile and test injecting note append to kept bookmark during rename
  await fs.writeFile(secondFile, originalSecond, 'utf8');
  const planKeepRace = await createDedupePlan(root);
  let injectedOnKeepRename = false;
  await assert.rejects(
    () => applyDedupePlan(planKeepRace, {
      fsOps: {
        ...fs,
        rename: async (oldPath, newPath) => {
          if (!injectedOnKeepRename && oldPath === firstFile) {
            injectedOnKeepRename = true;
            await fs.appendFile(firstFile, '\nKeep note appended during rename.\n', 'utf8');
          }
          return fs.rename(oldPath, newPath);
        }
      }
    }),
    (error) => error instanceof BookmarkDedupeError && error.code === 'concurrent_change'
  );
  assert.equal(await fs.readFile(firstFile, 'utf8'), `${originalFirst}\nKeep note appended during rename.\n`);
  assert.equal(await fs.readFile(secondFile, 'utf8'), originalSecond);

  // Restore firstFile and verify vault lock serializes companion saveBookmark and dedupe
  await fs.writeFile(firstFile, originalFirst, 'utf8');
  const events = [];
  const lockDone = withVaultLock(root, async () => {
    events.push('lock-acquired');
    await new Promise((resolve) => setTimeout(resolve, 60));
    await saveBookmark({
      id: 'third-concurrent',
      url: 'https://example.test/another-page',
      title: 'Another page',
      tags: ['locked'],
      saved_at: '2026-09-03T10:00:00.000Z'
    }, root);
    events.push('save-finished');
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  const dedupePromise = dedupeVaultBookmarks(root, { apply: true }).then((res) => {
    events.push('dedupe-finished');
    return res;
  });
  const [, dedupeRes] = await Promise.all([lockDone, dedupePromise]);
  assert.deepEqual(events, ['lock-acquired', 'save-finished', 'dedupe-finished']);
  assert.equal(dedupeRes.applied, true);
  assert.equal(dedupeRes.bookmarkCount, 3);
});

test('dedupe rejects new references added in existing or new projects and bookmarks between planning and apply', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-dedupe-refs-'));
  await initVault(root);

  const firstFile = await writeRawBookmark(root, '08', 'first.md', `---
id: "first"
url: "https://example.test/doc"
title: "Doc"
tags:
  - "docs"
saved_at: "2026-08-01T10:00:00.000Z"
---
`);
  const secondFile = await writeRawBookmark(root, '09', 'second.md', `---
id: "second"
url: "https://example.test/doc?utm_source=ref"
title: "Doc Duplicate"
tags:
  - "docs"
saved_at: "2026-09-01T10:00:00.000Z"
---
`);
  const unaffectedBookmark = await saveBookmark({
    id: 'unaffected-bm',
    url: 'https://example.test/other',
    title: 'Other',
    tags: ['other'],
    saved_at: '2026-09-02T10:00:00.000Z'
  }, root);
  const unaffectedProject = await createProject({ id: 'unaffected-proj', title: 'Unaffected Project' }, root);
  await addProjectBookmark('unaffected-proj', 'unaffected-bm', root);

  // Case 1: Existing previously unaffected project adds reference to duplicate after planning
  const plan1 = await createDedupePlan(root);
  assert.equal(plan1.projectEdits.length, 0);
  await addProjectBookmark('unaffected-proj', 'second', root);
  await assert.rejects(
    () => applyDedupePlan(plan1),
    (error) => error instanceof BookmarkDedupeError && error.code === 'concurrent_change'
  );
  // Duplicate bookmark must still exist so reference is not dangling
  await fs.access(secondFile);

  // Clean up reference from unaffected-proj for Case 2
  const plan1Refreshed = await createDedupePlan(root);
  assert.equal(plan1Refreshed.projectEdits.length, 1);

  // Case 2: New project created after planning referencing duplicate bookmark
  const plan2 = await createDedupePlan(root);
  const newProject = await createProject({ id: 'new-proj', title: 'New Project' }, root);
  await addProjectBookmark('new-proj', 'second', root);
  await assert.rejects(
    () => applyDedupePlan(plan2),
    (error) => error instanceof BookmarkDedupeError && error.code === 'concurrent_change'
  );
  await fs.access(secondFile);
  await fs.rm(newProject.file);
  // Remove new-proj from secondFile's projects list
  await fs.writeFile(
    secondFile,
    (await fs.readFile(secondFile, 'utf8')).replace('  - "new-proj"\n', ''),
    'utf8'
  );

  // Case 3: Existing unaffected bookmark adds relationship reference to duplicate after planning
  const plan3 = await createDedupePlan(root);
  const beforeUnaffectedBm = await fs.readFile(unaffectedBookmark.file, 'utf8');
  await fs.writeFile(
    unaffectedBookmark.file,
    beforeUnaffectedBm.replace('tags:\n', 'references:\n  - "second"\ntags:\n'),
    'utf8'
  );
  await assert.rejects(
    () => applyDedupePlan(plan3),
    (error) => error instanceof BookmarkDedupeError && error.code === 'concurrent_change'
  );
  await fs.access(secondFile);
  await fs.writeFile(unaffectedBookmark.file, beforeUnaffectedBm, 'utf8');

  // Case 4: New bookmark added after planning referencing duplicate bookmark
  const plan4 = await createDedupePlan(root);
  const addedBmFile = await writeRawBookmark(root, '09', 'added-after-plan.md', `---
id: "added-after-plan"
url: "https://example.test/brand-new"
title: "Brand New"
references:
  - "second"
tags:
  - "new"
saved_at: "2026-09-05T10:00:00.000Z"
---
`);
  await assert.rejects(
    () => applyDedupePlan(plan4),
    (error) => error instanceof BookmarkDedupeError && error.code === 'concurrent_change'
  );
  await fs.access(secondFile);
  await fs.access(firstFile);

  // Re-planning now rewrites all references across unaffected-proj and added-after-plan cleanly
  const finalResult = await dedupeVaultBookmarks(root, { apply: true });
  assert.equal(finalResult.applied, true);
  assert.deepEqual(readList(await fs.readFile(addedBmFile, 'utf8'), 'references'), ['first']);
  const projView = await projectBookmarks('unaffected-proj', root);
  assert.deepEqual(projView.entries.map((entry) => entry.id), ['unaffected-bm', 'first']);
  assert.equal(projView.entries.every((entry) => !entry.missing), true);
  assert.ok(unaffectedProject.file);
});

test('dedupe aborts without changing files on conflicting scalar, list, or object custom fields', async () => {
  for (const [label, fieldA, fieldB] of [
    ['scalar', 'custom_scalar: "alpha"', 'custom_scalar: "beta"'],
    ['list', 'custom_list:\n  - "one"\n  - "two"', 'custom_list:\n  - "one"\n  - "three"'],
    ['object', 'custom_obj:\n  nested: "left"', 'custom_obj:\n  nested: "right"'],
    ['scalar-vs-list', 'custom_mixed: "scalar"', 'custom_mixed:\n  - "list-item"']
  ]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `markdown-bookmarks-conflict-${label}-`));
    await initVault(root);
    const firstFile = await writeRawBookmark(root, '08', 'first.md', `---
id: "first"
url: "https://example.test/conflict"
title: "Conflict ${label}"
tags:
  - "test"
saved_at: "2026-08-01T10:00:00.000Z"
${fieldA}
---
`);
    const secondFile = await writeRawBookmark(root, '09', 'second.md', `---
id: "second"
url: "https://example.test/conflict?utm_source=x"
title: "Conflict ${label}"
tags:
  - "test"
saved_at: "2026-09-01T10:00:00.000Z"
${fieldB}
---
`);
    const beforeFirst = await fs.readFile(firstFile, 'utf8');
    const beforeSecond = await fs.readFile(secondFile, 'utf8');

    await assert.rejects(
      () => dedupeVaultBookmarks(root, { apply: true }),
      (error) => error instanceof BookmarkDedupeError && error.code === 'conflicting_metadata'
    );
    assert.equal(await fs.readFile(firstFile, 'utf8'), beforeFirst);
    assert.equal(await fs.readFile(secondFile, 'utf8'), beforeSecond);
  }
});

test('dedupe rejects conflicting share/capture event IDs and deduplicates identical event IDs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-events-'));
  await initVault(root);

  const firstFile = await writeRawBookmark(root, '08', 'first.md', `---
id: "first"
url: "https://example.test/shared"
title: "Shared"
tags:
  - "shared"
share_history:
  - {"id":"share-same","sender":"Alice","channel":"Signal","received_at":"2026-08-01T10:00:00.000Z","source":"manual","confidence":"confirmed"}
capture_history:
  - {"id":"cap-same","saved_at":"2026-08-01T10:00:00.000Z","client":"browser-extension","device":"macbook","os":"mac"}
saved_at: "2026-08-01T10:00:00.000Z"
---
`);
  const secondFile = await writeRawBookmark(root, '09', 'second.md', `---
id: "second"
url: "https://example.test/shared?utm_source=chat"
title: "Shared"
tags:
  - "shared"
share_history:
  - {"id":"share-same","sender":"Bob","channel":"Slack","received_at":"2026-09-01T10:00:00.000Z","source":"manual","confidence":"confirmed"}
capture_history:
  - {"id":"cap-same","saved_at":"2026-08-01T10:00:00.000Z","client":"browser-extension","device":"macbook","os":"mac"}
saved_at: "2026-09-01T10:00:00.000Z"
---
`);

  const beforeFirst = await fs.readFile(firstFile, 'utf8');
  const beforeSecond = await fs.readFile(secondFile, 'utf8');
  await assert.rejects(
    () => dedupeVaultBookmarks(root, { apply: true }),
    (error) => error instanceof BookmarkDedupeError && error.code === 'conflicting_share_event'
  );
  assert.equal(await fs.readFile(firstFile, 'utf8'), beforeFirst);
  assert.equal(await fs.readFile(secondFile, 'utf8'), beforeSecond);

  // Now make share-same identical, but make cap-same conflict
  await fs.writeFile(secondFile, `---
id: "second"
url: "https://example.test/shared?utm_source=chat"
title: "Shared"
tags:
  - "shared"
share_history:
  - {"id":"share-same","sender":"Alice","channel":"Signal","received_at":"2026-08-01T10:00:00.000Z","source":"manual","confidence":"confirmed"}
capture_history:
  - {"id":"cap-same","saved_at":"2026-09-01T10:00:00.000Z","client":"browser-extension","device":"win-pc","os":"win"}
saved_at: "2026-09-01T10:00:00.000Z"
---
`, 'utf8');
  const beforeSecondCapConflict = await fs.readFile(secondFile, 'utf8');
  await assert.rejects(
    () => dedupeVaultBookmarks(root, { apply: true }),
    (error) => error instanceof BookmarkDedupeError && error.code === 'conflicting_capture_event'
  );
  assert.equal(await fs.readFile(firstFile, 'utf8'), beforeFirst);
  assert.equal(await fs.readFile(secondFile, 'utf8'), beforeSecondCapConflict);

  // When both share-same and cap-same have matching provenance, dedupe succeeds and preserves provenance
  await fs.writeFile(secondFile, `---
id: "second"
url: "https://example.test/shared?utm_source=chat"
title: "Shared"
tags:
  - "shared"
share_history:
  - {"id":"share-same","sender":"Alice","channel":"Signal","received_at":"2026-08-01T10:00:00.000Z","source":"manual","confidence":"confirmed"}
capture_history:
  - {"id":"cap-same","saved_at":"2026-08-01T10:00:00.000Z","client":"browser-extension","device":"macbook","os":"mac"}
saved_at: "2026-09-01T10:00:00.000Z"
---
`, 'utf8');
  const mergedResult = await dedupeVaultBookmarks(root, { apply: true });
  assert.equal(mergedResult.applied, true);
  const mergedContent = await fs.readFile(firstFile, 'utf8');
  assert.equal(readList(mergedContent, 'share_history').length, 1);
  assert.equal(readList(mergedContent, 'capture_history').length, 1);
});

test('dedupe keeps publication date, source, and confidence from the same evidence record without mixing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-pubdate-'));
  await initVault(root);

  // Earliest has published_at + source "manual" (no confidence); duplicate has different date + source "json-ld" + confidence "high"
  const firstFile = await writeRawBookmark(root, '08', 'first.md', `---
id: "first"
url: "https://example.test/post"
title: "Post"
tags:
  - "blog"
published_at: "2024-05-01"
published_at_source: "manual"
saved_at: "2026-08-01T10:00:00.000Z"
---
`);
  await writeRawBookmark(root, '09', 'second.md', `---
id: "second"
url: "https://example.test/post?utm_source=rss"
title: "Post"
tags:
  - "blog"
published_at: "2024-05-02"
published_at_source: "json-ld"
published_at_confidence: "high"
saved_at: "2026-09-01T10:00:00.000Z"
---
`);

  await dedupeVaultBookmarks(root, { apply: true });
  const merged = await fs.readFile(firstFile, 'utf8');
  assert.equal(readScalar(merged, 'published_at'), '2024-05-01');
  assert.equal(readScalar(merged, 'published_at_source'), 'manual');
  assert.equal(readScalar(merged, 'published_at_confidence'), undefined);

  // Case 2: Earliest has stray published_at_source without published_at; duplicate has published_at + published_at_confidence "medium"
  const thirdFile = await writeRawBookmark(root, '08', 'third.md', `---
id: "third"
url: "https://example.test/post-2"
title: "Post 2"
tags:
  - "blog"
published_at_source: "stray-source"
saved_at: "2026-08-01T10:00:00.000Z"
---
`);
  await writeRawBookmark(root, '09', 'fourth.md', `---
id: "fourth"
url: "https://example.test/post-2?ref=home"
title: "Post 2"
tags:
  - "blog"
published_at: "2025-01-15"
published_at_confidence: "medium"
saved_at: "2026-09-01T10:00:00.000Z"
---
`);

  await dedupeVaultBookmarks(root, { apply: true });
  const mergedThird = await fs.readFile(thirdFile, 'utf8');
  assert.equal(readScalar(mergedThird, 'published_at'), '2025-01-15');
  assert.equal(readScalar(mergedThird, 'published_at_source'), undefined);
  assert.equal(readScalar(mergedThird, 'published_at_confidence'), 'medium');
});

test('dedupe handles equal timestamps, same-ID copies across directories, and multiple duplicate groups', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-multi-groups-'));
  await initVault(root);

  // Group 1: Equal timestamps -> tie-break by relative vault path
  const eqA = await writeRawBookmark(root, '08', 'a-equal.md', `---
id: "z-id"
url: "https://example.test/equal"
title: "Equal A"
tags:
  - "alpha"
saved_at: "2026-08-01T10:00:00.000Z"
---
`);
  const eqB = await writeRawBookmark(root, '08', 'b-equal.md', `---
id: "a-id"
url: "https://example.test/equal?utm_medium=social"
title: "Equal B"
tags:
  - "beta"
saved_at: "2026-08-01T10:00:00.000Z"
---
`);

  // Group 2: Same-ID copies in different month directories
  const sameIdEarly = await writeRawBookmark(root, '07', 'same-id.md', `---
id: "same-id"
url: "https://example.test/same-id"
title: "Same ID Early"
tags:
  - "early"
saved_at: "2026-07-01T10:00:00.000Z"
---

## Summary

Early copy note.
`);
  const sameIdLate = await writeRawBookmark(root, '09', 'same-id.md', `---
id: "same-id"
url: "https://example.test/same-id#fragment"
title: "Same ID Late"
tags:
  - "late"
duplicate:
  - "same-id"
saved_at: "2026-09-01T10:00:00.000Z"
---

## Summary

Late copy note.
`);

  const result = await dedupeVaultBookmarks(root, { apply: true });
  assert.equal(result.applied, true);
  assert.equal(result.groups.length, 2);

  // Verify Group 1
  await fs.access(eqA);
  await assert.rejects(() => fs.access(eqB), { code: 'ENOENT' });
  assert.deepEqual(readList(await fs.readFile(eqA, 'utf8'), 'tags'), ['alpha', 'beta']);

  // Verify Group 2 (Same ID)
  await fs.access(sameIdEarly);
  await assert.rejects(() => fs.access(sameIdLate), { code: 'ENOENT' });
  const mergedSameId = await fs.readFile(sameIdEarly, 'utf8');
  assert.equal(readScalar(mergedSameId, 'id'), 'same-id');
  assert.deepEqual(readList(mergedSameId, 'tags'), ['early', 'late']);
  assert.deepEqual(readList(mergedSameId, 'duplicate'), []);
  assert.match(mergedSameId, /Early copy note\.\n\nLate copy note\./);
});

test('dedupe recovers cleanly from injected failures at every write, rename, and deletion and supports safe reruns', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-fault-injection-'));
  await initVault(root);

  await writeRawBookmark(root, '08', 'g1-keep.md', `---
id: "g1-keep"
url: "https://example.test/g1"
title: "Group 1 Keep"
tags:
  - "one"
saved_at: "2026-08-01T10:00:00.000Z"
---
`);
  await writeRawBookmark(root, '09', 'g1-drop.md', `---
id: "g1-drop"
url: "https://example.test/g1?utm_source=1"
title: "Group 1 Drop"
tags:
  - "two"
saved_at: "2026-09-01T10:00:00.000Z"
---
`);
  await writeRawBookmark(root, '08', 'g2-keep.md', `---
id: "g2-keep"
url: "https://example.test/g2"
title: "Group 2 Keep"
tags:
  - "three"
saved_at: "2026-08-02T10:00:00.000Z"
---
`);
  await writeRawBookmark(root, '09', 'g2-drop.md', `---
id: "g2-drop"
url: "https://example.test/g2?utm_source=2"
title: "Group 2 Drop"
tags:
  - "four"
saved_at: "2026-09-02T10:00:00.000Z"
---
`);
  await createProject({ id: 'fault-proj', title: 'Fault Project' }, root);
  await addProjectBookmark('fault-proj', 'g1-drop', root, { note: 'Note 1' });
  await addProjectBookmark('fault-proj', 'g2-drop', root, { note: 'Note 2' });

  const initialFiles = await listAllFiles(root);
  const initialContents = new Map(
    await Promise.all(initialFiles.map(async (file) => [file, await fs.readFile(file, 'utf8')]))
  );

  // Count how many writeFile, rename, and unlink operations occur on a successful run
  // Expected: 3 updates (g1-keep, g2-keep, fault-proj) and 2 removals (g1-drop, g2-drop)
  // writeFile: 3 calls; rename: 3 * 2 + 2 = 8 calls; unlink: 3 + 2 = 5 calls
  for (const [opName, totalCalls] of [['writeFile', 3], ['rename', 8], ['unlink', 5]]) {
    for (let failAt = 1; failAt <= totalCalls; failAt++) {
      let count = 0;
      const plan = await createDedupePlan(root);
      await assert.rejects(
        () => applyDedupePlan(plan, {
          fsOps: {
            ...fs,
            [opName]: async (...args) => {
              count += 1;
              if (count === failAt) {
                throw new Error(`Injected ${opName} failure at call #${failAt}`);
              }
              return fs[opName](...args);
            }
          }
        }),
        (error) => error instanceof BookmarkDedupeError && error.code === 'write_failed'
      );

      // Verify full recovery: exact same file list, no leftover .tmp files, and identical contents
      const afterFiles = await listAllFiles(root);
      assert.deepEqual(afterFiles, initialFiles, `File list mismatch after ${opName} failure #${failAt}`);
      for (const file of afterFiles) {
        assert.equal(
          await fs.readFile(file, 'utf8'),
          initialContents.get(file),
          `Content mismatch for ${file} after ${opName} failure #${failAt}`
        );
      }
    }
  }

  // Now run dedupe for real and verify clean completion
  const finalRes = await dedupeVaultBookmarks(root, { apply: true });
  assert.equal(finalRes.applied, true);
  assert.equal(finalRes.changed.length, 3);
  assert.equal(finalRes.removed.length, 2);
});

test('dedupe preserves unknown project-entry fields and rejects malformed project entries instead of dropping them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-project-entries-'));
  await initVault(root);

  await writeRawBookmark(root, '08', 'keep-bm.md', `---
id: "keep-bm"
url: "https://example.test/item"
title: "Item"
tags:
  - "tag"
saved_at: "2026-08-01T10:00:00.000Z"
---
`);
  await writeRawBookmark(root, '09', 'drop-bm.md', `---
id: "drop-bm"
url: "https://example.test/item?utm_source=dup"
title: "Item Dup"
tags:
  - "tag"
saved_at: "2026-09-01T10:00:00.000Z"
---
`);
  await writeRawBookmark(root, '09', 'other-bm.md', `---
id: "other-bm"
url: "https://example.test/other"
title: "Other"
tags:
  - "tag"
saved_at: "2026-09-02T10:00:00.000Z"
---
`);

  const projectFile = path.join(root, 'projects', 'custom-proj.md');

  // 1. Malformed JSON entry in project bookmarks must be rejected
  await fs.writeFile(projectFile, `---
id: "custom-proj"
title: "Custom Project"
status: "active"
contexts:
  []
tags:
  []
bookmarks:
  - {"id":"drop-bm","notes":["broken"
---
`, 'utf8');
  await assert.rejects(
    () => dedupeVaultBookmarks(root, { apply: true }),
    (error) => error instanceof BookmarkDedupeError && error.code === 'invalid_project'
  );

  // 2. Entry missing id must be rejected instead of dropped
  await fs.writeFile(projectFile, `---
id: "custom-proj"
title: "Custom Project"
status: "active"
contexts:
  []
tags:
  []
bookmarks:
  - {"notes":["missing id"]}
  - {"id":"drop-bm","notes":["valid"]}
---
`, 'utf8');
  await assert.rejects(
    () => dedupeVaultBookmarks(root, { apply: true }),
    (error) => error instanceof BookmarkDedupeError && error.code === 'invalid_project'
  );

  // 3. Conflicting unknown project-entry fields between merged entries must be rejected
  await fs.writeFile(projectFile, `---
id: "custom-proj"
title: "Custom Project"
status: "active"
contexts:
  []
tags:
  []
bookmarks:
  - {"id":"keep-bm","notes":["note 1"],"role":"primary"}
  - {"id":"drop-bm","notes":["note 2"],"role":"secondary"}
---
`, 'utf8');
  await assert.rejects(
    () => dedupeVaultBookmarks(root, { apply: true }),
    (error) => error instanceof BookmarkDedupeError && error.code === 'invalid_project'
  );

  // 4. Non-conflicting unknown project-entry fields are preserved on both merged and untouched entries
  await fs.writeFile(projectFile, `---
id: "custom-proj"
title: "Custom Project"
status: "active"
contexts:
  []
tags:
  []
bookmarks:
  - {"id":"keep-bm","notes":["note 1"],"role":"primary"}
  - {"id":"drop-bm","notes":["note 2"],"pinned":true}
  - {"id":"other-bm","notes":[],"section":"appendix"}
---
`, 'utf8');

  const applied = await dedupeVaultBookmarks(root, { apply: true });
  assert.equal(applied.applied, true);
  const updatedProject = await fs.readFile(projectFile, 'utf8');
  assert.deepEqual(readList(updatedProject, 'bookmarks'), [
    { id: 'keep-bm', notes: ['note 1', 'note 2'], role: 'primary', pinned: true },
    { id: 'other-bm', notes: [], section: 'appendix' }
  ]);
});

test('dedupe detects concurrent modifications before apply and fails visibly on invalid saved_at', async () => {
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
