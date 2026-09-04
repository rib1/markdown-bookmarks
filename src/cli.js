#!/usr/bin/env node
import { saveBookmark, findBookmarks } from './vault.js';

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
} else {
  console.log('Commands: save --url URL [--title TITLE] [--tags tag1,tag2], find QUERY');
}
