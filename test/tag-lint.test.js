import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTagVocabulary,
  findLikelyTagTypos,
  levenshteinDistance,
  tagDistanceLimit
} from '../src/tag-lint.js';

function record(id, tags) {
  return { id, file: `bookmarks/2026/09/${id}.md`, tags };
}

test('uses case-insensitive plain Levenshtein distance and documented limits', () => {
  assert.equal(levenshteinDistance('Dowload', 'download'), 1);
  assert.equal(levenshteinDistance('ab', 'ba'), 2);
  assert.equal(tagDistanceLimit('download', 'dowload'), 1);
  assert.equal(tagDistanceLimit('wordpress', 'wordpres'), 2);
});

test('builds distinct per-bookmark tag usage counts', () => {
  const vocabulary = buildTagVocabulary([
    record('one', ['WordPress', 'wordpress', 'music']),
    record('two', ['WORDPRESS'])
  ]);
  assert.deepEqual(vocabulary.map(({ tag, count }) => ({ tag, count })), [
    { tag: 'music', count: 1 },
    { tag: 'wordpress', count: 2 }
  ]);
});

test('reports likely typos, harmless near matches, overlap, and deterministic order', () => {
  const records = [
    record('one', ['wordpres', 'wordpress']),
    record('two', ['wordpres']),
    record('three', ['wordpress']),
    record('four', ['wordpress']),
    record('four-b', ['wordpress']),
    record('five', ['hobby']),
    record('six', ['lobby'])
  ];
  const report = findLikelyTagTypos(records);
  assert.deepEqual(report.candidates.map((candidate) => [
    candidate.source?.tag,
    candidate.canonical?.tag,
    candidate.left.tag,
    candidate.right.tag,
    candidate.distance
  ]), [
    [undefined, undefined, 'hobby', 'lobby', 1],
    ['wordpres', 'wordpress', 'wordpres', 'wordpress', 1]
  ]);
  const typo = report.candidates[1];
  assert.equal(typo.left.count, 2);
  assert.equal(typo.right.count, 4);
  assert.deepEqual(typo.overlap.map((item) => item.id), ['one']);
  assert.deepEqual(report.likelyCandidates.map((candidate) => candidate.source.tag), ['wordpres']);
});

test('default candidates retain only conservative frequency and punctuation matches', () => {
  const records = [
    record('punctuated', ['ork.']),
    record('plain', ['ork']),
    record('typo-one', ['wordpres']),
    record('typo-two', ['wordpres']),
    ...Array.from({ length: 4 }, (_, index) => record(`canonical-${index}`, ['wordpress'])),
    record('short-source', ['om']),
    ...Array.from({ length: 4 }, (_, index) => record(`short-target-${index}`, ['oma'])),
    ...Array.from({ length: 4 }, (_, index) => record(`established-source-${index}`, ['color'])),
    ...Array.from({ length: 5 }, (_, index) => record(`established-target-${index}`, ['colour'])),
    record('near-one', ['hobby']),
    record('near-two', ['lobby'])
  ];
  const report = findLikelyTagTypos(records);
  const names = (candidate) => [candidate.left.tag, candidate.right.tag].join('/');

  assert.ok(report.candidates.some((candidate) => names(candidate) === 'hobby/lobby'));
  assert.ok(report.candidates.some((candidate) => names(candidate) === 'om/oma'));
  assert.ok(report.candidates.some((candidate) => names(candidate) === 'color/colour'));
  assert.deepEqual(report.likelyCandidates.map(names), ['ork/ork.', 'wordpres/wordpress']);
  const punctuation = report.likelyCandidates[0];
  assert.equal(punctuation.source.tag, 'ork.');
  assert.equal(punctuation.canonical.tag, 'ork');
});

test('allows two edits only when the longer tag has at least nine characters', () => {
  const report = findLikelyTagTypos([
    record('one', ['abcdefgh']),
    record('two', ['abcdefxy']),
    record('three', ['abcdefghij']),
    record('four', ['abcdefghxy'])
  ]);
  const pairs = report.candidates.map((candidate) => `${candidate.left.tag}/${candidate.right.tag}`);
  assert.ok(pairs.includes('abcdefghij/abcdefghxy'));
  assert.ok(!pairs.includes('abcdefgh/abcdefxy'));
});
