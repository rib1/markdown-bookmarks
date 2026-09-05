# Markdown Bookmarks

Save browser tabs as searchable Markdown files in a private, Git-versioned vault.

## Quick start

Windows PowerShell:

```powershell
$env:BOOKMARK_VAULT = 'C:\path\to\private-vault'
docker compose up --build
```

macOS:

```sh
BOOKMARK_VAULT="$HOME/path/to/private-vault" docker compose up --build
```

Load `extension/` as an unpacked Chrome extension, then save tabs from its popup.

## Run without Docker

The current prototype can run directly with Node.js 26 and npm. It has no
runtime packages to install.

Windows PowerShell:

```powershell
$env:BOOKMARK_VAULT = 'C:\path\to\private-vault'
npm run bookmark -- init
npm start
```

macOS:

```sh
export BOOKMARK_VAULT="$HOME/path/to/private-vault"
npm run bookmark -- init
npm start
```

Keep the terminal open while using the extension. This npm workflow runs the
Node prototype; the planned standalone companion will not require Node or npm.

Run quality checks and all tests:

```powershell
docker compose run --rm quality
docker compose run --rm all-tests
```

See the [user guide](docs/USER-GUIDE.md), [development instructions](docs/DEVELOPMENT.md),
and [TODO list](TODO.md).
