# User guide

This guide describes the current prototype. The companion can run in Docker or
directly with Node.js and npm. A future release will provide a standalone
executable that does not require Docker or a language runtime.

## Requirements

Install Git and Chrome or another Chromium-based browser. For the Docker
workflow, install Docker Desktop; the host does not need Node.js or npm. For the
native prototype workflow, install Node.js 26, which includes npm; Docker is not
required. Neither workflow needs Python or a database server.

## Get the application

```bash
git clone https://github.com/rib1/markdown-bookmarks.git
cd markdown-bookmarks
```

## Create the private vault

Keep your bookmarks in a separate private Git repository.

```bash
mkdir my-bookmarks
cd my-bookmarks
git init
cd ../markdown-bookmarks
```

Or clone an existing private vault:

```bash
git clone git@github.com:YOUR-ACCOUNT/private-bookmarks.git ../my-bookmarks
```

Configure Git authentication separately on the host. The extension and
companion never handle Git credentials.

You can also initialize the directory with the companion:

```bash
export BOOKMARK_VAULT="$HOME/Documents/my-bookmarks"
docker compose run --rm bookmarkd node src/cli.js vault init
```

On Windows PowerShell, set the host path before running Docker:

```powershell
$env:BOOKMARK_VAULT = "$HOME\Documents\my-bookmarks"
docker compose run --rm bookmarkd node src/cli.js vault init
```

The command creates the standard vault directories, a README, and a
`.gitattributes` file that normalizes text files to Unix LF line endings. It
does not overwrite those existing files. It installs a companion-managed
`AGENTS.md` in the vault root with portable structure, privacy, editing, and
search instructions for LLM agents. It also installs the generic vault-management
LLM skill at `.codex/skills/markdown-bookmark-vault/SKILL.md`. Use `--no-skill`
if you do not want the optional skill copied into the vault; `AGENTS.md` is
still installed.

For an existing vault, install or refresh only the vault-local skill with:

```bash
docker compose run --rm bookmarkd node src/cli.js skill install
```

The public application’s `skills/` directory is only the source template; the
usable copy for your bookmarks is inside the private vault.

## Use the vault with an LLM

The repository includes a reusable Codex skill at
`skills/markdown-bookmark-vault/`. Copy that directory into your local Codex
skills directory, then open the private vault in the same workspace or provide
its path when asking the LLM to work with it.

The skill preserves stable IDs, distinguishes suggestions from confirmed edits,
protects private content, and avoids unrequested Git commits or pushes.

## Start the companion

Windows PowerShell:

```powershell
$env:BOOKMARK_VAULT = 'C:\Users\YOUR-NAME\Documents\my-bookmarks'
docker compose up --build
```

macOS/Linux:

```bash
export BOOKMARK_VAULT="$HOME/Documents/my-bookmarks"
docker compose up --build
```

The local API listens at `http://127.0.0.1:8787`. Keep the terminal open, or
start it in the background with `docker compose up --build -d`. Stop it with
`docker compose down`.

The same configured vault is used by the companion service and its CLI.
On startup, the companion compares `.markdown-bookmarks.json` with the current
application schema and runs pending Markdown migrations before accepting saves.
It reports each migration script and version transition, or says that no
migrations ran. The same startup pass installs or refreshes the vault-root
`AGENTS.md`, then reports the process start time, current schema, and
migrated-file count. Review and
commit resulting private-vault changes with host Git; the companion never
commits or pushes them.

## Run without Docker using npm

The Node prototype has no runtime dependencies, so there is no package-install
step. Install Node.js 26 and run these commands from the application repository.

Windows PowerShell:

```powershell
$env:BOOKMARK_VAULT = 'C:\Users\YOUR-NAME\Documents\my-bookmarks'
npm run bookmark -- vault init
npm start
```

macOS:

```bash
export BOOKMARK_VAULT="$HOME/Documents/my-bookmarks"
npm run bookmark -- vault init
npm start
```

The API listens at `http://127.0.0.1:8787`. Keep that terminal open while using
the extension and press `Ctrl+C` to stop the companion. This is a direct way to
run the current prototype, not the future self-contained companion binary.
The same automatic schema migration described above runs before the npm server
starts listening.

## Install the extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository's `extension` directory.
5. Pin **Markdown Bookmarks** to the toolbar.

The current prototype is not yet packaged for a browser store.

The add-on and companion verify API compatibility only after you click Save, so
opening the popup does not wait for the companion. After pulling application
changes, restart the companion and reload the unpacked add-on. When versions
differ, supported fields are saved and the popup lists omitted fields with an
instruction to update the older component.

## Reload the extension after changes

1. Keep the companion running:

   ```powershell
   docker compose up -d --build --force-recreate bookmarkd
   ```

2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Find **Markdown Bookmarks** and click **Reload**.
5. If it is not installed, choose **Load unpacked** and select the repository's
   `extension` directory.

To test metadata extraction, open a real article page containing author and
publication-date metadata. Click the extension, choose a context, add tags,
and save the page. Inspect the generated Markdown file in the private vault.

## Save a bookmark

