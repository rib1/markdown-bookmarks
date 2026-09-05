# Instructions for AI contributors

## Project objective

Build a personal, local-first bookmark system that saves browser tabs as searchable Markdown files in a private Git repository.

## Non-negotiable boundaries

- Application source code stays in this public repository.
- Personal bookmarks, URLs, notes, projects, events, and archived content stay in a separate private vault repository.
- Never add real personal bookmark data, browser exports, credentials, tokens, or private repository URLs here.
- The vault is the source of truth. Any database or search index must be disposable and rebuildable from Markdown.
- Development dependencies are provided through Docker only. Do not require Node, Python, npm, or another runtime on the developer host.
- The distributed companion must be a standalone executable that runs without Docker or a language runtime.
- Prefer one self-contained, signed companion binary over a runtime installer or a collection of host-installed packages.
- The companion workflow must work on both Windows and macOS.
- Use Docker Compose for development and tests. The released companion runs directly on Windows and macOS.

## Architecture

```text
Browser extension -> localhost HTTP API -> standalone companion -> private vault -> host Git
```

The browser extension must not receive Git credentials or call a remote bookmark service.

During development Docker may mount the vault at `/vault`. In the released
companion, use native Windows/macOS filesystem paths selected through config or
the CLI.

## Data model rules

- Use stable IDs for bookmarks, projects, and events.
- Do not use directories as semantic categories.
- Store contexts, areas, projects, events, tags, status, and relationships in metadata.
- Support many-to-many project/event/bookmark relationships.
- Preserve publication-date source and confidence when extracted.
- Keep access history separate from saved-page content.
- Prefer typed relationships such as `references`, `supports`, `alternative`, `follow-up`, and `duplicate`.
- Store the vault schema version in `.markdown-bookmarks.json`. Migrations must be idempotent, preserve unknown metadata, and update the vault version only after every file succeeds.
- Keep each schema upgrade in its own numbered file under `src/migrations/` and register it in `src/migrations/index.js`.

## Development rules

- Keep the first vertical slice working: save a tagged tab, inspect its Markdown file, and find it through the CLI.
- Add or update a containerized test for behavior changes.
- Prefer standard-library implementations until a dependency is justified.
- Do not add a web UI or hosted backend unless the project plan changes.
- Treat browser input as untrusted data; validate URLs and safely serialize Markdown/YAML values.
- Do not silently enable Git push or remote network access.

## Verification

```powershell
docker compose run --rm quality
docker compose run --rm all-tests
```

For manual browser verification, start the service with `docker compose up`, load `extension/` as an unpacked extension, save a tagged page, inspect the mounted vault, and run the CLI inside the container.
