import { prepareFindRequest } from './find-query.js';
import { argumentError, parseTuiArguments } from './tui-arguments.js';

export const OPEN_USAGE = 'Usage: npm run bookmark -- open QUERY [options]';

const options = {
  '--pick': { key: 'pick', type: 'value', valueLabel: 'a positive result number' },
  '--saved-within': { key: 'savedWithin', type: 'value', valueLabel: 'day, week, month, or year' },
  '--saved-since': { key: 'savedSince', type: 'value', valueLabel: 'YYYY-MM-DD' },
  '--fuzzy': { key: 'fuzzy', type: 'boolean' },
  '--with': { key: 'withBrowser', type: 'value', valueLabel: 'a browser name or executable' },
  '--dry-run': { key: 'dryRun', type: 'boolean' }
};

export function parseOpenArguments(args) {
  const parsed = parseTuiArguments(args, { options, maximumPositionals: 1 });
  if (parsed.help) return parsed;
  const query = String(parsed.positionals[0] || '').trim();
  if (!query) throw argumentError('missing_query', OPEN_USAGE);
  if (parsed.savedWithin && parsed.savedSince) {
    throw argumentError('conflicting_options', 'Use either --saved-within or --saved-since, not both');
  }
  if (parsed.pick !== undefined && !/^[1-9]\d*$/.test(parsed.pick)) {
    throw argumentError('invalid_option_value', '--pick requires a positive whole number');
  }
  let request;
  try {
    request = prepareFindRequest({ query, savedWithin: parsed.savedWithin, savedSince: parsed.savedSince });
  } catch (error) {
    if (error.code === 'missing_query_or_time_filter') throw argumentError('missing_query', OPEN_USAGE);
    throw error;
  }
  return { ...parsed, ...request };
}
