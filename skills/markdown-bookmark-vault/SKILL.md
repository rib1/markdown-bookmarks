---
name: markdown-bookmark-vault
description: Work with a Markdown bookmark vault: find, summarize, classify, relate, and safely update bookmarks, projects, and life events while preserving stable IDs and user-owned files.
metadata:
  short-description: Safely manage a Markdown bookmark vault
---

# Markdown bookmark vault

Use this skill when the user asks to search, organize, summarize, classify,
relate, review, or update their Markdown bookmark vault.

## Core rules

- Treat the vault’s Markdown files as the source of truth.
- Preserve stable `id` values, URLs, timestamps, notes, and existing metadata.
- Never move files solely to represent categories; use metadata instead.
- Keep `contexts`, `areas`, `projects`, `events`, and `tags` distinct:
  contexts describe life context, areas are ongoing responsibilities, projects
  are temporary goals, events are time-bound occasions, and tags describe
  subject matter.
- Use existing project/event IDs when linking bookmarks. Do not create duplicate
  entities because names differ slightly.
- Preserve the source and confidence of extracted publication dates.
- Keep page authors distinct from people who shared links. Missing sender data
  is normal and must not be guessed from URLs or authors.
- Preserve structured `share_history` and `capture_history` events and their IDs.
- Add typed relationships only when supported by the page or user instruction.

## Safe workflow

1. Identify the vault root and read its `AGENTS.md`, optional
   `AGENTS.local.md`, and documented layout.
2. Search Markdown files before proposing new bookmarks or entities.
3. Read relevant frontmatter and body text; do not rely only on filenames.
4. Make the smallest edit that satisfies the request.
5. Preserve valid YAML and ordinary Markdown links.
6. Report changed files and important metadata changes.

## Privacy and external actions

- Treat all vault content as private personal data.
- Do not send URLs or page text to external services unless explicitly requested.
- Do not delete, merge, archive, or rewrite many files without explicit scope.
- Do not commit or push Git changes unless explicitly requested.
- Before destructive bulk changes, provide a preview or require confirmation.

## Useful operations

- Find bookmarks by title, URL, tag, project, context, event, sender, save
  device, browser, or body text.
- Identify unclassified, stale, duplicate, or missing-metadata bookmarks.
- Suggest tags, contexts, projects, events, and relationships, distinguishing
  suggestions from confirmed edits.
- Summarize a bookmark without replacing the user’s notes.
- Produce review lists such as unread work links or recently saved project
  references.

Treat the vault-root `AGENTS.md` as the canonical, companion-maintained
instructions for current frontmatter, layout, and portable search guidance.
Do not require access to the application repository to use this skill.
