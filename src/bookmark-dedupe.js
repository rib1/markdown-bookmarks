import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  normalizeLineEndings,
  normalizeTags,
  normalizeUrl,
  readList,
  readScalar,
  replaceList,
  replaceScalar
} from './bookmark-format.js';
import { BOOKMARK_SCHEMA_VERSION, migrateBookmarkContent } from './migrations/index.js';
import { applySitePlugins } from './site-plugins/index.js';
import { appendShareEvent } from './share-history.js';
import { appendCaptureEvent } from './capture-history.js';
import { formatProjectContent, validateProjectContent } from './project-format.js';
import { listBookmarkFiles, relativeVaultPath } from './vault-bookmark-files.js';

const SCALAR_BACKFILL_FIELDS = [
  'site', 'repository', 'author', 'video_id', 'imgur_id',
  'space_key', 'page_id', 'issue_key', 'project_key', 'status', 'priority'
];
const CLASSIFICATION_LIST_FIELDS = ['areas', 'projects', 'events'];
const RELATIONSHIP_LIST_FIELDS = ['related', 'references', 'supports', 'alternative', 'follow-up', 'duplicate'];
const KNOWN_BOOKMARK_FIELDS = new Set([
  'schema_version', 'id', 'url', 'canonical_url', 'title', 'type',
  'contexts', 'tags', ...CLASSIFICATION_LIST_FIELDS, ...RELATIONSHIP_LIST_FIELDS,
  ...SCALAR_BACKFILL_FIELDS,
  'published_at', 'published_at_source', 'published_at_confidence',
  'share_history', 'capture_history',
  'saved_at', 'first_saved_at', 'last_saved_at', 'save_count', 'save_history'
]);

export class BookmarkDedupeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BookmarkDedupeError';
    this.code = code;
  }
}

function dedupeError(code, message) {
  return new BookmarkDedupeError(code, message);
}

function parseBookmarkParts(content, file) {
  const normalized = normalizeLineEndings(content);
  const match = normalized.match(/^---\n([\s\S]*?)^---(?:\n|$)/m);
  if (!match || match.index !== 0) {
    throw dedupeError('invalid_frontmatter', `Invalid bookmark frontmatter in ${file}: opening and closing --- delimiters are required`);
  }
  const metadata = match[1];
  const headers = [...metadata.matchAll(/^([A-Za-z_][\w-]*):[^\n]*(?:\n|$)/gm)];
  const fields = new Map();
  for (let index = 0; index < headers.length; index++) {
    const field = headers[index][1];
    if (fields.has(field)) {
      throw dedupeError('invalid_frontmatter', `Invalid bookmark frontmatter in ${file}: duplicate field: ${field}`);
    }
    const end = headers[index + 1]?.index ?? metadata.length;
    fields.set(field, metadata.slice(headers[index].index, end));
  }
  return {
    frontmatter: `---\n${metadata}---\n`,
    fields,
    body: normalized.slice(match[0].length)
  };
}

function resolveCanonicalUrl(url, existingCanonical, file) {
  let normalizedUrl;
  try {
    normalizedUrl = normalizeUrl(url);
  } catch {
    throw dedupeError('invalid_url', `Bookmark has an invalid URL in ${file}: ${url}`);
  }
  let normalizedExisting;
  if (existingCanonical !== undefined && String(existingCanonical).trim() !== '') {
    try {
      normalizedExisting = normalizeUrl(String(existingCanonical));
    } catch {
      throw dedupeError('invalid_url', `Bookmark has an invalid canonical_url in ${file}: ${existingCanonical}`);
    }
  }
  const pluginResult = applySitePlugins({
    url: normalizedUrl,
    ...(normalizedExisting ? { canonical_url: normalizedExisting } : {})
  });
  return normalizeUrl(pluginResult.canonical_url || normalizedExisting || normalizedUrl);
}

function parseValidatedTimestamp(value, field, file) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const text = String(value).trim();
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) {
    throw dedupeError('invalid_saved_at', `Bookmark has an invalid ${field} date in ${file}: ${text}`);
  }
  return { text, ms };
}

