import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  normalizeUrl,
  normalizeTags,
  readList,
  readScalar,
  replaceList,
  replaceScalar,
  yamlList
} from './bookmark-format.js';
import {
  BOOKMARK_SCHEMA_VERSION,
  VAULT_SCHEMA_FILE,
  migrateBookmarkContent,
  migrateVault
} from './migrations/index.js';
import { applySitePlugins } from './site-plugins/index.js';
import { fuzzyBookmarkMatch } from './fuzzy-search.js';
import { sortSearchResults } from './search-result-order.js';
import { appendShareEvent, createShareEvent } from './share-history.js';
import { appendCaptureEvent, createCaptureEvent } from './capture-history.js';
import { vaultRoot } from './vault-path.js';

export { vaultRoot } from './vault-path.js';

export async function installVaultSkill(root) {
  const source = process.env.SKILL_SOURCE || path.resolve('skills', 'markdown-bookmark-vault', 'SKILL.md');
  const target = path.join(root, '.codex', 'skills', 'markdown-bookmark-vault', 'SKILL.md');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  return target;
}

export async function initVault(root, { installSkill = true } = {}) {
  await Promise.all(['bookmarks', 'projects', 'events', 'assets', 'views'].map((name) =>
    fs.mkdir(path.join(root, name), { recursive: true })));
  const attributes = path.join(root, '.gitattributes');
  try {
    await fs.access(attributes);
  } catch {
    await fs.writeFile(attributes, '* text=auto eol=lf\n', 'utf8');
  }
  const readme = path.join(root, 'README.md');
  try {
    await fs.access(readme);
  } catch {
    const vaultReadme = [
      '# Private bookmark vault',
      '',
      'This directory contains your personal browser bookmarks and related notes.',
      'It is designed to be private and Git-versioned.',
      '',
      '## Directories',
      '',
      '- `bookmarks/` - one Markdown file per saved page, organized by save month',
      '- `projects/` - project records linked from bookmarks',
      '- `events/` - life-event records linked from bookmarks',
      '- `assets/` - optional saved page content and images',
      '- `views/` - optional generated lists and searches',
      '- `AGENTS.md` - companion-managed instructions for LLM agents working in this vault',
      '- `.codex/skills/` - LLM instructions for working safely with this vault',
      `- \`${VAULT_SCHEMA_FILE}\` - vault schema version used for automatic migrations`,
      '',
      'Markdown files are the source of truth. Search indexes and generated views can',
      'be recreated. Do not commit this vault to a public repository.',
      ''
    ].join('\n');
    await fs.writeFile(readme, vaultReadme, 'utf8');
  }
  if (installSkill) {
    await installVaultSkill(root);
  }
  await migrateVault(root);
  return root;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'bookmark';
}

async function findBookmarkByUrl(url, root) {
  const normalized = normalizeUrl(url);
  for (const result of await findBookmarks('', root)) {
    const match = result.content.match(/^(?:canonical_url|url):\s*["']?([^"'\r\n]+)["']?\s*$/m);
    if (match && normalizeUrl(match[1]) === normalized) return result;
  }
  return undefined;
}

