import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTuiArguments, TuiArgumentError } from '../src/tui-arguments.js';
import { FindQueryError } from '../src/find-query.js';
import { parseFindArguments } from '../src/tui-find-arguments.js';
import { parseOpenArguments } from '../src/tui-open-arguments.js';
import { parseInitArguments, parseSaveArguments, parseSkillInstallArguments } from '../src/tui-basic-arguments.js';

function fails(code, action) {
  assert.throws(action, (error) => error instanceof TuiArgumentError && error.code === code);
}

test('generic parser consumes options once and handles help and end-of-options', () => {
  const spec = {
    options: {
      '--name': { key: 'name', type: 'value', valueLabel: 'a name' },
      '--verbose': { key: 'verbose', type: 'boolean' }
    },
    maximumPositionals: 1
  };
  assert.deepEqual(parseTuiArguments(['--name=value', '--verbose', 'query'], spec), {
    help: false, positionals: ['query'], verbose: true, name: 'value'
  });
  assert.deepEqual(parseTuiArguments(['--', '-query'], spec), {
    help: false, positionals: ['-query'], verbose: false
  });
  assert.deepEqual(parseTuiArguments(['--unknown', '--help'], spec), { help: true, positionals: [] });
  fails('unknown_option', () => parseTuiArguments(['--unknown'], spec));
  fails('missing_option_value', () => parseTuiArguments(['--name', '--verbose'], spec));
  fails('unexpected_option_value', () => parseTuiArguments(['--verbose=false'], spec));
  fails('duplicate_option', () => parseTuiArguments(['--name', 'a', '--name=b'], spec));
  fails('extra_positional', () => parseTuiArguments(['one', 'two'], spec));
});

test('find parser supports filter-only searches and rejects ambiguous options', () => {
  assert.equal(parseFindArguments(['--saved-within', 'day']).description, 'saved within day');
  assert.equal(parseFindArguments(['--saved-since=2026-09-01']).description, 'saved since 2026-09-01');
  assert.equal(parseFindArguments(['--saved-within', 'month', 'alpha']).query, 'alpha');
  assert.equal(parseFindArguments(['--', '-alpha']).query, '-alpha');
  assert.equal(parseFindArguments(['alpha', '--help']).help, true);
  fails('unknown_option', () => parseFindArguments(['--pick', '2']));
  fails('duplicate_option', () => parseFindArguments(['--saved-within', 'day', '--saved-within', 'year']));
  fails('conflicting_options', () => parseFindArguments(['--saved-within', 'day', '--saved-since', '2026-09-01']));
  fails('dependent_option', () => parseFindArguments(['alpha', '--with', 'chrome']));
  fails('dependent_option', () => parseFindArguments(['alpha', '--dry-run']));
  fails('conflicting_options', () => parseFindArguments(['alpha', '--browser', '--expand']));
});

test('find and open parsers enforce strict dates and command-specific options', () => {
  for (const date of ['2026-02-29', '2026-02-30', '2026-09', '09/01/2026', '0', '2026-09-01T12:00:00Z', '2026-09-01junk']) {
    assert.throws(() => parseFindArguments(['--saved-since', date]), /valid date/);
  }
  assert.equal(parseOpenArguments(['alpha', '--pick', '2']).pick, '2');
  assert.equal(parseOpenArguments(['alpha', '--help']).help, true);
  fails('missing_query', () => parseOpenArguments(['--saved-within', 'day']));
  fails('invalid_option_value', () => parseOpenArguments(['alpha', '--pick', '0']));
  fails('unknown_option', () => parseOpenArguments(['alpha', '--browser']));
});

test('basic command parsers reject unsupported arguments and honor help', () => {
  assert.equal(parseInitArguments(['--path', '/vault']).path, '/vault');
  assert.equal(parseSaveArguments(['--url=https://example.test']).url, 'https://example.test');
  assert.equal(parseSkillInstallArguments(['--help', '--unknown']).help, true);
  fails('extra_positional', () => parseInitArguments(['unexpected']));
  fails('missing_option', () => parseSaveArguments([]));
  fails('unknown_option', () => parseSkillInstallArguments(['--tags', 'x']));
});

test('seeded parser combinations are deterministic, immutable, and typed', () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const atoms = [
    ['alpha'], [''], ['--saved-within', 'day'], ['--saved-within', 'hour'],
    ['--saved-within'], ['--saved-since', '2026-09-01'], ['--saved-since', 'banana'],
    ['--fuzzy'], ['--expand'], ['--browser'], ['--dry-run'], ['--wat'], ['--pick', '2']
  ];
  for (let run = 0; run < 250; run++) {
    const args = [];
    const count = 1 + Math.floor(random() * 4);
    for (let index = 0; index < count; index++) args.push(...atoms[Math.floor(random() * atoms.length)]);
    const original = [...args];
    const outcome = () => {
      try { return { value: parseFindArguments(args) }; } catch (error) {
        assert.ok(error instanceof TuiArgumentError || error instanceof FindQueryError);
        return { error: { name: error.name, code: error.code, message: error.message } };
      }
    };
    assert.deepEqual(outcome(), outcome());
    assert.deepEqual(args, original);
  }
});
