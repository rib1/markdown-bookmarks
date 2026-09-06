import { prepareFindRequest } from './find-query.js';
import { argumentError, parseTuiArguments } from './tui-arguments.js';

const options = {
  '--saved-within': { key: 'savedWithin', type: 'value', valueLabel: 'day, week, month, or year' },
  '--saved-since': { key: 'savedSince', type: 'value', valueLabel: 'YYYY-MM-DD' },
  '--fuzzy': { key: 'fuzzy', type: 'boolean' },
  '--expand': { key: 'expand', type: 'boolean' },
  '--browser': { key: 'browser', type: 'boolean' },
  '--with': { key: 'withBrowser', type: 'value', valueLabel: 'a browser name or executable' },
  '--dry-run': { key: 'dryRun', type: 'boolean' }
};

export function parseFindArguments(args) {
  const parsed = parseTuiArguments(args, { options, maximumPositionals: 1 });
  if (parsed.help) return parsed;
  if (parsed.savedWithin && parsed.savedSince) {
    throw argumentError('conflicting_options', 'Use either --saved-within or --saved-since, not both');
  }
  if (parsed.withBrowser && !parsed.browser) {
    throw argumentError('dependent_option', '--with requires --browser for find');
  }
  if (parsed.dryRun && !parsed.browser) {
    throw argumentError('dependent_option', '--dry-run requires --browser for find');
  }
  if (parsed.expand && parsed.browser) {
    throw argumentError('conflicting_options', 'Use either --expand or --browser, not both');
  }
  const request = prepareFindRequest({
    query: parsed.positionals[0], savedWithin: parsed.savedWithin, savedSince: parsed.savedSince
  });
  return { ...parsed, ...request };
}
