#!/usr/bin/env node
import { saveBookmark, findBookmarks, initVault, installVaultSkill, vaultRoot } from './vault.js';
import { createInterface } from 'node:readline/promises';
import { openInBrowser } from './browser-launcher.js';
import {
  createSearchResultsPage,
  hostSearchResultsFileUrl,
  metadataValue,
  sortSearchResults
} from './search-results-page.js';

const [command, ...args] = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index >= 0) {
    const value = args[index + 1];
    return value?.startsWith('--') ? undefined : value;
  }
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  return inline?.slice(name.length + 1) || undefined;
}

function positionalArgument(valueOptions = []) {
  for (let index = 0; index < args.length; index++) {
    if (valueOptions.includes(args[index])) {
      index++;
      continue;
    }
    if (!args[index].startsWith('-')) return args[index];
  }
  return undefined;
}

function printSearchResult(result) {
  console.log(`FILE: ${result.file}`);
  console.log(`URL: ${metadataValue(result.content, 'url') || '(missing)'}`);
  console.log(result.content);
  console.log('---');
}

function printOpenChoices(results) {
  console.log('Multiple bookmarks found:');
  results.forEach((result, index) => {
    const title = metadataValue(result.content, 'title') || '(untitled)';
    const url = metadataValue(result.content, 'url') || '(missing URL)';
    console.log(`${index + 1}. ${title} — ${url}`);
  });
}

function printOpenHelp() {
  console.log(`Usage: npm run bookmark -- open QUERY [options]

Find a bookmark and open its HTTP/HTTPS URL.

Options:
  --pick NUMBER     Skip the menu and directly open a numbered search result.
  --with BROWSER   Use a browser alias, application name, executable, or executable path.
  --dry-run         Print the selected URL without launching a browser.
  --help, -h        Show this help.

Browser aliases:
  chrome, edge, firefox, brave
  safari            macOS only

Multiple matches:
  Without --pick, an interactive terminal displays a numbered menu and asks
  you to choose. With --pick NUMBER, that menu is skipped and the numbered
  match for the current query opens directly. --pick=NUMBER is also accepted.

Examples:
  npm run bookmark -- open database
  npm run bookmark -- open database --pick 2
  npm run bookmark -- open database --with firefox
  npm run bookmark -- open database --with "Google Chrome"
  npm run bookmark -- open database --dry-run

Open a bookmark by its stable ID:
  npm run bookmark -- open 550e8400-e29b-41d4-a716-446655440000

Search first, then open the third matching link:
  npm run bookmark -- find database
  npm run bookmark -- open database --pick 3

Open that third link in Firefox:
  npm run bookmark -- open database --pick 3 --with firefox

Open all search matches as a browser page:
  npm run bookmark -- find database --browser
  npm run bookmark -- find database --browser --with firefox

On macOS, custom values are passed to "open -a" as application names. On
Windows and Linux, custom values are launched directly and must be executable
paths or commands available on PATH. Docker cannot launch a host application,
so the Docker command prints the selected URL for opening on the host.`);
}

function printHelp() {
  console.log(`Markdown Bookmarks commands:
  init [--path PATH] [--no-skill]
  skill install [--path PATH]
  save --url URL [--title TITLE] [--tags tag1,tag2]
  find QUERY [--saved-within PERIOD] [--saved-since DATE] [--browser] [--with BROWSER] [--dry-run]
  open QUERY [--pick NUMBER] [--with BROWSER] [--dry-run]

Common workflows:
  npm run bookmark -- find database
  npm run bookmark -- open database --pick 3
  npm run bookmark -- open database --pick 3 --with firefox
  npm run bookmark -- find database --browser --with chrome

Run "npm run bookmark -- open --help" for launch options and browser details.`);
}

function pickedResult(results, value) {
  const pick = Number(value);
  if (!Number.isInteger(pick) || pick < 1 || pick > results.length) {
    throw new Error(`--pick must be a number from 1 to ${results.length}`);
  }
  return results[pick - 1];
}

