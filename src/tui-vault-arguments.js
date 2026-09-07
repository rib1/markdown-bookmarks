import { argumentError, parseTuiArguments } from './tui-arguments.js';

const vaultOptions = {
  '--full': { key: 'full', type: 'boolean' },
  '--dry-run': { key: 'dryRun', type: 'boolean' },
  '--path': { key: 'path', type: 'value', valueLabel: 'a vault path' },
  '--no-skill': { key: 'noSkill', type: 'boolean' },
  '--check': { key: 'check', type: 'boolean' },
  '--from': { key: 'from', type: 'value', valueLabel: 'a source tag' },
  '--to': { key: 'to', type: 'value', valueLabel: 'a canonical tag' },
  '--apply': { key: 'apply', type: 'boolean' }
};

export function parseVaultArguments(args) {
  const parsed = parseTuiArguments(args, { options: vaultOptions, maximumPositionals: 1 });
  if (parsed.help) return parsed;
  const [action] = parsed.positionals;
  if (!['init', 'git-help', 'open', 'tag-lint', 'tag-fix'].includes(action)) {
    throw argumentError('invalid_subcommand', 'Usage: npm run bookmark -- vault COMMAND [options]. Run vault --help.');
  }
  if (!['git-help', 'tag-lint'].includes(action) && parsed.full) {
    throw argumentError('unsupported_option', '--full is only supported by vault git-help and vault tag-lint');
  }
  if (action !== 'open' && parsed.dryRun) {
    throw argumentError('unsupported_option', '--dry-run is only supported by vault open');
  }
  if (action !== 'init' && parsed.path) {
    throw argumentError('unsupported_option', '--path is only supported by vault init');
  }
  if (action !== 'init' && parsed.noSkill) {
    throw argumentError('unsupported_option', '--no-skill is only supported by vault init');
  }
  if (action !== 'tag-lint' && parsed.check) {
    throw argumentError('unsupported_option', '--check is only supported by vault tag-lint');
  }
  if (action !== 'tag-fix' && (parsed.from || parsed.to || parsed.apply)) {
    throw argumentError('unsupported_option', '--from, --to, and --apply are only supported by vault tag-fix');
  }
  if (action === 'tag-fix' && (!parsed.from || !parsed.to)) {
    throw argumentError('missing_option', 'Usage: npm run bookmark -- vault tag-fix --from TAG --to TAG [--apply]');
  }
  return { ...parsed, action };
}
