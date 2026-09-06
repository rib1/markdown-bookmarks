import { argumentError, parseTuiArguments } from './tui-arguments.js';

const vaultOptions = {
  '--full': { key: 'full', type: 'boolean' },
  '--dry-run': { key: 'dryRun', type: 'boolean' }
};

export function parseVaultArguments(args) {
  const parsed = parseTuiArguments(args, { options: vaultOptions, maximumPositionals: 1 });
  if (parsed.help) return parsed;
  const [action] = parsed.positionals;
  if (!['git-help', 'open'].includes(action)) {
    throw argumentError('invalid_subcommand', 'Usage: npm run bookmark -- vault git-help [--full] | vault open [--dry-run]');
  }
  if (action === 'git-help' && parsed.dryRun) {
    throw argumentError('unsupported_option', '--dry-run is only supported by vault open');
  }
  if (action === 'open' && parsed.full) {
    throw argumentError('unsupported_option', '--full is only supported by vault git-help');
  }
  return { ...parsed, action };
}
