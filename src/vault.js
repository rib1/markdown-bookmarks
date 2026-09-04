import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function vaultRoot() {
  return process.env.BOOKMARK_VAULT || path.resolve('vault');
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'bookmark';
}

function yamlList(values) {
  return values.length ? values.map((v) => `  - ${JSON.stringify(v)}`).join('\n') : '  []';
}

export async function saveBookmark(input, root = vaultRoot()) {
  const now = input.saved_at || new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  const title = input.title || input.url;
  const tags = [...new Set((input.tags || []).map(String).map((v) => v.trim()).filter(Boolean))];
  const dir = path.join(root, 'bookmarks', now.slice(0, 7).replace('-', path.sep));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}-${slug(title)}.md`);
  const body = `---\nid: ${id}\nurl: ${JSON.stringify(input.url)}\ntitle: ${JSON.stringify(title)}\ntags:\n${yamlList(tags)}\nsaved_at: ${now}\nfirst_opened_at: ${input.first_opened_at || now}\nlast_opened_at: ${input.last_opened_at || now}\naccess_count: ${input.access_count || 1}\n---\n\n## Summary\n\n${input.summary || ''}\n`;
  await fs.writeFile(file, body, 'utf8');
  return { id, file, title, tags };
}

export async function findBookmarks(query, root = vaultRoot()) {
  const base = path.join(root, 'bookmarks');
  const results = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.name.endsWith('.md')) {
        const content = await fs.readFile(target, 'utf8');
        if (content.toLowerCase().includes(query.toLowerCase())) results.push({ file: target, content });
      }
    }
  }
  await walk(base);
  return results;
}
