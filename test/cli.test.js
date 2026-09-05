import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CANCELLED_SELECTION, interactiveResult } from '../src/open-selection.js';
import { saveBookmark } from '../src/vault.js';

const run = promisify(execFile);
const cli = path.resolve('src', 'cli.js');

async function readEventually(file) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await fs.readFile(file, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await delay(20);
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

function runInteractiveCli(args, { env, input = '\n' }) {
  const script = `
Object.defineProperty(process.stdin, 'isTTY', { value: true });
Object.defineProperty(process.stdout, 'isTTY', { value: true });
process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('CLI help lists commands, launch options, browser choices, and linked workflows', async () => {
  const generalHelp = await run(process.execPath, [cli, 'help']);
  assert.match(generalHelp.stdout, /Markdown Bookmarks commands:/);
  assert.match(generalHelp.stdout, /save --url URL .*--shared-by NAME.*--via CHANNEL/);
  assert.match(generalHelp.stdout, /find QUERY .*--expand.*--with BROWSER/);
  assert.match(generalHelp.stdout, /--saved-within day\|week\|month\|year/);
  assert.match(generalHelp.stdout, /--saved-since YYYY-MM-DD/);
  assert.match(generalHelp.stdout, /open QUERY .*--pick NUMBER.*--with BROWSER.*--dry-run/);
  assert.match(generalHelp.stdout, /find QUERY .*--fuzzy.*--browser/);
  assert.match(generalHelp.stdout, /Keep the "--" in "npm run bookmark -- COMMAND"/);
  assert.match(generalHelp.stdout, /--browser, --fuzzy, --expand, --pick, --saved-within, --saved-since, --with,/);
  assert.match(generalHelp.stdout, /Compact find output:\n\s+1\. Night Drive \[d34db33f\]/);
  assert.match(generalHelp.stdout, /TAGS: bandcamp, music/);
  assert.match(generalHelp.stdout, /find QUERY --expand to include vault file paths and full Markdown records/);
  assert.match(generalHelp.stdout, /displayed ID prefix can be used with open/);
  assert.match(generalHelp.stdout, /open d34db33f/);
  assert.match(generalHelp.stdout, /Common workflows:/);
  assert.match(generalHelp.stdout, /save --url https:\/\/example\.test\/page --shared-by Alice --via Signal/);
  assert.match(generalHelp.stdout, /find database\n\s+npm run bookmark -- open database --pick 3/);
  assert.match(generalHelp.stdout, /find database --expand/);
  assert.match(generalHelp.stdout, /find database --saved-within week/);
  assert.match(generalHelp.stdout, /find travel --saved-within month/);
  assert.match(generalHelp.stdout, /find archive --saved-within year/);
  assert.match(generalHelp.stdout, /find database --saved-since 2026-09-01/);
  assert.match(generalHelp.stdout, /open database --saved-since 2026-09-01 --pick 3/);
  assert.match(generalHelp.stdout, /open database --pick 3 --with firefox/);
  assert.match(generalHelp.stdout, /find database --browser --with chrome/);

  const openHelp = await run(process.execPath, [cli, 'open', '--help']);
  assert.match(openHelp.stdout, /--pick NUMBER/);
  assert.match(openHelp.stdout, /--saved-within PERIOD\n\s+Only match bookmarks saved within day, week, month, or year/);
  assert.match(openHelp.stdout, /--saved-since DATE\n\s+Only match bookmarks saved on or after YYYY-MM-DD/);
  assert.match(openHelp.stdout, /--fuzzy\s+Use typo-tolerant ranked matching/);
  assert.match(openHelp.stdout, /keep the "--" after "bookmark"/i);
  assert.match(openHelp.stdout, /Without --pick, an interactive terminal displays a numbered menu/);
  assert.match(openHelp.stdout, /Press Enter without a number to cancel and open nothing/);
  assert.match(openHelp.stdout, /With --pick NUMBER, that menu is skipped/);
  assert.match(openHelp.stdout, /--pick=NUMBER is also accepted/);
  assert.match(openHelp.stdout, /If the selected browser is missing or cannot start/);
  assert.match(openHelp.stdout, /target link for manual opening/);
  assert.match(openHelp.stdout, /--with BROWSER/);
  assert.match(openHelp.stdout, /--dry-run/);
  assert.match(openHelp.stdout, /chrome, edge, firefox, brave/);
  assert.match(openHelp.stdout, /open database --with chrome/);
  assert.match(openHelp.stdout, /safari\s+macOS only/);
  assert.match(openHelp.stdout,
    /Open a bookmark by the short ID shown in find output:\n\s+npm run bookmark -- find database\n\s+npm run bookmark -- open d34db33f/);
  assert.match(openHelp.stdout,
    /Full stable IDs work too:\n\s+npm run bookmark -- open 550e8400-e29b-41d4-a716-446655440000/);
  assert.match(openHelp.stdout, /find database\n\s+npm run bookmark -- open database --pick 3/);
  assert.match(openHelp.stdout,
    /find database --saved-since 2026-09-01\n\s+npm run bookmark -- open database --saved-since 2026-09-01 --pick 3/);
  assert.match(openHelp.stdout, /find database --browser --with firefox/);
  assert.match(openHelp.stdout, /open triper --fuzzy/);
  assert.match(openHelp.stdout, /Docker cannot launch a host application/);
});

test('empty interactive link selection cancels without choosing a bookmark', () => {
  const results = [{ file: 'one.md' }, { file: 'two.md' }];
  assert.equal(interactiveResult(results, ''), CANCELLED_SELECTION);
  assert.equal(interactiveResult(results, '   '), CANCELLED_SELECTION);
  assert.equal(interactiveResult(results, '2'), results[1]);
});

test('time-filtered find numbering is reused by open --pick and --with', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-cli-time-'));
  const env = { ...process.env, BOOKMARK_VAULT: root };
  const recent = new Date().toISOString();
  const cutoff = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await saveBookmark({
    url: 'https://example.test/timeline-old', title: 'Aardvark old', tags: ['timeline'],
    saved_at: '2020-01-01T00:00:00.000Z'
  }, root);
  await saveBookmark({
    url: 'https://example.test/timeline-alpha', title: 'Alpha recent', tags: ['timeline'], saved_at: recent
  }, root);
  await saveBookmark({
    url: 'https://example.test/timeline-beta', title: 'Beta recent', tags: ['timeline'], saved_at: recent
  }, root);

  const found = await run(process.execPath,
    [cli, 'find', 'timeline', '--saved-since', cutoff], { env });
  assert.match(found.stdout, /^1\. Alpha recent /m);
  assert.match(found.stdout, /^2\. Beta recent /m);
  assert.doesNotMatch(found.stdout, /Aardvark old/);

  const browserCapture = path.join(root, 'time-filtered-browser-url.txt');
  const fakeBrowser = path.join(root, 'fake-time-filtered-browser');
  await fs.writeFile(fakeBrowser, '#!/bin/sh\nprintf \'%s\' "$1" > "$BOOKMARK_BROWSER_CAPTURE"\n', { mode: 0o755 });
  const opened = await run(process.execPath, [cli, 'open', 'timeline',
    '--saved-since', cutoff, '--pick', '2', '--with', fakeBrowser], {
    env: { ...env, BOOKMARK_BROWSER_CAPTURE: browserCapture }
  });
  assert.equal(opened.stdout, '');
  assert.equal(await readEventually(browserCapture), 'https://example.test/timeline-beta');

  const within = await run(process.execPath,
    [cli, 'open', 'timeline', '--saved-within', 'week', '--pick', '1', '--dry-run'], { env });
  assert.equal(within.stdout.trim(), 'https://example.test/timeline-alpha');
});

test('CLI commands initialize, save, find, install the vault skill, and dry-run open', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-cli-'));
  const env = {
    ...process.env,
    BOOKMARK_VAULT: root,
    SKILL_SOURCE: path.resolve('skills', 'markdown-bookmark-vault', 'SKILL.md')
  };
  delete env.BOOKMARK_RESULTS_HOST_VAULT;
  delete env.BOOKMARK_RESULTS_DIR;
  const initialized = await run(process.execPath, [cli, 'init', '--path', root], { env });
  assert.match(initialized.stdout, /Vault ready/);
  assert.match(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), /How to search/);

  const emptyBrowserSearch = await run(process.execPath,
    [cli, 'find', 'triper', '--browser'], { env });
  assert.equal(emptyBrowserSearch.stdout.trim(), 'No bookmarks found for: triper');
  await assert.rejects(() => fs.access(path.join(root, 'views', '.search-results')), { code: 'ENOENT' });

  const saved = await run(process.execPath, [cli, 'save', '--url', 'https://example.test/cli', '--title', 'CLI Amiga',
    '--tags', 'amiga,test', '--shared-by', 'Alice', '--via', 'Signal'], { env });
  const savedResult = JSON.parse(saved.stdout);
  assert.ok(savedResult.file);
  const savedContent = await fs.readFile(savedResult.file, 'utf8');
  const savedId = savedContent.match(/^id:\s*([^\r\n]+)$/m)?.[1];
  assert.ok(savedId);
  assert.match(savedContent, /"sender":"Alice"/);
  assert.match(savedContent, /"channel":"Signal"/);

  const found = await run(process.execPath, [cli, 'find', 'amiga'], { env });
  assert.match(found.stdout, new RegExp(`^1\\. CLI Amiga \\[${savedId.slice(0, 8)}\\]$`, 'm'));
  assert.match(found.stdout, /URL: https:\/\/example.test\/cli/);
  assert.match(found.stdout, /^ {3}TAGS: amiga, test$/m);
  assert.doesNotMatch(found.stdout, /FILE:/);
  assert.doesNotMatch(found.stdout, /^title:|^tags:|^## Summary$/m);
  const expanded = await run(process.execPath, [cli, 'find', 'amiga', '--expand'], { env });
  assert.match(expanded.stdout, /^RESULT: 1 — CLI Amiga$/m);
  assert.match(expanded.stdout, /- "amiga"/);
  assert.match(expanded.stdout, /title: "CLI Amiga"/);
  assert.match(expanded.stdout, /^## Summary$/m);
  const foundBySender = await run(process.execPath, [cli, 'find', 'Alice'], { env });
  assert.match(foundBySender.stdout, /URL: https:\/\/example.test\/cli/);

  const opened = await run(process.execPath, [cli, 'open', 'amiga', '--dry-run'], { env });
  assert.equal(opened.stdout.trim(), 'https://example.test/cli');
  const openedById = await run(process.execPath, [cli, 'open', savedId, '--dry-run'], { env });
  assert.equal(openedById.stdout.trim(), 'https://example.test/cli');
  const openedByShortId = await run(process.execPath, [cli, 'open', savedId.slice(0, 8), '--dry-run'], { env });
  assert.equal(openedByShortId.stdout.trim(), 'https://example.test/cli');

  await run(process.execPath, [cli, 'save', '--url', 'https://example.test/cli-second',
    '--title', 'Second Amiga', '--tags', 'amiga,test'], { env });
  await run(process.execPath, [cli, 'save', '--url', 'https://example.test/tripper',
    '--title', 'Tripper Travel Planning', '--tags', 'journey'], { env });

  const fuzzyFound = await run(process.execPath, [cli, 'find', 'triper', '--fuzzy'], { env });
  assert.match(fuzzyFound.stdout, /URL: https:\/\/example\.test\/tripper/);
  assert.match(fuzzyFound.stdout, /MATCH: fuzzy \d+% \(title\)/);
  assert.match(fuzzyFound.stdout, /^1\. Tripper Travel Planning \[[\da-f]{8}\]$/m);
  const fuzzyOpened = await run(process.execPath,
    [cli, 'open', 'triper', '--fuzzy', '--dry-run'], { env });
  assert.equal(fuzzyOpened.stdout.trim(), 'https://example.test/tripper');
  const fuzzyBrowser = await run(process.execPath,
    [cli, 'find', 'triper', '--fuzzy', '--browser', '--dry-run'], { env });
  const fuzzyPage = await fs.readFile(fileURLToPath(fuzzyBrowser.stdout.trim()), 'utf8');
  assert.match(fuzzyPage, /Tripper Travel Planning/);
  assert.match(fuzzyPage, /<strong>Match:<\/strong> Fuzzy \d+% · title/);

  const cancelled = await runInteractiveCli(['open', 'amiga'], { env });
  assert.equal(cancelled.code, 0, cancelled.stderr);
  assert.match(cancelled.stdout, /Multiple bookmarks found:/);
  assert.match(cancelled.stdout, /Cancelled\./);

  await assert.rejects(
    () => run(process.execPath, [cli, 'open', 'amiga', '--dry-run'], { env }),
    (error) => {
      assert.match(error.stdout, /Multiple bookmarks found:/);
      assert.match(error.stdout, /1\. CLI Amiga/);
      assert.match(error.stdout, /2\. Second Amiga/);
      assert.match(error.stderr, /rerun with --pick NUMBER/);
      return true;
    }
  );
  const picked = await run(process.execPath, [cli, 'open', '--pick', '2', 'amiga', '--dry-run'], { env });
  assert.equal(picked.stdout.trim(), 'https://example.test/cli-second');
  const inlinePicked = await run(process.execPath, [cli, 'open', 'amiga', '--pick=2', '--dry-run'], { env });
  assert.equal(inlinePicked.stdout.trim(), 'https://example.test/cli-second');

  const browserCapture = path.join(root, 'browser-url.txt');
  const fakeBrowser = path.join(root, 'fake-browser');
  await fs.writeFile(fakeBrowser, '#!/bin/sh\nprintf \'%s\' "$1" > "$BOOKMARK_BROWSER_CAPTURE"\n', { mode: 0o755 });
  const directlyPicked = await run(process.execPath,
    [cli, 'open', 'amiga', '--pick', '2', '--with', fakeBrowser], {
      env: { ...env, BOOKMARK_BROWSER_CAPTURE: browserCapture }
    });
  assert.doesNotMatch(directlyPicked.stdout, /Multiple bookmarks found|Choose a bookmark/);
  assert.equal(await readEventually(browserCapture), 'https://example.test/cli-second');

  const missingBrowser = path.join(root, 'browser-that-does-not-exist');
  await assert.rejects(
    () => run(process.execPath,
      [cli, 'open', 'amiga', '--pick', '1', '--with', missingBrowser], { env }),
    (error) => {
      assert.match(error.stderr, /Could not launch browser .*application or executable was not found/);
      assert.doesNotMatch(error.stderr, /\n\s+at /);
      assert.equal(error.stdout.trim(), 'Open this link manually:\nhttps://example.test/cli');
      return true;
    }
  );

  const selectedBrowser = await run(process.execPath,
    [cli, 'open', '--with', 'firefox', '--pick', '1', 'amiga', '--dry-run'], { env });
  assert.equal(selectedBrowser.stdout.trim(), 'https://example.test/cli');
  const dockerOpen = await run(process.execPath,
    [cli, 'open', 'amiga', '--pick', '1', '--with', 'firefox'], {
      env: { ...env, BOOKMARK_RESULTS_HOST_VAULT: 'C:\\Users\\me\\My Vault' }
    });
  assert.equal(dockerOpen.stdout.trim(), 'Open bookmark in firefox: https://example.test/cli');

  const browserSearch = await run(process.execPath,
    [cli, 'find', 'amiga', '--browser', '--dry-run'], { env });
  const resultsPage = fileURLToPath(browserSearch.stdout.trim());
  assert.equal(path.dirname(resultsPage), path.join(root, 'views', '.search-results'));
  const resultsHtml = await fs.readFile(resultsPage, 'utf8');
  assert.match(resultsHtml, /2 results for “amiga”/);
  assert.ok(resultsHtml.indexOf('CLI Amiga') < resultsHtml.indexOf('Second Amiga'));
  assert.match(resultsHtml, /href="https:\/\/example\.test\/cli-second"/);

  const dockerSearch = await run(process.execPath,
    [cli, 'find', 'amiga', '--browser', '--dry-run'], {
      env: { ...env, BOOKMARK_RESULTS_HOST_VAULT: 'C:\\Users\\me\\My Vault' }
    });
  assert.match(dockerSearch.stdout.trim(),
    /^file:\/\/\/C:\/Users\/me\/My%20Vault\/views\/\.search-results\/search-results-[\da-f-]+\.html$/);

  const nativePageCapture = path.join(root, 'browser-page-url.txt');
  const nativeBrowserSearch = await run(process.execPath,
    [cli, 'find', 'amiga', '--browser', '--with', fakeBrowser], {
      env: { ...env, BOOKMARK_BROWSER_CAPTURE: nativePageCapture }
    });
  const printedPageUrl = nativeBrowserSearch.stdout.match(
    /Search results file:\n(file:\/\/\/[^\r\n]+)/)?.[1];
  assert.ok(printedPageUrl, 'expected a standalone search-results file link');
  assert.equal(await readEventually(nativePageCapture), printedPageUrl);
  assert.match(nativeBrowserSearch.stdout, /Opened 2 bookmark results in the browser/);

  await assert.rejects(
    () => run(process.execPath,
      [cli, 'find', 'amiga', '--browser', '--with', missingBrowser], { env }),
    (error) => {
      assert.match(error.stderr, /Could not launch browser .*application or executable was not found/);
      assert.doesNotMatch(error.stderr, /\n\s+at /);
      assert.match(error.stdout, /Search results file:\nfile:\/\/\//);
      assert.match(error.stdout, /Open the search results link above manually/);
      assert.doesNotMatch(error.stdout, /Opened 2 bookmark results/);
      return true;
    }
  );

  const dockerBrowserSearch = await run(process.execPath,
    [cli, 'find', 'amiga', '--browser'], {
      env: { ...env, BOOKMARK_RESULTS_HOST_VAULT: 'C:\\Users\\me\\My Vault' }
    });
  assert.match(dockerBrowserSearch.stdout,
    /Search results file:\nfile:\/\/\/C:\/Users\/me\/My%20Vault\/views\/\.search-results\/search-results-[\da-f-]+\.html/);

  const installed = await run(process.execPath, [cli, 'skill', 'install', '--path', root], { env });
  assert.match(installed.stdout, new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*SKILL\\.md`));
});
