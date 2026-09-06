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
import { parseFindArguments } from './tui-find-arguments.js';
import { parseOpenArguments } from './tui-open-arguments.js';
import { parseInitArguments, parseSaveArguments, parseSkillInstallArguments } from './tui-basic-arguments.js';
import { parseVaultArguments } from './tui-vault-arguments.js';
import { renderVaultGitHelp } from './vault-git-help.js';
import {
  formatDirectoryCommand,
  hostDirectoryCommands,
  openDirectory
} from './vault-directory-launcher.js';

const [command, ...args] = process.argv.slice(2);

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

function printInitHelp() {
  console.log(`Usage: npm run bookmark -- init [options]

Initialize the selected private bookmark vault.

Options:
  --path PATH       Initialize this vault path instead of the configured default.
  --no-skill        Do not install the optional vault-management LLM skill.
  --help, -h        Show this help.`);
}

function printSkillHelp() {
  console.log(`Usage: npm run bookmark -- skill install [options]

Install or refresh the vault-management LLM skill.

Options:
  --path PATH       Install into this vault path instead of the configured default.
  --help, -h        Show this help.`);
}

function printSaveHelp() {
  console.log(`Usage: npm run bookmark -- save --url URL [options]

Save one HTTP/HTTPS bookmark through the TUI.

Options:
  --url URL         Bookmark URL. Required.
  --title TITLE     Bookmark title.
  --tags TAGS       Comma-separated tags.
  --shared-by NAME  Person who sent the link.
  --via CHANNEL     Channel through which the link was received.
  --help, -h        Show this help.`);
}

function printVaultHelp() {
  console.log(`Usage: npm run bookmark -- vault git-help [--full]
   or: npm run bookmark -- vault open [--dry-run]

No Git command is run and no network connection is made by git-help. Vault open
uses the native file explorer; Docker prints a host command instead.

Options:
  --full            Include initialization, remote-check, and conflict help.
  --dry-run         Print the native file-explorer command without running it.
  --help, -h        Show this help.`);
}

async function openVaultDirectory(root, dryRun) {
  const hostRoot = process.env.BOOKMARK_RESULTS_HOST_VAULT;
  if (hostRoot) {
    console.log('Open the vault on the host:');
    hostDirectoryCommands(hostRoot).forEach((line) => console.log(`  ${line}`));
    return;
  }
  const commandLine = formatDirectoryCommand(root);
  if (dryRun) {
    console.log(commandLine);
    return;
  }
  try {
    await openDirectory(root);
    console.log(`Opened vault: ${root}`);
  } catch {
    console.error('Could not open the vault in the native file explorer.');
    console.log(`Open it manually with: ${commandLine}`);
    process.exitCode = 1;
  }
}

