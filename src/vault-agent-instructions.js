import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VAULT_AGENTS_FILE = 'AGENTS.md';

const defaultSource = fileURLToPath(new URL('../templates/vault/AGENTS.md', import.meta.url));

export async function syncVaultAgentInstructions(root, source = process.env.VAULT_AGENTS_SOURCE || defaultSource) {
  const target = path.join(root, VAULT_AGENTS_FILE);
  const desired = await fs.readFile(source, 'utf8');
  let existing;
  try { existing = await fs.readFile(target, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing === desired) return { target, status: 'current' };
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(target, desired, 'utf8');
  return { target, status: existing === undefined ? 'installed' : 'updated' };
}
