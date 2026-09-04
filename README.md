# Markdown Bookmarks

Save browser tabs as searchable Markdown files in a private, Git-versioned vault.

## Quick start

```powershell
$env:BOOKMARK_VAULT = 'C:\path\to\private-vault'
docker compose up --build
```

Load `extension/` as an unpacked Chrome extension, then save tabs from its popup.

Run all tests:

```powershell
docker compose run --rm all-tests
```

See the [user guide](docs/USER-GUIDE.md) and [development instructions](docs/DEVELOPMENT.md).
