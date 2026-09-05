import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browserCommand } from '../src/browser-launcher.js';
import {
  cleanupStaleSearchResultPages,
  createSearchResultsPage,
  hostSearchResultsFileUrl,
  renderSearchResultsPage,
  SEARCH_RESULTS_CSP,
  SEARCH_RESULTS_MAX_AGE_MS
} from '../src/search-results-page.js';

function result(file, { title, url, tags = [], contexts = [], savedAt = '2026-09-05T10:00:00.000Z' }) {
  const list = (values) => values.length
    ? values.map((value) => `  - ${JSON.stringify(value)}`).join('\n')
    : '  []';
  return {
    file,
    content: `---
title: ${JSON.stringify(title)}
url: ${JSON.stringify(url)}
tags:
${list(tags)}
contexts:
${list(contexts)}
last_saved_at: ${savedAt}
---
`
  };
}

test('renders safe, sorted search-result HTML with useful metadata', () => {
  const html = renderSearchResultsPage('<private & query>', [
    result('beta.md', {
      title: 'Beta <img src=x onerror=alert(1)>',
      url: 'javascript:alert(1)',
      tags: ['unsafe<script>'],
      contexts: ['personal']
    }),
    result('alpha.md', {
      title: 'Alpha result',
      url: 'https://example.test/page?a=1&b=2',
      tags: ['reference'],
      contexts: ['travel']
    })
  ]);

  assert.ok(html.indexOf('Alpha result') < html.indexOf('Beta &lt;img'));
  assert.match(html, /2 results for “&lt;private &amp; query&gt;”/);
  assert.match(html, /href="https:\/\/example\.test\/page\?a=1&amp;b=2"/);
  assert.match(html, /example\.test/);
  assert.match(html, />reference</);
  assert.match(html, />travel</);
  assert.match(html, /2026-09-05T10:00:00\.000Z/);
  assert.match(html, /Beta &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /aria-disabled="true">Unavailable/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.ok(html.includes(SEARCH_RESULTS_CSP));
});

test('creates unique private pages and only purges stale generated pages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-page-'));
  const directory = path.join(root, 'views', '.search-results');
  const results = [result('one.md', { title: 'One', url: 'https://example.test/one' })];
  try {
    await assert.rejects(() => createSearchResultsPage('none', [], { directory }), /No bookmark found/);
    const first = await createSearchResultsPage('one', results, { directory });
    const second = await createSearchResultsPage('one', results, { directory });
    assert.notEqual(first.file, second.file);
    assert.equal(await fs.readFile(first.file, 'utf8'), renderSearchResultsPage('one', results));
    assert.equal(hostSearchResultsFileUrl(first.token, '/Users/me/My Vault'),
      `file:///Users/me/My%20Vault/views/.search-results/search-results-${first.token}.html`);
    assert.equal(hostSearchResultsFileUrl(first.token, 'C:\\Users\\me\\My Vault'),
      `file:///C:/Users/me/My%20Vault/views/.search-results/search-results-${first.token}.html`);

    const unrelated = path.join(directory, 'keep-me.html');
    await fs.writeFile(unrelated, 'unrelated', 'utf8');
    const now = Date.now();
    const staleDate = new Date(now - SEARCH_RESULTS_MAX_AGE_MS - 1_000);
    await fs.utimes(first.file, staleDate, staleDate);
    assert.equal(await cleanupStaleSearchResultPages(directory, now), 1);
    await assert.rejects(() => fs.access(first.file), { code: 'ENOENT' });
    await fs.access(second.file);
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'unrelated');
    assert.throws(() => hostSearchResultsFileUrl('../private', '/tmp/vault'), /Invalid search-results token/);
    assert.throws(() => hostSearchResultsFileUrl(second.token, 'relative/vault'), /absolute host path/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('selects safe native browser launcher commands', () => {
  const target = 'file:///tmp/results.html';
  assert.deepEqual(browserCommand(target, 'win32'),
    { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', target] });
  assert.deepEqual(browserCommand(target, 'darwin'), { command: 'open', args: [target] });
  assert.deepEqual(browserCommand(target, 'linux'), { command: 'xdg-open', args: [target] });
  assert.deepEqual(browserCommand(target, 'darwin', 'chrome'),
    { command: 'open', args: ['-a', 'Google Chrome', target] });
  assert.deepEqual(browserCommand(target, 'win32', 'edge'),
    { command: 'msedge.exe', args: [target] });
  assert.deepEqual(browserCommand(target, 'linux', 'firefox'),
    { command: 'firefox', args: [target] });
  assert.deepEqual(browserCommand(target, 'darwin', 'Vivaldi'),
    { command: 'open', args: ['-a', 'Vivaldi', target] });
  assert.deepEqual(browserCommand(target, 'win32', 'C:\\Apps\\browser.exe'),
    { command: 'C:\\Apps\\browser.exe', args: [target] });
  assert.throws(() => browserCommand(target, 'linux', 'safari'), /not supported on linux/);
});