1. Open the page to keep.
2. Click the Markdown Bookmarks toolbar icon.
3. Enter comma-separated tags, such as `work,database,reference`. Tags are
   stored in lowercase and duplicate spellings that differ only by case are
   combined.
4. If someone sent the link, optionally enter their name in **Shared by** and
   the channel in **Via**.
5. Optionally expand **Save source** and set a memorable device label such as
   `home-mac` or `work-windows`. The label is remembered locally.
6. Click **Save current tab**.

The companion creates a file under:

```text
my-bookmarks/bookmarks/YYYY/MM/<id>-page-title.md
```

The file is ordinary Markdown and can be opened without this application.

Sender information is stored only when supplied. It is separate from the page
author, and saving the same URL from another person appends another share event.
Browser saves also append capture provenance containing the device label, OS,
architecture, browser/version, and add-on version. This makes it possible to
distinguish saves from home and work machines. If no custom label is set, the
OS (`mac`, `win`, and so on) is used as the device label. Set a custom label to
distinguish multiple machines using the same OS. The add-on does not record the
machine hostname, username, IP address, geolocation, or full user-agent string.

Most destination URLs do not reliably identify who sent them. The add-on does
not treat article authors, repository owners, referral tokens, or campaign
parameters as senders. Future site-specific extraction may offer a suggestion,
but it must be confirmed before it is stored.

GitHub bookmarks receive repository and owner metadata when available. YouTube
bookmarks are classified as videos and always receive the `youtube` tag.
Mural bookmarks are classified as whiteboards and default to the `work`
context.
Bandcamp bookmarks receive the `bandcamp` tag and are classified as albums or
tracks when the URL identifies that page type. The artist subdomain is used as
the author only when the page did not provide an author.
Imgur bookmarks receive the `imgur` tag, their image/album/gallery type, and an
`imgur_id` when the URL contains a valid resource ID.

## Command help

The TUI includes a compact command reference plus workflow examples. Show the
full command list with:

```powershell
npm run bookmark -- help
```

The `--` after `bookmark` is required for npm commands. It tells npm to forward
following options such as `--browser`, `--fuzzy`, `--pick`, `--with`, and `--dry-run` to
the bookmark TUI. Without it, npm may consume an option; for example,
`npm run bookmark find amiga --browser` performs a plain text search. Use:

```powershell
npm run bookmark -- find amiga --browser
```

This lists initialization, saving, searching, browser-page generation, and
link-opening commands. Its examples show how to open by stable bookmark ID,
search first and open a numbered result, choose another browser, or open all
matches as a browser page.

For the detailed link-launch reference, run:

```powershell
npm run bookmark -- open --help
```

The detailed help explains `--pick`, `--with`, `--dry-run`, supported browser
aliases, custom application/executable values, platform behavior, and the fact
that Docker cannot launch applications on the host.

Every command supports `--help` and `-h`, and help takes precedence over other
arguments:

```powershell
npm run bookmark -- find --help
npm run bookmark -- save --help
npm run bookmark -- vault init --help
```

The TUI rejects unknown, unsupported, duplicate, or conflicting options instead
of silently ignoring them. It also rejects extra unquoted terms, missing option
values, and dates that are not real calendar dates in strict `YYYY-MM-DD`
format. Do not combine `--saved-within` and `--saved-since`. These expected
errors are concise and do not print JavaScript stack traces. Quote a multiword
search, and use `--` before a search beginning with a hyphen:

```powershell
npm run bookmark -- find "amiga music"
npm run bookmark -- find -- -amiga
```

## Search from the TUI

With the Docker companion running:

```powershell
docker compose exec bookmarkd node src/cli.js find database
```

The same command works in a macOS/Linux shell. Search covers the Markdown
bookmark content, including URLs, titles, tags, summaries, sender names,
sharing channels, and browser/device capture information.

With the npm companion, set `BOOKMARK_VAULT` in the CLI terminal as shown above
and run:

```powershell
npm run bookmark -- find database
```

Terminal searches use a compact three-line result: numbered title with a short
stable-ID prefix, URL, and comma-separated tags. This fits several bookmarks in
a typical terminal and uses the same stable ordering as
`open QUERY --pick NUMBER`:

```text
1. Night Drive [d34db33f]
   URL: https://desert-sounds.bandcamp.com/album/night-drive
   TAGS: bandcamp, music
```

To include the vault file path and each bookmark's full Markdown record, add
`--expand`:

```powershell
npm run bookmark -- find database --expand
```

The displayed ID prefix is searchable. Open a bookmark directly when that
prefix is unique:

```powershell
npm run bookmark -- open d34db33f
```

The TUI can also record manually supplied sender information:

```powershell
npm run bookmark -- save --url https://example.test/page --title "Useful page" --shared-by Alice --via Signal
```

Limit results by their original save time with `--saved-within`:

```powershell
npm run bookmark -- find --saved-within day
npm run bookmark -- find database --saved-within week
npm run bookmark -- find travel --saved-within month
npm run bookmark -- find archive --saved-within year
```

