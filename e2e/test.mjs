import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';

const exec = promisify(execFile);
const vault = process.env.VAULT_PATH || '/vault';
const extensionPath = path.resolve('/e2e/extension');
console.log('launching Chrome');
const browser = await chromium.launchPersistentContext('/tmp/bookmark-chrome-profile', {
  headless: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
});

try {
  const page = await browser.newPage();
  console.log('opening test page');
  await page.goto('data:text/html,<title>E2E Bookmark Page</title><h1>E2E Bookmark Page</h1>');
  console.log('discovering extension');
  const serviceWorker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(serviceWorker.url()).host;
  const popup = await browser.newPage();
  console.log('opening extension popup');
  await popup.goto(`chrome-extension://${extensionId}/popup.html?test-url=${encodeURIComponent('https://example.test/e2e-bookmark')}&test-title=${encodeURIComponent('E2E Bookmark Page')}`);
  await popup.locator('#tags').fill('e2e,work');
  await popup.getByRole('button', { name: 'Save current tab' }).click();
  console.log('waiting for save response');
  await expect(popup.locator('#result')).toHaveText('Saved.', { timeout: 10_000 });

  const yearMonth = new Date().toISOString().slice(0, 7).replace('-', path.sep);
  const directory = path.join(vault, 'bookmarks', yearMonth);
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.md'));
  assert.ok(files.length > 0, 'expected a Markdown bookmark file');
  const content = await fs.readFile(path.join(directory, files.at(-1)), 'utf8');
  assert.match(content, /E2E Bookmark Page/);
  assert.match(content, /- "e2e"/);
  assert.match(content, /- "work"/);
  const opened = await exec('node', ['src/cli.js', 'open', 'E2E Bookmark Page', '--dry-run'], { cwd: '/e2e', env: { ...process.env, BOOKMARK_VAULT: vault } });
  assert.equal(opened.stdout.trim(), 'https://example.test/e2e-bookmark');
  console.log(`E2E passed: ${files.at(-1)}`);
} finally {
  await browser.close();
}
