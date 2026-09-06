# Local Web UI plan

## Objective

Add a companion-hosted, local Web UI for browsing, searching, and opening the
private bookmark vault. The Web UI and terminal UI (TUI) must be adapters over the same
application logic, so a query produces the same matches, ordering, IDs, and
metadata in both interfaces.

The first release is read-only. Saving continues through the browser add-on or
TUI until shared write operations and their security model are ready. The UI
uses vanilla HTML, CSS, and JavaScript with no external dependencies.

## Boundaries

- Keep the UI local; do not add a hosted service or remote account.
- Keep Markdown in the private vault as the source of truth.
- Do not expose the vault directory directly through an HTTP static-file route.
- Do not add Git operations or credentials to the UI or companion.
- Do not load scripts, fonts, analytics, images, or styles from external hosts.
- Treat bookmark URLs, titles, notes, senders, and device details as private.
- Keep development and browser tests in Docker Compose.
- Use only browser-standard HTML, CSS, and vanilla JavaScript. Do not add a
  frontend framework, build tool, package, CDN asset, or external runtime
  dependency.

## Shared application layer

Before adding routes or screens, move interface-neutral behavior out of the TUI
entry point in `src/cli.js` and the generated search-page renderer:

1. Introduce one query-options parser/validator for exact or fuzzy search,
   `saved-within`, and `saved-since`.
2. Introduce one bookmark result model containing the stable ID, title, safe
   HTTP/HTTPS URL, relative vault path, tags, contexts, save date, sender/device
   labels, and optional match details.
3. Keep `findBookmarks()` and `sortSearchResults()` as the source of search and
   ordering behavior. Do not reproduce matching or sorting in browser code.
4. Reuse the existing result-selection helpers for stable-ID and numbered
   selection. The Web UI opens a result through a safe HTTP/HTTPS anchor; the
   TUI continues to use the native browser launcher.
5. Make terminal formatting and HTML rendering consume the shared result model.

The same pattern applies to future writes: HTTP handlers and TUI commands must
call shared validated operations such as `saveBookmark()` rather than editing
Markdown independently.

## TUI refactor prerequisite

Make `src/cli.js` a thin TUI adapter before implementing the Web UI. The
refactor should separate these responsibilities:

- Keep each shared responsibility in its own focused source file and import it
  only where needed. Avoid a single large shared module or copying helpers
  between the TUI, server, and browser UI.
- Shared query parsing validates a plain options object. Small TUI and HTTP
  adapters translate `process.argv` and URL parameters into that object.
- Shared use-case functions perform find, resolve-one, save, and future edit
  operations without reading `process.argv`, writing to `console`, prompting,
  launching applications, or setting process exit codes.
- Shared result serialization produces interface-neutral bookmark summaries
  and details.
- TUI-only code formats terminal text, reads interactive menu input, sets exit
  status, and calls the native browser launcher.
- Web-only code renders DOM elements, updates browser URL state, and opens safe
  HTTP/HTTPS links.

Shared modules must not execute work when imported. Pass paths, clocks, and
other environment-specific values into functions instead of reading process or
browser globals internally. Export small functions with plain input and return
values so tests can cover them without starting the HTTP server, creating a
terminal, or launching a browser. Integration tests then verify that each
adapter composes those modules correctly.

Do not make the HTTP server import `src/cli.js`, and do not move terminal or DOM
concerns into `src/vault.js`. Preserve the existing TUI command syntax and
output during this refactor. Add characterization tests before moving behavior,
then add parity tests against the extracted functions.

## Local HTTP design

Serve the UI from the existing companion process:

- `GET /ui/` returns the application shell.
- `GET /ui/assets/*` returns versioned local CSS and JavaScript assets.
- `GET /ui/api/search` accepts `q`, `fuzzy`, `saved_within`, and `saved_since`.
- `GET /ui/api/bookmarks/:id` returns one record only when the ID or unique
  prefix resolves safely.

API responses use structured JSON view models, not raw absolute host paths.
Search results may include a relative vault path, while full Markdown is
returned only by the single-bookmark endpoint when the user requests details.
Errors use stable codes and actionable messages shared with TUI validation.

Before exposing read APIs, make binding explicit: native mode defaults to
`127.0.0.1`; Docker listens inside the container while Compose continues to
publish only `127.0.0.1:8787`. UI APIs are same-origin and must not inherit the
browser-add-on endpoint's wildcard CORS behavior.

## First vertical slice

1. Open `http://127.0.0.1:8787/ui/`.
2. Search using the same exact matching as `bookmark find`.
3. Display compact cards with title, short stable ID, URL, tags, and contexts.
4. Preserve the TUI's deterministic ordering.
5. Open a bookmark URL in a new browser tab with `noopener`, `noreferrer`, and
   no referrer policy.
6. Show a useful empty state instead of an exception.

