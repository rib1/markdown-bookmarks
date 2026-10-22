import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { readList, replaceList, replaceScalar, removeScalar } from '../src/bookmark-format.js';
import {
  addProjectBookmark, addProjectBookmarkNote, createProject, moveProjectBookmark,
  projectBookmarks, removeProjectBookmark, removeProjectBookmarkNote
} from '../src/projects.js';
import { initVault, saveBookmark } from '../src/vault.js';
import { formatProjectContent } from '../src/project-format.js';
import { migrateProject } from '../src/migrations/004-project-notes-v2.js';

const run = promisify(execFile);
const cli = path.resolve('src', 'cli.js');

function assertProjectFieldOrder(content) {
  const metadata = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)[1];
  const fields = [...metadata.matchAll(/^([A-Za-z_][\w-]*):/gm)].map((match) => match[1]);
  assert.deepEqual(fields.filter((field) => ['id', 'title', 'status', 'contexts', 'tags', 'bookmarks'].includes(field)),
    ['id', 'title', 'status', 'contexts', 'tags', 'bookmarks']);
  assert.equal(new Set(fields).size, fields.length);
  assert.doesNotMatch(content, /\r/);
}

test('common project formatter orders complete metadata blocks and preserves unknown fields and body text', () => {
  const body = '\n## Purpose\n\nKeep this Markdown.\n\n```yaml\ntags:\n  - body-only\nbookmarks:\n  - body-only\n```\n';
  const metadata = ['---', '# File comment', 'bookmarks:', '  - {"id":"one","notes":["Keep cue"],"custom":"entry-value"}', '# Bookmark comment',
    'custom_map:', '  nested: "preserved"', '  more:', '    - "value"',
    'title: "Example"', 'tags:', '  - "reference"', 'id: "example"', 'status: "active"', 'contexts:', '  []', '---', ''].join('\n');
  const formatted = formatProjectContent((metadata + body).replace(/\n/g, '\r\n'));
  assertProjectFieldOrder(formatted);
  assert.ok(formatted.startsWith('---\n# File comment\nid:'));
  assert.ok(formatted.includes('custom_map:\n  nested: "preserved"\n  more:\n    - "value"\n'));
  assert.ok(formatted.endsWith(body));
  assert.deepEqual(readList(formatted, 'bookmarks'), [{ id: 'one', notes: ['Keep cue'], custom: 'entry-value' }]);
  assert.equal(formatProjectContent(formatted), formatted);
  const changed = formatProjectContent(formatted, { bookmarks: [{ id: 'two', notes: [] }] });
  assert.deepEqual(readList(changed, 'bookmarks'), [{ id: 'two', notes: [] }]);
  assert.ok(changed.endsWith(body));
  assert.ok(changed.includes('# Bookmark comment\n'));
  assert.equal(formatProjectContent(changed, { bookmarks: [{ id: 'two', notes: [] }] }), changed);
});

