import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeUrl, readList, readScalar } from './bookmark-format.js';
import { BOOKMARK_SCHEMA_VERSION, VAULT_SCHEMA_FILE } from './migrations/index.js';
import { listBookmarkFiles } from './vault-bookmark-files.js';
import { oneLine, vaultPathLines } from './vault-path-display.js';

const hashPattern = /^[0-9a-f]{40,64}$/i;
const refPattern = /^refs\/[A-Za-z0-9._/-]+$/;

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function countMarkdownFiles(directory) {
  let count = 0;
  async function walk(current) {
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) count++;
    }
  }
  await walk(directory);
  return count;
}

function safeRef(ref) {
  return refPattern.test(ref) && !ref.includes('..') && !ref.includes('//') && !ref.endsWith('/');
}

async function readPackedRef(gitDirectory, ref) {
  let packed;
  try { packed = await fs.readFile(path.join(gitDirectory, 'packed-refs'), 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  for (const line of packed.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('^')) continue;
    const separator = line.indexOf(' ');
    if (separator > 0 && line.slice(separator + 1) === ref && hashPattern.test(line.slice(0, separator))) {
      return line.slice(0, separator).toLowerCase();
    }
  }
  return undefined;
}

async function readRef(gitDirectory, ref) {
  if (!safeRef(ref)) return undefined;
  let value;
  try { value = (await fs.readFile(path.join(gitDirectory, ...ref.split('/')), 'utf8')).trim(); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (hashPattern.test(value || '')) return value.toLowerCase();
  return readPackedRef(gitDirectory, ref);
}

function unquoteConfigValue(value) {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed;
  return trimmed.slice(1, -1).replace(/\\(\\|")/g, '$1');
}

function upstreamForBranch(config, branch) {
  let selected = false;
  let remote;
  let merge;
  for (const line of config.split(/\r?\n/)) {
    const section = line.match(/^\s*\[branch\s+"((?:\\.|[^"\\])*)"\]\s*$/i);
    if (section) {
      selected = unquoteConfigValue(`"${section[1]}"`) === branch;
      continue;
    }
    if (/^\s*\[/.test(line)) {
      selected = false;
      continue;
    }
    if (!selected) continue;
    const property = line.match(/^\s*(remote|merge)\s*=\s*(.*?)\s*$/i);
    if (property?.[1].toLowerCase() === 'remote') remote = unquoteConfigValue(property[2]);
    if (property?.[1].toLowerCase() === 'merge') merge = unquoteConfigValue(property[2]);
  }
  if (!remote || remote === '.' || !merge?.startsWith('refs/heads/')) return undefined;
  const branchRef = merge.slice('refs/heads/'.length);
  const ref = `refs/remotes/${remote}/${branchRef}`;
  return safeRef(ref) ? { name: `${remote}/${branchRef}`, ref } : undefined;
}

async function inspectGit(root) {
  const gitDirectory = path.join(root, '.git');
  let stat;
  try { stat = await fs.stat(gitDirectory); } catch (error) {
    if (error.code === 'ENOENT') return { repository: false, checkpoint: 'not-configured' };
    throw error;
  }
  if (!stat.isDirectory()) {
    return { repository: true, checkpoint: 'unavailable', detail: 'linked Git metadata requires Git' };
  }

  let head;
  try { head = (await fs.readFile(path.join(gitDirectory, 'HEAD'), 'utf8')).trim(); } catch (error) {
    if (error.code === 'ENOENT') {
      return { repository: true, checkpoint: 'unavailable', detail: 'Git HEAD is missing' };
    }
    throw error;
  }
  const symbolic = head.match(/^ref:\s*(refs\/heads\/(.+))$/);
  if (!symbolic || !safeRef(symbolic[1])) {
    return { repository: true, branch: '(detached)', checkpoint: 'unavailable', detail: 'detached HEAD' };
  }
  const branch = symbolic[2];
  const localCommit = await readRef(gitDirectory, symbolic[1]);
  if (!localCommit) return { repository: true, branch, checkpoint: 'no-commits' };

  let config = '';
  try { config = await fs.readFile(path.join(gitDirectory, 'config'), 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const upstream = upstreamForBranch(config, branch);
  if (!upstream) return { repository: true, branch, checkpoint: 'no-upstream' };
  const upstreamCommit = await readRef(gitDirectory, upstream.ref);
  if (!upstreamCommit) return { repository: true, branch, upstream: upstream.name, checkpoint: 'not-fetched' };
  return {
    repository: true,
    branch,
    upstream: upstream.name,
    checkpoint: localCommit === upstreamCommit ? 'matches' : 'differs'
  };
}

function instant(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const milliseconds = Date.parse(String(value));
  return Number.isNaN(milliseconds) ? undefined : { value: new Date(milliseconds).toISOString(), milliseconds };
}

function bookmarkLabel(content) {
  return {
    id: readScalar(content, 'id'),
    title: readScalar(content, 'title') || '(untitled)'
  };
}

function incrementCount(counts, value) {
  if (value === undefined || value === null) return;
  const key = String(value).trim();
  if (key) counts.set(key, (counts.get(key) || 0) + 1);
}

function comparableUrl(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  try { return normalizeUrl(String(value)); } catch { return String(value).trim(); }
}

function duplicateValueCount(counts) {
  return [...counts.values()].filter((count) => count > 1).length;
}

function replaceExtreme(current, candidate, preferLater) {
  if (!candidate) return current;
  if (!current || (preferLater ? candidate.milliseconds > current.milliseconds : candidate.milliseconds < current.milliseconds)) {
    return candidate;
  }
  return current;
}

function printable(value, maximum = 100) {
  return oneLine(value, maximum);
}

function datedLabel(record) {
  if (!record) return 'none';
  const id = printable(record.id, 40);
  return `${record.value} — ${printable(record.title) || '(untitled)'}${id ? ` [${id.slice(0, 8)}]` : ''}`;
}

export async function inspectVaultStatus(root, { hostRoot } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, VAULT_SCHEMA_FILE), 'utf8'));
  const schemaVersion = Number(manifest.schema_version);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
    throw new Error(`Invalid vault schema version: ${manifest.schema_version}`);
  }
  const files = await listBookmarkFiles(root);
  const tags = new Set();
  const health = { missingId: 0, missingUrl: 0, invalidOrMissingSavedAt: 0, duplicateIds: 0, duplicateUrls: 0 };
  const idCounts = new Map();
  const urlCounts = new Map();
  let oldest;
  let newest;
  let latestActivity;

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    const label = bookmarkLabel(content);
    const url = readScalar(content, 'url');
    const saved = instant(readScalar(content, 'saved_at'));
    const first = instant(readScalar(content, 'first_saved_at')) || saved;
    const last = instant(readScalar(content, 'last_saved_at')) || saved;
    for (const tag of readList(content, 'tags')) {
      const normalized = String(tag).trim().toLowerCase();
      if (normalized) tags.add(normalized);
    }
    if (!label.id) health.missingId++;
    if (!url) health.missingUrl++;
    if (!first) health.invalidOrMissingSavedAt++;
    incrementCount(idCounts, label.id && String(label.id).toLowerCase());
    incrementCount(urlCounts, comparableUrl(readScalar(content, 'canonical_url') || url));
    const firstRecord = first && { ...first, ...label };
    const lastRecord = last && { ...last, ...label };
    oldest = replaceExtreme(oldest, firstRecord, false);
    newest = replaceExtreme(newest, firstRecord, true);
    latestActivity = replaceExtreme(latestActivity, lastRecord, true);
  }
  health.duplicateIds = duplicateValueCount(idCounts);
  health.duplicateUrls = duplicateValueCount(urlCounts);

  return {
    root,
    hostRoot,
    schemaVersion,
    supportedSchemaVersion: BOOKMARK_SCHEMA_VERSION,
    bookmarks: files.length,
    projects: await countMarkdownFiles(path.join(root, 'projects')),
    events: await countMarkdownFiles(path.join(root, 'events')),
    uniqueTags: tags.size,
    oldest,
    newest,
    latestActivity,
    health,
    agentsInstalled: await exists(path.join(root, 'AGENTS.md')),
    skillInstalled: await exists(path.join(root, '.codex', 'skills', 'markdown-bookmark-vault', 'SKILL.md')),
    git: await inspectGit(root)
  };
}

function schemaLabel(status) {
  if (status.schemaVersion === status.supportedSchemaVersion) return `${status.schemaVersion} (current)`;
  if (status.schemaVersion < status.supportedSchemaVersion) return `${status.schemaVersion} (upgrade available: ${status.supportedSchemaVersion})`;
  return `${status.schemaVersion} (newer than supported: ${status.supportedSchemaVersion})`;
}

function gitLines(git) {
  if (!git.repository) return ['Git: not initialized (optional; vault status is still available)'];
  const lines = [`Git branch: ${printable(git.branch || 'unknown')}`];
  if (git.checkpoint === 'matches') lines.push(`Git checkpoint: local HEAD matches last fetched ${printable(git.upstream)}`);
  else if (git.checkpoint === 'differs') lines.push(`Git checkpoint: local HEAD differs from last fetched ${printable(git.upstream)}`);
  else if (git.checkpoint === 'no-commits') lines.push('Git checkpoint: no local commits');
  else if (git.checkpoint === 'no-upstream') lines.push('Git checkpoint: no upstream configured');
  else if (git.checkpoint === 'not-fetched') lines.push(`Git checkpoint: ${printable(git.upstream)} has not been fetched locally`);
  else lines.push(`Git checkpoint: unavailable${git.detail ? ` (${printable(git.detail)})` : ''}`);
  lines.push('Git working tree: run git status to inspect changes');
  if (['matches', 'differs'].includes(git.checkpoint)) {
    lines.push('Git remote: offline checkpoint only; the remote may have changed since the last fetch');
  }
  return lines;
}

export function renderVaultStatus(status, {
  gitHelpCommand = 'npm run bookmark -- vault git-help'
} = {}) {
  const warningCount = Object.values(status.health).reduce((total, value) => total + value, 0);
  const health = warningCount
    ? `${warningCount} warning(s): missing ID ${status.health.missingId}, missing URL ${status.health.missingUrl}, invalid/missing saved date ${status.health.invalidOrMissingSavedAt}, duplicate ID values ${status.health.duplicateIds}, duplicate URL values ${status.health.duplicateUrls}`
    : 'passed (IDs, URLs, saved dates, duplicate IDs/URLs)';
  return [
    'Bookmark vault status',
    ...vaultPathLines(status.root, { hostRoot: status.hostRoot }),
    `Schema: ${schemaLabel(status)}`,
    `Bookmarks: ${status.bookmarks}`,
    `Projects: ${status.projects}`,
    `Events: ${status.events}`,
    `Unique tags: ${status.uniqueTags}`,
    `Oldest bookmark: ${datedLabel(status.oldest)}`,
    `Newest bookmark: ${datedLabel(status.newest)}`,
    `Latest save activity: ${datedLabel(status.latestActivity)}`,
    `Record checks: ${health}`,
    `Vault instructions: AGENTS.md ${status.agentsInstalled ? 'present' : 'missing'}; optional Codex skill ${status.skillInstalled ? 'installed' : 'not installed'}`,
    ...gitLines(status.git),
    `See vault Git help: ${gitHelpCommand}`
  ].join('\n');
}