function earliestSaveMs(frontmatter, file) {
  const savedAt = parseValidatedTimestamp(readScalar(frontmatter, 'saved_at'), 'saved_at', file);
  if (!savedAt) {
    throw dedupeError('invalid_saved_at', `Bookmark is missing a valid saved_at date: ${file}`);
  }
  const firstSavedAt = parseValidatedTimestamp(readScalar(frontmatter, 'first_saved_at'), 'first_saved_at', file);
  parseValidatedTimestamp(readScalar(frontmatter, 'last_saved_at'), 'last_saved_at', file);
  const candidates = [savedAt.ms];
  if (firstSavedAt) candidates.push(firstSavedAt.ms);
  for (const entry of readList(frontmatter, 'save_history')) {
    const parsed = parseValidatedTimestamp(entry, 'save_history', file);
    if (parsed) candidates.push(parsed.ms);
  }
  return Math.min(...candidates);
}

async function readBookmarkRecords(root) {
  const records = [];
  const byId = new Map();
  for (const absoluteFile of await listBookmarkFiles(root)) {
    const file = relativeVaultPath(root, absoluteFile);
    const content = await fs.readFile(absoluteFile, 'utf8');
    const parts = parseBookmarkParts(content, file);
    const rawId = readScalar(parts.frontmatter, 'id');
    if (rawId === undefined || String(rawId).trim() === '') {
      throw dedupeError('missing_id', `Bookmark is missing an ID: ${file}`);
    }
    const id = String(rawId).trim();
    const rawUrl = readScalar(parts.frontmatter, 'url');
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
      throw dedupeError('invalid_url', `Bookmark is missing a URL: ${file}`);
    }
    const url = rawUrl.trim();
    const earliestMs = earliestSaveMs(parts.frontmatter, file);
    let migratedFrontmatter;
    try {
      migratedFrontmatter = migrateBookmarkContent(parts.frontmatter).content;
    } catch (error) {
      throw dedupeError('invalid_frontmatter', `Invalid bookmark metadata in ${file}: ${error.message}`);
    }
    const canonicalUrl = resolveCanonicalUrl(url, readScalar(migratedFrontmatter, 'canonical_url'), file);
    const existingIdRecord = byId.get(id);
    if (existingIdRecord && existingIdRecord.canonicalUrl !== canonicalUrl) {
      throw dedupeError('duplicate_id', `Multiple bookmarks with different URLs share ID ${id}: ${existingIdRecord.file}, ${file}`);
    }
    const record = {
      id,
      file,
      absoluteFile,
      url,
      canonicalUrl,
      title: readScalar(migratedFrontmatter, 'title'),
      savedAt: String(readScalar(migratedFrontmatter, 'saved_at')),
      earliestMs,
      originalContent: content,
      frontmatter: migratedFrontmatter,
      fields: parseBookmarkParts(migratedFrontmatter, file).fields,
      body: parts.body
    };
    if (!existingIdRecord) byId.set(id, record);
    records.push(record);
  }
  return records;
}

function uniqueStrings(values) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
}

