import { readList, readScalar } from './bookmark-format.js';

const scalarFields = [
  ['title', 1],
  ['id', 1],
  ['issue_key', 1],
  ['project_key', 0.95],
  ['repository', 0.95],
  ['video_id', 0.95],
  ['space_key', 0.95],
  ['page_id', 0.95],
  ['author', 0.85],
  ['site', 0.85],
  ['type', 0.8],
  ['url', 0.75],
  ['canonical_url', 0.75]
];

const listFields = [
  ['tags', 0.95],
  ['contexts', 0.9],
  ['areas', 0.9],
  ['projects', 0.9],
  ['events', 0.9]
];

export function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function tokens(value) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(/\s+/) : [];
}

export function damerauLevenshtein(leftValue, rightValue) {
  const left = [...normalizeSearchText(leftValue)];
  const right = [...normalizeSearchText(rightValue)];
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let row = 0; row <= left.length; row++) rows[row][0] = row;
  for (let column = 0; column <= right.length; column++) rows[0][column] = column;
  for (let row = 1; row <= left.length; row++) {
    for (let column = 1; column <= right.length; column++) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + substitution
      );
      if (row > 1 && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
      }
    }
  }
  return rows[left.length][right.length];
}

function tokenSimilarity(queryToken, candidateToken) {
  if (queryToken === candidateToken) return 1;
  const shortest = Math.min(queryToken.length, candidateToken.length);
  if (shortest < 3) return 0;
  if (queryToken.startsWith(candidateToken) || candidateToken.startsWith(queryToken)) {
    return Math.max(0.78, 0.9 - Math.abs(queryToken.length - candidateToken.length) * 0.02);
  }
  if (shortest >= 4 && (queryToken.includes(candidateToken) || candidateToken.includes(queryToken))) return 0.8;
  const longest = Math.max(queryToken.length, candidateToken.length);
  return 1 - damerauLevenshtein(queryToken, candidateToken) / longest;
}

function frontmatterValues(content) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '';
  return frontmatter.split(/\r?\n/).map((line) => {
    const listValue = line.match(/^\s*-\s+(.*)$/)?.[1];
    if (listValue !== undefined) return listValue;
    return line.match(/^[^:]+:\s*(.*)$/)?.[1] || '';
  }).join(' ');
}

function markdownBody(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}

function searchableFields(content) {
  return [
    ...scalarFields.map(([name, weight]) => ({ name, weight, value: readScalar(content, name) })),
    ...listFields.map(([name, weight]) => ({ name, weight, value: readList(content, name).join(' ') })),
    { name: 'metadata', weight: 0.7, value: frontmatterValues(content) },
    { name: 'body', weight: 0.65, value: markdownBody(content) }
  ].filter((field) => field.value !== undefined && String(field.value).trim());
}

function requiredSimilarity(token) {
  if (token.length <= 2) return 1;
  if (token.length <= 4) return 0.75;
  return 0.7;
}

export function fuzzyBookmarkMatch(query, content) {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return undefined;
  const fields = searchableFields(content).map((field) => ({ ...field, tokens: tokens(field.value) }));
  const matches = queryTokens.map((queryToken) => {
    let best = { similarity: 0, weightedScore: 0, field: undefined };
    for (const field of fields) {
      for (const candidateToken of field.tokens) {
        const similarity = tokenSimilarity(queryToken, candidateToken);
        const weightedScore = similarity * field.weight;
        if (weightedScore > best.weightedScore
          || (weightedScore === best.weightedScore && similarity > best.similarity)) {
          best = { similarity, weightedScore, field: field.name };
        }
      }
    }
    return { queryToken, ...best };
  });
  if (matches.some((match) => match.similarity < requiredSimilarity(match.queryToken))) return undefined;
  const score = matches.reduce((total, match) => total + match.weightedScore, 0) / matches.length;
  return {
    score: Math.round(score * 1000) / 1000,
    fields: [...new Set(matches.map((match) => match.field).filter(Boolean))]
  };
}
