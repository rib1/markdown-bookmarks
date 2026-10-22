import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_DOCUMENT_EXTENSIONS = new Set([
  '.html', '.htm', '.svg', '.pdf', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'
]);

function hasControlCharacters(value) {
  return [...value].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127);
}

export function isOpenableBookmarkUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || hasControlCharacters(value) || value.includes('\\')) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return /^https?:\/\//i.test(value) && Boolean(url.hostname);
    }
    // Explicit absolute local files only: reject UNC/network shares and relative URLs.
    if (url.protocol !== 'file:' || !/^file:\/\/\/(?!\/)/i.test(value) || url.hostname) return false;
    if (/%(?:2f|5c)/i.test(url.pathname)) return false;
    const localPath = fileURLToPath(url, { windows: false });
    if (localPath.startsWith('//') || localPath.includes('\\') || hasControlCharacters(localPath)) return false;
    if (localPath.replace(/^\/[a-z]:/i, '').includes(':')) return false;
    if (/^\/[a-z]:/i.test(localPath)) {
      if (!/^\/[a-z]:\//i.test(localPath)) return false;
      fileURLToPath(url, { windows: true });
    }
    // Default OS handlers can execute programs; allow browser document types only.
    return LOCAL_DOCUMENT_EXTENSIONS.has(path.posix.extname(localPath).toLowerCase());
  } catch { return false; }
}

export function assertBrowserTarget(value) {
  if (!isOpenableBookmarkUrl(value)) {
    throw new Error('Browser target must be HTTP/HTTPS or an absolute local document file:/// URL');
  }
}
