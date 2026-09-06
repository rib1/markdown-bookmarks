# TODO

This list captures the remaining work agreed during the initial design and
prototype sessions.

## Next priorities

- [ ] Add a real CLI configuration command that stores the selected vault path
      for future invocations without requiring `BOOKMARK_VAULT` every time.
- [x] Add a simple host wrapper or standalone CLI workflow so users do not need
      to run `docker compose exec ...` for normal use.
- [ ] Add a `dedupe` command to preview and safely merge existing duplicate
      bookmarks, preserving tags, metadata, notes, and access history.
- [x] Add CLI tests for `find`, `open`, and time filters, including the new
      content-rich output format.
- [x] Add the public GitHub remote and push the latest commits.

## Browser capture

- [ ] Save all tabs in the current window.
- [ ] Save all tabs in a tab group.
- [ ] Capture browser tab groups as contexts or projects when requested.
- [ ] Record browser access events, not only save events.
- [x] Improve error messages when the companion is stopped or unreachable.
- [ ] Test the extension on Chrome/Chromium on both Windows and macOS.
- [ ] Test Firefox compatibility.
- [ ] Package and document browser extension installation for eventual store
      distribution.

## Metadata extraction

- [x] Improve generic author extraction and publication-date detection.
- [ ] Store extraction provenance and confidence consistently for all generated
      metadata.
- [ ] Add canonical URL handling for more sites.
- [ ] Add deterministic content extraction for cleaned Markdown.
- [ ] Add optional page description and key-point extraction without requiring
      an LLM.
- [ ] Define behavior when metadata is missing, conflicting, or clearly stale.

## Site plugins

- [x] Create a site-plugin registry in the companion.
- [x] Add GitHub site metadata: site, repository, owner/author, and `github` tag.
- [x] Add YouTube metadata: site, video type, video ID, and mandatory `youtube`
      tag.
- [x] Add site-plugin tests for GitHub and YouTube metadata and legacy GitHub
      bookmark enrichment.
- [ ] Add duplicate-save backfill tests specifically for YouTube metadata.
- [x] Document how to add a new site plugin.
- [ ] Consider plugins for common article, PDF, podcast, and social sites.
- [x] Add Confluence and Jira site metadata plugins and tests.

## Vault and data model

- [x] Use Markdown files with YAML frontmatter as the source of truth.
- [x] Keep categories, contexts, areas, projects, events, and tags in metadata
      rather than semantic directories.
- [x] Support typed relationships between bookmarks.
- [x] Generate a short vault README during initialization.
- [x] Install the vault-management LLM skill during initialization.
- [ ] Add project and event creation/editing commands.
- [ ] Add commands for adding and removing tags, contexts, projects, events,
      and relationships.
- [ ] Add validation for frontmatter and stable IDs.
- [x] Add versioned, idempotent migration handling for bookmark schema changes.
- [ ] Add optional generated views for projects, contexts, events, unread items,
      and recent activity.

## Search and opening

- [x] Refactor TUI argument parsing to reject ambiguous, duplicate, unknown, and
      malformed options with concise errors.
- [x] Allow time-filter-only searches such as
      `find --saved-within day` without requiring a text term.
- [ ] Add a local Web UI that reuses the terminal UI (TUI) search, filtering,
      result
      ordering, selection, opening, and vault-operation logic instead of
      implementing separate behavior, using vanilla JavaScript with no external
      dependencies. First refactor the TUI into a thin adapter over shared
      application logic kept in focused, directly testable files that are
      imported only where needed. Keep TUI and Web behavior equal with shared
      contract tests. See [Web UI plan](docs/WEB-UI-PLAN.md).
- [x] Search URLs, titles, tags, summaries, and Markdown content.
- [x] Return file path, URL, and full Markdown content from `find`.
- [x] Add `--saved-within day|week|month|year` filtering.
- [x] Add `--saved-since YYYY-MM-DD` filtering.
- [x] Add `open QUERY` and `open QUERY --dry-run`.
- [ ] Add structured output such as `--json` and `--jsonl`.
- [ ] Add tag, context, project, event, site, type, and status filters.
- [x] Add ranking and stable result ordering.
- [ ] Add a rebuildable SQLite FTS index when plain recursive search becomes too
      slow.

## Page preservation

- [ ] Add optional clean Markdown page capture.
- [ ] Add optional HTML snapshot capture.
- [ ] Store assets under `assets/<bookmark-id>/`.
- [ ] Add link health checks and stale-link reporting.
- [ ] Decide whether large files use Git LFS or a separate archive.
- [ ] Document privacy, copyright, paywall, login, and JavaScript limitations.

## Git integration

- [x] Keep Git operations user-controlled by default.
- [ ] Add CLI guidance for status, diff, commit, pull, and push.
- [ ] Add optional local commit modes: manual, on-save, or daily.
- [x] Never put Git credentials in the browser extension.
- [ ] Test the private vault workflow with GitHub and GitLab remotes.
- [ ] Add safeguards against accidentally initializing or pushing a public vault.

## LLM integration

- [x] Add `skills/markdown-bookmark-vault/SKILL.md`.
- [x] Make vault initialization install the skill under `.codex/skills/`.
- [ ] Add examples for common vault questions and review workflows.
- [ ] Add explicit read-only and edit modes to the skill guidance.
- [ ] Decide whether summaries remain manual/deterministic or support optional
      external/local models.
- [x] Ensure LLM workflows never expose vault content without user approval.

## Distribution and cross-platform packaging

- [ ] Replace the Node prototype companion with a compiled standalone binary.
- [ ] Choose Go or Rust for the companion implementation.
- [ ] Include CLI, localhost API, vault operations, search, and configuration in
      one executable.
- [ ] Build Windows and macOS binaries reproducibly in Docker.
- [ ] Sign release binaries where practical.
- [ ] Verify the companion works without Docker, Node, Python, or npm installed.
- [ ] Add installation and upgrade instructions for Windows and macOS.

## Testing and quality

- [x] Run Dockerized unit tests for vault initialization, metadata, paths,
      deduplication, plugins, and time filters.
- [x] Run a Dockerized Chrome E2E test for save, tags, duplicate saves, file
      creation, search, and CLI URL resolution.
- [x] Ensure E2E always uses isolated test data and never a configured private
      vault.
- [ ] Add failure tests for malformed URLs, invalid dates, inaccessible vaults,
      and unavailable companion service.
- [ ] Add Windows and macOS CI coverage.
- [ ] Add backup/restore verification for a private vault.
