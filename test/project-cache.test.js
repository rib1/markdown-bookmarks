import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedProjects } from '../extension/project-cache.js';

test('uses the cached project list until its refresh interval expires', async () => {
  const data = {};
  const storage = {
    async get(keys) { return Object.fromEntries(keys.map((key) => [key, data[key]])); },
    async set(values) { Object.assign(data, values); }
  };
  let calls = 0;
  const fetchProjects = async () => {
    calls++;
    return [{ id: 'talk', title: 'Talk', status: 'active' }];
  };
  const first = await cachedProjects({ storage, fetchProjects, now: () => 1000, ttl: 100 });
  const second = await cachedProjects({ storage, fetchProjects, now: () => 1050, ttl: 100 });
  const third = await cachedProjects({ storage, fetchProjects, now: () => 1100, ttl: 100 });
  const forced = await cachedProjects({ storage, fetchProjects, now: () => 1101, ttl: 100, force: true });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(third.cached, false);
  assert.equal(forced.cached, false);
  assert.equal(calls, 3);
});
