import test from 'node:test';
import assert from 'node:assert/strict';
import { FIND_USAGE, FindQueryError, prepareFindRequest, searchCutoff } from '../src/find-query.js';

test('allows an omitted term only with a valid time filter', () => {
  assert.deepEqual(prepareFindRequest({ savedWithin: 'day' }), {
    query: '', savedWithin: 'day', savedSince: undefined, description: 'saved within day'
  });
  assert.deepEqual(prepareFindRequest({ savedSince: '2026-09-01' }), {
    query: '', savedWithin: undefined, savedSince: '2026-09-01', description: 'saved since 2026-09-01'
  });
  assert.throws(() => prepareFindRequest(), (error) =>
    error instanceof FindQueryError && error.code === 'missing_query_or_time_filter'
      && new RegExp(FIND_USAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(error.message));
});

test('preserves terms and rejects invalid time filters', () => {
  assert.deepEqual(prepareFindRequest({ query: '  amiga  ', savedWithin: 'week' }), {
    query: 'amiga', savedWithin: 'week', savedSince: undefined, description: 'amiga'
  });
  assert.throws(() => prepareFindRequest({ savedWithin: 'hour' }), (error) => error.code === 'invalid_saved_within');
  assert.throws(() => prepareFindRequest({ savedSince: 'not-a-date' }), (error) => error.code === 'invalid_saved_since');
});

test('calculates time cutoffs with an injected clock', () => {
  const now = Date.parse('2026-09-06T12:00:00.000Z');
  assert.equal(searchCutoff({ savedWithin: 'day', now }), Date.parse('2026-09-05T12:00:00.000Z'));
  assert.equal(searchCutoff({ savedWithin: 'week', now }), Date.parse('2026-08-30T12:00:00.000Z'));
  assert.equal(searchCutoff({ savedSince: '2026-09-01', now }), Date.parse('2026-09-01'));
  assert.equal(searchCutoff({ now }), undefined);
});
