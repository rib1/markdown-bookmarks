import test from 'node:test';
import assert from 'node:assert/strict';
import { damerauLevenshtein, fuzzyBookmarkMatch, normalizeSearchText } from '../src/fuzzy-search.js';
import { sortSearchResults } from '../src/search-result-order.js';

function bookmark({ title, tags = [], contexts = [], body = '', extra = '' }) {
  const list = (values) => values.length
    ? values.map((value) => `  - ${JSON.stringify(value)}`).join('\n')
    : '  []';
  return `---
id: test-bookmark
url: "https://example.test/page"
title: ${JSON.stringify(title)}
tags:
${list(tags)}
contexts:
${list(contexts)}
${extra}---

${body}
`;
}

test('normalizes Unicode and measures edits including adjacent transpositions', () => {
  assert.equal(normalizeSearchText('  Café—TRAVEL! '), 'cafe travel');
  assert.equal(damerauLevenshtein('triper', 'tripper'), 1);
  assert.equal(damerauLevenshtein('amgia', 'amiga'), 1);
});

test('matches typos across weighted bookmark fields and requires every query term', () => {
  const content = bookmark({
    title: 'Tripper travel planning',
    tags: ['itinerary'],
    contexts: ['personal'],
    body: 'Ferry details and packing notes.'
  });
  const titleMatch = fuzzyBookmarkMatch('triper planing', content);
  assert.ok(titleMatch);
  assert.ok(titleMatch.score > 0.8);
  assert.deepEqual(titleMatch.fields, ['title']);
  assert.equal(fuzzyBookmarkMatch('triper quantum', content), undefined);
});

test('uses strict short-query thresholds and avoids unrelated fuzzy results', () => {
  const content = bookmark({ title: 'API design', body: 'Database reference material.' });
  assert.equal(fuzzyBookmarkMatch('ai', content), undefined);
  assert.equal(fuzzyBookmarkMatch('orchestra', content), undefined);
  assert.ok(fuzzyBookmarkMatch('databse', content));
});

test('weights title matches above body matches and sorts scores deterministically', () => {
  const titleContent = bookmark({ title: 'Tripper guide' });
  const bodyContent = bookmark({ title: 'Holiday notes', body: 'A tripper guide.' });
  const titleMatch = fuzzyBookmarkMatch('triper', titleContent);
  const bodyMatch = fuzzyBookmarkMatch('triper', bodyContent);
  assert.ok(titleMatch.score > bodyMatch.score);

  const sorted = sortSearchResults([
    { file: 'alpha.md', content: bodyContent, matchScore: bodyMatch.score },
    { file: 'beta.md', content: titleContent, matchScore: titleMatch.score }
  ]);
  assert.equal(sorted[0].file, 'beta.md');
});

test('matches sender names inside structured share history', () => {
  const content = bookmark({
    title: 'Database notes',
    extra: 'share_history:\n  - {"id":"one","sender":"Charlotte","channel":"Signal"}\n'
  });
  const match = fuzzyBookmarkMatch('Charlote', content);
  assert.ok(match);
  assert.deepEqual(match.fields, ['shared_by']);
});

test('matches device labels inside structured capture history', () => {
  const content = bookmark({
    title: 'Database notes',
    extra: 'capture_history:\n  - {"id":"one","device":"work-windows","os":"win"}\n'
  });
  const match = fuzzyBookmarkMatch('work-widnows', content);
  assert.ok(match);
  assert.deepEqual(match.fields, ['capture_source']);
});
