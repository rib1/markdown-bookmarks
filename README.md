# Markdown Bookmarks

Local-first browser bookmarks stored as Markdown files in a Git-versioned vault.

For host installation and usage, see the [user guide](docs/USER-GUIDE.md).

Initialize a vault from the Docker development environment with `init`; this
also installs the vault-management LLM skill.

## Run the development companion

Development uses Docker; the released companion will be a standalone binary.
Install Docker and Git on the development host:

```powershell
docker compose up --build
```

The default development vault is `./vault`. To use a private repository elsewhere:

```powershell
$env:BOOKMARK_VAULT = 'C:\path\to\private-bookmarks'
docker compose up --build
```

Load `extension/` as an unpacked extension in Chrome or another Chromium browser.
Enter tags in the popup and click **Save current tab**. The container writes the
Markdown file into the mounted vault. Use Git on the host to inspect, commit,
and push the private vault.

## End-to-end smoke test

```powershell
docker compose up --build -d
docker compose exec bookmarkd node --test test/vault.test.js
docker compose down
```

Run the real Chrome extension test entirely in Docker:

```powershell
docker compose run --rm e2e
```

The browser development test is: open a page, load the extension, enter `work,database`,
click save, inspect the generated file under `vault/bookmarks/`, then run:

```powershell
docker compose exec bookmarkd node src/cli.js find postgres
```

Open a saved bookmark in the default browser:

```powershell
docker compose exec bookmarkd node src/cli.js open postgres
```

Use `--dry-run` in scripts or tests to print the resolved URL without opening
the browser.
