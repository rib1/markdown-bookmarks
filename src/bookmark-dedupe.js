import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  normalizeLineEndings,
  normalizeTags,
  normalizeUrl,
  readList,
  readScalar,
  removeScalar,
  replaceList,
  replaceScalar
} from './bookmark-format.js';
import { BOOKMARK_SCHEMA_VERSION, migrateBookmarkContent } from './migrations/index.js';
import { applySitePlugins } from './site-plugins/index.js';
import { appendShareEvent } from './share-history.js';
import { appendCaptureEvent } from './capture-history.js';
import { formatProjectContent, validateProjectContent } from './project-format.js';
import { listBookmarkFiles, relativeVaultPath } from './vault-bookmark-files.js';
import { withVaultLock } from './vault-lock.js';

const nativeFs = {
  readFile: fs.readFile.bind(fs),
  writeFile: fs.writeFile.bind(fs),
  rename: fs.rename.bind(fs),
  unlink: fs.unlink.bind(fs),
  rm: fs.rm.bind(fs),
  stat: fs.stat.bind(fs),
  readdir: fs.readdir.bind(fs)
};

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

function validateFrontmatterSyntax(metadata, file) {
  const lines = metadata.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    if (!line.trim() || /^[ \t]*#/.test(line)) continue;
    const headerMatch = line.match(/^([A-Za-z_][\w-]*):[ \t]*(.*)$/);
    if (headerMatch) {
      const [, field, rawValue] = headerMatch;
      const trimmed = rawValue.trim();
      if (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          JSON.parse(trimmed);
        } catch {
          throw dedupeError('invalid_frontmatter', `Invalid bookmark frontmatter value for "${field}" in ${file}`);
        }
      }
      continue;
    }
    const listMatch = line.match(/^ {2}- (.*)$/);
    if (listMatch) {
      const trimmed = listMatch[1].trim();
      if (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          JSON.parse(trimmed);
        } catch {
          throw dedupeError('invalid_frontmatter', `Invalid bookmark frontmatter list item in ${file}`);
        }
      }
      continue;
    }
    if (/^ {2,}\[\][ \t]*$/.test(line)) continue;
    const nestedKeyMatch = line.match(/^ {2,}([A-Za-z_][\w-]*):[ \t]*(.*)$/);
    if (nestedKeyMatch) {
      const [, nestedField, rawValue] = nestedKeyMatch;
      const trimmed = rawValue.trim();
      if (trimmed.startsWith('"') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          JSON.parse(trimmed);
        } catch {
          throw dedupeError('invalid_frontmatter', `Invalid nested frontmatter value for "${nestedField}" in ${file}`);
        }
      }
      continue;
    }
    throw dedupeError('invalid_frontmatter', `Invalid bookmark frontmatter line in ${file}: ${line}`);
  }
}

function parseBookmarkParts(content, file) {
  const normalized = normalizeLineEndings(content);
  const match = normalized.match(/^---\n([\s\S]*?)^---(?:\n|$)/m);
  if (!match || match.index !== 0) {
    throw dedupeError('invalid_frontmatter', `Invalid bookmark frontmatter in ${file}: opening and closing --- delimiters are required`);
  }
  const metadata = match[1];
  validateFrontmatterSyntax(metadata, file);
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

export function validateBookmarkContent(content, file) {
  const parts = parseBookmarkParts(content, file);
  const rawId = readScalar(parts.frontmatter, 'id');
  if (rawId === undefined || String(rawId).trim() === '') {
    throw dedupeError('missing_id', `Bookmark is missing an ID: ${file}`);
  }
  const rawUrl = readScalar(parts.frontmatter, 'url');
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw dedupeError('invalid_url', `Bookmark is missing a URL: ${file}`);
  }
  earliestSaveMs(parts.frontmatter, file);
  const rawSaveCount = readScalar(parts.frontmatter, 'save_count');
  if (rawSaveCount !== undefined && (!Number.isInteger(Number(rawSaveCount)) || Number(rawSaveCount) < 1)) {
    throw dedupeError('invalid_frontmatter', `Bookmark has an invalid save_count in ${file}: ${rawSaveCount}`);
  }
  let migratedFrontmatter;
  try {
    migratedFrontmatter = migrateBookmarkContent(parts.frontmatter).content;
  } catch (error) {
    throw dedupeError('invalid_frontmatter', `Invalid bookmark metadata in ${file}: ${error.message}`);
  }
  const canonicalUrl = resolveCanonicalUrl(rawUrl.trim(), readScalar(migratedFrontmatter, 'canonical_url'), file);
  return {
    parts,
    id: String(rawId).trim(),
    url: rawUrl.trim(),
    canonicalUrl,
    migratedFrontmatter
  };
}

