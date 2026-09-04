import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveBookmark, findBookmarks } from '../src/vault.js';

test('saves tagged bookmark and finds it through the CLI index path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-'));
  const saved = await saveBookmark({ url: 'https://example.test/postgres', title: 'Postgres Guide', tags: ['work', 'database'] }, root);
  const content = await fs.readFile(saved.file, 'utf8');
  assert.match(content, /- "work"/);
  assert.match(content, /- "database"/);
  const found = await findBookmarks('postgres', root);
  assert.equal(found.length, 1);
});
