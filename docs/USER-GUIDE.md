# User guide

This guide describes the current prototype. The companion currently runs in
Docker; a future release will provide a standalone executable.

## Requirements

Install Docker Desktop, Git, and Chrome or another Chromium-based browser. The
host does not need Node.js, Python, npm, or a database server.

## Get the application

```bash
git clone https://github.com/YOUR-ACCOUNT/markdown-bookmarks.git
cd markdown-bookmarks
```

Replace the URL with the actual public repository URL after publication.

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
docker compose run --rm -e BOOKMARK_VAULT=/vault bookmarkd node src/cli.js init
```

The command creates the standard vault directories and a README without
overwriting existing files. It also installs the generic vault-management LLM
skill at `.codex/skills/markdown-bookmark-vault/SKILL.md`. Use `--no-skill` if
you do not want the skill copied into the vault.

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

## Install the extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository's `extension` directory.
5. Pin **Markdown Bookmarks** to the toolbar.

The current prototype is not yet packaged for a browser store.

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

## Search from the CLI

The current CLI runs inside Docker:

```powershell
docker compose exec bookmarkd node src/cli.js find database
```

The same command works in a macOS/Linux shell. Search covers the Markdown
bookmark content, including URLs, titles, tags, and summaries.

Open the first matching bookmark in the host's default browser:

```powershell
docker compose exec bookmarkd node src/cli.js open database
```

Use `open QUERY --dry-run` to print the URL without launching a browser.

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

## Troubleshooting

For **Companion unavailable**, confirm Docker Desktop is running and inspect
the service with `docker compose ps` and `docker compose logs bookmarkd`.

If the vault is empty, check `BOOKMARK_VAULT` and grant Docker Desktop access
to that directory when requested.

If the extension is missing, reload it from `chrome://extensions` and select
the `extension` directory itself.
