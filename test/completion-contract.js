// Generate expectations from the live parsers, not a second hand-maintained option list.
// Runs only when building the PowerShell test image, never on the developer host.
import assert from 'node:assert/strict';
import { TUI_COMMANDS } from '../src/tui-arguments.js';
import { options as findOptions, parseFindArguments } from '../src/tui-find-arguments.js';
import { options as openOptions, parseOpenArguments } from '../src/tui-open-arguments.js';
import { saveOptions, parseSaveArguments } from '../src/tui-basic-arguments.js';
import { VAULT_COMMANDS, vaultOptions, parseVaultArguments } from '../src/tui-vault-arguments.js';
import {
  PROJECT_COMMANDS, PROJECT_NOTE_COMMANDS, options as projectOptions, parseProjectArguments
} from '../src/tui-project-arguments.js';
import { SAVED_WITHIN_DAYS } from '../src/find-query.js';
import { BROWSER_ALIASES } from '../src/browser-launcher.js';

const samples = {
  '--url': 'https://example.test/page', '--saved-within': Object.keys(SAVED_WITHIN_DAYS)[0],
  '--saved-since': '2026-01-01', '--pick': '1', '--to': '1', '--with': 'firefox'
};
const cases = [];
function add(command, parse, definitions, args, variants = []) {
  parse(args); // Every fixture must remain valid as parser requirements change.
  cases.push({ command, parse, definitions, variants: [args, ...variants] });
}
add('find', parseFindArguments, findOptions, ['query'], [['query', '--browser'], ['query', '--expand']]);
add('open', parseOpenArguments, openOptions, ['query']);
add('save', parseSaveArguments, saveOptions, ['--url', samples['--url']]);
for (const action of VAULT_COMMANDS) {
  const args = action === 'tag-fix' ? [action, '--from', 'old', '--to', 'new'] : [action];
  add(`vault ${action}`, parseVaultArguments, vaultOptions, args);
}
const projectArgs = {
  create: ['create', '--title', 'Example'], list: ['list'], show: ['show', 'project'],
  add: ['add', 'project', 'bookmark'], remove: ['remove', 'project', 'bookmark'],
  move: ['move', 'project', 'bookmark', '--to', '1'],
  note: ['note', 'project', 'bookmark', '--note', 'Example'], open: ['open', 'project']
};
for (const action of PROJECT_COMMANDS) {
  assert.ok(projectArgs[action], `Add a completion contract fixture for project ${action}`);
  add(`project ${action}`, parseProjectArguments, projectOptions, projectArgs[action]);
}
const noteArgs = {
  add: ['note', 'add', 'project', 'bookmark', '--note', 'Example'],
  remove: ['note', 'remove', 'project', 'bookmark', '--pick', '1']
};
for (const action of PROJECT_NOTE_COMMANDS) {
  assert.ok(noteArgs[action], `Add a completion contract fixture for project note ${action}`);
  add(`project note ${action}`, parseProjectArguments, projectOptions, noteArgs[action]);
}

function accepts(parse, args) {
  try { parse(args); return true; } catch (error) {
    assert.ok(error.code, `Unexpected parser failure: ${error.message}`);
    return false;
  }
}
function flagArgs(flag, definitions) {
  return definitions[flag].type === 'value' ? [flag, samples[flag] || 'example'] : [flag];
}
function withoutFlag(args, flag, definitions) {
  const result = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === flag) {
      if (definitions[flag].type === 'value') index++;
    } else result.push(args[index]);
  }
  return result;
}
const options = {};
const completionCases = [];
for (const { command, parse, definitions, variants } of cases) {
  const flags = Object.keys(definitions);
  options[command] = flags.filter((flag) => variants.some((args) =>
    accepts(parse, [...withoutFlag(args, flag, definitions), ...flagArgs(flag, definitions)])));
  for (const args of variants) {
    const expected = flags.filter((flag) => !args.includes(flag) && accepts(parse, [...args, ...flagArgs(flag, definitions)]));
    const root = command.split(' ')[0];
    const cliArgs = root === 'vault' || root === 'project' ? [root, ...args] : [command, ...args];
    completionCases.push({ line: `bookmark ${cliArgs.join(' ')} -`, expected: [...expected, '--help', '-h'] });
  }
}
const definitions = [findOptions, openOptions, saveOptions, vaultOptions, projectOptions];
const valueOptions = [...new Set(definitions.flatMap((table) => Object.entries(table)
  .filter(([, definition]) => definition.type === 'value').map(([flag]) => flag)))];

console.log(JSON.stringify({
  commands: TUI_COMMANDS, vaultCommands: VAULT_COMMANDS, projectCommands: PROJECT_COMMANDS,
  noteCommands: PROJECT_NOTE_COMMANDS, options, valueOptions, completionCases,
  periods: Object.keys(SAVED_WITHIN_DAYS),
  browsers: Object.fromEntries(['win32', 'linux', 'darwin'].map((platform) =>
    [platform, Object.keys(BROWSER_ALIASES).filter((name) => BROWSER_ALIASES[name][platform])]))
}));