test('all project mutation paths save the same field order and preserve custom metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-project-order-'));
  await initVault(root);
  await saveBookmark({ id: 'first', url: 'https://example.test/first' }, root);
  await saveBookmark({ id: 'second', url: 'https://example.test/second' }, root);
  const project = await createProject({ id: 'demo', title: 'Demo', tags: ['reference'], purpose: 'Preserve purpose', notes: 'Preserve presenter notes' }, root);
  assertProjectFieldOrder(await fs.readFile(project.file, 'utf8'));
  const custom = 'custom_map:\n  owner: "preserved"\n';
  await fs.writeFile(project.file, (await fs.readFile(project.file, 'utf8')).replace('\n---\n', `\n${custom}---\n`));
  const actions = [
    () => addProjectBookmark('demo', 'first', root, { note: 'First cue' }),
    () => addProjectBookmark('demo', 'second', root, { note: 'Second cue' }),
    () => addProjectBookmark('demo', 'second', root),
    () => moveProjectBookmark('demo', 'second', 1, root),
    () => addProjectBookmarkNote('demo', 'second', 'Another cue', root),
    () => removeProjectBookmarkNote('demo', 'second', 1, root),
    () => removeProjectBookmark('demo', 'first', root)
  ];
  for (const action of actions) {
    // Deliberately scramble tags before every edit: every writer must correct it.
    const original = await fs.readFile(project.file, 'utf8');
    const tags = original.match(/^tags:\n(?: {2}[^\n]*\n)*/m)[0];
    const scrambled = original.replace(tags, '').replace('\n---\n', `\n${tags}---\n`);
    await fs.writeFile(project.file, scrambled.replace(/\n/g, '\r\n'));
    await action();
    const saved = await fs.readFile(project.file, 'utf8');
    assertProjectFieldOrder(saved);
    assert.deepEqual(readList(saved, 'tags'), ['reference']);
    assert.ok(saved.includes(custom));
    assert.ok(saved.includes('## Purpose\n\nPreserve purpose'));
    assert.ok(saved.includes('## Presenter notes\n\nPreserve presenter notes'));
  }
  const view = await projectBookmarks('demo', root);
  assert.deepEqual(view.entries.map((entry) => ({ id: entry.id, notes: entry.notes })), [{ id: 'second', notes: ['Another cue'] }]);
});

test('project notes migration uses the common metadata order without losing tags or custom fields', () => {
  const original = ['---', 'id: "legacy"', 'title: "Legacy"', 'status: "active"', 'contexts:', '  []',
    'bookmarks:', '  - {"id":"first","note":"Keep this cue","custom":"entry-value"}',
    'tags:', '  - "reference"', 'custom: "preserved"', '---', '', 'Keep body.', ''].join('\r\n');
  const migrated = migrateProject(original);
  assert.equal(migrated.migrated, 1);
  assertProjectFieldOrder(migrated.content);
  assert.deepEqual(readList(migrated.content, 'bookmarks'), [{ custom: 'entry-value', id: 'first', notes: ['Keep this cue'] }]);
  assert.deepEqual(readList(migrated.content, 'tags'), ['reference']);
  assert.ok(migrated.content.includes('custom: "preserved"\n'));
  assert.ok(migrated.content.endsWith('Keep body.\n'));
  assert.equal(migrateProject(migrated.content).content, migrated.content);
});

test('metadata writers normalize CRLF/mixed lines and replace rather than duplicate lists', () => {
  for (const eol of ['\r\n', '\n']) {
    const original = ['---', 'id: "example"', 'bookmarks:', '  - {"id":"first","notes":["Keep this"]}', 'tags:', '  - "reference"', 'custom: "preserved"', '---', '', 'Body text', ''].join(eol);
    const entries = [{ id: 'first', notes: ['Keep this'] }, { id: 'second', notes: [] }];
    const updated = replaceList(original, 'bookmarks', entries);
    assert.equal(updated.match(/^bookmarks:/gm).length, 1);
    assert.deepEqual(readList(updated, 'bookmarks'), entries);
    assert.deepEqual(readList(updated, 'tags'), ['reference']);
    assert.ok(updated.includes('custom: "preserved"\n---\n\nBody text\n'));
    assert.doesNotMatch(updated, /\r/);
    assert.equal(replaceList(updated, 'bookmarks', entries), updated);
    assert.doesNotMatch(replaceScalar(original, 'id', 'changed'), /\r/);
    assert.doesNotMatch(removeScalar(original, 'custom'), /\r/);
  }
  assert.equal(replaceList('tags:\r\n  - "old"', 'tags', ['new']), 'tags:\n  - "new"\n');
  assert.equal(replaceList('tags:', 'tags', ['new']), 'tags:\n  - "new"\n');
});

