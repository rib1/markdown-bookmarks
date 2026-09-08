import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVaultGitHelp } from '../src/vault-git-help.js';

test('renders concise copyable Git help without remote details', () => {
  const output = renderVaultGitHelp('C:\\Users\\Example User\\bookmarks');
  assert.match(output, /git -C "C:\\Users\\Example User\\bookmarks" status --short/);
  assert.match(output, /pull --rebase/);
  assert.match(output, /commit -m "Add bookmarks"/);
  assert.match(output, /Before saving on this machine/);
  assert.match(output, /Synchronize the clean committed worktree/);
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
  assert.match(output, /If pull is blocked by the companion-managed AGENTS\.md/);
  assert.match(output, /diff -- AGENTS\.md/);
  assert.match(output, /Move any personal instructions to AGENTS\.local\.md and commit that file/);
  assert.match(output, /restore --source=HEAD -- AGENTS\.md/);
  assert.match(output, /worktree must be clean before pull --rebase/);
  assert.match(output, /commit -m "Save local vault changes before pull"/);
  assert.match(output, /Never restore AGENTS\.md before reviewing its diff/);
  assert.match(output, /never fetches, pulls, commits, or\npushes automatically/);
});

test('keeps injected vault paths on one output line', () => {
  const output = renderVaultGitHelp('/vault\nmisleading command');
  assert.doesNotMatch(output, /Vault: \/vault\n/);
  assert.match(output, /Vault: \/vault misleading command/);
});

test('renders Docker help with host Git paths and container CLI commands', () => {
  const output = renderVaultGitHelp('/vault', {
    commandPrefix: 'docker compose exec bookmarkd node src/cli.js',
    hostRoot: 'C:\\Users\\Example User\\bookmarks'
  });
  assert.match(output, /Vault \(host\): C:\\Users\\Example User\\bookmarks/);
  assert.match(output, /Vault \(container\): \/vault/);
  assert.match(output, /git -C "C:\\Users\\Example User\\bookmarks" status --short/);
  assert.match(output, /More help: docker compose exec bookmarkd node src\/cli\.js vault git-help --full/);
  assert.doesNotMatch(output, /git -C "\/vault"/);
});

test('puts initialization first when no vault is present', () => {
  const output = renderVaultGitHelp('/new-vault', { initialized: false });
  assert.match(output, /^No initialized bookmark vault was found\. First run:/);
  assert.match(output, /npm run bookmark -- vault init/);
});
