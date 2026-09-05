import { normalizeTags, readList, replaceList } from '../bookmark-format.js';

export const version = 2;
export const fromVersion = 1;
export const script = '002-normalize-tags-and-capture-labels.js';

export function migrate(content) {
  const originalTags = readList(content, 'tags');
  const tags = normalizeTags(originalTags);
  const normalizedTags = originalTags.reduce((count, value, index) => {
    const normalized = String(value).trim().toLowerCase();
    return count + (normalized !== String(value) || tags.indexOf(normalized) !== index ? 1 : 0);
  }, 0);
  if (JSON.stringify(tags) !== JSON.stringify(originalTags)) {
    content = replaceList(content, 'tags', tags);
  }

  const originalCaptures = readList(content, 'capture_history');
  let osLabelsAdded = 0;
  const captures = originalCaptures.map((capture) => {
    if (!capture || typeof capture !== 'object' || Array.isArray(capture)) return capture;
    const device = typeof capture.device === 'string' ? capture.device.trim() : '';
    const os = typeof capture.os === 'string' ? capture.os.trim() : '';
    if (device || !os) return capture;
    osLabelsAdded++;
    return { ...capture, device: os };
  });
  if (osLabelsAdded) content = replaceList(content, 'capture_history', captures);

  return { content, normalizedTags, osLabelsAdded };
}
