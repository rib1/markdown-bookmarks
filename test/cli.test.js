import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const cli = path.resolve('src', 'cli.js');

test('CLI help lists commands, launch options, browser choices, and linked workflows', async () => {
  const generalHelp = await run(process.execPath, [cli, 'help']);
  assert.match(generalHelp.stdout, /Markdown Bookmarks commands:/);
  assert.match(generalHelp.stdout, /find QUERY .*--with BROWSER/);
  assert.match(generalHelp.stdout, /open QUERY .*--pick NUMBER.*--with BROWSER.*--dry-run/);
  assert.match(generalHelp.stdout, /Common workflows:/);
  assert.match(generalHelp.stdout, /find database\n\s+npm run bookmark -- open database --pick 3/);
  assert.match(generalHelp.stdout, /open database --pick 3 --with firefox/);
  assert.match(generalHelp.stdout, /find database --browser --with chrome/);

  const openHelp = await run(process.execPath, [cli, 'open', '--help']);
  assert.match(openHelp.stdout, /--pick NUMBER/);
  assert.match(openHelp.stdout, /--with BROWSER/);
  assert.match(openHelp.stdout, /--dry-run/);
  assert.match(openHelp.stdout, /chrome, edge, firefox, brave/);
  assert.match(openHelp.stdout, /safari\s+macOS only/);
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

  const saved = await run(process.execPath, [cli, 'save', '--url', 'https://example.test/cli', '--title', 'CLI Amiga', '--tags', 'amiga,test'], { env });
  const savedResult = JSON.parse(saved.stdout);
  assert.ok(savedResult.file);

  const found = await run(process.execPath, [cli, 'find', 'amiga'], { env });
  assert.match(found.stdout, /URL: https:\/\/example.test\/cli/);
  assert.match(found.stdout, /- "amiga"/);
  assert.match(found.stdout, /title: "CLI Amiga"/);

  const opened = await run(process.execPath, [cli, 'open', 'amiga', '--dry-run'], { env });
  assert.equal(opened.stdout.trim(), 'https://example.test/cli');

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

  const installed = await run(process.execPath, [cli, 'skill', 'install', '--path', root], { env });
  assert.match(installed.stdout, new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*SKILL\\.md`));
});
