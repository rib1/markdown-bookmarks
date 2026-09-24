import { argumentError, parseTuiArguments } from './tui-arguments.js';

const options = {
  '--title': { key: 'title', type: 'value', valueLabel: 'a project title' },
  '--id': { key: 'id', type: 'value', valueLabel: 'a stable project ID' },
  '--status': { key: 'status', type: 'value', valueLabel: 'a status' },
  '--contexts': { key: 'contexts', type: 'value', valueLabel: 'comma-separated contexts' },
  '--tags': { key: 'tags', type: 'value', valueLabel: 'comma-separated tags' },
  '--purpose': { key: 'purpose', type: 'value', valueLabel: 'a purpose' },
  '--notes': { key: 'notes', type: 'value', valueLabel: 'presenter notes' },
  '--note': { key: 'note', type: 'value', valueLabel: 'a bookmark note' },
  '--pick': { key: 'pick', type: 'value', valueLabel: 'a note number' },
  '--to': { key: 'to', type: 'value', valueLabel: 'a position number' },
  '--with': { key: 'withBrowser', type: 'value', valueLabel: 'a browser name or executable' },
  '--dry-run': { key: 'dryRun', type: 'boolean' }
};

export function parseProjectArguments(args) {
  const parsed = parseTuiArguments(args, { options, maximumPositionals: 4 });
  if (parsed.help) return parsed;
  const [action, first, second, third] = parsed.positionals;
  if (!['create', 'list', 'show', 'add', 'remove', 'move', 'note', 'open'].includes(action)) {
    throw argumentError('invalid_subcommand', 'Usage: npm run bookmark -- project COMMAND [options]. Run project --help.');
  }
  if ((action === 'list' || action === 'create') && first) {
    throw argumentError('extra_positional', `Unexpected extra argument: ${JSON.stringify(first)}`);
  }
  if (['show', 'open'].includes(action) && second) {
    throw argumentError('extra_positional', `Unexpected extra argument: ${JSON.stringify(second)}`);
  }
  const noteAction = action === 'note' && ['add', 'remove'].includes(first) ? first : undefined;
  if (action === 'note' && !noteAction && third) {
    throw argumentError('extra_positional', `Unexpected extra argument: ${JSON.stringify(third)}`);
  }
  const project = noteAction ? second : first;
  const bookmark = noteAction ? third : second;
  const requiresProject = ['show', 'add', 'remove', 'move', 'note', 'open'].includes(action);
  if (requiresProject && !project) throw argumentError('missing_argument', `project ${action} requires a project ID`);
  if (['add', 'remove', 'move', 'note'].includes(action) && !bookmark) {
    throw argumentError('missing_argument', `project ${action} requires a bookmark ID`);
  }
  if (action === 'create' && !parsed.title) throw argumentError('missing_option', 'Usage: npm run bookmark -- project create --title TITLE [options]');
  if (action === 'move' && !parsed.to) throw argumentError('missing_option', 'Usage: npm run bookmark -- project move PROJECT BOOKMARK --to NUMBER');
  if (action === 'note' && !noteAction && parsed.note === undefined) throw argumentError('missing_option', 'Usage: npm run bookmark -- project note add PROJECT BOOKMARK --note TEXT');
  if (action === 'note' && noteAction === 'add' && parsed.note === undefined) throw argumentError('missing_option', 'Usage: npm run bookmark -- project note add PROJECT BOOKMARK --note TEXT');
  if (action === 'note' && noteAction === 'remove' && parsed.pick === undefined) throw argumentError('missing_option', 'Usage: npm run bookmark -- project note remove PROJECT BOOKMARK --pick NUMBER');
  if (action !== 'move' && parsed.to) throw argumentError('unsupported_option', '--to is only supported by project move');
  if (!['add', 'note'].includes(action) && parsed.note !== undefined) throw argumentError('unsupported_option', '--note is only supported by project add and project note');
  if (!(action === 'note' && noteAction === 'remove') && parsed.pick !== undefined) throw argumentError('unsupported_option', '--pick is only supported by project note remove');
  if (action !== 'open' && (parsed.withBrowser || parsed.dryRun)) throw argumentError('unsupported_option', '--with and --dry-run are only supported by project open');
  if (action !== 'create' && (parsed.title || parsed.id || parsed.status || parsed.contexts || parsed.tags || parsed.purpose || parsed.notes)) {
    throw argumentError('unsupported_option', 'Create options are only supported by project create');
  }
  return { ...parsed, action, noteAction: noteAction || (action === 'note' ? 'add' : undefined), project, bookmark };
}
