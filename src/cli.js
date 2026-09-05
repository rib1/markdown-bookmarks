#!/usr/bin/env node
import { saveBookmark, findBookmarks, initVault, installVaultSkill, vaultRoot } from './vault.js';
import { createInterface } from 'node:readline/promises';
import { openInBrowser } from './browser-launcher.js';
import {
  createSearchResultsPage,
  hostSearchResultsFileUrl
} from './search-results-page.js';
import { metadataValue, sortSearchResults } from './search-result-order.js';
import { CANCELLED_SELECTION, interactiveResult, pickedResult } from './open-selection.js';
import { readList } from './bookmark-format.js';

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

function printSearchResult(result, index, expand = false) {
  const title = metadataValue(result.content, 'title') || '(untitled)';
  const url = metadataValue(result.content, 'url') || '(missing)';
  const id = String(metadataValue(result.content, 'id') || '');
  if (!expand) {
    const tags = readList(result.content, 'tags');
    console.log(`${index + 1}. ${title}${id ? ` [${id.slice(0, 8)}]` : ''}`);
    console.log(`   URL: ${url}`);
    console.log(`   TAGS: ${tags.join(', ') || '(none)'}`);
    if (result.matchType) {
      const fields = result.matchedFields?.length ? ` (${result.matchedFields.join(', ')})` : '';
      console.log(`   MATCH: ${result.matchType} ${Math.round(result.matchScore * 100)}%${fields}`);
    }
    return;
  }
  console.log(`RESULT: ${index + 1} — ${title}`);
  console.log(`FILE: ${result.file}`);
  console.log(`URL: ${url}`);
  if (result.matchType) {
    const fields = result.matchedFields?.length ? ` (${result.matchedFields.join(', ')})` : '';
    console.log(`MATCH: ${result.matchType} ${Math.round(result.matchScore * 100)}%${fields}`);
  }
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

async function launchBrowserOrExplain(target, browser, { linkAlreadyPrinted = false } = {}) {
  try {
    await openInBrowser(target, browser);
    return true;
  } catch (error) {
    const browserLabel = browser ? `browser "${browser}"` : 'the default browser';
    const reason = error.code === 'ENOENT'
      ? 'the application or executable was not found'
      : 'the application could not be opened';
    console.error(`Could not launch ${browserLabel}: ${reason}.`);
    if (linkAlreadyPrinted) console.log('Open the search results link above manually.');
    else {
      console.log('Open this link manually:');
      console.log(target);
    }
    process.exitCode = 1;
    return false;
  }
}

function printOpenHelp() {
  console.log(`Usage: npm run bookmark -- open QUERY [options]

Find a bookmark and open its HTTP/HTTPS URL.

When using npm, keep the "--" after "bookmark" so npm forwards every option
below to this CLI.

Options:
  --pick NUMBER     Skip the menu and directly open a numbered search result.
  --saved-within PERIOD
                    Only match bookmarks saved within day, week, month, or year.
  --saved-since DATE
                    Only match bookmarks saved on or after YYYY-MM-DD.
  --fuzzy           Use typo-tolerant ranked matching instead of exact-only matching.
  --with BROWSER   Use a browser alias, application name, executable, or executable path.
  --dry-run         Print the selected URL without launching a browser.
  --help, -h        Show this help.

Browser aliases:
  chrome, edge, firefox, brave
  safari            macOS only

Multiple matches:
  Without --pick, an interactive terminal displays a numbered menu and asks
  you to choose. Press Enter without a number to cancel and open nothing.
  With --pick NUMBER, that menu is skipped and the numbered
  match for the current query opens directly. --pick=NUMBER is also accepted.
  With --fuzzy, numbering follows match score; exact matches rank first.

Launch failures:
  If the selected browser is missing or cannot start, the command prints the
  target link for manual opening and exits with a nonzero status.

Examples:
  npm run bookmark -- open database
  npm run bookmark -- open database --pick 2
  npm run bookmark -- open database --with firefox
  npm run bookmark -- open database --with chrome
  npm run bookmark -- open triper --fuzzy
  npm run bookmark -- open database --dry-run

Open a bookmark by the short ID shown in find output:
  npm run bookmark -- find database
  npm run bookmark -- open d34db33f

Full stable IDs work too:
  npm run bookmark -- open 550e8400-e29b-41d4-a716-446655440000

Search first, then open the third matching link:
  npm run bookmark -- find database
  npm run bookmark -- open database --pick 3

Search by date, then open the third result from that same filtered list:
  npm run bookmark -- find database --saved-since 2026-09-01
  npm run bookmark -- open database --saved-since 2026-09-01 --pick 3

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
  save --url URL [--title TITLE] [--tags tag1,tag2] [--shared-by NAME] [--via CHANNEL]
  find QUERY [--saved-within day|week|month|year] [--saved-since YYYY-MM-DD] [--fuzzy] [--expand] [--browser] [--with BROWSER] [--dry-run]
  open QUERY [--pick NUMBER] [--saved-within day|week|month|year] [--saved-since YYYY-MM-DD] [--fuzzy] [--with BROWSER] [--dry-run]

npm syntax:
  Keep the "--" in "npm run bookmark -- COMMAND". It forwards options such as
  --browser, --fuzzy, --expand, --pick, --saved-within, --saved-since, --with,
  and --dry-run to the bookmark CLI.

Compact find output:
  1. Night Drive [d34db33f]
     URL: https://desert-sounds.bandcamp.com/album/night-drive
     TAGS: bandcamp, music

Use find QUERY --expand to include vault file paths and full Markdown records.
The displayed ID prefix can be used with open when it uniquely identifies a bookmark.

Common workflows:
  npm run bookmark -- save --url https://example.test/page --shared-by Alice --via Signal
  npm run bookmark -- find database
  npm run bookmark -- open database --pick 3
  npm run bookmark -- find database --expand
  npm run bookmark -- open d34db33f
  npm run bookmark -- find database --saved-within week
  npm run bookmark -- find travel --saved-within month
  npm run bookmark -- find archive --saved-within year
  npm run bookmark -- find database --saved-since 2026-09-01
  npm run bookmark -- open database --saved-since 2026-09-01 --pick 3
  npm run bookmark -- open database --pick 3 --with firefox
  npm run bookmark -- find triper --fuzzy
  npm run bookmark -- find database --browser --with chrome

Run "npm run bookmark -- open --help" for launch options and browser details.`);
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
    return interactiveResult(sorted, await prompt.question(`Choose a bookmark [1-${sorted.length}, Enter to cancel]: `));
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
  if (!url) throw new Error('Usage: npm run bookmark -- save --url URL [--title TITLE] [--tags tag1,tag2] [--shared-by NAME] [--via CHANNEL]');
  const result = await saveBookmark({
    url,
    title: option('--title'),
    tags: (option('--tags') || '').split(','),
    shared_by: option('--shared-by'),
    shared_via: option('--via')
  });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'find') {
  const query = positionalArgument(['--saved-within', '--saved-since', '--with']);
  if (!query) throw new Error('Usage: npm run bookmark -- find QUERY');
  const selectedBrowser = option('--with');
  const fuzzy = args.includes('--fuzzy');
  if (args.includes('--with') && (!selectedBrowser || selectedBrowser.startsWith('-'))) {
    throw new Error('--with requires a browser name or executable');
  }
  if (selectedBrowser && !args.includes('--browser')) throw new Error('--with requires find --browser');
  const results = await findBookmarks(query, undefined, {
    savedWithin: option('--saved-within'),
    savedSince: option('--saved-since'),
    fuzzy
  });
  if (!results.length) {
    console.log(`No bookmarks found for: ${query}`);
  } else if (args.includes('--browser')) {
    const page = await createSearchResultsPage(query, results);
    const hostVaultPath = process.env.BOOKMARK_RESULTS_HOST_VAULT;
    const pageUrl = hostVaultPath ? hostSearchResultsFileUrl(page.token, hostVaultPath) : page.fileUrl;
    if (args.includes('--dry-run')) console.log(pageUrl);
    else {
      console.log('Search results file:');
      console.log(pageUrl);
      if (!hostVaultPath) {
        const launched = await launchBrowserOrExplain(pageUrl, selectedBrowser, { linkAlreadyPrinted: true });
        if (launched) console.log(`Opened ${page.count} bookmark result${page.count === 1 ? '' : 's'} in the browser.`);
      }
    }
  } else {
    sortSearchResults(results).forEach((result, index) => printSearchResult(result, index, args.includes('--expand')));
  }
} else if (command === 'open') {
  if (args.includes('--help') || args.includes('-h')) {
    printOpenHelp();
  } else {
    const query = positionalArgument(['--pick', '--with', '--saved-within', '--saved-since']);
    const dryRun = args.includes('--dry-run');
    const fuzzy = args.includes('--fuzzy');
    const selectedBrowser = option('--with');
    if (args.includes('--with') && (!selectedBrowser || selectedBrowser.startsWith('-'))) {
      throw new Error('--with requires a browser name or executable');
    }
    if (!query) throw new Error('Usage: npm run bookmark -- open QUERY [--pick NUMBER] [--saved-within day|week|month|year] [--saved-since YYYY-MM-DD] [--fuzzy] [--with BROWSER] [--dry-run]');
    const selection = await chooseOpenResult(await findBookmarks(query, undefined, {
      fuzzy,
      savedWithin: option('--saved-within'),
      savedSince: option('--saved-since')
    }), option('--pick'));
    if (selection === CANCELLED_SELECTION) {
      console.log('Cancelled.');
    } else {
      if (!selection) throw new Error(`No bookmark found for: ${query}`);
      const url = selection.content.match(/^url:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
      if (!url || !/^https?:\/\//i.test(url)) throw new Error(`Bookmark has no safe HTTP URL: ${selection.file}`);
      if (dryRun) {
        console.log(url);
      } else if (process.env.BOOKMARK_RESULTS_HOST_VAULT) {
        console.log(`Open bookmark${selectedBrowser ? ` in ${selectedBrowser}` : ''}: ${url}`);
      } else {
        await launchBrowserOrExplain(url, selectedBrowser);
      }
    }
  }
} else {
  printHelp();
}
