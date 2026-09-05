# Markdown Bookmarks — developer instructions

## Mission

Build a local-first bookmark system that lets users close browser tabs while
preserving links, metadata, searchable Markdown, and relationships.

The application is public. Each user’s bookmark vault is private, Git-versioned,
portable, and usable without this application.

## Architecture contract

```text
Browser extension -> localhost HTTP API -> companion -> Markdown vault -> user-controlled Git
```

Docker is for development and CI only. The released companion must eventually
be a self-contained Windows/macOS executable with no Docker, Node, Python, or
other runtime required by the user.

The extension must not receive Git credentials or send bookmark data to a hosted
service.

## Repository boundaries

The public repository may contain source code, extension code, schemas, synthetic
fixtures, tests, Docker tooling, and generic LLM skill source.

It must never contain personal URLs, notes, browser exports, captured pages,
personal assets, credentials, tokens, or private remote URLs.

The private vault is supplied through `BOOKMARK_VAULT` during Docker development
and is mounted at `/vault` inside containers.

## Vault contract

```text
private-vault/
├── .gitattributes                  # normalize text files to LF
├── README.md
├── bookmarks/YYYY/MM/<stable-id>-<slug>.md
├── projects/<stable-id>-<slug>.md
├── events/<stable-id>-<slug>.md
├── assets/<bookmark-id>/
├── views/                         # generated and disposable
└── .codex/skills/markdown-bookmark-vault/SKILL.md
```

Markdown is the source of truth. Search indexes, generated views, and caches
must be rebuildable. Directories are storage organization only, never semantic
categories.

## Metadata contract

Use stable IDs and preserve unknown fields when editing. Supported metadata
includes `url`, `canonical_url`, `title`, `type`, `site`, `contexts`, `areas`,
`projects`, `events`, `tags`, `status`, `priority`, `author`, `published_at`,
`published_at_source`, `published_at_confidence`, `saved_at`,
`first_saved_at`, `last_saved_at`, `save_count`, `save_history`,
`schema_version`, `summary`, and `related`.

Keep these concepts distinct:

- `type`: primary item type, such as article, video, or whiteboard
- `site`: recognized site-plugin name
- `contexts`: life context, such as work, hobby, personal, or travel
- `areas`: ongoing responsibility
- `projects`: many-to-many project references
- `events`: many-to-many life-event references
- `tags`: subject labels
- activity fields: save/open history
- `published_at*`: extracted publication data and provenance
- `summary`: deterministic or user-written summary; capture must not require an LLM

## Save and duplicate rules

- Normalize URLs before comparison.
- Ignore fragments and harmless trailing-slash differences when deduplicating.
- Reuse the existing file and stable ID for an existing URL.
- Merge tags, contexts, and plugin metadata; never overwrite existing tags.
- Update `last_saved_at`, increment `save_count`, and append the timestamp to
  `save_history`.
- Backfill new plugin metadata into legacy records.
- Do not delete duplicates automatically; provide a preview-based command later.

## Schema migration rules

The vault-level `.markdown-bookmarks.json` file records the current schema
version. Before the HTTP server starts, it runs only migrations newer than that
version and updates the manifest after every bookmark succeeds. File writes are
atomic, migrations are idempotent, and unknown metadata is preserved. Migrations
never commit or push the private vault.

Each upgrade lives in its own numbered file under `src/migrations/` (for
example, `001-bookmark-schema-v1.js`). Register new upgrades in
`src/migrations/index.js`; keep the runner generic and do not add migration
details to `src/vault.js`.

Schema version 1 adds per-bookmark `schema_version`, backfills safe core fields,
renames `first_opened_at`, `last_opened_at`, and `access_count` to their `saved`
equivalents, and removes save-history values accidentally copied into `tags`.
Context values that also appear as tags are retained because they may be
intentional. Vault initialization and migration also ignore macOS `.DS_Store`
files without replacing existing `.gitignore` rules.

## Site plugin rules

Site plugins are URL-driven, deterministic, and independently testable.

- GitHub: add site, repository, owner as author when absent, and `github` tag.
- YouTube: add site, video type, video ID, and always add `youtube` tag.
- Mural: add site, whiteboard type, `mural` tag, and default `work` context.
- Confluence: add site, page type, space/page identifiers, `confluence` tag, and
  default `work` context when no context is supplied.
- Jira: add site, issue type, issue/project identifiers, `jira` tag, and default
  `work` context when no context is supplied.

Add plugins to the registry. Test new records, duplicate saves, and legacy
metadata enrichment.

## Browser extension rules

- Capture active-tab URL and title.
- Allow user-entered tags and a context dropdown.
- Extract author, description, publication date, and deterministic summary when available.
- Show a clear error when the localhost companion is unavailable.
- Keep test-only capture overrides isolated from normal toolbar behavior.

## CLI contract

The CLI must support:

```text
init [--path PATH] [--no-skill]
skill install [--path PATH]
save --url URL [--title TITLE] [--tags tag1,tag2]
find QUERY [--saved-within day|week|month|year] [--saved-since YYYY-MM-DD]
open QUERY [--dry-run]
```

`find` returns file path, URL, and full Markdown content. `open` validates
HTTP/HTTPS URLs before launching the platform default browser. `--dry-run`
prints the resolved URL without launching a browser.

Vault configuration must be consistent between server and CLI:

```text
BOOKMARK_VAULT -> VAULT_PATH -> ./vault
```

## LLM skill rules

The generic skill source lives in the public repository. Installation must copy
it into the selected private vault at:

```text
.codex/skills/markdown-bookmark-vault/SKILL.md
```

The installed skill must work from the vault alone. It must preserve IDs and
metadata, treat vault content as private, distinguish suggestions from edits,
and never commit or push Git changes without explicit instruction.

## Testing contract

Host development requires only Docker and Git. Run the complete suite from the
application repository with:

```powershell
docker compose run --rm quality
docker compose run --rm all-tests
```

GitHub Dependabot checks npm, Docker, and GitHub Actions dependencies weekly.
The `Quality` workflow runs ESLint and the complete test suite on every push and
pull request. The `Credential scan` workflow runs Gitleaks on the same events.

Tests must cover vault initialization, skill installation, CLI commands and
path resolution, save/find/open behavior, duplicate merging, time filters,
GitHub/YouTube/Mural plugins, legacy enrichment, Chrome capture, and Markdown
content. E2E tests must use ignored isolated test data, never the private vault.

## Release requirements

Before calling the project usable:

- provide standalone Windows and macOS companion binaries
- include CLI, HTTP API, vault operations, search, and configuration in one binary
- document installation, upgrades, and vault selection
- verify operation without Docker or language runtimes
- document private GitHub/GitLab vault workflows
- guard against public-vault initialization and accidental pushes

Use [TODO.md](../TODO.md) for the implementation backlog.