Omit the search term to list everything saved during the selected period. The
accepted periods are `day`, `week`, `month`, and `year`. Bare `find` without a
term or time filter remains invalid. To use a specific cutoff date instead,
pass an ISO date, with or without a search term:

```powershell
npm run bookmark -- find --saved-since 2026-09-01
npm run bookmark -- find database --saved-since 2026-09-01
```

Repeat the filter when opening a numbered result so `--pick` uses the same
filtered list:

```powershell
npm run bookmark -- find database --saved-since 2026-09-01
npm run bookmark -- open database --saved-since 2026-09-01 --pick 3
```

The same workflow works with a chosen browser:

```powershell
npm run bookmark -- open database --saved-within month --pick 2 --with chrome
```

Exact substring matching is the default. For typo-tolerant ranked results, add
`--fuzzy`:

```powershell
npm run bookmark -- find triper --fuzzy
```

Fuzzy matching normalizes case, punctuation, and Unicode, then compares query
tokens with bookmark fields using transposition-aware edit distance. Titles,
IDs, tags, contexts, and site identifiers rank above URLs and Markdown body
text. Every query token must meet a strict similarity threshold, and very short
terms are not broadened. Exact matches always rank before fuzzy matches. Compact
terminal results show the score and strongest matching fields.

The same ordering is used when opening one result or generating a browser page:

```powershell
npm run bookmark -- open triper --fuzzy
npm run bookmark -- find triper --fuzzy --browser
```

To view useful metadata for all matches in a temporary browser page, use:

```powershell
npm run bookmark -- find database --browser
```

Native mode prints the generated `file://` link on its own line before opening
the page. This leaves a copyable link even if browser launching fails. With
Docker, keep `bookmarkd` running and run:

```powershell
docker compose exec bookmarkd node src/cli.js find database --browser
```

Docker prints the generated file's host-side `file://` link for the browser.
Set `BOOKMARK_VAULT` to an absolute host path before starting Compose so that
this link can be constructed reliably. Both modes store the generated HTML
under the private vault's Git-ignored `views/.search-results/` directory. The
page contains private result metadata, loads no external assets, and is never a
source record. Server startup deletes generated pages older than 24 hours. Add
`--dry-run` to generate and print the page URL without opening it.
If no bookmarks match, the command describes the term or time filter, such as
`No bookmarks found for: saved within day`, and does not create a page or
launch a browser.

Open a matching bookmark in the default browser with the native npm workflow:

```powershell
npm run bookmark -- open database
```

Select another browser with `--with`. Built-in aliases are `chrome`, `edge`,
`firefox`, `brave`, and `safari` on macOS:

```powershell
npm run bookmark -- open database --with firefox
```

You can also give a macOS application name or a Windows/Linux executable name
or path. Browser launching is available only in the native npm workflow;
Docker cannot launch applications on the host.

If the selected browser is missing or cannot start, the CLI prints a clear
message and the target URL for manual opening, without a stack trace. The
command returns a nonzero status so scripts can detect that launching failed.

If several bookmarks match, `open` shows a numbered list and asks which one to
open. Enter a short number such as `2`; there is no need to type the bookmark
ID. Press Enter without selecting a number to cancel and open nothing. For
scripts or other non-interactive use, select the same numbered result
with `open QUERY --pick 2`. Supplying `--pick` skips the menu and opens that
result directly; `--pick=2` is equivalent. Results are sorted by title so the
numbering is stable. Use `open QUERY --dry-run` to print the selected URL
without launching a browser.

## Version the private vault

Print a concise, copyable Git workflow for the configured vault:

```powershell
npm run bookmark -- vault git-help
```

Add initialization, remote-check, conflict, and commit-message examples with:

```powershell
npm run bookmark -- vault git-help --full
```

The help command does not run Git or access the network. Review vault changes,
pull before saving on another machine, and commit and push explicitly.
If the selected vault is not initialized, help tells you to run `vault init`
first.

Open the vault in Finder, File Explorer, or the Linux file manager with:

```powershell
npm run bookmark -- vault open
```

Use `--dry-run` to print the native command without opening anything. In
Docker, the command prints a host-side command because a container cannot open
the host file manager. An uninitialized vault is not opened; the TUI prints the
initialization command instead.

## Run the browser end-to-end test

This uses a separate Docker image containing Chrome and Playwright and writes
synthetic data to the ignored `test-data/` directory, never to your private
vault:

```bash
docker compose run --rm e2e
```

To run all quality checks—ESLint, vault, CLI, and Chrome extension:

```powershell
docker compose run --rm quality
docker compose run --rm all-tests
```

## Troubleshooting

For **Companion unavailable**, confirm Docker Desktop is running and inspect
the service with `docker compose ps` and `docker compose logs bookmarkd`.

If the vault is empty, check `BOOKMARK_VAULT` and grant Docker Desktop access
to that directory when requested.

If the extension is missing, reload it from `chrome://extensions` and select
the `extension` directory itself.

For **Browser add-on is out of date**, restart the updated companion, open
`chrome://extensions`, and click **Reload** on Markdown Bookmarks. The companion
saves fields provided by the older add-on and displays an update warning. Reload
before subsequent saves to capture all available metadata.
