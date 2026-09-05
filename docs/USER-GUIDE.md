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
docker compose run --rm bookmarkd node src/cli.js init
```

On Windows PowerShell, set the host path before running Docker:

```powershell
$env:BOOKMARK_VAULT = "$HOME\Documents\my-bookmarks"
docker compose run --rm bookmarkd node src/cli.js init
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
`AGENTS.md`, then reports the current schema and migrated-file count. Review and
commit resulting private-vault changes with host Git; the companion never
commits or pushes them.

## Run without Docker using npm

The Node prototype has no runtime dependencies, so there is no package-install
step. Install Node.js 26 and run these commands from the application repository.

Windows PowerShell:

```powershell
$env:BOOKMARK_VAULT = 'C:\Users\YOUR-NAME\Documents\my-bookmarks'
npm run bookmark -- init
npm start
```

macOS:

```bash
export BOOKMARK_VAULT="$HOME/Documents/my-bookmarks"
npm run bookmark -- init
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
3. Enter comma-separated tags, such as `work,database,reference`.
4. Click **Save current tab**.

The companion creates a file under:

```text
my-bookmarks/bookmarks/YYYY/MM/<id>-page-title.md
```

The file is ordinary Markdown and can be opened without this application.

GitHub bookmarks receive repository and owner metadata when available. YouTube
bookmarks are classified as videos and always receive the `youtube` tag.
Mural bookmarks are classified as whiteboards and default to the `work`
context.

## Command help

The CLI includes a compact command reference plus workflow examples. Show the
full command list with:

```powershell
npm run bookmark -- help
```

This lists initialization, saving, searching, browser-page generation, and
link-opening commands. Its examples show how to search first, open a numbered
result, choose another browser, or open all matches as a browser page.

For the detailed link-launch reference, run:

```powershell
npm run bookmark -- open --help
```

The detailed help explains `--pick`, `--with`, `--dry-run`, supported browser
aliases, custom application/executable values, platform behavior, and the fact
that Docker cannot launch applications on the host.

## Search from the CLI

With the Docker companion running:

```powershell
docker compose exec bookmarkd node src/cli.js find database
```

The same command works in a macOS/Linux shell. Search covers the Markdown
bookmark content, including URLs, titles, tags, and summaries.

With the npm companion, set `BOOKMARK_VAULT` in the CLI terminal as shown above
and run:

```powershell
npm run bookmark -- find database
```

To view useful metadata for all matches in a temporary browser page, use:

```powershell
npm run bookmark -- find database --browser
```

Native mode opens the page directly and also prints its `file://` link. With
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

If several bookmarks match, `open` shows a numbered list and asks which one to
open. Enter a short number such as `2`; there is no need to type the bookmark
ID. For scripts or other non-interactive use, select the same numbered result
with `open QUERY --pick 2`. Results are sorted by title so the numbering is
stable. Use `open QUERY --dry-run` to print the selected URL without launching
a browser.

## Version the private vault

Run Git from the private vault directory:

```bash
cd ../my-bookmarks
git status
git add bookmarks/
git commit -m "Save bookmarks"
git push
```

Pull before saving on another computer:

```bash
git pull --rebase
```

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
