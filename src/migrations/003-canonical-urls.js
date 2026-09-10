import { normalizeUrl, readScalar, replaceScalar } from '../bookmark-format.js';
import { applySitePlugins } from '../site-plugins/index.js';

export const version = 3;
export const fromVersion = 2;
export const script = '003-canonical-urls.js';

export function canonicalUrlForBookmark(url, existingCanonical) {
  let canonical = normalizeUrl(url);
  try {
    const pluginResult = applySitePlugins({ url });
    if (pluginResult.canonical_url) {
      canonical = normalizeUrl(pluginResult.canonical_url);
    }
  } catch {
    if (existingCanonical) canonical = normalizeUrl(existingCanonical);
  }
  return canonical;
}

export function migrate(content) {
  const url = readScalar(content, 'url');
  if (!url) throw new Error('Cannot migrate bookmark without url');

  const existingCanonical = readScalar(content, 'canonical_url');
  const canonical = canonicalUrlForBookmark(url, existingCanonical);

  let updatedCanonicalUrls = 0;
  if (existingCanonical !== canonical) {
    content = replaceScalar(content, 'canonical_url', canonical);
    updatedCanonicalUrls = 1;
  }

  return { content, updatedCanonicalUrls };
}
