function normalizeWordSearchText(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');
}

function isShortAlphabeticTerm(value) {
  return /^\p{L}{1,3}$/u.test(value);
}

export function searchMode(query, { fuzzy = false } = {}) {
  const text = String(query ?? '').trim();
  if (!text) return 'filter-only';
  if (fuzzy) return 'fuzzy';
  const terms = text.split(/\s+/);
  return terms.every(isShortAlphabeticTerm) ? 'short-word-exact' : 'substring-exact';
}

export function matchesShortWords(content, query) {
  const searchable = normalizeWordSearchText(content);
  return String(query ?? '').trim().split(/\s+/).every((term) => {
    const normalizedTerm = normalizeWordSearchText(term);
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(searchable);
  });
}
