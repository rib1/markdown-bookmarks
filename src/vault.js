import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { applySitePlugins } from './site-plugins.js';

export const BOOKMARK_SCHEMA_VERSION = 1;
const VAULT_SCHEMA_FILE = '.markdown-bookmarks.json';

export function vaultRoot() {
  return process.env.BOOKMARK_VAULT || process.env.VAULT_PATH || path.resolve('vault');
}

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

function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
  return url.toString();
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'bookmark';
}

function yamlList(values) {
  return values.length ? values.map((v) => `  - ${JSON.stringify(v)}`).join('\n') : '  []';
}

async function findBookmarkByUrl(url, root) {
  const normalized = normalizeUrl(url);
  for (const result of await findBookmarks('', root)) {
    const match = result.content.match(/^(?:canonical_url|url):\s*["']?([^"'\r\n]+)["']?\s*$/m);
    if (match && normalizeUrl(match[1]) === normalized) return result;
  }
  return undefined;
}

function replaceScalar(content, field, value) {
  const line = `${field}: ${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${field}:.*$`, 'm');
  return pattern.test(content) ? content.replace(pattern, line) : content.replace(/^---\n/, `---\n${line}\n`);
}

function readScalar(content, field) {
  const match = content.match(new RegExp(`^${field}:\\s*(.*?)\\s*$`, 'm'));
  if (!match) return undefined;
  const value = match[1];
  try { return JSON.parse(value); } catch { return value.replace(/^["']|["']$/g, ''); }
}

function removeScalar(content, field) {
  return content.replace(new RegExp(`^${field}:.*(?:\\n|$)`, 'm'), '');
}

function replaceList(content, field, values) {
  const block = `${field}:\n${yamlList(values)}\n`;
  const pattern = new RegExp(`^${field}:\\n(?:  - .*\\n|  \\[\\]\\n)*`, 'm');
  if (pattern.test(content)) return content.replace(pattern, block);
  if (/^tags:/m.test(content)) return content.replace(/^tags:/m, `${block}tags:`);
  return content.replace(/^---\n/, `---\n${block}`);
}

function readList(content, field) {
  const match = content.match(new RegExp(`^${field}:\\r?\\n((?: {2}(?:- [^\\r\\n]*|\\[\\])\\r?\\n?)*)`, 'm'));
  if (!match) return [];
  return [...match[1].matchAll(/^ {2}- (.+?)\r?$/gm)].map((item) => {
    try { return JSON.parse(item[1]); } catch { return item[1].replace(/^["']|["']$/g, ''); }
  });
}

async function writeAtomic(file, content) {
  const temporary = `${file}.migration-${process.pid}-${crypto.randomUUID()}.tmp`;
  const { mode } = await fs.stat(file).catch(() => ({ mode: undefined }));
  try {
    await fs.writeFile(temporary, content, 'utf8');
    if (mode !== undefined) await fs.chmod(temporary, mode);
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function ensureVaultGitignore(root) {
  const file = path.join(root, '.gitignore');
  let content = '';
  try { content = await fs.readFile(file, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (content.split(/\r?\n/).includes('.DS_Store')) return false;
  const separator = content && !content.endsWith('\n') ? '\n' : '';
  if (content) await writeAtomic(file, `${content}${separator}.DS_Store\n`);
  else await fs.writeFile(file, '.DS_Store\n', 'utf8');
  return true;
}

async function readVaultSchemaVersion(root) {
  const file = path.join(root, VAULT_SCHEMA_FILE);
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw new Error(`Cannot read vault schema manifest ${file}: ${error.message}`, { cause: error });
  }
  const version = Number(manifest.schema_version);
  if (!Number.isInteger(version) || version < 0) throw new Error(`Invalid vault schema version: ${manifest.schema_version}`);
  return version;
}

async function writeVaultSchemaVersion(root, version) {
  const file = path.join(root, VAULT_SCHEMA_FILE);
  await writeAtomic(file, `${JSON.stringify({ schema_version: version }, null, 2)}\n`);
}

function migrateToSchemaVersion1(content) {
  const savedAt = readScalar(content, 'saved_at');
  if (!savedAt) throw new Error('Cannot migrate bookmark without saved_at');
  const url = readScalar(content, 'url');
  if (!url) throw new Error('Cannot migrate bookmark without url');

  const firstSavedAt = readScalar(content, 'first_saved_at')
    || readScalar(content, 'first_opened_at') || savedAt;
  const lastSavedAt = readScalar(content, 'last_saved_at')
    || readScalar(content, 'last_opened_at') || savedAt;
  let saveHistory = readList(content, 'save_history');
  if (!saveHistory.length) {
    saveHistory = [firstSavedAt];
    if (lastSavedAt !== firstSavedAt) saveHistory.push(lastSavedAt);
  }
  const legacyAccessCount = Number(readScalar(content, 'access_count'));
  const existingSaveCount = Number(readScalar(content, 'save_count'));
  const saveCount = Number.isInteger(existingSaveCount) && existingSaveCount > 0
    ? existingSaveCount
    : Number.isInteger(legacyAccessCount) && legacyAccessCount > 0 ? legacyAccessCount : saveHistory.length;

  const corruptedTagValues = new Set(saveHistory.map(String));
  const originalTags = readList(content, 'tags');
  const tags = originalTags.filter((tag) => !corruptedTagValues.has(String(tag)));
  const contexts = readList(content, 'contexts');
  const ambiguousContextTags = tags.filter((tag) => contexts.includes(tag)).length;

  if (!readScalar(content, 'canonical_url')) content = replaceScalar(content, 'canonical_url', normalizeUrl(url));
  if (!readScalar(content, 'type')) content = replaceScalar(content, 'type', 'bookmark');
  if (!/^contexts:/m.test(content)) content = replaceList(content, 'contexts', []);
  if (!/^tags:/m.test(content) || tags.length !== originalTags.length) content = replaceList(content, 'tags', tags);
  content = replaceScalar(content, 'first_saved_at', firstSavedAt);
  content = replaceScalar(content, 'last_saved_at', lastSavedAt);
  content = replaceScalar(content, 'save_count', Math.max(saveCount, saveHistory.length));
  content = replaceList(content, 'save_history', saveHistory);
  content = removeScalar(content, 'first_opened_at');
  content = removeScalar(content, 'last_opened_at');
  content = removeScalar(content, 'access_count');

  return {
    content,
    repairedTags: originalTags.length - tags.length,
    ambiguousContextTags
  };
}

const BOOKMARK_MIGRATIONS = [
  { version: 1, migrate: migrateToSchemaVersion1 }
];

export function migrateBookmarkContent(original) {
  const declaredVersion = readScalar(original, 'schema_version');
  const parsedVersion = declaredVersion === undefined ? 0 : Number(declaredVersion);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 0) throw new Error(`Invalid bookmark schema version: ${declaredVersion}`);
  if (parsedVersion > BOOKMARK_SCHEMA_VERSION) {
    throw new Error(`Bookmark schema version ${parsedVersion} is newer than supported version ${BOOKMARK_SCHEMA_VERSION}`);
  }

  let content = original;
  let version = parsedVersion;
  let repairedTags = 0;
  let ambiguousContextTags = 0;
  for (const migration of BOOKMARK_MIGRATIONS) {
    if (version >= migration.version) continue;
    const result = migration.migrate(content);
    content = replaceScalar(result.content, 'schema_version', migration.version);
    repairedTags += result.repairedTags;
    ambiguousContextTags += result.ambiguousContextTags;
    version = migration.version;
  }
  return { content, fromVersion: parsedVersion, toVersion: version, repairedTags, ambiguousContextTags };
}

export async function migrateVault(root = vaultRoot()) {
  await fs.mkdir(root, { recursive: true });
  const gitignoreUpdated = await ensureVaultGitignore(root);
  const fromSchemaVersion = await readVaultSchemaVersion(root);
  if (fromSchemaVersion > BOOKMARK_SCHEMA_VERSION) {
    throw new Error(`Vault schema version ${fromSchemaVersion} is newer than supported version ${BOOKMARK_SCHEMA_VERSION}`);
  }
  const result = {
    fromSchemaVersion,
    schemaVersion: BOOKMARK_SCHEMA_VERSION,
    scanned: 0,
    migrated: 0,
    repairedTags: 0,
    ambiguousContextTags: 0,
    gitignoreUpdated,
    skipped: fromSchemaVersion === BOOKMARK_SCHEMA_VERSION
  };
  if (result.skipped) return result;

  const bookmarks = await findBookmarks('', root);
  result.scanned = bookmarks.length;
  for (const bookmark of bookmarks) {
    let migration;
    try { migration = migrateBookmarkContent(bookmark.content); } catch (error) {
      throw new Error(`Failed to migrate ${bookmark.file}: ${error.message}`, { cause: error });
    }
    result.repairedTags += migration.repairedTags;
    result.ambiguousContextTags += migration.ambiguousContextTags;
    if (migration.content === bookmark.content) continue;
    await writeAtomic(bookmark.file, migration.content);
    result.migrated++;
  }
  await writeVaultSchemaVersion(root, BOOKMARK_SCHEMA_VERSION);
  return result;
}

export async function saveBookmark(input, root = vaultRoot()) {
  input = applySitePlugins(input);
  const now = input.saved_at || new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  const title = input.title || input.url;
  const tags = [...new Set((input.tags || []).map(String).map((v) => v.trim()).filter(Boolean))];
  const canonicalUrl = normalizeUrl(input.url);
  const existing = await findBookmarkByUrl(canonicalUrl, root);
  if (existing) {
    let content = migrateBookmarkContent(existing.content).content;
    const oldTags = readList(content, 'tags');
    const mergedTags = [...new Set([...oldTags, ...tags])];
    content = replaceList(content, 'tags', mergedTags);
    if (input.contexts?.length) {
      const oldContexts = readList(content, 'contexts');
      content = replaceList(content, 'contexts', [...new Set([...oldContexts, ...input.contexts])]);
    }
    for (const field of ['type', 'site', 'repository', 'author', 'video_id', 'space_key', 'page_id', 'issue_key', 'project_key', 'published_at', 'published_at_source', 'published_at_confidence']) {
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
    return { id: readScalar(content, 'id'), file: existing.file, title, tags: mergedTags, duplicate: true };
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
    input.space_key ? `space_key: ${JSON.stringify(input.space_key)}` : '',
    input.page_id ? `page_id: ${JSON.stringify(input.page_id)}` : '',
    input.issue_key ? `issue_key: ${JSON.stringify(input.issue_key)}` : '',
    input.project_key ? `project_key: ${JSON.stringify(input.project_key)}` : '',
    input.author ? `author: ${JSON.stringify(input.author)}` : '',
    input.published_at ? `published_at: ${input.published_at}` : '',
    input.published_at_source ? `published_at_source: ${input.published_at_source}` : '',
    input.published_at_confidence ? `published_at_confidence: ${input.published_at_confidence}` : '',
    `saved_at: ${now}`, `first_saved_at: ${input.first_saved_at || now}`,
    `last_saved_at: ${input.last_saved_at || now}`, `save_count: ${input.save_count || 1}`,
    `save_history:`, yamlList([now]), `---`
  ].filter(Boolean).join('\n');
  const body = `${metadata}\n\n## Summary\n\n${input.summary || ''}\n`;
  await fs.writeFile(file, body, 'utf8');
  return { id, file, title, tags };
}

function savedAfter(content, cutoff) {
  const savedAt = content.match(/^saved_at:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
  return savedAt && !Number.isNaN(Date.parse(savedAt)) && Date.parse(savedAt) >= cutoff;
}

export async function findBookmarks(query, root = vaultRoot(), { savedWithin, savedSince } = {}) {
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
        if (content.toLowerCase().includes(query.toLowerCase()) && (cutoff === undefined || savedAfter(content, cutoff))) {
          results.push({ file: target, content });
        }
      }
    }
  }
  await walk(base);
  return results;
}
