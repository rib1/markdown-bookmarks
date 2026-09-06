export const FIND_USAGE = 'Usage: npm run bookmark -- find QUERY [options]\n'
  + '   or: npm run bookmark -- find --saved-within day|week|month|year\n'
  + '   or: npm run bookmark -- find --saved-since YYYY-MM-DD';

export const SAVED_WITHIN_DAYS = Object.freeze({ day: 1, week: 7, month: 30, year: 365 });

export class FindQueryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FindQueryError';
    this.code = code;
  }
}

function isoDateTimestamp(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return timestamp;
}

function validateTimeFilters(savedWithin, savedSince) {
  if (savedWithin && !Object.hasOwn(SAVED_WITHIN_DAYS, savedWithin)) {
    throw new FindQueryError('invalid_saved_within', '--saved-within must be one of: day, week, month, year');
  }
  if (savedSince && isoDateTimestamp(savedSince) === undefined) {
    throw new FindQueryError('invalid_saved_since', '--saved-since must be a valid date such as 2026-09-04');
  }
}

export function searchCutoff({ savedWithin, savedSince, now = Date.now() } = {}) {
  validateTimeFilters(savedWithin, savedSince);
  if (savedSince) return isoDateTimestamp(savedSince);
  if (savedWithin) return now - SAVED_WITHIN_DAYS[savedWithin] * 86400000;
  return undefined;
}

export function prepareFindRequest({ query = '', savedWithin, savedSince } = {}) {
  query = String(query).trim();
  validateTimeFilters(savedWithin, savedSince);
  if (!query && !savedWithin && !savedSince) throw new FindQueryError('missing_query_or_time_filter', FIND_USAGE);
  const description = query || (savedSince ? `saved since ${savedSince}` : `saved within ${savedWithin}`);
  return { query, savedWithin, savedSince, description };
}
