#!/usr/bin/env node
import { saveBookmark, findBookmarks } from './vault.js';
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (command === 'save') {
  const url = option('--url');
  if (!url) throw new Error('Usage: npm run bookmark -- save --url URL --title TITLE --tags tag1,tag2');
  const result = await saveBookmark({ url, title: option('--title'), tags: (option('--tags') || '').split(',') });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'find') {
  const query = args.find((arg) => !arg.startsWith('-'));
  if (!query) throw new Error('Usage: npm run bookmark -- find QUERY');
  for (const result of await findBookmarks(query)) console.log(result.file);
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
  console.log('Commands: save --url URL [--title TITLE] [--tags tag1,tag2], find QUERY, open QUERY [--dry-run]');
}
