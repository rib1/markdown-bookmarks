#!/usr/bin/env node
import { saveBookmark, findBookmarks, initVault, vaultRoot } from './vault.js';
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function metadataValue(content, field) {
  return content.match(new RegExp(`^${field}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, 'm'))?.[1];
}

function printSearchResult(result) {
  console.log(`FILE: ${result.file}`);
  console.log(`URL: ${metadataValue(result.content, 'url') || '(missing)'}`);
  console.log(result.content);
  console.log('---');
}

if (command === 'init') {
  const root = option('--path') || vaultRoot();
  await initVault(root, { installSkill: !args.includes('--no-skill') });
  console.log(`Vault ready: ${root}`);
  if (!args.includes('--no-skill')) console.log('LLM skill installed: .codex/skills/markdown-bookmark-vault/SKILL.md');
  console.log('Next: git -C "' + root + '" init');
} else if (command === 'save') {
  const url = option('--url');
  if (!url) throw new Error('Usage: npm run bookmark -- save --url URL --title TITLE --tags tag1,tag2');
  const result = await saveBookmark({ url, title: option('--title'), tags: (option('--tags') || '').split(',') });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'find') {
  const query = args.find((arg) => !arg.startsWith('-'));
  if (!query) throw new Error('Usage: npm run bookmark -- find QUERY');
  for (const result of await findBookmarks(query, undefined, { savedWithin: option('--saved-within'), savedSince: option('--saved-since') })) printSearchResult(result);
} else if (command === 'open') {
  const query = args.find((arg) => !arg.startsWith('-'));
  const dryRun = args.includes('--dry-run');
  if (!query) throw new Error('Usage: npm run bookmark -- open QUERY [--dry-run]');
  const [result] = await findBookmarks(query);
  if (!result) throw new Error(`No bookmark found for: ${query}`);
  const url = result.content.match(/^url:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
  if (!url || !/^https?:\/\//i.test(url)) throw new Error(`Bookmark has no safe HTTP URL: ${result.file}`);
  if (dryRun) {
    console.log(url);
  } else if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
} else {
  console.log('Commands: init [--path PATH] [--no-skill], save --url URL [--title TITLE] [--tags tag1,tag2], find QUERY [--saved-within day|week|month|year] [--saved-since YYYY-MM-DD], open QUERY [--dry-run]');
}
