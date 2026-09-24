import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectArguments } from '../src/tui-project-arguments.js';

test('parses project commands and rejects incompatible options', () => {
  assert.deepEqual(parseProjectArguments(['create', '--title', 'Talk', '--id=talk']), {
    help: false, positionals: ['create'], title: 'Talk', id: 'talk', action: 'create', noteAction: undefined, project: undefined, bookmark: undefined,
    dryRun: false
  });
  assert.deepEqual(parseProjectArguments(['open', 'talk', '--dry-run']), {
    help: false, positionals: ['open', 'talk'], dryRun: true, action: 'open', noteAction: undefined, project: 'talk', bookmark: undefined
  });
  assert.throws(() => parseProjectArguments(['add', 'talk']), /requires a bookmark ID/);
  assert.throws(() => parseProjectArguments(['move', 'talk', 'bookmark']), /--to NUMBER/);
  assert.deepEqual(parseProjectArguments(['note', 'add', 'talk', 'bookmark', '--note', 'Cue']), {
    help: false, positionals: ['note', 'add', 'talk', 'bookmark'], note: 'Cue', dryRun: false,
    action: 'note', noteAction: 'add', project: 'talk', bookmark: 'bookmark'
  });
  assert.deepEqual(parseProjectArguments(['note', 'remove', 'talk', 'bookmark', '--pick', '2']), {
    help: false, positionals: ['note', 'remove', 'talk', 'bookmark'], pick: '2', dryRun: false,
    action: 'note', noteAction: 'remove', project: 'talk', bookmark: 'bookmark'
  });
  assert.throws(() => parseProjectArguments(['note', 'add', 'talk', 'bookmark']), /--note TEXT/);
  assert.throws(() => parseProjectArguments(['list', '--dry-run']), /only supported by project open/);
  assert.throws(() => parseProjectArguments(['show', 'talk', 'extra']), /Unexpected extra argument/);
});
