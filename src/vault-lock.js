import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export const VAULT_LOCK_FILE = '.markdown-bookmarks.lock';

const heldLocks = new AsyncLocalStorage();

export class VaultLockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultLockError';
    this.code = 'vault_locked';
  }
}

export async function withVaultLock(root, callback, {
  timeoutMs = 5000,
  retryMs = 15,
  staleMs = 60000
} = {}) {
  const resolvedRoot = path.resolve(root);
  const activeSet = heldLocks.getStore();
  if (activeSet?.has(resolvedRoot)) {
    return callback();
  }

  const lockFile = path.join(resolvedRoot, VAULT_LOCK_FILE);
  const token = `${process.pid}-${crypto.randomUUID()}`;
  const payload = `${JSON.stringify({ pid: process.pid, token, acquiredAt: Date.now() })}\n`;
  const deadline = Date.now() + timeoutMs;

  let acquired = false;
  while (!acquired) {
    try {
      await fs.writeFile(lockFile, payload, { encoding: 'utf8', flag: 'wx' });
      acquired = true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(resolvedRoot, { recursive: true });
        continue;
      }
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = await fs.stat(lockFile);
        if (Date.now() - stat.mtimeMs > staleMs) {
          await fs.rm(lockFile, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError.code === 'ENOENT') continue;
      }
      if (Date.now() >= deadline) {
        throw new VaultLockError(`Vault is locked by another operation: ${lockFile}`);
      }
      await delay(retryMs);
    }
  }

  const nextSet = new Set(activeSet);
  nextSet.add(resolvedRoot);
  try {
    return await heldLocks.run(nextSet, callback);
  } finally {
    try {
      const current = await fs.readFile(lockFile, 'utf8');
      if (JSON.parse(current).token === token) {
        await fs.rm(lockFile, { force: true });
      }
    } catch {
      // Lock file already removed or unreadable during cleanup.
    }
  }
}
