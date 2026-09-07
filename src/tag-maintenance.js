import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { normalizeTags, readList, readScalar, replaceList } from './bookmark-format.js';
import { findLikelyTagTypos, levenshteinDistance, tagDistanceLimit } from './tag-lint.js';
import { listBookmarkFiles, relativeVaultPath } from './vault-bookmark-files.js';

export class TagMaintenanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TagMaintenanceError';
    this.code = code;
  }
}

function maintenanceError(code, message) {
  return new TagMaintenanceError(code, message);
}

async function readTagRecords(root) {
  const records = [];
  for (const absoluteFile of await listBookmarkFiles(root)) {
    const file = relativeVaultPath(root, absoluteFile);
    const content = await fs.readFile(absoluteFile, 'utf8');
    const id = readScalar(content, 'id');
    if (!id) throw maintenanceError('missing_id', `Bookmark is missing an ID: ${file}`);
    if (!/^tags:\r?\n/m.test(content)) {
      throw maintenanceError('invalid_tags', `Bookmark has no valid tags list: ${file}`);
    }
    records.push({ id: String(id), file, absoluteFile, content, tags: readList(content, 'tags') });
  }
  return records;
}

export async function lintVaultTags(root) {
  const records = await readTagRecords(root);
  const report = findLikelyTagTypos(records);
  return { bookmarkCount: records.length, ...report };
}

function normalizedTag(value, label) {
  const [tag] = normalizeTags([value]);
  if (!tag) throw maintenanceError('invalid_tag', `${label} must be a non-empty tag`);
  return tag;
}

export async function createTagFixPlan(root, { from, to }) {
  const source = normalizedTag(from, '--from');
  const canonical = normalizedTag(to, '--to');
  if (source === canonical) throw maintenanceError('same_tag', '--from and --to must be different tags');

  const records = await readTagRecords(root);
  const vocabulary = new Set(records.flatMap((record) => normalizeTags(record.tags)));
  if (!vocabulary.has(canonical)) {
    throw maintenanceError('target_not_found', `Canonical tag does not exist in the vault: ${canonical}`);
  }
  if (!vocabulary.has(source)) return { root, source, canonical, edits: [] };

  const distance = levenshteinDistance(source, canonical);
  if (distance > tagDistanceLimit(source, canonical)) {
    throw maintenanceError('not_lint_candidate', `Tags are not a lint candidate: ${source}, ${canonical}`);
  }

  const edits = records.filter((record) => normalizeTags(record.tags).includes(source)).map((record) => {
    const canonicalAlreadyPresent = normalizeTags(record.tags).includes(canonical);
    const tags = normalizeTags(record.tags.map((tag) => normalizeTags([tag])[0] === source ? canonical : tag));
    return {
      id: record.id,
      file: record.file,
      absoluteFile: record.absoluteFile,
      originalContent: record.content,
      content: replaceList(record.content, 'tags', tags),
      action: canonicalAlreadyPresent ? 'remove-duplicate' : 'replace'
    };
  });
  return { root, source, canonical, distance, edits };
}

async function unchanged(edit) {
  return await fs.readFile(edit.absoluteFile, 'utf8') === edit.originalContent;
}

export async function applyTagFixPlan(plan) {
  for (const edit of plan.edits) {
    if (!await unchanged(edit)) {
      throw maintenanceError('concurrent_change', `Bookmark changed after preview: ${edit.file}`);
    }
  }

  const staged = [];
  const changed = [];
  try {
    for (const edit of plan.edits) {
      const temporary = `${edit.absoluteFile}.tag-fix-${process.pid}-${crypto.randomUUID()}.tmp`;
      const { mode } = await fs.stat(edit.absoluteFile);
      await fs.writeFile(temporary, edit.content, { encoding: 'utf8', flag: 'wx', mode });
      staged.push({ edit, temporary });
    }
    for (const item of staged) {
      if (!await unchanged(item.edit)) {
        throw maintenanceError('concurrent_change', `Bookmark changed while applying fix: ${item.edit.file}`);
      }
      await fs.rename(item.temporary, item.edit.absoluteFile);
      changed.push(item.edit.file);
      item.temporary = undefined;
    }
    return { changed };
  } catch (error) {
    const pending = plan.edits.map((edit) => edit.file).filter((file) => !changed.includes(file));
    const detail = changed.length
      ? ` Changed: ${changed.join(', ')}. Not changed: ${pending.join(', ')}.`
      : '';
    if (error instanceof TagMaintenanceError) {
      error.message += detail;
      throw error;
    }
    throw maintenanceError('write_failed', `Could not apply tag fix: ${error.message}.${detail}`);
  } finally {
    await Promise.all(staged.filter((item) => item.temporary)
      .map((item) => fs.rm(item.temporary, { force: true })));
  }
}

export async function fixVaultTags(root, { from, to, apply = false }) {
  const plan = await createTagFixPlan(root, { from, to });
  if (!apply || !plan.edits.length) return { ...plan, applied: false, changed: [] };
  const result = await applyTagFixPlan(plan);
  return { ...plan, applied: true, changed: result.changed };
}