test('adding and resaving bookmarks to a CRLF project preserves one list, notes, tags and order', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-crlf-project-'));
  await initVault(root);
  await saveBookmark({ id: 'first', url: 'https://example.test/first' }, root);
  await saveBookmark({ id: 'second', url: 'https://example.test/second' }, root);
  const project = await createProject({ id: 'demo', title: 'Demo', tags: ['reference'] }, root);
  await addProjectBookmark('demo', 'first', root, { note: 'Preserve this cue' });
  const original = await fs.readFile(project.file, 'utf8');
  await fs.writeFile(project.file, original.replace(/\n/g, '\r\n'));
  assert.equal((await addProjectBookmark('demo', 'second', root)).added, true);
  assert.equal((await addProjectBookmark('demo', 'second', root)).added, false);
  const content = await fs.readFile(project.file, 'utf8');
  assert.equal(content.match(/^bookmarks:/gm).length, 1);
  assert.equal(content.match(/^tags:/gm).length, 1);
  assert.deepEqual(readList(content, 'tags'), ['reference']);
  assert.deepEqual(readList(content, 'bookmarks'), [{ id: 'first', notes: ['Preserve this cue'] }, { id: 'second', notes: [] }]);
  assert.doesNotMatch(content, /\r/);
});

test('malformed project metadata is rejected without rewriting records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-invalid-project-'));
  await initVault(root);
  const bookmark = await saveBookmark({ id: 'first', url: 'https://example.test/first' }, root);
  const project = await createProject({ id: 'demo', title: 'Demo' }, root);
  const original = await fs.readFile(project.file, 'utf8');
  const bookmarkBefore = await fs.readFile(bookmark.file, 'utf8');
  for (const content of [
    original.replace(/\n---\n/, '\n'),
    original.replace('bookmarks:\n', 'bookmarks:\n  []\nbookmarks:\n'),
    original.replace('title: "Demo"', 'title: "Demo')
  ]) {
    await fs.writeFile(project.file, content);
    await assert.rejects(() => addProjectBookmark('demo', 'first', root), /Invalid project frontmatter/);
    assert.equal(await fs.readFile(project.file, 'utf8'), content);
    assert.equal(await fs.readFile(bookmark.file, 'utf8'), bookmarkBefore);
  }
});

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

test('project open prints every tab for manual opening when the browser cannot launch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-project-open-failure-'));
  await initVault(root);
  await saveBookmark({ id: 'first-tab', url: 'https://example.test/first', title: 'First tab' }, root);
  await saveBookmark({ id: 'second-tab', url: 'https://example.test/second', title: 'Second tab' }, root);
  const environment = { ...process.env, BOOKMARK_VAULT: root };
  await run(process.execPath, [cli, 'project', 'create', '--id', 'demo', '--title', 'Demo'], { env: environment });
  await run(process.execPath, [cli, 'project', 'add', 'demo', 'first-tab'], { env: environment });
  await run(process.execPath, [cli, 'project', 'add', 'demo', 'second-tab'], { env: environment });

  await assert.rejects(
    () => run(process.execPath, [cli, 'project', 'open', 'demo', '--with', path.join(root, 'missing-browser')], { env: environment }),
    (error) => {
      assert.match(error.stdout, /Open these project tabs manually:\r?\n1\. https:\/\/example\.test\/first\r?\n2\. https:\/\/example\.test\/second/);
      return true;
    }
  );
});

