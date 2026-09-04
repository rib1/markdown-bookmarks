# Markdown Bookmarks plan

## Vision

Close browser tabs without losing useful context. A browser extension captures a page and sends it to a local standalone companion, which writes a durable, searchable Markdown record into a private Git-versioned vault.

The application repository is public. The user’s vault is a separate private repository and is never bundled with the application.

## Current decisions

- Personal-first CLI companion; no web UI for the initial product.
- Docker is used for development and CI only.
- The released companion is a standalone Windows/macOS executable and does not require Docker or a language runtime.
- Git is used by the user on the host for versioning and synchronization.
- Markdown with YAML frontmatter is the canonical data format.
- SQLite/search indexes may be added later but must be regenerable.
- Browser integration uses a localhost HTTP API, not native messaging.
- Categories are metadata, not directories.
- Windows and macOS are required companion-app targets.
- The host needs Docker Desktop and Git, but no language runtime.

## Vault layout

```text
private-vault/
├── bookmarks/YYYY/MM/<stable-id>-<slug>.md
├── projects/<stable-id>-<slug>.md
├── events/<stable-id>-<slug>.md
├── assets/<bookmark-id>/
└── views/                 # generated, optional
```

In Docker development, the private vault is mounted at `/vault`. In a release,
the companion uses a native host path configured by the user. The extension
always connects to `http://127.0.0.1:8787`, independent of host operating system.

## Bookmark metadata

```yaml
id: stable-id
url: https://example.com/page
title: Page title
type: article
contexts: [work, learning]
areas: [software-development]
projects: [database-migration]
events: []
tags: [postgres, performance]
status: unread
priority: high
published_at: 2026-08-28
published_at_source: article-meta
published_at_confidence: high
saved_at: 2026-09-04T14:30:00+03:00
first_opened_at: 2026-09-04T10:12:00+03:00
last_opened_at: 2026-09-04T15:10:00+03:00
access_count: 4
summary: Short searchable summary
related: []
```

## Milestones

### M0 — Working vertical slice

- Docker Compose starts the companion service.
- Extension saves the active tab with user-entered tags.
- Service writes one Markdown file into a bind-mounted vault.
- CLI finds the saved bookmark by URL, title, tag, or body text.
- Containerized automated test verifies save and find behavior.

### M1 — Reliable vault format

- Add contexts, areas, projects, events, and typed relations.
- Add safe update/merge behavior for duplicate URLs.
- Validate and document frontmatter.
- Add fixture vaults containing only synthetic data.

### M2 — Browser workflow

- Save all tabs and tab groups.
- Record first-opened, last-opened, and access-count events.
- Import browser bookmark HTML and selected history.
- Provide clear offline/error behavior when the companion is stopped.

### M3 — Page preservation and retrieval

- Extract title, description, publication date, and canonical URL.
- Store optional cleaned Markdown/page snapshot.
- Add full-text indexing with a rebuild command.
- Add link health and duplicate checks.

### M4 — Git-friendly operations

- Add explicit CLI commands for status, commit, diff, and sync guidance.
- Keep commits user-controlled by default.
- Document private GitHub/GitLab remote setup without handling credentials.

### M5 — Cross-platform packaging

- Select a compiled companion implementation, preferably Go or Rust, producing standalone Windows and macOS binaries.
- Build release binaries in Docker for reproducibility.
- Verify the standalone binary without Docker on Windows and macOS.
- Verify Docker Compose and bind mounts on Windows and macOS.
- Provide PowerShell and POSIX command examples.
- Verify the unpacked extension against Chrome/Chromium on both platforms.
- Handle Docker-stopped and vault-permission errors with actionable messages.

## End-to-end acceptance test

1. Start with `docker compose up --build -d`.
2. Load `extension/` as an unpacked Chromium extension.
3. Open a test page.
4. Enter `work,database` in the extension and save the current tab.
5. Confirm a Markdown file appears in `vault/bookmarks/YYYY/MM/`.
6. Confirm frontmatter contains URL, title, both tags, and timestamps.
7. Run `docker compose exec bookmarkd node src/cli.js find <term>`.
8. Confirm the saved file is returned.
9. Stop the service and verify the Markdown remains usable by Git and a plain text editor.

## Open questions

- Whether summaries are manual, locally generated, or supplied by an optional external model.
- Whether archived page content is stored in Git, Git LFS, or a separate archive.
- Whether access events are committed immediately, daily, or only manually.
- Whether the CLI remains Node-based or later becomes a standalone binary.