async function readBookmarkRecords(root, fsOps = fs) {
  const records = [];
  const byId = new Map();
  for (const absoluteFile of await listBookmarkFiles(root)) {
    const file = relativeVaultPath(root, absoluteFile);
    const content = await fsOps.readFile(absoluteFile, 'utf8');
    const { parts, id, url, canonicalUrl, migratedFrontmatter } = validateBookmarkContent(content, file);
    const earliestMs = earliestSaveMs(parts.frontmatter, file);
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

function sameEventObject(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false;
  }
  return true;
}

function mergeEventHistory(group, field, appendEvent, errorCode) {
  let merged = [];
  for (const record of group) {
    for (const entry of readList(record.frontmatter, field)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw dedupeError(errorCode, `Invalid ${field} entry in ${record.file}`);
      }
      if (entry.id !== undefined && entry.id !== null && String(entry.id).trim() !== '') {
        const existing = merged.find((item) => item && typeof item === 'object' && item.id === entry.id);
        try {
          merged = appendEvent(merged, entry).history;
        } catch (error) {
          throw dedupeError(errorCode, `Cannot merge ${field} in ${record.file}: ${error.message}`);
        }
        if (existing && !sameEventObject(existing, entry)) {
          throw dedupeError(
            errorCode,
            `Cannot merge ${field} in ${record.file}: event ${entry.id} has conflicting provenance metadata`
          );
        }
      } else {
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
        const normalizedBlock = block.endsWith('\n') ? block : `${block}\n`;
        frontmatter = frontmatter.replace(/\n---\n$/, () => `\n${normalizedBlock}---\n`);
        mergedFields.set(field, block);
        continue;
      }
      if (mergedFields.get(field).trim() === block.trim()) continue;
      throw dedupeError('conflicting_metadata', `Conflicting metadata field "${field}" between ${keep.file} and ${duplicate.file}`);
    }
  }
  return frontmatter;
}

