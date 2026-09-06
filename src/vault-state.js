import fs from 'node:fs/promises';
import path from 'node:path';

const VAULT_SCHEMA_FILE = '.markdown-bookmarks.json';

export async function isVaultInitialized(root) {
  try {
    await fs.access(path.join(root, VAULT_SCHEMA_FILE));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
