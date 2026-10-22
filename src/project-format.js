import fs from 'node:fs/promises';
import { normalizeLineEndings, yamlList } from './bookmark-format.js';

const FIELD_ORDER = ['id', 'title', 'status', 'contexts', 'tags', 'bookmarks'];

function projectParts(content, file) {
  const normalized = normalizeLineEndings(content);
  const frontmatter = normalized.match(/^---\n([\s\S]*?)^---(?:\n|$)/m);
  const invalid = (reason) => new Error(`Invalid project frontmatter${file ? ` in ${file}` : ''}: ${reason}`);
  if (!frontmatter || frontmatter.index !== 0) throw invalid('opening and closing --- delimiters are required');
  const metadata = frontmatter[1];
  const headers = [...metadata.matchAll(/^([A-Za-z_][\w-]*):[^\n]*(?:\n|$)/gm)];
  const fields = new Map();
  for (let index = 0; index < headers.length; index++) {
    const field = headers[index][1];
    if (fields.has(field)) throw invalid(`duplicate field(s): ${field}`);
    const end = headers[index + 1]?.index ?? metadata.length;
    fields.set(field, metadata.slice(headers[index].index, end));
  }
  for (const field of ['id', 'title']) {
    const value = fields.get(field)?.match(/^[^:]+: *([^\n]*)/)?.[1];
    if (value?.startsWith('"')) {
      try { JSON.parse(value); } catch { throw invalid(`${field} must be a complete quoted string`); }
    }
  }
  return {
    fields,
    prefix: metadata.slice(0, headers[0]?.index ?? metadata.length),
    body: normalized.slice(frontmatter[0].length)
  };
}

export function validateProjectContent(content, file) {
  projectParts(content, file);
}

export function formatProjectContent(content, { bookmarks, file } = {}) {
  const { fields, prefix, body } = projectParts(content, file);
  if (bookmarks !== undefined) {
    const comments = fields.get('bookmarks')?.match(/^[ \t]*#[^\n]*(?:\n|$)/gm)?.join('') || '';
    fields.set('bookmarks', `bookmarks:\n${yamlList(bookmarks)}\n${comments}`);
  }
  // Move complete raw blocks, preserving unknown fields, nested metadata, and comments.
  // Only frontmatter is reordered: body text resembling metadata stays untouched.
  const order = [...FIELD_ORDER.filter((field) => fields.has(field)),
    ...[...fields.keys()].filter((field) => !FIELD_ORDER.includes(field))];
  const metadata = order.map((field) => fields.get(field)).join('');
  return `---\n${prefix}${metadata}---\n${body}`;
}

export function createProjectContent({ id, title, status = 'active', contexts = [], tags = [], purpose = '', notes = '' }) {
  const metadata = { id, title, status, contexts, tags, bookmarks: [] };
  const fields = Object.entries(metadata).map(([field, value]) =>
    Array.isArray(value) ? `${field}:\n${yamlList(value)}` : `${field}: ${JSON.stringify(value)}`);
  return formatProjectContent([
    '---', ...fields, '---', '', '## Purpose', '', purpose, '', '## Presenter notes', '', notes, ''
  ].join('\n'));
}

export async function writeProject(file, content, changes = {}) {
  await fs.writeFile(file, formatProjectContent(content, { ...changes, file }), 'utf8');
}
