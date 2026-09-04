import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function vaultRoot() {
  return process.env.BOOKMARK_VAULT || process.env.VAULT_PATH || path.resolve('vault');
}

export async function initVault(root, { installSkill = true } = {}) {
  await Promise.all(['bookmarks', 'projects', 'events', 'assets', 'views'].map((name) =>
    fs.mkdir(path.join(root, name), { recursive: true })));
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
      '',
      'Markdown files are the source of truth. Search indexes and generated views can',
      'be recreated. Do not commit this vault to a public repository.',
      ''
    ].join('\n');
    await fs.writeFile(readme, vaultReadme, 'utf8');
  }
  if (installSkill) {
    const source = process.env.SKILL_SOURCE || path.resolve('skills', 'markdown-bookmark-vault', 'SKILL.md');
    const target = path.join(root, '.codex', 'skills', 'markdown-bookmark-vault', 'SKILL.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
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

export async function saveBookmark(input, root = vaultRoot()) {
  const now = input.saved_at || new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  const title = input.title || input.url;
  const tags = [...new Set((input.tags || []).map(String).map((v) => v.trim()).filter(Boolean))];
  const canonicalUrl = normalizeUrl(input.url);
  const existing = await findBookmarkByUrl(canonicalUrl, root);
  if (existing) {
    const oldTags = [...existing.content.matchAll(/^  - ["']?([^"'\r\n]+)["']?$/gm)].map((match) => match[1]);
    const mergedTags = [...new Set([...oldTags, ...tags])];
    let content = existing.content;
    content = content.replace(/^tags:\n(?:  - .*\n|  \[\]\n)*/m, `tags:\n${yamlList(mergedTags)}\n`);
    content = replaceScalar(content, 'last_opened_at', now);
    content = replaceScalar(content, 'access_count', Number(content.match(/^access_count:\s*(\d+)/m)?.[1] || 0) + 1);
    await fs.writeFile(existing.file, content, 'utf8');
    return { id: existing.content.match(/^id:\s*(.+)$/m)?.[1], file: existing.file, title, tags: mergedTags, duplicate: true };
  }
  const dir = path.join(root, 'bookmarks', now.slice(0, 7).replace('-', path.sep));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}-${slug(title)}.md`);
  const body = `---\nid: ${id}\nurl: ${JSON.stringify(input.url)}\ncanonical_url: ${JSON.stringify(canonicalUrl)}\ntitle: ${JSON.stringify(title)}\ntags:\n${yamlList(tags)}\nsaved_at: ${now}\nfirst_opened_at: ${input.first_opened_at || now}\nlast_opened_at: ${input.last_opened_at || now}\naccess_count: ${input.access_count || 1}\n---\n\n## Summary\n\n${input.summary || ''}\n`;
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
