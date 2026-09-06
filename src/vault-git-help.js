function oneLine(value) {
  return String(value).replace(/[\r\n]/g, ' ');
}

function quotedPath(root) {
  return `"${oneLine(root).replaceAll('"', '\\"')}"`;
}

export function renderVaultGitHelp(root, { full = false } = {}) {
  const vault = oneLine(root);
  const git = (arguments_) => `  git -C ${quotedPath(root)} ${arguments_}`;
  const concise = `Bookmark vault Git help

Vault: ${vault}
This command does not run Git or access the network.

Recommended workflow:
${git('status --short')}
${git('pull --rebase')}
${git('add -A')}
${git('diff --cached --stat')}
${git('commit -m "Add bookmarks"')}
${git('push')}

Review changes before adding and committing them.`;

  if (!full) return `${concise}\nMore help: npm run bookmark -- vault git-help --full`;
  return `${concise}

Review details:
${git('diff')}
${git('diff --cached')}

Example commit messages:
  Add 3 bookmarks
  Update bookmark tags and notes
  Add 3 bookmarks and update 2
  Apply vault schema migration

Check the remote explicitly:
${git('fetch')}
${git('status --short --branch')}

Start a new private vault repository:
${git('init -b main')}
${git('add -A')}
${git('commit -m "Initialize bookmark vault"')}
${git('remote add origin <PRIVATE-REPOSITORY-URL>')}
${git('push -u origin main')}

For conflicts, run git status, resolve and add each file, then run
git rebase --continue. Use git rebase --abort to cancel.

Confirm the remote is private. The companion never fetches, pulls, commits, or
pushes automatically.`;
}
