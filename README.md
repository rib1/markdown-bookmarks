# Markdown Bookmarks

Save browser tabs as searchable Markdown files in a private, Git-versioned vault.

## Quick start

Set the private vault path:

```powershell
# Windows PowerShell
$env:BOOKMARK_VAULT = 'C:\path\to\private-vault'
```

```sh
# macOS
export BOOKMARK_VAULT="$HOME/path/to/private-vault"
```

Then start with Docker:

```powershell
docker compose up --build
```

Or run the current prototype directly with Node.js 26 and npm:

```powershell
npm run bookmark -- vault init
npm start
```

Load `extension/` as an unpacked Chrome extension.

## Verify

```powershell
docker compose run --rm quality
docker compose run --rm all-tests
```

See the [user guide](docs/USER-GUIDE.md), [development instructions](docs/DEVELOPMENT.md),
and [TODO list](TODO.md).
