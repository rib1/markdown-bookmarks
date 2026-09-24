import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readList } from '../src/bookmark-format.js';
import {
  addProjectBookmark, addProjectBookmarkNote, createProject, moveProjectBookmark,
  projectBookmarks, removeProjectBookmark, removeProjectBookmarkNote
} from '../src/projects.js';
import { initVault, saveBookmark } from '../src/vault.js';

const run = promisify(execFile);
const cli = path.resolve('src', 'cli.js');

test('projects keep ordered bookmark IDs and bidirectional metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-project-'));
  await initVault(root);
  const first = await saveBookmark({ id: 'first-tab', url: 'https://example.test/first', title: 'First tab' }, root);
  await saveBookmark({ id: 'second-tab', url: 'http://localhost:5000/', title: 'Local app' }, root);
  const project = await createProject({
    id: 'ai-talk', title: 'AI assisted app talk', contexts: ['Hobby'], tags: ['Amiga'], purpose: 'Explain the demo.'
  }, root);
  assert.equal(project.id, 'ai-talk');
  assert.match(await fs.readFile(project.file, 'utf8'), /"Hobby"/);
  assert.match(await fs.readFile(project.file, 'utf8'), /"amiga"/);

  assert.equal((await addProjectBookmark('ai-talk', 'first-tab', root)).added, true);
  assert.equal((await addProjectBookmark('ai-talk', 'second', root, { note: 'Show the local conversion demo.' })).added, true);
  assert.equal((await addProjectBookmark('ai-talk', 'first', root)).added, false);
  await moveProjectBookmark('ai-talk', 'second-tab', 1, root);

  let view = await projectBookmarks('ai-talk', root);
  assert.deepEqual(view.entries.map((entry) => entry.id), ['second-tab', 'first-tab']);
  assert.equal(view.entries[0].url, 'http://localhost:5000/');
  assert.deepEqual(view.entries[0].notes, ['Show the local conversion demo.']);
  await addProjectBookmarkNote('ai-talk', 'second-tab', 'Explain the mobile demo.', root);
  view = await projectBookmarks('ai-talk', root);
  assert.deepEqual(view.entries[0].notes, ['Show the local conversion demo.', 'Explain the mobile demo.']);
  await removeProjectBookmarkNote('ai-talk', 'second-tab', 1, root);
  view = await projectBookmarks('ai-talk', root);
  assert.deepEqual(view.entries[0].notes, ['Explain the mobile demo.']);
  assert.deepEqual(readList(await fs.readFile(first.file, 'utf8'), 'projects'), ['ai-talk']);

  assert.equal((await removeProjectBookmark('ai-talk', 'first-tab', root)).removed, true);
  view = await projectBookmarks('ai-talk', root);
  assert.deepEqual(view.entries.map((entry) => entry.id), ['second-tab']);
  assert.deepEqual(readList(await fs.readFile(first.file, 'utf8'), 'projects'), []);
});

test('project TUI prints ordered tabs in dry-run mode and reports broken references', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-project-cli-'));
  await initVault(root);
  await saveBookmark({ id: 'intro-tab', url: 'https://example.test/intro', title: 'Intro' }, root);
  await saveBookmark({ id: 'local-tab', url: 'http://localhost:5000/', title: 'Local app' }, root);
  const environment = { ...process.env, BOOKMARK_VAULT: root };
  await run(process.execPath, [cli, 'project', 'create', '--id', 'demo', '--title', 'Demo'], { env: environment });
  await run(process.execPath, [cli, 'project', 'add', 'demo', 'intro-tab', '--note', 'Start with the motivation.'], { env: environment });
  await run(process.execPath, [cli, 'project', 'add', 'demo', 'local-tab'], { env: environment });
  const dryRun = await run(process.execPath, [cli, 'project', 'open', 'demo', '--dry-run'], { env: environment });
  assert.match(dryRun.stdout, /1\. https:\/\/example\.test\/intro/);
  assert.match(dryRun.stdout, /2\. http:\/\/localhost:5000\//);
  const show = await run(process.execPath, [cli, 'project', 'show', 'demo'], { env: environment });
  assert.match(show.stdout, /Demo \[demo\]/);
  assert.match(show.stdout, /Intro \[intro-ta\]/);
  assert.match(show.stdout, /NOTE 1: Start with the motivation\./);
  await run(process.execPath, [cli, 'project', 'note', 'add', 'demo', 'intro-tab', '--note', 'Explain the problem first.'], { env: environment });
  const noted = await run(process.execPath, [cli, 'project', 'show', 'demo'], { env: environment });
  assert.match(noted.stdout, /NOTE 2: Explain the problem first\./);
  await run(process.execPath, [cli, 'project', 'note', 'remove', 'demo', 'intro-tab', '--pick', '1'], { env: environment });
  const removed = await run(process.execPath, [cli, 'project', 'show', 'demo'], { env: environment });
  assert.doesNotMatch(removed.stdout, /Start with the motivation/);
  assert.match(removed.stdout, /NOTE 1: Explain the problem first\./);

  const projectFile = path.join(root, 'projects', 'demo-demo.md');
  let content = await fs.readFile(projectFile, 'utf8');
  content = content.replace('"id":"local-tab"', '"id":"removed-tab"');
  await fs.writeFile(projectFile, content, 'utf8');
  await assert.rejects(() => run(process.execPath, [cli, 'project', 'open', 'demo', '--dry-run'], { env: environment }), /missing bookmark reference/);
});
