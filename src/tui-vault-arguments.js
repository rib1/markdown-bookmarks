import { argumentError, parseTuiArguments } from './tui-arguments.js';

export const VAULT_COMMANDS = Object.freeze(['init', 'skill-install', 'status', 'git-help', 'open', 'tag-lint', 'tag-fix', 'dedupe']);

export const vaultOptions = {
  '--git': { key: 'git', type: 'boolean' },
  '--full': { key: 'full', type: 'boolean' },
  '--dry-run': { key: 'dryRun', type: 'boolean' },
  '--path': { key: 'path', type: 'value', valueLabel: 'a vault path' },
  '--check': { key: 'check', type: 'boolean' },
  '--from': { key: 'from', type: 'value', valueLabel: 'a source tag' },
  '--to': { key: 'to', type: 'value', valueLabel: 'a canonical tag' },
  '--apply': { key: 'apply', type: 'boolean' }
};

export function parseVaultArguments(args) {
  const parsed = parseTuiArguments(args, { options: vaultOptions, maximumPositionals: 1 });
  if (parsed.help) return parsed;
  const [action] = parsed.positionals;
  if (!VAULT_COMMANDS.includes(action)) {
    throw argumentError('invalid_subcommand', 'Usage: npm run bookmark -- vault COMMAND [options]. Run vault --help.');
  }
  if (action !== 'init' && parsed.git) {
    throw argumentError('unsupported_option', '--git is only supported by vault init');
  }
  if (!['git-help', 'tag-lint'].includes(action) && parsed.full) {
    throw argumentError('unsupported_option', '--full is only supported by vault git-help and vault tag-lint');
  }
  if (action !== 'open' && parsed.dryRun) {
    throw argumentError('unsupported_option', '--dry-run is only supported by vault open');
  }
  if (!['init', 'skill-install'].includes(action) && parsed.path) {
    throw argumentError('unsupported_option', '--path is only supported by vault init and vault skill-install');
  }
  if (!['tag-lint', 'dedupe'].includes(action) && parsed.check) {
    throw argumentError('unsupported_option', '--check is only supported by vault tag-lint and vault dedupe');
  }
  if (action !== 'tag-fix' && (parsed.from || parsed.to)) {
    throw argumentError('unsupported_option', '--from, --to, and --apply are only supported by vault tag-fix');
  }
  if (!['tag-fix', 'dedupe'].includes(action) && parsed.apply) {
    throw argumentError('unsupported_option', '--from, --to, and --apply are only supported by vault tag-fix and vault dedupe');
  }
  if (action === 'dedupe' && parsed.check && parsed.apply) {
    throw argumentError('conflicting_options', 'Use either --check or --apply, not both');
  }
  if (action === 'tag-fix' && (!parsed.from || !parsed.to)) {
    throw argumentError('missing_option', 'Usage: npm run bookmark -- vault tag-fix --from TAG --to TAG [--apply]');
  }
  return { ...parsed, action };
}
