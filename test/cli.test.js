import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('CLI commands initialize, save, find, install the vault skill, and dry-run open', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-bookmarks-cli-'));
  const env = {
    ...process.env,
    BOOKMARK_VAULT: root,
    SKILL_SOURCE: path.resolve('skills', 'markdown-bookmark-vault', 'SKILL.md')
  };
  const cli = path.resolve('src', 'cli.js');

  const initialized = await run(process.execPath, [cli, 'init', '--path', root], { env });
  assert.match(initialized.stdout, /Vault ready/);

  const saved = await run(process.execPath, [cli, 'save', '--url', 'https://example.test/cli', '--title', 'CLI Amiga', '--tags', 'amiga,test'], { env });
  const savedResult = JSON.parse(saved.stdout);
  assert.ok(savedResult.file);

  const found = await run(process.execPath, [cli, 'find', 'amiga'], { env });
  assert.match(found.stdout, /URL: https:\/\/example.test\/cli/);
  assert.match(found.stdout, /- "amiga"/);
  assert.match(found.stdout, /title: "CLI Amiga"/);

  const opened = await run(process.execPath, [cli, 'open', 'amiga', '--dry-run'], { env });
  assert.equal(opened.stdout.trim(), 'https://example.test/cli');

  const installed = await run(process.execPath, [cli, 'skill', 'install', '--path', root], { env });
  assert.match(installed.stdout, new RegExp(`${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*SKILL\\.md`));
});
