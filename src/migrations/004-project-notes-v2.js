import { readList, replaceList } from '../bookmark-format.js';

export const version = 4;
export const fromVersion = 3;
export const script = '004-project-notes-v2.js';

export function migrate(content) {
  return { content };
}

export function migrateProject(content) {
  const original = readList(content, 'bookmarks');
  const bookmarks = original.map((value) => {
    if (typeof value === 'string') return { id: value, notes: [] };
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.id !== 'string') return value;
    const { note, notes, ...unknown } = value;
    const normalizedNotes = [
      ...(Array.isArray(notes) ? notes : []),
      ...(typeof note === 'string' ? [note] : [])
    ].map((item) => String(item).trim()).filter(Boolean);
    return { ...unknown, id: value.id, notes: normalizedNotes };
  });
  const changed = JSON.stringify(original) !== JSON.stringify(bookmarks);
  return { content: changed ? replaceList(content, 'bookmarks', bookmarks) : content, migrated: changed ? 1 : 0 };
}