function printFindHelp() {
  console.log(`Usage: npm run bookmark -- find QUERY [options]
   or: npm run bookmark -- find --saved-within day|week|month|year [options]
   or: npm run bookmark -- find --saved-since YYYY-MM-DD [options]

Search bookmarks and print deterministic TUI results.

Options:
  --saved-within PERIOD
                    Match bookmarks saved within day, week, month, or year.
  --saved-since DATE
                    Match bookmarks saved on or after strict YYYY-MM-DD.
  --fuzzy           Use typo-tolerant ranked matching.
  --expand          Include vault paths and full Markdown records.
  --browser         Generate a local HTML results page.
  --with BROWSER    Open that page with a selected browser; requires --browser.
  --dry-run         Print the generated page URL without opening; requires --browser.
  --help, -h        Show this help.

Rules:
  QUERY may be omitted only with one time filter. Use either --saved-within or
  --saved-since, not both. Quote a multiword query. Use the end-of-options
  marker before a query beginning with a hyphen. --expand and --browser cannot
  be combined.

Examples:
  npm run bookmark -- find amiga
  npm run bookmark -- find 'amiga music'
  npm run bookmark -- find --saved-within day
  npm run bookmark -- find --saved-since 2026-09-01
  npm run bookmark -- find amiga --saved-within month --fuzzy
  npm run bookmark -- find amiga --browser --dry-run
  npm run bookmark -- find -- -amiga`);
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
  vault git-help [--full]
  vault open [--dry-run]
  save --url URL [--title TITLE] [--tags tag1,tag2] [--shared-by NAME] [--via CHANNEL]
  find [QUERY] [--saved-within day|week|month|year] [--saved-since YYYY-MM-DD] [--fuzzy] [--expand] [--browser] [--with BROWSER] [--dry-run]
  open QUERY [--pick NUMBER] [--saved-within day|week|month|year] [--saved-since YYYY-MM-DD] [--fuzzy] [--with BROWSER] [--dry-run]

npm syntax:
  Keep the "--" in "npm run bookmark -- COMMAND". It forwards options such as
  --browser, --fuzzy, --expand, --pick, --saved-within, --saved-since, --with,
  and --dry-run to the bookmark TUI.

Argument rules:
  Run npm run bookmark -- COMMAND --help for command-specific help. Help wins
  when combined with other arguments. Unknown, unsupported, duplicate, or
  conflicting options are errors. Quote multiword queries. Expected input
  errors print a concise message without a JavaScript stack trace.

Compact find output:
  1. Night Drive [d34db33f]
     URL: https://desert-sounds.bandcamp.com/album/night-drive
     TAGS: bandcamp, music

Use find QUERY --expand to include vault file paths and full Markdown records.
The displayed ID prefix can be used with open when it uniquely identifies a bookmark.
QUERY may be omitted when --saved-within or --saved-since is provided.

Common workflows:
  npm run bookmark -- vault git-help
  npm run bookmark -- vault open
  npm run bookmark -- save --url https://example.test/page --shared-by Alice --via Signal
  npm run bookmark -- find database
  npm run bookmark -- open database --pick 3
  npm run bookmark -- find database --expand
  npm run bookmark -- open d34db33f
  npm run bookmark -- find database --saved-within week
  npm run bookmark -- find --saved-within day
  npm run bookmark -- find --saved-since 2026-09-01
  npm run bookmark -- find travel --saved-within month
  npm run bookmark -- find archive --saved-within year
  npm run bookmark -- find database --saved-since 2026-09-01
  npm run bookmark -- open database --saved-since 2026-09-01 --pick 3
  npm run bookmark -- open database --pick 3 --with firefox
  npm run bookmark -- find triper --fuzzy
  npm run bookmark -- find database --browser --with chrome

Run "npm run bookmark -- COMMAND --help" for command-specific options.`);
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

function printNamedHelp(name) {
  const printers = {
    init: printInitHelp,
    skill: printSkillHelp,
    vault: printVaultHelp,
    save: printSaveHelp,
    find: printFindHelp,
    open: printOpenHelp
  };
  const printer = printers[name];
  if (!printer) throw new Error(`Unknown command: ${name}. Run npm run bookmark -- help.`);
  printer();
}

async function runTui() {
  if (!command || command === '--help' || command === '-h') return printHelp();
  if (command === 'help') {
    if (args.length > 1) throw new Error(`Unexpected extra argument: ${JSON.stringify(args[1])}`);
    return args[0] ? printNamedHelp(args[0]) : printHelp();
  }
  if (command === 'init') {
    const options = parseInitArguments(args);
    if (options.help) return printInitHelp();
    const root = options.path || vaultRoot();
    await initVault(root, { installSkill: !options.noSkill });
    console.log(`Vault ready: ${root}`);
    if (!options.noSkill) console.log('LLM skill installed: .codex/skills/markdown-bookmark-vault/SKILL.md');
    console.log('Next: git -C "' + root + '" init');
    return;
  }
  if (command === 'skill') {
    if (args.some((argument) => argument === '--help' || argument === '-h')) return printSkillHelp();
    if (args[0] !== 'install') throw new Error('Usage: npm run bookmark -- skill install [--path PATH]');
    const options = parseSkillInstallArguments(args.slice(1));
    const root = options.path || vaultRoot();
    const target = await installVaultSkill(root);
    console.log(`LLM skill installed in vault: ${target}`);
    return;
  }
  if (command === 'vault') {
    const options = parseVaultArguments(args);
    if (options.help) return printVaultHelp();
    const root = vaultRoot();
    if (options.action === 'git-help') console.log(renderVaultGitHelp(root, { full: options.full }));
    else await openVaultDirectory(root, options.dryRun);
    return;
  }
  if (command === 'save') {
    const options = parseSaveArguments(args);
    if (options.help) return printSaveHelp();
    const result = await saveBookmark({
      url: options.url,
      title: options.title,
      tags: (options.tags || '').split(','),
      shared_by: options.sharedBy,
      shared_via: options.via
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'find') {
    const request = parseFindArguments(args);
    if (request.help) return printFindHelp();
    const results = await findBookmarks(request.query, undefined, {
      savedWithin: request.savedWithin,
      savedSince: request.savedSince,
      fuzzy: request.fuzzy
    });
    if (!results.length) {
      console.log(`No bookmarks found for: ${request.description}`);
    } else if (request.browser) {
      const page = await createSearchResultsPage(request.description, results);
      const hostVaultPath = process.env.BOOKMARK_RESULTS_HOST_VAULT;
      const pageUrl = hostVaultPath ? hostSearchResultsFileUrl(page.token, hostVaultPath) : page.fileUrl;
      if (request.dryRun) console.log(pageUrl);
      else {
        console.log('Search results file:');
        console.log(pageUrl);
        if (!hostVaultPath) {
          const launched = await launchBrowserOrExplain(pageUrl, request.withBrowser, { linkAlreadyPrinted: true });
          if (launched) console.log(`Opened ${page.count} bookmark result${page.count === 1 ? '' : 's'} in the browser.`);
        }
      }
    } else {
      sortSearchResults(results).forEach((result, index) => printSearchResult(result, index, request.expand));
    }
    return;
  }
  if (command === 'open') {
    const request = parseOpenArguments(args);
    if (request.help) return printOpenHelp();
    const selection = await chooseOpenResult(await findBookmarks(request.query, undefined, {
      fuzzy: request.fuzzy,
      savedWithin: request.savedWithin,
      savedSince: request.savedSince
    }), request.pick);
    if (selection === CANCELLED_SELECTION) {
      console.log('Cancelled.');
      return;
    }
    if (!selection) throw new Error(`No bookmark found for: ${request.query}`);
    const url = selection.content.match(/^url:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
    if (!url || !/^https?:\/\//i.test(url)) throw new Error(`Bookmark has no safe HTTP URL: ${selection.file}`);
    if (request.dryRun) console.log(url);
    else if (process.env.BOOKMARK_RESULTS_HOST_VAULT) {
      console.log(`Open bookmark${request.withBrowser ? ` in ${request.withBrowser}` : ''}: ${url}`);
    } else await launchBrowserOrExplain(url, request.withBrowser);
    return;
  }
  throw new Error(`Unknown command: ${command}. Run npm run bookmark -- help.`);
}

await runTui().catch((error) => {
  console.error(error?.message || String(error));
  if (process.env.BOOKMARK_DEBUG === '1' && error?.stack) console.error(error.stack);
  process.exitCode = 1;
});
