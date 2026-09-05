import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';

const exec = promisify(execFile);
// The vault is a Docker volume so the test can inspect files written by the service.
const vault = process.env.VAULT_PATH || '/vault';
const extensionPath = path.resolve('/e2e/extension');
console.log('launching Chrome');
// A persistent, headed context is required for loading an unpacked MV3 extension.
const browser = await chromium.launchPersistentContext('/tmp/bookmark-chrome-profile', {
  headless: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});

try {
  // Create a deterministic page that represents the active browser tab.
  const page = await browser.newPage();
  console.log('opening test page');
  await page.goto('data:text/html,<title>E2E Bookmark Page</title><h1>E2E Bookmark Page</h1>');
  console.log('discovering extension');
  const serviceWorker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  const popup = await browser.newPage();
  console.log('opening extension popup');
  const testUrl = `https://example.test/e2e-bookmark?run=${Date.now()}`;
  // The test URL avoids relying on browser chrome UI to open the action popup.
  await popup.goto(`chrome-extension://${extensionId}/popup.html?test-url=${encodeURIComponent(testUrl)}&test-title=${encodeURIComponent('E2E Bookmark Page')}`);
  // Exercise the same tag-entry and save path used by the user.
  await popup.locator('#context').selectOption('travel');
  await popup.locator('#tags').fill('e2e,work');
  await popup.getByRole('button', { name: 'Save current tab' }).click();
  console.log('waiting for save response');
  await expect(popup.locator('#result')).toHaveText('Saved.', { timeout: 10_000 });
  // Save the same URL again to verify deduplication and tag merging.
  await popup.locator('#tags').fill('e2e,work,duplicate');
  await popup.getByRole('button', { name: 'Save current tab' }).click();
  await expect(popup.locator('#result')).toHaveText('Saved.', { timeout: 10_000 });

  const yearMonth = new Date().toISOString().slice(0, 7).replace('-', path.sep);
  const directory = path.join(vault, 'bookmarks', yearMonth);
  // Verify the extension -> HTTP API -> companion -> Markdown file path.
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.md'));
  assert.ok(files.length > 0, 'expected a Markdown bookmark file');
  const matching = [];
  for (const file of files) {
    const candidate = await fs.readFile(path.join(directory, file), 'utf8');
    if (candidate.includes(testUrl)) matching.push({ file, content: candidate });
  }
  assert.equal(matching.length, 1, 'expected duplicate saves to produce one Markdown file');
  const { file, content } = matching[0];
  assert.match(content, /E2E Bookmark Page/);
  assert.match(content, /- "e2e"/);
  assert.match(content, /- "work"/);
  assert.match(content, /- "duplicate"/);
  assert.match(content, /contexts:\n {2}- "travel"/);
  assert.match(content, /save_count: 2/);
  const saveHistory = content.match(/^save_history:\n((?: {2}- .*\n)+)/m)?.[1];
  assert.equal((saveHistory?.match(/^ {2}- /gm) || []).length, 2);
  // Verify that the CLI can resolve the saved bookmark for browser opening.
  const opened = await exec('node', ['src/cli.js', 'open', testUrl, '--dry-run'], { cwd: '/e2e', env: { ...process.env, BOOKMARK_VAULT: vault } });
  assert.equal(opened.stdout.trim(), testUrl);
  // Verify search returns the URL and full Markdown content, not only a filename.
  const found = await exec('node', ['src/cli.js', 'find', testUrl], { cwd: '/e2e', env: { ...process.env, BOOKMARK_VAULT: vault } });
  assert.match(found.stdout, new RegExp(`URL: ${testUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(found.stdout, /- "duplicate"/);
  console.log(`E2E passed: ${file}`);
} finally {
  await browser.close();
}
