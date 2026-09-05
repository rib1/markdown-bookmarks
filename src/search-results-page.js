import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readList, readScalar } from './bookmark-format.js';
import { vaultRoot } from './vault-path.js';

export const SEARCH_RESULTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SEARCH_RESULTS_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'";

const resultFilePattern = /^search-results-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.html$/i;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function metadataValue(content, field) {
  return readScalar(content, field);
}

export function sortSearchResults(results) {
  return [...results].sort((left, right) => {
    const leftTitle = String(metadataValue(left.content, 'title') || left.file);
    const rightTitle = String(metadataValue(right.content, 'title') || right.file);
    return compareText(leftTitle.toLowerCase(), rightTitle.toLowerCase())
      || compareText(leftTitle, rightTitle)
      || compareText(left.file, right.file);
  });
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function httpUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function chips(label, values) {
  if (!values.length) return '';
  return `<div class="metadata"><strong>${escapeHtml(label)}:</strong> ${values.map((value) =>
    `<span class="chip">${escapeHtml(value)}</span>`).join(' ')}</div>`;
}

function resultCard(result) {
  const title = String(metadataValue(result.content, 'title') || '(untitled)');
  const rawUrl = String(metadataValue(result.content, 'url') || '');
  const parsedUrl = httpUrl(rawUrl);
  const savedAt = metadataValue(result.content, 'last_saved_at') || metadataValue(result.content, 'saved_at');
  const tags = readList(result.content, 'tags');
  const contexts = readList(result.content, 'contexts');
  const openLink = parsedUrl
    ? `<a class="open-link" href="${escapeHtml(parsedUrl.href)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(title)}">Open</a>`
    : '<span class="open-link disabled" aria-disabled="true">Unavailable</span>';
  return `<article class="result">
    <div class="result-heading"><div><h2>${escapeHtml(title)}</h2><span class="host">${escapeHtml(parsedUrl?.host || 'Invalid URL')}</span></div>${openLink}</div>
    <div class="url">${escapeHtml(rawUrl || '(missing URL)')}</div>
    ${chips('Tags', tags)}
    ${chips('Contexts', contexts)}
    ${savedAt ? `<div class="metadata"><strong>Saved:</strong> ${escapeHtml(savedAt)}</div>` : ''}
  </article>`;
}

export function renderSearchResultsPage(query, results) {
  const sorted = sortSearchResults(results);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="${SEARCH_RESULTS_CSP}">
  <title>Bookmark search results</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 920px; margin: 0 auto; padding: 2rem 1rem; background: Canvas; color: CanvasText; }
    header { margin-bottom: 1.5rem; }
    h1 { margin-bottom: .25rem; }
    .query, .host, .url, .metadata { color: GrayText; }
    .results { display: grid; gap: 1rem; }
    .result { border: 1px solid ButtonBorder; border-radius: .75rem; padding: 1rem; }
    .result-heading { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }
    h2 { font-size: 1.1rem; margin: 0 0 .2rem; overflow-wrap: anywhere; }
    .url { margin: .8rem 0; overflow-wrap: anywhere; font-family: ui-monospace, monospace; }
    .metadata { margin-top: .5rem; }
    .chip { display: inline-block; border: 1px solid ButtonBorder; border-radius: 999px; padding: .1rem .45rem; }
    .open-link { background: LinkText; color: Canvas; border-radius: .4rem; padding: .45rem .75rem; text-decoration: none; }
    .disabled { background: GrayText; }
  </style>
</head>
<body>
  <header><h1>Bookmark search results</h1><div class="query">${sorted.length} result${sorted.length === 1 ? '' : 's'} for “${escapeHtml(query)}”</div></header>
  <main class="results">${sorted.map(resultCard).join('\n')}</main>
</body>
</html>
`;
}

export function searchResultsDirectory() {
  return process.env.BOOKMARK_RESULTS_DIR || path.join(vaultRoot(), 'views', '.search-results');
}

function resultFileName(token) {
  const name = `search-results-${token}.html`;
  if (!resultFilePattern.test(name)) throw new Error('Invalid search-results token');
  return name;
}

function resultFile(token, directory = searchResultsDirectory()) {
  return path.join(directory, resultFileName(token));
}

export async function cleanupStaleSearchResultPages(directory = searchResultsDirectory(), now = Date.now()) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !resultFilePattern.test(entry.name)) continue;
    const file = path.join(directory, entry.name);
    const stat = await fs.stat(file);
    if (now - stat.mtimeMs <= SEARCH_RESULTS_MAX_AGE_MS) continue;
    await fs.rm(file, { force: true });
    removed++;
  }
  return removed;
}

export async function createSearchResultsPage(query, results, { directory = searchResultsDirectory() } = {}) {
  if (!results.length) throw new Error(`No bookmark found for: ${query}`);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const token = crypto.randomUUID();
  const file = resultFile(token, directory);
  await fs.writeFile(file, renderSearchResultsPage(query, results), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return { token, file, fileUrl: pathToFileURL(file).href, count: results.length };
}

export function hostSearchResultsFileUrl(token, hostVaultPath) {
  const relativeParts = ['views', '.search-results', resultFileName(token)];
  if (/^[a-z]:[\\/]/i.test(hostVaultPath)) {
    const normalized = hostVaultPath.replaceAll('\\', '/').replace(/\/$/, '');
    const [drive, ...parts] = normalized.split('/');
    return `file:///${drive}/${[...parts, ...relativeParts].map(encodeURIComponent).join('/')}`;
  }
  if (path.isAbsolute(hostVaultPath)) return pathToFileURL(path.join(hostVaultPath, ...relativeParts)).href;
  throw new Error('BOOKMARK_VAULT must be an absolute host path for Docker browser results');
}