async function chooseOpenResult(results, requestedPick) {
  if (!results.length) return undefined;
  const sorted = sortSearchResults(results);
  if (requestedPick !== undefined) return pickedResult(sorted, requestedPick);
  if (sorted.length === 1) return sorted[0];

  printOpenChoices(sorted);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Multiple bookmarks found; rerun with --pick NUMBER');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return pickedResult(sorted, await prompt.question(`Choose a bookmark [1-${sorted.length}]: `));
  } finally {
    prompt.close();
  }
}

if (command === 'help' || command === '--help' || command === '-h') {
  printHelp();
} else if (command === 'init') {
  const root = option('--path') || vaultRoot();
  await initVault(root, { installSkill: !args.includes('--no-skill') });
  console.log(`Vault ready: ${root}`);
  if (!args.includes('--no-skill')) console.log('LLM skill installed: .codex/skills/markdown-bookmark-vault/SKILL.md');
  console.log('Next: git -C "' + root + '" init');
} else if (command === 'skill' && args[0] === 'install') {
  const root = option('--path') || vaultRoot();
  const target = await installVaultSkill(root);
  console.log(`LLM skill installed in vault: ${target}`);
} else if (command === 'save') {
  const url = option('--url');
  if (!url) throw new Error('Usage: npm run bookmark -- save --url URL --title TITLE --tags tag1,tag2');
  const result = await saveBookmark({ url, title: option('--title'), tags: (option('--tags') || '').split(',') });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'find') {
  const query = positionalArgument(['--saved-within', '--saved-since', '--with']);
  if (!query) throw new Error('Usage: npm run bookmark -- find QUERY');
  const selectedBrowser = option('--with');
  if (args.includes('--with') && (!selectedBrowser || selectedBrowser.startsWith('-'))) {
    throw new Error('--with requires a browser name or executable');
  }
  if (selectedBrowser && !args.includes('--browser')) throw new Error('--with requires find --browser');
  const results = await findBookmarks(query, undefined, { savedWithin: option('--saved-within'), savedSince: option('--saved-since') });
  if (args.includes('--browser')) {
    const page = await createSearchResultsPage(query, results);
    const hostVaultPath = process.env.BOOKMARK_RESULTS_HOST_VAULT;
    const pageUrl = hostVaultPath ? hostSearchResultsFileUrl(page.token, hostVaultPath) : page.fileUrl;
    if (args.includes('--dry-run')) console.log(pageUrl);
    else {
      console.log('Search results file:');
      console.log(pageUrl);
      if (!hostVaultPath) {
        await openInBrowser(pageUrl, selectedBrowser);
        console.log(`Opened ${page.count} bookmark result${page.count === 1 ? '' : 's'} in the browser.`);
      }
    }
  } else {
    for (const result of results) printSearchResult(result);
  }
} else if (command === 'open') {
  if (args.includes('--help') || args.includes('-h')) {
    printOpenHelp();
  } else {
    const query = positionalArgument(['--pick', '--with']);
    const dryRun = args.includes('--dry-run');
    const selectedBrowser = option('--with');
    if (args.includes('--with') && (!selectedBrowser || selectedBrowser.startsWith('-'))) {
      throw new Error('--with requires a browser name or executable');
    }
    if (!query) throw new Error('Usage: npm run bookmark -- open QUERY [--pick NUMBER] [--with BROWSER] [--dry-run]');
    const result = await chooseOpenResult(await findBookmarks(query), option('--pick'));
    if (!result) throw new Error(`No bookmark found for: ${query}`);
    const url = result.content.match(/^url:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
    if (!url || !/^https?:\/\//i.test(url)) throw new Error(`Bookmark has no safe HTTP URL: ${result.file}`);
    if (dryRun) {
      console.log(url);
    } else if (process.env.BOOKMARK_RESULTS_HOST_VAULT) {
      console.log(`Open bookmark${selectedBrowser ? ` in ${selectedBrowser}` : ''}: ${url}`);
    } else {
      await openInBrowser(url, selectedBrowser);
    }
  }
} else {
  printHelp();
}