test('project open without --with launches all tabs through the default browser', { skip: process.platform !== 'linux' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-project-default-'));
  await initVault(root);
  const urls = ['file:///C:/Example%20Documents/presentation.html', 'file:///Users/example/Documents/chart.svg'];
  await saveBookmark({ id: 'first-tab', url: urls[0], title: 'First tab' }, root);
  await saveBookmark({ id: 'second-tab', url: urls[1], title: 'Second tab' }, root);
  await createProject({ id: 'demo', title: 'Demo' }, root);
  await addProjectBookmark('demo', 'first-tab', root);
  await addProjectBookmark('demo', 'second-tab', root);

  const bin = path.join(root, 'bin');
  const log = path.join(root, 'opened.txt');
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'xdg-open'), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$BOOKMARK_BROWSER_LOG"\n', { mode: 0o755 });
  const environment = { ...process.env, BOOKMARK_VAULT: root, BOOKMARK_BROWSER_LOG: log, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  delete environment.BOOKMARK_RESULTS_HOST_VAULT;
  const result = await run(process.execPath, [cli, 'project', 'open', 'demo'], { env: environment });
  assert.match(result.stdout, /Opened 2 project tabs\./);
  let opened = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    opened = (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n');
    if (opened.length === urls.length) break;
    await delay(20);
  }
  assert.deepEqual(opened.toSorted(), urls.toSorted());

  // A missing system opener must report every URL for manual opening.
  await fs.unlink(path.join(bin, 'xdg-open'));
  await assert.rejects(() => run(process.execPath, [cli, 'project', 'open', 'demo'], {
    env: { ...environment, PATH: bin }
  }), (error) => {
    assert.match(error.stderr, /Could not launch the default browser/);
    for (const url of urls) assert.ok(error.stdout.includes(url));
    return true;
  });
});

test('project and single-bookmark opening accept local documents with explicit browser and dry-run', { skip: process.platform !== 'linux' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-local-open-'));
  await initVault(root);
  const targets = ['file:///C:/Example%20Documents/presentation.html', 'file:///Users/example/Documents/chart.svg', 'https://example.test/reference'];
  const records = [];
  for (let index = 0; index < targets.length; index++) {
    records.push(await saveBookmark({ id: `local-${index}`, url: targets[index], title: `Document ${index}` }, root));
  }
  await createProject({ id: 'demo', title: 'Demo' }, root);
  for (const record of records) await addProjectBookmark('demo', record.id, root);
  const environment = { ...process.env, BOOKMARK_VAULT: root };
  delete environment.BOOKMARK_RESULTS_HOST_VAULT;
  const dryRun = await run(process.execPath, [cli, 'project', 'open', 'demo', '--with', 'chrome', '--dry-run'], { env: environment });
  for (let index = 0; index < targets.length; index++) assert.ok(dryRun.stdout.includes(`${index + 1}. ${targets[index]}`));
  const single = await run(process.execPath, [cli, 'open', records[0].id, '--dry-run'], { env: environment });
  assert.equal(single.stdout.trim(), targets[0]);

  const browser = path.join(root, 'mock-browser.mjs');
  const capture = path.join(root, 'browser-arguments.json');
  await fs.writeFile(browser, '#!/usr/bin/env node\nimport fs from "node:fs"; fs.writeFileSync(process.env.BOOKMARK_BROWSER_CAPTURE, JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
  environment.BOOKMARK_BROWSER_CAPTURE = capture;
  const launched = await run(process.execPath, [cli, 'project', 'open', 'demo', '--with', browser], { env: environment });
  assert.match(launched.stdout, /Opened 3 project tabs/);
  let captured;
  for (let attempt = 0; attempt < 50; attempt++) {
    captured = await fs.readFile(capture, 'utf8').then(JSON.parse).catch(() => undefined);
    if (captured) break;
    await delay(20);
  }
  assert.deepEqual(captured, ['--new-window', ...targets]);

  // Invalid entries block the entire presentation before any browser is started.
  for (const url of ['javascript:alert(1)', 'file://server/share/page.html', 'file:///C:/run.exe']) {
    const original = await fs.readFile(records[1].file, 'utf8');
    await fs.writeFile(records[1].file, replaceScalar(original, 'url', url));
    await fs.unlink(capture);
    await assert.rejects(() => run(process.execPath, [cli, 'project', 'open', 'demo', '--with', browser], { env: environment }), /without supported browser URLs/);
    await assert.rejects(() => fs.access(capture), { code: 'ENOENT' });
    await assert.rejects(() => run(process.execPath, [cli, 'open', records[1].id, '--dry-run'], { env: environment }), /no supported browser URL/);
    await fs.writeFile(records[1].file, original);
    // Recreate the sentinel to check that the next rejected launch does not write it.
    await fs.writeFile(capture, '[]');
  }
});
