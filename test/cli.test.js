import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

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

test('CLI help lists commands, launch options, browser choices, and linked workflows', async () => {
  const generalHelp = await run(process.execPath, [cli, 'help']);
  assert.match(generalHelp.stdout, /Markdown Bookmarks commands:/);
  assert.match(generalHelp.stdout, /find QUERY .*--with BROWSER/);
  assert.match(generalHelp.stdout, /open QUERY .*--pick NUMBER.*--with BROWSER.*--dry-run/);
  assert.match(generalHelp.stdout, /Keep the "--" in "npm run bookmark -- COMMAND"/);
  assert.match(generalHelp.stdout, /--browser, --pick, --with, and --dry-run/);
  assert.match(generalHelp.stdout, /Common workflows:/);
  assert.match(generalHelp.stdout, /find database\n\s+npm run bookmark -- open database --pick 3/);
  assert.match(generalHelp.stdout, /open database --pick 3 --with firefox/);
  assert.match(generalHelp.stdout, /find database --browser --with chrome/);

  const openHelp = await run(process.execPath, [cli, 'open', '--help']);
  assert.match(openHelp.stdout, /--pick NUMBER/);
  assert.match(openHelp.stdout, /keep the "--" after "bookmark"/i);
  assert.match(openHelp.stdout, /Without --pick, an interactive terminal displays a numbered menu/);
  assert.match(openHelp.stdout, /With --pick NUMBER, that menu is skipped/);
  assert.match(openHelp.stdout, /--pick=NUMBER is also accepted/);
  assert.match(openHelp.stdout, /If the selected browser is missing or cannot start/);
  assert.match(openHelp.stdout, /target link for manual opening/);
  assert.match(openHelp.stdout, /--with BROWSER/);
  assert.match(openHelp.stdout, /--dry-run/);
  assert.match(openHelp.stdout, /chrome, edge, firefox, brave/);
  assert.match(openHelp.stdout, /safari\s+macOS only/);
  assert.match(openHelp.stdout,
    /Open a bookmark by its stable ID:\n\s+npm run bookmark -- open 550e8400-e29b-41d4-a716-446655440000/);
  assert.match(openHelp.stdout, /find database\n\s+npm run bookmark -- open database --pick 3/);
  assert.match(openHelp.stdout, /find database --browser --with firefox/);
  assert.match(openHelp.stdout, /Docker cannot launch a host application/);
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

  const saved = await run(process.execPath, [cli, 'save', '--url', 'https://example.test/cli', '--title', 'CLI Amiga', '--tags', 'amiga,test'], { env });
  const savedResult = JSON.parse(saved.stdout);
  assert.ok(savedResult.file);
  const savedContent = await fs.readFile(savedResult.file, 'utf8');
  const savedId = savedContent.match(/^id:\s*([^\r\n]+)$/m)?.[1];
  assert.ok(savedId);

  const found = await run(process.execPath, [cli, 'find', 'amiga'], { env });
  assert.match(found.stdout, /URL: https:\/\/example.test\/cli/);
  assert.match(found.stdout, /- "amiga"/);
  assert.match(found.stdout, /title: "CLI Amiga"/);

  const opened = await run(process.execPath, [cli, 'open', 'amiga', '--dry-run'], { env });
  assert.equal(opened.stdout.trim(), 'https://example.test/cli');
  const openedById = await run(process.execPath, [cli, 'open', savedId, '--dry-run'], { env });
  assert.equal(openedById.stdout.trim(), 'https://example.test/cli');

  await run(process.execPath, [cli, 'save', '--url', 'https://example.test/cli-second',
    '--title', 'Second Amiga', '--tags', 'amiga,test'], { env });
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
