import test from 'node:test';
import assert from 'node:assert/strict';
import {
  directoryCommand,
  formatDirectoryCommand,
  hostDirectoryCommands
} from '../src/vault-directory-launcher.js';

test('selects native file-explorer commands without launching them', () => {
  assert.deepEqual(directoryCommand('C:\\Vault', 'win32'), {
    command: 'explorer.exe', args: ['C:\\Vault']
  });
  assert.deepEqual(directoryCommand('/vault', 'darwin'), { command: 'open', args: ['/vault'] });
  assert.deepEqual(directoryCommand('/vault', 'linux'), { command: 'xdg-open', args: ['/vault'] });
  assert.equal(formatDirectoryCommand('/Users/example/My Vault', 'darwin'),
    'open "/Users/example/My Vault"');
});

test('prints suitable host commands when running in Docker', () => {
  assert.deepEqual(hostDirectoryCommands('C:\\Users\\example\\Vault'),
    ['explorer.exe "C:\\Users\\example\\Vault"']);
  assert.deepEqual(hostDirectoryCommands('/Users/example/Vault'), [
    'macOS: open "/Users/example/Vault"',
    'Linux: xdg-open "/Users/example/Vault"'
  ]);
});
