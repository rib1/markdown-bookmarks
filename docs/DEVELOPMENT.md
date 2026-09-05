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
├── AGENTS.md                       # companion-managed portable LLM instructions
├── README.md
├── bookmarks/YYYY/MM/<stable-id>-<slug>.md
├── projects/<stable-id>-<slug>.md
├── events/<stable-id>-<slug>.md
├── assets/<bookmark-id>/
├── views/                         # generated and disposable
│   └── .search-results/           # temporary, Git-ignored HTML result pages
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
`share_history`, `capture_history`, site-specific source IDs such as `video_id`
and `imgur_id`, `schema_version`, `summary`, and `related`.

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
- `author`: creator of the saved page; never use it for the person who sent a link
- `share_history`: optional receipt events with sender/channel provenance
- `capture_history`: browser-save provenance such as device label, OS, browser, and extension version
- `summary`: deterministic or user-written summary; capture must not require an LLM

## Save and duplicate rules

- Normalize URLs before comparison.
- Ignore fragments and harmless trailing-slash differences when deduplicating.
- Reuse the existing file and stable ID for an existing URL.
- Merge tags, contexts, and plugin metadata; never overwrite existing tags.
- Update `last_saved_at`, increment `save_count`, and append the timestamp to
  `save_history`.
- Backfill new plugin metadata into legacy records.
- Append sender and browser-capture events on duplicate saves; deduplicate event IDs.
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
details to `src/vault.js`. A migration module exports its `script`,
`fromVersion`, and target `version` so startup logging can identify exactly
which upgrade ran.

Schema version 1 adds per-bookmark `schema_version`, backfills safe core fields,
renames `first_opened_at`, `last_opened_at`, and `access_count` to their `saved`
equivalents, and removes save-history values accidentally copied into `tags`.
Context values that also appear as tags are retained because they may be
intentional. Vault initialization and migration also ignore macOS `.DS_Store`
files and `views/.search-results/` without replacing existing `.gitignore`
rules.

New optional `share_history` and `capture_history` fields remain compatible
with schema version 1. Existing bookmarks are valid without them, so adding
these fields does not run a migration or rewrite the vault. Increment the
schema only when existing stored data needs conversion or existing readers can
no longer interpret the format.

## Browser API compatibility

Browser add-on and companion compatibility uses an API protocol independent of
the vault schema. The check runs when the user saves, not when the popup opens.
`GET /capabilities` advertises protocol bounds, supported features, accepted
bookmark input fields, and deprecated aliases. Every current browser save uses
a versioned envelope and the response confirms each processed input field.

- Save fields supported by both sides and return warnings listing omitted fields.
- Tell the user to reload or update the browser add-on when its protocol is too old.
- Tell the user to update the companion when the add-on is newer.
- Treat invalid required fields as errors, but omit unknown optional fields with a warning.
- Keep renamed fields as explicit aliases for a transition period and return a warning.
- Legacy add-ons receive a visible saved-with-warning response through their existing error display.

Every migration/startup pass also synchronizes `templates/vault/AGENTS.md` to
the vault root, including when the schema is already current. This keeps agents
opened directly in the private vault aligned with the application version. The
template must remain portable: it may describe conditional search examples but
must not require the application checkout, its CLI, a shell, Git, or any
particular search tool. The managed file may direct users to a separate
`AGENTS.local.md` for vault-specific additions.

## Site plugin rules

Site plugins are URL-driven, deterministic, and independently testable.

- GitHub: add site, repository, owner as author when absent, and `github` tag.
- YouTube: add site, video type, video ID, and always add `youtube` tag.
- Mural: add site, whiteboard type, `mural` tag, and default `work` context.
- Confluence: add site, page type, space/page identifiers, `confluence` tag, and
  default `work` context when no context is supplied.
- Jira: add site, issue type, issue/project identifiers, `jira` tag, and default
  `work` context when no context is supplied.
- Bandcamp: add site, album/track type, artist handle from a non-reserved
  Bandcamp subdomain when author is absent, and the `bandcamp` tag.
- Imgur: add site, image/album/gallery type, Imgur resource ID, and the `imgur`
  tag for `imgur.com` and its subdomains.