function extractBodyNotes(body) {
  const normalized = normalizeLineEndings(body);
  const summaryMatch = normalized.match(/^\s*## Summary[ \t]*(?:\n|$)/);
  return summaryMatch ? normalized.slice(summaryMatch[0].length).trim() : normalized.trim();
}

function mergeBodies(group) {
  const keep = group[0];
  const keepNotes = extractBodyNotes(keep.body);
  const extraSections = [];
  for (const duplicate of group.slice(1)) {
    const duplicateNotes = extractBodyNotes(duplicate.body);
    if (!duplicateNotes) continue;
    if (duplicateNotes === keepNotes || keepNotes.includes(duplicateNotes)) continue;
    if (extraSections.some((section) => section === duplicateNotes || section.includes(duplicateNotes))) continue;
    if (keepNotes && duplicateNotes.startsWith(keepNotes)) {
      const remainder = duplicateNotes.slice(keepNotes.length).trim();
      if (remainder && !extraSections.includes(remainder)) extraSections.push(remainder);
      continue;
    }
    extraSections.push(duplicateNotes);
  }
  if (!extraSections.length) {
    return { body: normalizeLineEndings(keep.body), notesMerged: false };
  }
  if (!keepNotes) {
    return { body: `\n## Summary\n\n${extraSections.join('\n\n')}\n`, notesMerged: true };
  }
  return {
    body: `${normalizeLineEndings(keep.body).trimEnd()}\n\n${extraSections.join('\n\n')}\n`,
    notesMerged: true
  };
}

function mergeSaveHistory(group) {
  const allTimestamps = [];
  let extraCount = 0;
  let maxDeclaredCount = 1;
  for (const record of group) {
    const history = readList(record.frontmatter, 'save_history').map(String).filter(Boolean);
    const candidates = uniqueStrings([
      readScalar(record.frontmatter, 'first_saved_at') || '',
      readScalar(record.frontmatter, 'saved_at') || '',
      ...history,
      readScalar(record.frontmatter, 'last_saved_at') || ''
    ]);
    for (const timestamp of candidates) {
      if (!allTimestamps.includes(timestamp)) allTimestamps.push(timestamp);
    }
    const declaredCount = Number(readScalar(record.frontmatter, 'save_count')) || candidates.length || 1;
    if (declaredCount > maxDeclaredCount) maxDeclaredCount = declaredCount;
    extraCount += Math.max(0, declaredCount - candidates.length);
  }
  allTimestamps.sort((left, right) => Date.parse(left) - Date.parse(right) || left.localeCompare(right, 'en'));
  return {
    firstSavedAt: allTimestamps[0],
    lastSavedAt: allTimestamps[allTimestamps.length - 1],
    saveHistory: allTimestamps,
    saveCount: Math.max(allTimestamps.length + extraCount, maxDeclaredCount, 1)
  };
}

function mergeEventHistory(group, field, appendEvent, errorCode) {
  let merged = [];
  for (const record of group) {
    for (const entry of readList(record.frontmatter, field)) {
      if (entry && typeof entry === 'object' && entry.id) {
        try {
          merged = appendEvent(merged, entry).history;
        } catch (error) {
          throw dedupeError(errorCode, `Cannot merge ${field} in ${record.file}: ${error.message}`);
        }
      } else if (entry !== undefined && entry !== null) {
        const serialized = JSON.stringify(entry);
        if (!merged.some((existing) => JSON.stringify(existing) === serialized)) merged.push(entry);
      }
    }
  }
  return merged;
}

function remapRelationshipValues(values, removedIdMap, selfId) {
  return uniqueStrings(values.map((value) => {
    const key = String(value).trim();
    return removedIdMap.get(key) || key;
  })).filter((id) => id !== selfId);
}

function mergeUnknownFields(frontmatter, group) {
  const keep = group[0];
  const mergedFields = new Map(keep.fields);
  for (const duplicate of group.slice(1)) {
    for (const [field, block] of duplicate.fields.entries()) {
      if (KNOWN_BOOKMARK_FIELDS.has(field)) continue;
      if (!mergedFields.has(field)) {
        frontmatter = frontmatter.replace(/\n---\n$/, `\n${block.endsWith('\n') ? block : `${block}\n`}---\n`);
        mergedFields.set(field, block);
        continue;
      }
      if (mergedFields.get(field).trim() === block.trim()) continue;
      const keepList = readList(frontmatter, field);
      const duplicateList = readList(duplicate.frontmatter, field);
      if (keepList.length || duplicateList.length) {
        const combined = [...keepList];
        for (const item of duplicateList) {
          if (!combined.some((existing) => JSON.stringify(existing) === JSON.stringify(item))) combined.push(item);
        }
        frontmatter = replaceList(frontmatter, field, combined);
        mergedFields.set(field, parseBookmarkParts(frontmatter, keep.file).fields.get(field));
        continue;
      }
      throw dedupeError('conflicting_metadata', `Conflicting metadata field "${field}" between ${keep.file} and ${duplicate.file}`);
    }
  }
  return frontmatter;
}

function mergeDuplicateGroup(group, canonicalUrl, removedIdMap, linkedProjectsByBookmarkId) {
  const keep = group[0];
  let frontmatter = keep.frontmatter;
  const pluginData = applySitePlugins({ url: keep.url, canonical_url: canonicalUrl });

  const keepTitle = readScalar(frontmatter, 'title');
  const titleFromDuplicate = group.slice(1)
    .map((record) => readScalar(record.frontmatter, 'title'))
    .find((title, index) => title && title !== group[index + 1].url && title !== canonicalUrl);
  const mergedTitle = (!keepTitle || keepTitle === keep.url || keepTitle === canonicalUrl) && titleFromDuplicate
    ? titleFromDuplicate
    : (keepTitle || keep.url);
  frontmatter = replaceScalar(frontmatter, 'title', mergedTitle);
  frontmatter = replaceScalar(frontmatter, 'canonical_url', canonicalUrl);

  const keepType = readScalar(frontmatter, 'type');
  const duplicateType = group.slice(1)
    .map((record) => readScalar(record.frontmatter, 'type'))
    .find((type) => type && type !== 'bookmark');
  const mergedType = (keepType && keepType !== 'bookmark')
    ? keepType
    : (duplicateType || (pluginData.type && pluginData.type !== 'bookmark' ? pluginData.type : (keepType || 'bookmark')));
  frontmatter = replaceScalar(frontmatter, 'type', mergedType);

  const combinedContexts = uniqueStrings(group.flatMap((record) => readList(record.frontmatter, 'contexts')));
  const mergedContexts = combinedContexts.length
    ? combinedContexts
    : uniqueStrings(pluginData.contexts || []);
  frontmatter = replaceList(frontmatter, 'contexts', mergedContexts);

  const mergedTags = normalizeTags([
    ...group.flatMap((record) => readList(record.frontmatter, 'tags')),
    ...(pluginData.tags || [])
  ]);
  frontmatter = replaceList(frontmatter, 'tags', mergedTags);

  for (const field of SCALAR_BACKFILL_FIELDS) {
    const existing = readScalar(frontmatter, field);
    if (existing !== undefined && String(existing).trim() !== '') continue;
    const fromDuplicate = group.slice(1)
      .map((record) => readScalar(record.frontmatter, field))
      .find((value) => value !== undefined && String(value).trim() !== '');
    const candidate = fromDuplicate ?? pluginData[field];
    if (candidate !== undefined && String(candidate).trim() !== '') {
      frontmatter = replaceScalar(frontmatter, field, candidate);
    }
  }

  const publishedRecord = group.find((record) => {
    const value = readScalar(record.frontmatter, 'published_at');
    return value !== undefined && String(value).trim() !== '';
  });
  if (publishedRecord) {
    const publishedAt = readScalar(publishedRecord.frontmatter, 'published_at');
    frontmatter = replaceScalar(frontmatter, 'published_at', publishedAt);
    for (const field of ['published_at_source', 'published_at_confidence']) {
      const value = readScalar(frontmatter, field)
        || group.find((record) => readScalar(record.frontmatter, 'published_at') === publishedAt && readScalar(record.frontmatter, field))
          && readScalar(
            group.find((record) => readScalar(record.frontmatter, 'published_at') === publishedAt && readScalar(record.frontmatter, field)).frontmatter,
            field
          );
      if (value !== undefined && String(value).trim() !== '') {
        frontmatter = replaceScalar(frontmatter, field, value);
      }
    }
  }

  for (const field of CLASSIFICATION_LIST_FIELDS) {
    const extraProjects = field === 'projects' ? (linkedProjectsByBookmarkId.get(keep.id) || []) : [];
    const values = uniqueStrings([
      ...group.flatMap((record) => readList(record.frontmatter, field)),
      ...extraProjects
    ]);
    if (values.length || keep.fields.has(field)) {
      frontmatter = replaceList(frontmatter, field, values);
    }
  }

  for (const field of RELATIONSHIP_LIST_FIELDS) {
    const values = remapRelationshipValues(
      group.flatMap((record) => readList(record.frontmatter, field)),
      removedIdMap,
      keep.id
    );
    if (values.length || keep.fields.has(field)) {
      frontmatter = replaceList(frontmatter, field, values);
    }
  }

  const shares = mergeEventHistory(group, 'share_history', appendShareEvent, 'conflicting_share_event');
  if (shares.length || keep.fields.has('share_history')) {
    frontmatter = replaceList(frontmatter, 'share_history', shares);
  }
  const captures = mergeEventHistory(group, 'capture_history', appendCaptureEvent, 'conflicting_capture_event');
  if (captures.length || keep.fields.has('capture_history')) {
    frontmatter = replaceList(frontmatter, 'capture_history', captures);
  }

  const saveStats = mergeSaveHistory(group);
  frontmatter = replaceScalar(frontmatter, 'saved_at', keep.savedAt || saveStats.firstSavedAt);
  frontmatter = replaceScalar(frontmatter, 'first_saved_at', saveStats.firstSavedAt);
  frontmatter = replaceScalar(frontmatter, 'last_saved_at', saveStats.lastSavedAt);
  frontmatter = replaceScalar(frontmatter, 'save_count', saveStats.saveCount);
  frontmatter = replaceList(frontmatter, 'save_history', saveStats.saveHistory);
  frontmatter = mergeUnknownFields(frontmatter, group);
  frontmatter = replaceScalar(frontmatter, 'schema_version', BOOKMARK_SCHEMA_VERSION);

  const { body, notesMerged } = mergeBodies(group);
  return {
    content: `${frontmatter}${body}`,
    mergedTags,
    mergedContexts,
    saveCount: saveStats.saveCount,
    notesMerged
  };
}

async function listProjectFiles(root) {
  const directory = path.join(root, 'projects');
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right, 'en'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function normalizeProjectBookmarkEntry(rawEntry) {
  if (typeof rawEntry === 'string') return { id: rawEntry, notes: [] };
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return rawEntry;
  const { note, notes: storedNotes, ...rest } = rawEntry;
  const notes = Array.isArray(storedNotes)
    ? storedNotes.map(String).map((item) => item.trim()).filter(Boolean)
    : typeof note === 'string' && note.trim() ? [note.trim()] : [];
  return { ...rest, notes };
}

async function planProjectEdits(root, removedIdMap) {
  const projectEdits = [];
  const linkedProjectsByBookmarkId = new Map();
  if (!removedIdMap.size) return { projectEdits, linkedProjectsByBookmarkId };

  for (const absoluteFile of await listProjectFiles(root)) {
    const file = relativeVaultPath(root, absoluteFile);
    const content = await fs.readFile(absoluteFile, 'utf8');
    const rawEntries = readList(content, 'bookmarks').map(normalizeProjectBookmarkEntry)
      .filter((entry) => entry && typeof entry.id === 'string');
    if (!rawEntries.some((entry) => removedIdMap.has(entry.id))) continue;

    try {
      validateProjectContent(content, file);
    } catch (error) {
      throw dedupeError('invalid_project', error.message);
    }
    const projectId = readScalar(content, 'id');
    const rewritten = [];
    const indexById = new Map();
    for (const entry of rawEntries) {
      const targetId = removedIdMap.get(entry.id) || entry.id;
      if (projectId && removedIdMap.has(entry.id)) {
        const list = linkedProjectsByBookmarkId.get(targetId) || [];
        if (!list.includes(projectId)) list.push(projectId);
        linkedProjectsByBookmarkId.set(targetId, list);
      }
      if (indexById.has(targetId)) {
        const existingIndex = indexById.get(targetId);
        const existing = rewritten[existingIndex];
        const mergedNotes = uniqueStrings([...existing.notes, ...entry.notes]);
        rewritten[existingIndex] = { ...entry, ...existing, id: targetId, notes: mergedNotes };
      } else {
        indexById.set(targetId, rewritten.length);
        rewritten.push({ ...entry, id: targetId });
      }
    }
    const updatedContent = formatProjectContent(content, { bookmarks: rewritten, file });
    if (updatedContent !== content) {
      projectEdits.push({
        id: projectId ? String(projectId) : file,
        file,
        absoluteFile,
        originalContent: content,
        content: updatedContent
      });
    }
  }
  return { projectEdits, linkedProjectsByBookmarkId };
}

function planExternalBookmarkRelationshipEdits(singleRecords, removedIdMap, linkedProjectsByBookmarkId) {
  const edits = [];
  if (!removedIdMap.size && !linkedProjectsByBookmarkId.size) return edits;
  for (const record of singleRecords) {
    let frontmatter = record.frontmatter;
    let changed = false;
    const extraProjects = linkedProjectsByBookmarkId.get(record.id) || [];
    if (extraProjects.length) {
      const existingProjects = readList(frontmatter, 'projects');
      const mergedProjects = uniqueStrings([...existingProjects, ...extraProjects]);
      if (JSON.stringify(mergedProjects) !== JSON.stringify(existingProjects)) {
        frontmatter = replaceList(frontmatter, 'projects', mergedProjects);
        changed = true;
      }
    }
    for (const field of RELATIONSHIP_LIST_FIELDS) {
      if (!record.fields.has(field)) continue;
      const existing = readList(frontmatter, field);
      if (!existing.some((id) => removedIdMap.has(String(id).trim()))) continue;
      const remapped = remapRelationshipValues(existing, removedIdMap, record.id);
      frontmatter = replaceList(frontmatter, field, remapped);
      changed = true;
    }
    if (changed) {
      edits.push({
        id: record.id,
        file: record.file,
        absoluteFile: record.absoluteFile,
        originalContent: record.originalContent,
        content: `${frontmatter}${normalizeLineEndings(record.body)}`
      });
    }
  }
  return edits;
}

export async function createDedupePlan(root) {
  const records = await readBookmarkRecords(root);
  const byCanonicalUrl = new Map();
  for (const record of records) {
    const list = byCanonicalUrl.get(record.canonicalUrl) || [];
    list.push(record);
    byCanonicalUrl.set(record.canonicalUrl, list);
  }

  const duplicateEntries = [...byCanonicalUrl.entries()]
    .filter(([, group]) => group.length > 1)
    .sort(([leftUrl], [rightUrl]) => leftUrl.localeCompare(rightUrl, 'en'));

  if (!duplicateEntries.length) {
    return {
      root,
      bookmarkCount: records.length,
      groups: [],
      bookmarkEdits: [],
      projectEdits: [],
      removals: []
    };
  }

  const removedIdMap = new Map();
  const sortedGroups = duplicateEntries.map(([canonicalUrl, group]) => {
    const ordered = [...group].sort((left, right) =>
      left.earliestMs - right.earliestMs
      || left.file.localeCompare(right.file, 'en')
      || left.id.localeCompare(right.id, 'en'));
    const keep = ordered[0];
    for (const duplicate of ordered.slice(1)) {
      if (duplicate.id !== keep.id) removedIdMap.set(duplicate.id, keep.id);
    }
    return { canonicalUrl, ordered };
  });

  const { projectEdits, linkedProjectsByBookmarkId } = await planProjectEdits(root, removedIdMap);

  const groups = [];
  const bookmarkEdits = [];
  const removals = [];
  for (const { canonicalUrl, ordered } of sortedGroups) {
    const keep = ordered[0];
    const remove = ordered.slice(1);
    const merged = mergeDuplicateGroup(ordered, canonicalUrl, removedIdMap, linkedProjectsByBookmarkId);
    const keepSummary = {
      id: keep.id,
      file: keep.file,
      absoluteFile: keep.absoluteFile,
      url: keep.url,
      title: readScalar(merged.content, 'title') || keep.title || keep.url,
      savedAt: keep.savedAt
    };
    const removeSummaries = remove.map((record) => ({
      id: record.id,
      file: record.file,
      absoluteFile: record.absoluteFile,
      url: record.url,
      title: record.title || record.url,
      savedAt: record.savedAt,
      originalContent: record.originalContent
    }));
    groups.push({
      canonicalUrl,
      keep: keepSummary,
      remove: removeSummaries,
      mergedTags: merged.mergedTags,
      mergedContexts: merged.mergedContexts,
      saveCount: merged.saveCount,
      notesMerged: merged.notesMerged
    });
    bookmarkEdits.push({
      id: keep.id,
      file: keep.file,
      absoluteFile: keep.absoluteFile,
      originalContent: keep.originalContent,
      content: merged.content
    });
    removals.push(...removeSummaries);
  }

  const singleRecords = [...byCanonicalUrl.values()]
    .filter((group) => group.length === 1)
    .map((group) => group[0]);
  bookmarkEdits.push(...planExternalBookmarkRelationshipEdits(singleRecords, removedIdMap, linkedProjectsByBookmarkId));

  return {
    root,
    bookmarkCount: records.length,
    groups,
    bookmarkEdits,
    projectEdits,
    removals
  };
}

async function unchanged(record) {
  try {
    return await fs.readFile(record.absoluteFile, 'utf8') === record.originalContent;
  } catch {
    return false;
  }
}

export async function applyDedupePlan(plan) {
  const allUpdates = [...plan.bookmarkEdits, ...plan.projectEdits];
  for (const item of [...allUpdates, ...plan.removals]) {
    if (!await unchanged(item)) {
      throw dedupeError('concurrent_change', `Vault file changed after preview: ${item.file}`);
    }
  }

  const staged = [];
  const changed = [];
  const removed = [];
  try {
    for (const edit of allUpdates) {
      const temporary = `${edit.absoluteFile}.dedupe-${process.pid}-${crypto.randomUUID()}.tmp`;
      const { mode } = await fs.stat(edit.absoluteFile);
      await fs.writeFile(temporary, edit.content, { encoding: 'utf8', flag: 'wx', mode });
      staged.push({ edit, temporary });
    }
    for (const item of [...allUpdates, ...plan.removals]) {
      if (!await unchanged(item)) {
        throw dedupeError('concurrent_change', `Vault file changed while applying dedupe: ${item.file}`);
      }
    }
    for (const item of staged) {
      await fs.rename(item.temporary, item.edit.absoluteFile);
      changed.push(item.edit.file);
      item.temporary = undefined;
    }
    for (const removal of plan.removals) {
      await fs.unlink(removal.absoluteFile);
      removed.push(removal.file);
    }
    return { changed, removed };
  } catch (error) {
    const pendingUpdates = allUpdates.map((edit) => edit.file).filter((file) => !changed.includes(file));
    const pendingRemovals = plan.removals.map((item) => item.file).filter((file) => !removed.includes(file));
    const detail = (changed.length || removed.length)
      ? ` Changed: ${changed.join(', ') || 'none'}. Removed: ${removed.join(', ') || 'none'}. Pending: ${[...pendingUpdates, ...pendingRemovals].join(', ') || 'none'}.`
      : '';
    if (error instanceof BookmarkDedupeError) {
      error.message += detail;
      throw error;
    }
    throw dedupeError('write_failed', `Could not apply bookmark deduplication: ${error.message}.${detail}`);
  } finally {
    await Promise.all(staged.filter((item) => item.temporary)
      .map((item) => fs.rm(item.temporary, { force: true })));
  }
}

export async function dedupeVaultBookmarks(root, { apply = false } = {}) {
  const plan = await createDedupePlan(root);
  if (!apply || !plan.groups.length) return { ...plan, applied: false, changed: [], removed: [] };
  const result = await applyDedupePlan(plan);
  return { ...plan, applied: true, changed: result.changed, removed: result.removed };
}