export async function saveBookmark(input, root = vaultRoot()) {
  input = applySitePlugins(input);
  const now = input.saved_at || new Date().toISOString();
  const shareEvent = createShareEvent(input, now);
  const captureEvent = createCaptureEvent(input, now);
  const id = input.id || crypto.randomUUID();
  const title = input.title || input.url;
  const tags = normalizeTags(input.tags);
  const canonicalUrl = normalizeUrl(input.url);
  const existing = await findBookmarkByUrl(canonicalUrl, root);
  if (existing) {
    let content = migrateBookmarkContent(existing.content).content;
    const oldTags = readList(content, 'tags');
    const mergedTags = normalizeTags([...oldTags, ...tags]);
    content = replaceList(content, 'tags', mergedTags);
    if (input.contexts?.length) {
      const oldContexts = readList(content, 'contexts');
      content = replaceList(content, 'contexts', [...new Set([...oldContexts, ...input.contexts])]);
    }
    if (shareEvent) {
      const mergedShares = appendShareEvent(readList(content, 'share_history'), shareEvent);
      if (mergedShares.added) content = replaceList(content, 'share_history', mergedShares.history);
    }
    if (captureEvent) {
      const mergedCaptures = appendCaptureEvent(readList(content, 'capture_history'), captureEvent);
      if (mergedCaptures.added) content = replaceList(content, 'capture_history', mergedCaptures.history);
    }
    for (const field of ['type', 'site', 'repository', 'author', 'video_id', 'imgur_id', 'space_key', 'page_id', 'issue_key', 'project_key', 'published_at', 'published_at_source', 'published_at_confidence']) {
      if (input[field]) content = replaceScalar(content, field, input[field]);
    }
    content = replaceScalar(content, 'last_saved_at', now);
    const previousSaveCount = Number(readScalar(content, 'save_count') || 0);
    let saveHistory = readList(content, 'save_history');
    if (!saveHistory.length) {
      const originalSavedAt = content.match(/^saved_at:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
      saveHistory = originalSavedAt ? [originalSavedAt] : [];
    }
    saveHistory.push(now);
    content = replaceScalar(content, 'save_count', Math.max(previousSaveCount + 1, saveHistory.length));
    content = replaceList(content, 'save_history', saveHistory);
    content = replaceScalar(content, 'schema_version', BOOKMARK_SCHEMA_VERSION);
    await fs.writeFile(existing.file, content, 'utf8');
    return {
      id: readScalar(content, 'id'), file: existing.file, title, tags: mergedTags,
      duplicate: true, share_recorded: Boolean(shareEvent), capture_recorded: Boolean(captureEvent)
    };
  }
  const dir = path.join(root, 'bookmarks', now.slice(0, 7).replace('-', path.sep));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}-${slug(title)}.md`);
  const contexts = [...new Set((input.contexts || []).map(String).filter(Boolean))];
  const metadata = [
    `---`, `schema_version: ${BOOKMARK_SCHEMA_VERSION}`, `id: ${id}`, `url: ${JSON.stringify(input.url)}`, `canonical_url: ${JSON.stringify(canonicalUrl)}`,
    `title: ${JSON.stringify(title)}`, `type: ${input.type || 'bookmark'}`, `contexts:`, yamlList(contexts), `tags:`, yamlList(tags),
    input.site ? `site: ${input.site}` : '',
    input.repository ? `repository: ${JSON.stringify(input.repository)}` : '',
    input.video_id ? `video_id: ${JSON.stringify(input.video_id)}` : '',
    input.imgur_id ? `imgur_id: ${JSON.stringify(input.imgur_id)}` : '',
    input.space_key ? `space_key: ${JSON.stringify(input.space_key)}` : '',
    input.page_id ? `page_id: ${JSON.stringify(input.page_id)}` : '',
    input.issue_key ? `issue_key: ${JSON.stringify(input.issue_key)}` : '',
    input.project_key ? `project_key: ${JSON.stringify(input.project_key)}` : '',
    input.author ? `author: ${JSON.stringify(input.author)}` : '',
    input.published_at ? `published_at: ${input.published_at}` : '',
    input.published_at_source ? `published_at_source: ${input.published_at_source}` : '',
    input.published_at_confidence ? `published_at_confidence: ${input.published_at_confidence}` : '',
    shareEvent ? `share_history:\n${yamlList([shareEvent])}` : '',
    captureEvent ? `capture_history:\n${yamlList([captureEvent])}` : '',
    `saved_at: ${now}`, `first_saved_at: ${input.first_saved_at || now}`,
    `last_saved_at: ${input.last_saved_at || now}`, `save_count: ${input.save_count || 1}`,
    `save_history:`, yamlList([now]), `---`
  ].filter(Boolean).join('\n');
  const body = `${metadata}\n\n## Summary\n\n${input.summary || ''}\n`;
  await fs.writeFile(file, body, 'utf8');
  return {
    id, file, title, tags,
    share_recorded: Boolean(shareEvent), capture_recorded: Boolean(captureEvent)
  };
}

function savedAfter(content, cutoff) {
  const savedAt = content.match(/^saved_at:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
  return savedAt && !Number.isNaN(Date.parse(savedAt)) && Date.parse(savedAt) >= cutoff;
}

export async function findBookmarks(query, root = vaultRoot(), { savedWithin, savedSince, fuzzy = false } = {}) {
  const base = path.join(root, 'bookmarks');
  const results = [];
  const durations = { day: 1, week: 7, month: 30, year: 365 };
  const cutoff = savedSince ? Date.parse(savedSince) : savedWithin ? Date.now() - (durations[savedWithin] || 0) * 86400000 : undefined;
  if (savedWithin && !durations[savedWithin]) throw new Error('savedWithin must be one of: day, week, month, year');
  if (savedSince && Number.isNaN(cutoff)) throw new Error('savedSince must be a valid date such as 2026-09-04');
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.name.endsWith('.md')) {
        const content = await fs.readFile(target, 'utf8');
        if (cutoff !== undefined && !savedAfter(content, cutoff)) continue;
        if (content.toLowerCase().includes(query.toLowerCase())) {
          results.push(fuzzy
            ? { file: target, content, matchType: 'exact', matchScore: 1, matchedFields: ['content'] }
            : { file: target, content });
          continue;
        }
        if (!fuzzy) continue;
        const match = fuzzyBookmarkMatch(query, content);
        if (match) results.push({
          file: target,
          content,
          matchType: 'fuzzy',
          matchScore: match.score,
          matchedFields: match.fields
        });
      }
    }
  }
  await walk(base);
  return fuzzy ? sortSearchResults(results) : results;
}
