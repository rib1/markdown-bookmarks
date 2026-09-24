import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readList, readScalar, replaceList } from './bookmark-format.js';
import { listBookmarkFiles } from './vault-bookmark-files.js';

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'project';
}

function validId(value) {
  return /^[a-z0-9][a-z0-9-]{0,79}$/i.test(value);
}

function safeText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required`);
  if ([...text].some((character) => character.codePointAt(0) < 32)) {
    throw new Error(`${label} must not contain control characters`);
  }
  return text;
}

function normalizeList(values = []) {
  return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
}

function bookmarkEntry(value) {
  if (typeof value === 'string') return { id: value, notes: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { note, notes: storedNotes, ...entry } = value;
  const notes = Array.isArray(storedNotes) ? storedNotes : typeof note === 'string' ? [note] : [];
  return { ...entry, notes: notes.map(String).map((item) => item.trim()).filter(Boolean) };
}

function projectEntries(values) {
  return values.map(bookmarkEntry).filter((entry) => entry && typeof entry.id === 'string');
}

async function listProjectFiles(root) {
  const directory = path.join(root, 'projects');
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(directory, entry.name)).sort((left, right) => left.localeCompare(right, 'en'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function projectRecords(root) {
  return Promise.all((await listProjectFiles(root)).map(async (file) => {
    const content = await fs.readFile(file, 'utf8');
    return {
      file, content, id: readScalar(content, 'id'), title: readScalar(content, 'title'),
      status: readScalar(content, 'status') || 'active', bookmarks: projectEntries(readList(content, 'bookmarks'))
    };
  }));
}

function selectUnique(records, reference, label) {
  const exact = records.filter((record) => record.id === reference);
  const prefix = exact.length ? exact : records.filter((record) => String(record.id || '').startsWith(reference));
  const title = prefix.length ? prefix : records.filter((record) => String(record.title || '').toLowerCase() === reference.toLowerCase());
  if (!title.length) throw new Error(`No ${label} found for: ${reference}`);
  if (title.length > 1) throw new Error(`Multiple ${label}s match: ${reference}. Use a longer stable ID.`);
  return title[0];
}

export async function listProjects(root) {
  return (await projectRecords(root)).sort((left, right) => String(left.title).localeCompare(String(right.title), 'en'));
}

export async function resolveProject(reference, root) {
  return selectUnique(await projectRecords(root), reference, 'project');
}

export async function createProject(input, root) {
  const title = safeText(input.title, 'Project title');
  const id = input.id || crypto.randomUUID();
  if (!validId(id)) throw new Error('Project ID must use letters, numbers, and hyphens only');
  const existing = await projectRecords(root);
  if (existing.some((project) => project.id === id)) throw new Error(`Project ID already exists: ${id}`);
  await fs.mkdir(path.join(root, 'projects'), { recursive: true });
  const file = path.join(root, 'projects', `${id}-${slug(title)}.md`);
  const contexts = normalizeList(input.contexts);
  const tags = normalizeList(input.tags).map((tag) => tag.toLowerCase());
  const content = [
    '---', `id: ${JSON.stringify(id)}`, `title: ${JSON.stringify(title)}`,
    `status: ${JSON.stringify(input.status || 'active')}`,
    'contexts:', ...(contexts.length ? contexts.map((value) => `  - ${JSON.stringify(value)}`) : ['  []']),
    'tags:', ...(tags.length ? tags.map((value) => `  - ${JSON.stringify(value)}`) : ['  []']),
    'bookmarks:', '  []', '---', '', '## Purpose', '', input.purpose || '', '', '## Presenter notes', '', input.notes || '', ''
  ].join('\n');
  await fs.writeFile(file, content, 'utf8');
  return { id, title, file };
}

async function resolveBookmark(reference, root) {
  const records = await Promise.all((await listBookmarkFiles(root)).map(async (file) => {
    const content = await fs.readFile(file, 'utf8');
    return { file, content, id: readScalar(content, 'id'), url: readScalar(content, 'url'), title: readScalar(content, 'title') };
  }));
  return selectUnique(records, reference, 'bookmark');
}

export async function addProjectBookmark(projectReference, bookmarkReference, root, { note } = {}) {
  const [project, bookmark] = await Promise.all([
    resolveProject(projectReference, root), resolveBookmark(bookmarkReference, root)
  ]);
  const existingIndex = project.bookmarks.findIndex((entry) => entry.id === bookmark.id);
  const bookmarks = [...project.bookmarks];
  if (existingIndex < 0) bookmarks.push({ id: bookmark.id, notes: note ? [safeText(note, 'Bookmark note')] : [] });
  else if (note !== undefined) bookmarks[existingIndex] = {
    ...bookmarks[existingIndex], notes: [...bookmarks[existingIndex].notes, safeText(note, 'Bookmark note')]
  };
  const projectContent = replaceList(project.content, 'bookmarks', bookmarks);
  const bookmarkProjects = normalizeList([...readList(bookmark.content, 'projects'), project.id]);
  const bookmarkContent = replaceList(bookmark.content, 'projects', bookmarkProjects);
  await fs.writeFile(project.file, projectContent, 'utf8');
  await fs.writeFile(bookmark.file, bookmarkContent, 'utf8');
  return { project: project.id, bookmark: bookmark.id, added: existingIndex < 0, noteAdded: existingIndex >= 0 && note !== undefined };
}

export async function removeProjectBookmark(projectReference, bookmarkReference, root) {
  const [project, bookmark] = await Promise.all([
    resolveProject(projectReference, root), resolveBookmark(bookmarkReference, root)
  ]);
  const bookmarks = project.bookmarks.filter((entry) => entry.id !== bookmark.id);
  const projects = readList(bookmark.content, 'projects').filter((id) => id !== project.id);
  await fs.writeFile(project.file, replaceList(project.content, 'bookmarks', bookmarks), 'utf8');
  await fs.writeFile(bookmark.file, replaceList(bookmark.content, 'projects', projects), 'utf8');
  return { project: project.id, bookmark: bookmark.id, removed: bookmarks.length !== project.bookmarks.length };
}

export async function addProjectBookmarkNote(projectReference, bookmarkReference, note, root) {
  const [project, bookmark] = await Promise.all([
    resolveProject(projectReference, root), resolveBookmark(bookmarkReference, root)
  ]);
  const index = project.bookmarks.findIndex((entry) => entry.id === bookmark.id);
  if (index < 0) throw new Error(`Bookmark ${bookmark.id} is not linked to project ${project.id}`);
  const bookmarks = [...project.bookmarks];
  bookmarks[index] = { ...bookmarks[index], notes: [...bookmarks[index].notes, safeText(note, 'Bookmark note')] };
  await fs.writeFile(project.file, replaceList(project.content, 'bookmarks', bookmarks), 'utf8');
  return { project: project.id, bookmark: bookmark.id, noteCount: bookmarks[index].notes.length };
}

export async function removeProjectBookmarkNote(projectReference, bookmarkReference, pick, root) {
  const [project, bookmark] = await Promise.all([
    resolveProject(projectReference, root), resolveBookmark(bookmarkReference, root)
  ]);
  const index = project.bookmarks.findIndex((entry) => entry.id === bookmark.id);
  if (index < 0) throw new Error(`Bookmark ${bookmark.id} is not linked to project ${project.id}`);
  const noteIndex = Number(pick);
  const notes = project.bookmarks[index].notes;
  if (!Number.isInteger(noteIndex) || noteIndex < 1 || noteIndex > notes.length) {
    throw new Error(`--pick must be a number from 1 to ${notes.length}`);
  }
  const bookmarks = [...project.bookmarks];
  bookmarks[index] = { ...bookmarks[index], notes: notes.filter((_note, position) => position !== noteIndex - 1) };
  await fs.writeFile(project.file, replaceList(project.content, 'bookmarks', bookmarks), 'utf8');
  return { project: project.id, bookmark: bookmark.id, removed: notes[noteIndex - 1] };
}

export async function moveProjectBookmark(projectReference, bookmarkReference, position, root) {
  const project = await resolveProject(projectReference, root);
  const bookmark = await resolveBookmark(bookmarkReference, root);
  const index = Number(position);
  if (!Number.isInteger(index) || index < 1 || index > project.bookmarks.length) {
    throw new Error(`--to must be a number from 1 to ${project.bookmarks.length}`);
  }
  const oldIndex = project.bookmarks.findIndex((entry) => entry.id === bookmark.id);
  if (oldIndex < 0) throw new Error(`Bookmark ${bookmark.id} is not linked to project ${project.id}`);
  const bookmarks = [...project.bookmarks];
  const entry = bookmarks[oldIndex];
  bookmarks.splice(oldIndex, 1);
  bookmarks.splice(index - 1, 0, entry);
  await fs.writeFile(project.file, replaceList(project.content, 'bookmarks', bookmarks), 'utf8');
  return { project: project.id, bookmark: bookmark.id, position: index };
}

export async function projectBookmarks(projectReference, root) {
  const project = await resolveProject(projectReference, root);
  const files = await listBookmarkFiles(root);
  const records = await Promise.all(files.map(async (file) => {
    const content = await fs.readFile(file, 'utf8');
    return { file, content, id: readScalar(content, 'id'), title: readScalar(content, 'title'), url: readScalar(content, 'url') };
  }));
  const byId = new Map(records.map((record) => [record.id, record]));
  return {
    project,
    entries: project.bookmarks.map((projectEntry) => ({
      ...(byId.get(projectEntry.id) || { id: projectEntry.id, missing: true }),
      notes: projectEntry.notes
    }))
  };
}
