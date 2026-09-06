import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVaultGitHelp } from '../src/vault-git-help.js';

test('renders concise copyable Git help without remote details', () => {
  const output = renderVaultGitHelp('C:\\Users\\Example User\\bookmarks');
  assert.match(output, /git -C "C:\\Users\\Example User\\bookmarks" status --short/);
  assert.match(output, /pull --rebase/);
  assert.match(output, /commit -m "Add bookmarks"/);
  assert.match(output, /vault git-help --full/);
  assert.doesNotMatch(output, /remote add|rebase --continue|https?:\/\//);
});

test('full Git help adds advanced guidance and safe examples', () => {
  const output = renderVaultGitHelp('/Users/example/My Bookmarks', { full: true });
  assert.match(output, /git -C "\/Users\/example\/My Bookmarks" fetch/);
  assert.match(output, /init -b main/);
  assert.match(output, /PRIVATE-REPOSITORY-URL/);
  assert.match(output, /Add 3 bookmarks and update 2/);
  assert.match(output, /rebase --continue/);
  assert.match(output, /never fetches, pulls, commits, or\npushes automatically/);
});

test('keeps injected vault paths on one output line', () => {
  const output = renderVaultGitHelp('/vault\nmisleading command');
  assert.doesNotMatch(output, /Vault: \/vault\n/);
  assert.match(output, /Vault: \/vault misleading command/);
});

test('puts initialization first when no vault is present', () => {
  const output = renderVaultGitHelp('/new-vault', { initialized: false });
  assert.match(output, /^No initialized bookmark vault was found\. First run:/);
  assert.match(output, /npm run bookmark -- vault init/);
});
