import { commandPath, vaultPathLines } from './vault-path-display.js';

function quotedPath(root) {
  return `"${commandPath(root).replaceAll('"', '\\"')}"`;
}

export function renderVaultGitHelp(root, {
  full = false,
  initialized = true,
  commandPrefix = 'npm run bookmark --',
  hostRoot
} = {}) {
  const gitRoot = hostRoot || root;
  const git = (arguments_) => `  git -C ${quotedPath(gitRoot)} ${arguments_}`;
  const initialization = initialized
    ? ''
    : `No initialized bookmark vault was found. First run:\n  ${commandPrefix} vault init\n\n`;
  const concise = `${initialization}Bookmark vault Git help

${vaultPathLines(root, { hostRoot }).join('\n')}
This command does not run Git or access the network.

Before saving on this machine:
${git('pull --rebase')}

After saving, review and commit locally:
${git('status --short')}
${git('diff')}
${git('add -A')}
${git('diff --cached --stat')}
${git('commit -m "Add bookmarks"')}

Synchronize the clean committed worktree:
${git('pull --rebase')}
${git('push')}

Review changes before adding and committing them.`;

  if (!full) return `${concise}\nMore help: ${commandPrefix} vault git-help --full`;
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

If pull is blocked by the companion-managed AGENTS.md:
${git('diff -- AGENTS.md')}
Move any personal instructions to AGENTS.local.md and commit that file. If the
remaining AGENTS.md changes are only generated instructions and the incoming
version should win, discard only that managed-file change:
${git('restore --source=HEAD -- AGENTS.md')}
If other local changes remain, commit or stash them before pulling. The
worktree must be clean before pull --rebase. A commit-first recovery is:
${git('add -A')}
${git('diff --cached --stat')}
${git('commit -m "Save local vault changes before pull"')}
${git('pull --rebase')}
Never restore AGENTS.md before reviewing its diff.

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
