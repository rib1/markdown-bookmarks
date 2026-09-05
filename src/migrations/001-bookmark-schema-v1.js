import {
  normalizeUrl,
  readList,
  readScalar,
  removeScalar,
  replaceList,
  replaceScalar
} from '../bookmark-format.js';

export const version = 1;
export const fromVersion = 0;
export const script = '001-bookmark-schema-v1.js';

export function migrate(content) {
  const savedAt = readScalar(content, 'saved_at');
  if (!savedAt) throw new Error('Cannot migrate bookmark without saved_at');
  const url = readScalar(content, 'url');
  if (!url) throw new Error('Cannot migrate bookmark without url');

  const firstSavedAt = readScalar(content, 'first_saved_at')
    || readScalar(content, 'first_opened_at') || savedAt;
  const lastSavedAt = readScalar(content, 'last_saved_at')
    || readScalar(content, 'last_opened_at') || savedAt;
  let saveHistory = readList(content, 'save_history');
  if (!saveHistory.length) {
    saveHistory = [firstSavedAt];
    if (lastSavedAt !== firstSavedAt) saveHistory.push(lastSavedAt);
  }
  const legacyAccessCount = Number(readScalar(content, 'access_count'));
  const existingSaveCount = Number(readScalar(content, 'save_count'));
  const saveCount = Number.isInteger(existingSaveCount) && existingSaveCount > 0
    ? existingSaveCount
    : Number.isInteger(legacyAccessCount) && legacyAccessCount > 0 ? legacyAccessCount : saveHistory.length;

  const corruptedTagValues = new Set(saveHistory.map(String));
  const originalTags = readList(content, 'tags');
  const tags = originalTags.filter((tag) => !corruptedTagValues.has(String(tag)));
  const contexts = readList(content, 'contexts');
  const ambiguousContextTags = tags.filter((tag) => contexts.includes(tag)).length;

  if (!readScalar(content, 'canonical_url')) content = replaceScalar(content, 'canonical_url', normalizeUrl(url));
  if (!readScalar(content, 'type')) content = replaceScalar(content, 'type', 'bookmark');
  if (!/^contexts:/m.test(content)) content = replaceList(content, 'contexts', []);
  if (!/^tags:/m.test(content) || tags.length !== originalTags.length) content = replaceList(content, 'tags', tags);
  content = replaceScalar(content, 'first_saved_at', firstSavedAt);
  content = replaceScalar(content, 'last_saved_at', lastSavedAt);
  content = replaceScalar(content, 'save_count', Math.max(saveCount, saveHistory.length));
  content = replaceList(content, 'save_history', saveHistory);
  content = removeScalar(content, 'first_opened_at');
  content = removeScalar(content, 'last_opened_at');
  content = removeScalar(content, 'access_count');

  return {
    content,
    repairedTags: originalTags.length - tags.length,
    ambiguousContextTags
  };
}
