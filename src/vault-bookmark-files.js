import fs from 'node:fs/promises';
import path from 'node:path';

export async function listBookmarkFiles(root) {
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(target);
    }
  }
  await walk(path.join(root, 'bookmarks'));
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

export function relativeVaultPath(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}