function selectPublishedEvidenceRecord(group) {
  const recordsWithDate = group.filter((record) => {
    const value = readScalar(record.frontmatter, 'published_at');
    return value !== undefined && String(value).trim() !== '';
  });
  if (!recordsWithDate.length) return undefined;
  const primary = recordsWithDate[0];
  const primaryDate = String(readScalar(primary.frontmatter, 'published_at')).trim();
  const hasProvenance = (record) => {
    const source = readScalar(record.frontmatter, 'published_at_source');
    const confidence = readScalar(record.frontmatter, 'published_at_confidence');
    return (source !== undefined && String(source).trim() !== '')
      || (confidence !== undefined && String(confidence).trim() !== '');
  };
  if (hasProvenance(primary)) return primary;
  const sameDateWithProvenance = recordsWithDate.find((record) =>
    String(readScalar(record.frontmatter, 'published_at')).trim() === primaryDate && hasProvenance(record));
  return sameDateWithProvenance || primary;
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

  const publishedRecord = selectPublishedEvidenceRecord(group);
  if (publishedRecord) {
    const publishedAt = readScalar(publishedRecord.frontmatter, 'published_at');
    frontmatter = replaceScalar(frontmatter, 'published_at', publishedAt);
    for (const field of ['published_at_source', 'published_at_confidence']) {
      const value = readScalar(publishedRecord.frontmatter, field);
      if (value !== undefined && String(value).trim() !== '') {
        frontmatter = replaceScalar(frontmatter, field, value);
      } else {
        frontmatter = removeScalar(frontmatter, field);
      }
    }
  } else {
    for (const field of ['published_at', 'published_at_source', 'published_at_confidence']) {
      frontmatter = removeScalar(frontmatter, field);
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
  const mergedContent = `${frontmatter}${body}`;
  validateBookmarkContent(mergedContent, keep.file);
  return {
    content: mergedContent,
    mergedTags,
    mergedContexts,
    saveCount: saveStats.saveCount,
    notesMerged
  };
}

async function listMarkdownFilesInDir(directory, fsOps = fs) {
  try {
    const entries = await fsOps.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...await listMarkdownFilesInDir(fullPath, fsOps));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
    return files.sort((left, right) => left.localeCompare(right, 'en'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function listProjectFiles(root, fsOps = fs) {
  return listMarkdownFilesInDir(path.join(root, 'projects'), fsOps);
}

async function snapshotVaultFiles(root, fsOps = fs) {
  const snapshot = new Map();
  for (const folder of ['bookmarks', 'projects', 'events']) {
    const files = await listMarkdownFilesInDir(path.join(root, folder), fsOps);
    for (const absoluteFile of files) {
      const rel = relativeVaultPath(root, absoluteFile);
      const content = await fsOps.readFile(absoluteFile, 'utf8');
      snapshot.set(rel, { absoluteFile, content });
    }
  }
  return snapshot;
}

function parseAndValidateProjectBookmarkEntries(content, file) {
  try {
    validateProjectContent(content, file);
  } catch (error) {
    throw dedupeError('invalid_project', error.message);
  }
  const normalized = normalizeLineEndings(content);
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)^---(?:\n|$)/m);
  const metadata = frontmatterMatch[1];
  const headers = [...metadata.matchAll(/^([A-Za-z_][\w-]*):[^\n]*(?:\n|$)/gm)];
  let bookmarksBlock = '';
  for (let index = 0; index < headers.length; index++) {
    if (headers[index][1] === 'bookmarks') {
      const end = headers[index + 1]?.index ?? metadata.length;
      bookmarksBlock = metadata.slice(headers[index].index, end);
      break;
    }
  }
  if (!bookmarksBlock) return [];
  const lines = bookmarksBlock.split('\n').slice(1);
  if (lines[lines.length - 1] === '') lines.pop();
  const entries = [];
  for (const line of lines) {
    if (!line.trim() || /^[ \t]*#/.test(line) || /^ {2}\[\][ \t]*$/.test(line)) continue;
    const itemMatch = line.match(/^ {2}- (.*)$/);
    if (!itemMatch) {
      throw dedupeError('invalid_project', `Invalid bookmark entry line in ${file}: ${line}`);
    }
    const rawItem = itemMatch[1].trim();
    if (!rawItem) {
      throw dedupeError('invalid_project', `Empty bookmark entry in ${file}`);
    }
    let parsed;
    if (rawItem.startsWith('{') || rawItem.startsWith('[') || rawItem.startsWith('"')) {
      try {
        parsed = JSON.parse(rawItem);
      } catch {
        throw dedupeError('invalid_project', `Malformed bookmark entry in ${file}: ${rawItem}`);
      }
    } else if (/[:{}[\]"]/.test(rawItem)) {
      throw dedupeError('invalid_project', `Malformed bookmark entry in ${file}: ${rawItem}`);
    } else {
      parsed = rawItem;
    }
    if (typeof parsed === 'string') {
      const id = parsed.trim();
      if (!id) throw dedupeError('invalid_project', `Bookmark entry in ${file} has an empty id`);
      entries.push({ id, notes: [] });
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw dedupeError('invalid_project', `Malformed bookmark entry in ${file}: ${rawItem}`);
    }
    if (typeof parsed.id !== 'string' || !parsed.id.trim()) {
      throw dedupeError('invalid_project', `Bookmark entry in ${file} is missing a valid string id`);
    }
    if (parsed.note !== undefined && typeof parsed.note !== 'string') {
      throw dedupeError('invalid_project', `Bookmark entry for ${parsed.id} in ${file} has an invalid note`);
    }
    if (parsed.notes !== undefined && (!Array.isArray(parsed.notes) || parsed.notes.some((item) => typeof item !== 'string'))) {
      throw dedupeError('invalid_project', `Bookmark entry for ${parsed.id} in ${file} has an invalid notes list`);
    }
    const { id, note, notes: storedNotes, ...rest } = parsed;
    const combinedNotes = uniqueStrings([
      ...(Array.isArray(storedNotes) ? storedNotes : []),
      ...(typeof note === 'string' ? [note] : [])
    ]);
    entries.push({ ...rest, id: id.trim(), notes: combinedNotes });
  }
  return entries;
}

function mergeProjectBookmarkEntries(existing, incoming, targetId, file) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'id' || key === 'notes') continue;
    if (merged[key] === undefined) {
      merged[key] = value;
      continue;
    }
    if (JSON.stringify(merged[key]) !== JSON.stringify(value)) {
      throw dedupeError('invalid_project', `Conflicting project bookmark entry field "${key}" for ${targetId} in ${file}`);
    }
  }
  merged.id = targetId;
  merged.notes = uniqueStrings([...(existing.notes || []), ...(incoming.notes || [])]);
  return merged;
}

async function planProjectEdits(root, removedIdMap, fsOps = fs) {
  const projectEdits = [];
  const linkedProjectsByBookmarkId = new Map();

  for (const absoluteFile of await listProjectFiles(root, fsOps)) {
    const file = relativeVaultPath(root, absoluteFile);
    const content = await fsOps.readFile(absoluteFile, 'utf8');
    const rawEntries = parseAndValidateProjectBookmarkEntries(content, file);
    const rawProjectId = readScalar(content, 'id');
    const projectId = rawProjectId !== undefined && String(rawProjectId).trim() !== '' ? String(rawProjectId).trim() : undefined;

    let touchesRemoved = false;
    let hasDuplicateTargetInProject = false;
    const seenTargets = new Set();
    for (const entry of rawEntries) {
      const targetId = removedIdMap.get(entry.id) || entry.id;
      if (removedIdMap.has(entry.id)) touchesRemoved = true;
      if (seenTargets.has(targetId)) hasDuplicateTargetInProject = true;
      seenTargets.add(targetId);
      if (projectId) {
        const list = linkedProjectsByBookmarkId.get(targetId) || [];
        if (!list.includes(projectId)) list.push(projectId);
        linkedProjectsByBookmarkId.set(targetId, list);
      }
    }

    if (!touchesRemoved && !hasDuplicateTargetInProject) continue;

    const rewritten = [];
    const indexById = new Map();
    for (const entry of rawEntries) {
      const targetId = removedIdMap.get(entry.id) || entry.id;
      if (indexById.has(targetId)) {
        const existingIndex = indexById.get(targetId);
        rewritten[existingIndex] = mergeProjectBookmarkEntries(rewritten[existingIndex], entry, targetId, file);
      } else {
        indexById.set(targetId, rewritten.length);
        rewritten.push({ ...entry, id: targetId });
      }
    }
    const updatedContent = formatProjectContent(content, { bookmarks: rewritten, file });
    parseAndValidateProjectBookmarkEntries(updatedContent, file);
    if (updatedContent !== content) {
      projectEdits.push({
        id: projectId || file,
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
      const updatedContent = `${frontmatter}${normalizeLineEndings(record.body)}`;
      validateBookmarkContent(updatedContent, record.file);
      edits.push({
        id: record.id,
        file: record.file,
        absoluteFile: record.absoluteFile,
        originalContent: record.originalContent,
        content: updatedContent
      });
    }
  }
  return edits;
}

export async function createDedupePlan(root, { fsOps = fs } = {}) {
  const vaultSnapshot = await snapshotVaultFiles(root, fsOps);
  const records = await readBookmarkRecords(root, fsOps);
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
    await planProjectEdits(root, new Map(), fsOps);
    return {
      root,
      bookmarkCount: records.length,
      groups: [],
      bookmarkEdits: [],
      projectEdits: [],
      removals: [],
      vaultSnapshot
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

  const { projectEdits, linkedProjectsByBookmarkId } = await planProjectEdits(root, removedIdMap, fsOps);

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
    removals,
    vaultSnapshot
  };
}

async function unchanged(record, fsOps = fs) {
  try {
    return await fsOps.readFile(record.absoluteFile, 'utf8') === record.originalContent;
  } catch {
    return false;
  }
}

async function verifyPreApplyState(plan, allUpdates, fsOps, phaseMessage) {
  if (plan.vaultSnapshot instanceof Map) {
    const currentSnapshot = await snapshotVaultFiles(plan.root, fsOps);
    for (const [file, snapshotEntry] of plan.vaultSnapshot.entries()) {
      const current = currentSnapshot.get(file);
      if (!current || current.content !== snapshotEntry.content) {
        throw dedupeError('concurrent_change', `${phaseMessage}: ${file}`);
      }
    }
    for (const file of currentSnapshot.keys()) {
      if (!plan.vaultSnapshot.has(file)) {
        throw dedupeError('concurrent_change', `${phaseMessage}: ${file}`);
      }
    }
  }
  for (const item of [...allUpdates, ...plan.removals]) {
    if (!await unchanged(item, fsOps)) {
      throw dedupeError('concurrent_change', `${phaseMessage}: ${item.file}`);
    }
  }
}

async function verifyPostApplyState(plan, allUpdates, fsOps) {
  for (const edit of allUpdates) {
    let current;
    try {
      current = await fsOps.readFile(edit.absoluteFile, 'utf8');
    } catch {
      throw dedupeError('concurrent_change', `Vault file missing after apply: ${edit.file}`);
    }
    if (current !== edit.content) {
      throw dedupeError('concurrent_change', `Vault file changed while applying dedupe: ${edit.file}`);
    }
  }
  for (const removal of plan.removals) {
    try {
      await fsOps.stat(removal.absoluteFile);
      throw dedupeError('concurrent_change', `Vault file changed while applying dedupe: ${removal.file}`);
    } catch (error) {
      if (error instanceof BookmarkDedupeError) throw error;
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (plan.vaultSnapshot instanceof Map) {
    const expected = new Map();
    for (const [file, entry] of plan.vaultSnapshot.entries()) {
      expected.set(file, entry.content);
    }
    for (const edit of allUpdates) {
      expected.set(edit.file, edit.content);
    }
    for (const removal of plan.removals) {
      expected.delete(removal.file);
    }
    const currentSnapshot = await snapshotVaultFiles(plan.root, fsOps);
    for (const [file, expectedContent] of expected.entries()) {
      const current = currentSnapshot.get(file);
      if (!current || current.content !== expectedContent) {
        throw dedupeError('concurrent_change', `Vault file changed while applying dedupe: ${file}`);
      }
    }
    for (const file of currentSnapshot.keys()) {
      if (!expected.has(file)) {
        throw dedupeError('concurrent_change', `Vault file changed while applying dedupe: ${file}`);
      }
    }
  }
}

async function rollbackDedupeChanges(updatedBackups, removedBackups) {
  for (const item of [...updatedBackups].reverse()) {
    let currentOnDisk;
    try {
      currentOnDisk = await nativeFs.readFile(item.edit.absoluteFile, 'utf8');
    } catch {
      currentOnDisk = undefined;
    }
    let restored = item.backupContent;
    if (currentOnDisk !== undefined && currentOnDisk !== item.edit.content && currentOnDisk !== item.backupContent) {
      if (currentOnDisk.startsWith(item.edit.content)) {
        restored = `${item.backupContent}${currentOnDisk.slice(item.edit.content.length)}`;
      } else {
        restored = currentOnDisk;
      }
    }
    await nativeFs.writeFile(item.edit.absoluteFile, restored, 'utf8');
    await nativeFs.rm(item.backupPath, { force: true });
  }
  for (const item of [...removedBackups].reverse()) {
    let currentOnDisk;
    try {
      currentOnDisk = await nativeFs.readFile(item.removal.absoluteFile, 'utf8');
    } catch {
      currentOnDisk = undefined;
    }
    let restored = item.backupContent;
    if (currentOnDisk !== undefined && currentOnDisk !== item.backupContent) {
      if (!currentOnDisk.startsWith('---\n')) {
        restored = `${item.backupContent}${currentOnDisk}`;
      } else {
        restored = currentOnDisk;
      }
    }
    await nativeFs.writeFile(item.removal.absoluteFile, restored, 'utf8');
    await nativeFs.rm(item.backupPath, { force: true });
  }
}

export async function applyDedupePlan(plan, { fsOps = fs, lockTimeoutMs } = {}) {
  return withVaultLock(plan.root, async () => {
    for (const edit of plan.bookmarkEdits) {
      validateBookmarkContent(edit.content, edit.file);
    }
    for (const edit of plan.projectEdits) {
      parseAndValidateProjectBookmarkEntries(edit.content, edit.file);
    }

    const allUpdates = [...plan.bookmarkEdits, ...plan.projectEdits];
    await verifyPreApplyState(plan, allUpdates, fsOps, 'Vault file changed after preview');

    const staged = [];
    const updatedBackups = [];
    const removedBackups = [];
    const changed = [];
    const removed = [];
    try {
      for (const edit of allUpdates) {
        const temporary = `${edit.absoluteFile}.dedupe-stage-${process.pid}-${crypto.randomUUID()}.tmp`;
        const { mode } = await fsOps.stat(edit.absoluteFile);
        await fsOps.writeFile(temporary, edit.content, { encoding: 'utf8', flag: 'wx', mode });
        staged.push({ edit, temporary });
      }

      await verifyPreApplyState(plan, allUpdates, fsOps, 'Vault file changed while applying dedupe');

      for (const item of staged) {
        const backupPath = `${item.edit.absoluteFile}.dedupe-backup-${process.pid}-${crypto.randomUUID()}.tmp`;
        await fsOps.rename(item.edit.absoluteFile, backupPath);
        const backupContent = await nativeFs.readFile(backupPath, 'utf8');
        updatedBackups.push({ edit: item.edit, backupPath, backupContent });
        if (backupContent !== item.edit.originalContent) {
          throw dedupeError('concurrent_change', `Vault file changed while applying dedupe: ${item.edit.file}`);
        }
        await fsOps.rename(item.temporary, item.edit.absoluteFile);
        item.temporary = undefined;
        changed.push(item.edit.file);
      }

      for (const removal of plan.removals) {
        const backupPath = `${removal.absoluteFile}.dedupe-removed-${process.pid}-${crypto.randomUUID()}.tmp`;
        await fsOps.rename(removal.absoluteFile, backupPath);
        const backupContent = await nativeFs.readFile(backupPath, 'utf8');
        removedBackups.push({ removal, backupPath, backupContent });
        if (backupContent !== removal.originalContent) {
          throw dedupeError('concurrent_change', `Vault file changed while applying dedupe: ${removal.file}`);
        }
        removed.push(removal.file);
      }

      await verifyPostApplyState(plan, allUpdates, fsOps);

      for (const item of [...updatedBackups, ...removedBackups]) {
        await fsOps.unlink(item.backupPath);
      }

      await verifyPostApplyState(plan, allUpdates, fsOps);

      return { changed, removed };
    } catch (error) {
      await rollbackDedupeChanges(updatedBackups, removedBackups);
      if (error instanceof BookmarkDedupeError) {
        throw error;
      }
      throw dedupeError('write_failed', `Could not apply bookmark deduplication: ${error.message}`);
    } finally {
      await Promise.all([
        ...staged.filter((item) => item.temporary).map((item) => nativeFs.rm(item.temporary, { force: true })),
        ...updatedBackups.map((item) => nativeFs.rm(item.backupPath, { force: true })),
        ...removedBackups.map((item) => nativeFs.rm(item.backupPath, { force: true }))
      ]);
    }
  }, { timeoutMs: lockTimeoutMs });
}

export async function dedupeVaultBookmarks(root, { apply = false, fsOps = fs, lockTimeoutMs } = {}) {
  if (!apply) {
    const plan = await createDedupePlan(root, { fsOps });
    return { ...plan, applied: false, changed: [], removed: [] };
  }
  return withVaultLock(root, async () => {
    const plan = await createDedupePlan(root, { fsOps });
    if (!plan.groups.length) return { ...plan, applied: false, changed: [], removed: [] };
    const result = await applyDedupePlan(plan, { fsOps, lockTimeoutMs });
    return { ...plan, applied: true, changed: result.changed, removed: result.removed };
  }, { timeoutMs: lockTimeoutMs });
}
