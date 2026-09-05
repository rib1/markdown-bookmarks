import path from 'node:path';

export function vaultRoot() {
  return process.env.BOOKMARK_VAULT || process.env.VAULT_PATH || path.resolve('vault');
}