## Search parity increment

After the vertical slice:

- Add fuzzy search with score and matched fields.
- Add `saved-within` and `saved-since` controls.
- Add compact and expanded detail views.
- Show sender and capture labels already available in the shared result model.
- Reflect filters in the URL query string so searches can be bookmarked locally.
- Add keyboard navigation without changing the ordering or selection rules.

Metadata filters should be implemented once in the shared query layer before
being exposed in either TUI or Web UI.

## Security and privacy checks

- Escape text at the rendering boundary; never inject bookmark Markdown as
  HTML.
- Allow only validated `http:` and `https:` destination links.
- Send a restrictive Content Security Policy and `Referrer-Policy: no-referrer`.
- Reject path traversal, unknown query parameters where practical, oversized
  queries, invalid dates, and unsupported methods.
- Do not include bookmark content in request logs or error logs.
- Do not make read endpoints available through wildcard CORS.
- If write endpoints are added later, require same-origin requests, validate
  `Origin`, and add explicit confirmation for destructive or bulk operations.

## Test plan

Add containerized tests at each increment:

1. Unit tests for query parsing and result-model serialization.
2. A shared TUI/Web contract test that runs both adapters against the same
   isolated vault fixtures and query-options table. Compare normalized results,
   including stable IDs, ordering, titles, URLs, tags, contexts, match type,
   score, matched fields, and save dates.
3. HTTP tests for routes, content types, validation errors, empty results,
   unique ID prefixes, path traversal, CORS, CSP, and referrer policy.
4. Rendering tests for hostile titles, URLs, tags, Markdown, and sender data.
5. Chromium E2E coverage for search, filters, details, keyboard selection, and
   opening a link, using only the isolated test vault.
6. Run `docker compose run --rm all-tests` before merging every increment.

The parity table must cover exact and fuzzy searches, every time filter,
time-filter-only searches with no text term, combined fuzzy/time options, one
and many matches, no matches, unique short IDs, and invalid input. Compare
structured values rather than terminal text or HTML; adapter-specific rendering
receives separate snapshot-free assertions. Empty results and validation
failures must map to the same shared status and error code even when their TUI
and HTTP presentation differs.

Any new search option is incomplete until it is added to this contract table.
This keeps TUI and Web behavior equal as both interfaces evolve.

## Delivery increments

### 1. TUI refactor and verification gate

- Refactor the TUI into a thin adapter over shared query and use-case modules.
- Extract query validation, use cases, and result serialization into separate,
  directly testable files that are imported only where needed.
- Update the TUI and generated HTML search page to consume the shared modules.
- Preserve current command syntax and output, and add characterization and
  parity regression tests.
- Add direct unit tests for every extracted shared module before switching the
  TUI to use it.
- Run the complete existing TUI test suite after each extraction and compare
  observable output, ordering, exit status, prompts, and browser-launch behavior
  with the characterization tests.
- Do not add Web UI HTML, assets, or HTTP routes until the refactored TUI passes
  lint, unit tests, integration tests, and the existing Chromium E2E test.

Completion of this increment is a hard gate. A passing unit test for shared
logic is necessary but not sufficient: the adapter-level tests must also prove
that the TUI still works as users expect.

TUI argument parsing is complete and documented in the developer guide. The
Web adapter must receive validated shared options; it must not copy the TUI
token parser.

### 2. Read-only Web UI

- Add local assets and search/detail endpoints.
- Implement exact search, empty/error states, result cards, and safe opening.
- Add HTTP and Chromium tests.

### 3. Full search parity

- Add fuzzy and time controls, expanded details, URL state, and keyboard use.
- Verify identical result IDs and ordering across TUI and Web UI.

### 4. Shared write operations

- Evaluate create/edit/tag/context workflows only after the read-only UI is
  stable.
- Reuse existing vault operations and validation.
- Add confirmations, concurrency handling, and regression tests before enabling
  any destructive or bulk change.

## Acceptance criteria

- The Web UI runs from the existing local companion in native and Docker modes.
- The frontend uses vanilla JavaScript and has no external dependencies or
  build step.
- No Node package or development tool is required beyond the project's existing
  Docker workflow.
- Equivalent TUI and Web UI queries return identical stable IDs and ordering.
- Automated contract tests compare the complete shared result model and error
  semantics for both adapters.
- Search and filtering logic has one implementation outside interface code.
- Shared responsibilities live in focused, side-effect-free modules with direct
  unit tests.
- `src/cli.js` contains only TUI-specific argument, formatting, prompt,
  process-status, and launcher behavior.
- The UI never serves arbitrary vault files or sends vault data externally.
- Empty, invalid, and malicious inputs have tested, user-facing behavior.
- Existing browser-add-on saves, TUI output, migrations, and generated search
  pages continue to pass their regression tests.