Keep each plugin in its own `src/site-plugins/<name>.js` module and register it
in `src/site-plugins/index.js`. Test new records, duplicate saves, and legacy
metadata enrichment.

## Browser extension rules

- Capture active-tab URL and title.
- Allow user-entered tags, context, optional sender/channel, and an optional remembered device label.
- Extract author, description, publication date, and deterministic summary when available.
- Record OS, architecture, browser/version, and extension version for browser saves.
- Do not capture hostname, username, IP address, geolocation, or a full user-agent string.
- Do not infer a sender from an author, repository owner, generic referral token, or campaign parameter.
- Show a clear error when the localhost companion is unavailable.
- Report `Saved` only when a bookmark was persisted, then show actionable warnings for omitted or unconfirmed fields.
- Keep test-only capture overrides isolated from normal toolbar behavior.

## CLI contract

The CLI must support:

```text
init [--path PATH] [--no-skill]
skill install [--path PATH]
save --url URL [--title TITLE] [--tags tag1,tag2] [--shared-by NAME] [--via CHANNEL]
find QUERY [--saved-within day|week|month|year] [--saved-since YYYY-MM-DD] [--fuzzy] [--expand] [--browser] [--with BROWSER] [--dry-run]
open QUERY [--pick NUMBER] [--saved-within day|week|month|year] [--saved-since YYYY-MM-DD] [--fuzzy] [--with BROWSER] [--dry-run]
```

All npm examples must include the argument separator:
`npm run bookmark -- COMMAND`. Without `--`, npm may consume CLI options such
as `--browser` or `--fuzzy` instead of forwarding them.

`find` prints compact, numbered terminal results containing title, short stable
ID, URL, comma-separated tags, and optional fuzzy-match details. Results use
the same deterministic ordering as `open --pick`; `--expand` additionally
prints the vault file path and full Markdown content.
With `--browser`, it
creates a static, safely escaped HTML page in the vault's ignored
`views/.search-results/` directory. Native mode prints its `file://` URL before
opening it; Docker prints the corresponding host-side `file://` URL.
Server startup removes generated pages older than 24 hours. `--dry-run` prints
the page URL without launching it.

Exact case-insensitive substring matching remains the default. `--fuzzy` uses
the dependency-free matcher in `src/fuzzy-search.js`: Unicode normalization,
token comparison, adjacent-transposition-aware edit distance, strict thresholds
for short terms, weighted metadata/body fields, and deterministic score ordering.
Every query token must qualify. Exact hits rank before fuzzy hits, and the same
ranking must feed text output, generated browser pages, and `open --pick`.

`open` validates HTTP/HTTPS URLs before launching the platform default browser.
A unique match opens directly; multiple matches are sorted by title and shown
as numbered choices. Interactive terminals prompt for a number, while
non-interactive use requires `--pick NUMBER`. Time-filtered find/open workflows
must repeat the same `--saved-within` or `--saved-since` filter so `--pick`
uses the displayed result numbering. `--with BROWSER` selects a known
browser alias or an explicit application/executable in native mode. Its
`--dry-run` prints the resolved bookmark URL without launching a browser.
`open --help` documents every launch option and gives linked search/open
workflow examples. Docker cannot launch host applications, so it prints the
selected URL instead. Native launch failures print the target for manual
opening without a stack trace and return a nonzero status.

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

The canonical cross-tool instructions live at `templates/vault/AGENTS.md` and
are synchronized to the vault root whenever migrations are checked. Update that
template whenever vault layout, schema fields, relationships, search behavior,
or safety rules change. Tests must verify both initial installation and refresh
of stale instructions.

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
path resolution, save/find/open behavior, temporary search-page safety and
cleanup, duplicate merging, time filters, GitHub/YouTube/Mural/Bandcamp/Imgur plugins, legacy
enrichment, Chrome capture, and Markdown content. E2E tests must use ignored
isolated test data, never the private vault.

## Release requirements

Before calling the project usable:

- provide standalone Windows and macOS companion binaries
- include CLI, HTTP API, vault operations, search, and configuration in one binary
- document installation, upgrades, and vault selection
- verify operation without Docker or language runtimes
- document private GitHub/GitLab vault workflows
- guard against public-vault initialization and accidental pushes

Use [TODO.md](../TODO.md) for the implementation backlog.
