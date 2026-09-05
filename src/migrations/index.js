import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readScalar, replaceScalar } from '../bookmark-format.js';
import { syncVaultAgentInstructions } from '../vault-agent-instructions.js';
import * as schemaVersion1 from './001-bookmark-schema-v1.js';
import * as schemaVersion2 from './002-normalize-tags-and-capture-labels.js';

export const BOOKMARK_SCHEMA_VERSION = 2;
export const VAULT_SCHEMA_FILE = '.markdown-bookmarks.json';

const BOOKMARK_MIGRATIONS = [schemaVersion1, schemaVersion2];
const VAULT_GITIGNORE_RULES = ['.DS_Store', '/views/.search-results/'];

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
  const existingRules = new Set(content.split(/\r?\n/));
  const missingRules = VAULT_GITIGNORE_RULES.filter((rule) => !existingRules.has(rule));
  if (!missingRules.length) return false;
  const separator = content && !content.endsWith('\n') ? '\n' : '';
  const updated = `${content}${separator}${missingRules.join('\n')}\n`;
  if (content) await writeAtomic(file, updated);
  else await fs.writeFile(file, updated, 'utf8');
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

async function bookmarkFiles(root) {
  const files = [];
  async function walk(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.name.endsWith('.md')) files.push(target);
    }
  }
  await walk(path.join(root, 'bookmarks'));
  return files;
}

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
  let normalizedTags = 0;
  let osLabelsAdded = 0;
  for (const migration of BOOKMARK_MIGRATIONS) {
    if (version >= migration.version) continue;
    const result = migration.migrate(content);
    content = replaceScalar(result.content, 'schema_version', migration.version);
    repairedTags += result.repairedTags ?? 0;
    ambiguousContextTags += result.ambiguousContextTags ?? 0;
    normalizedTags += result.normalizedTags ?? 0;
    osLabelsAdded += result.osLabelsAdded ?? 0;
    version = migration.version;
  }
  return {
    content, fromVersion: parsedVersion, toVersion: version,
    repairedTags, ambiguousContextTags, normalizedTags, osLabelsAdded
  };
}

export async function migrateVault(root) {
  await fs.mkdir(root, { recursive: true });
  const gitignoreUpdated = await ensureVaultGitignore(root);
  const fromSchemaVersion = await readVaultSchemaVersion(root);
  if (fromSchemaVersion > BOOKMARK_SCHEMA_VERSION) {
    throw new Error(`Vault schema version ${fromSchemaVersion} is newer than supported version ${BOOKMARK_SCHEMA_VERSION}`);
  }
  const result = {
    fromSchemaVersion,
    schemaVersion: BOOKMARK_SCHEMA_VERSION,
    migrationsRun: BOOKMARK_MIGRATIONS
      .filter((migration) => migration.version > fromSchemaVersion)
      .map((migration) => ({
        script: migration.script,
        fromVersion: migration.fromVersion,
        toVersion: migration.version
      })),
    scanned: 0,
    migrated: 0,
    repairedTags: 0,
    ambiguousContextTags: 0,
    normalizedTags: 0,
    osLabelsAdded: 0,
    agentInstructions: undefined,
    gitignoreUpdated,
    skipped: fromSchemaVersion === BOOKMARK_SCHEMA_VERSION
  };
  if (result.skipped) {
    result.agentInstructions = (await syncVaultAgentInstructions(root)).status;
    return result;
  }

  const files = await bookmarkFiles(root);
  result.scanned = files.length;
  for (const file of files) {
    let migration;
    try { migration = migrateBookmarkContent(await fs.readFile(file, 'utf8')); } catch (error) {
      throw new Error(`Failed to migrate ${file}: ${error.message}`, { cause: error });
    }
    result.repairedTags += migration.repairedTags;
    result.ambiguousContextTags += migration.ambiguousContextTags;
    result.normalizedTags += migration.normalizedTags;
    result.osLabelsAdded += migration.osLabelsAdded;
    if (migration.fromVersion === migration.toVersion) continue;
    await writeAtomic(file, migration.content);
    result.migrated++;
  }
  result.agentInstructions = (await syncVaultAgentInstructions(root)).status;
  await writeVaultSchemaVersion(root, BOOKMARK_SCHEMA_VERSION);
  return result;
}
