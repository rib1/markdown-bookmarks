import { argumentError, parseTuiArguments } from './tui-arguments.js';

const initOptions = {
  '--path': { key: 'path', type: 'value', valueLabel: 'a vault path' },
  '--no-skill': { key: 'noSkill', type: 'boolean' }
};
const saveOptions = {
  '--url': { key: 'url', type: 'value', valueLabel: 'a URL' },
  '--title': { key: 'title', type: 'value', valueLabel: 'a title' },
  '--tags': { key: 'tags', type: 'value', valueLabel: 'a comma-separated tag list' },
  '--shared-by': { key: 'sharedBy', type: 'value', valueLabel: 'a sender name' },
  '--via': { key: 'via', type: 'value', valueLabel: 'a channel' }
};
const skillOptions = {
  '--path': { key: 'path', type: 'value', valueLabel: 'a vault path' }
};

export function parseInitArguments(args) {
  return parseTuiArguments(args, { options: initOptions });
}

export function parseSaveArguments(args) {
  const parsed = parseTuiArguments(args, { options: saveOptions });
  if (!parsed.help && !parsed.url) {
    throw argumentError('missing_option', 'Usage: npm run bookmark -- save --url URL [options]');
  }
  return parsed;
}

export function parseSkillInstallArguments(args) {
  return parseTuiArguments(args, { options: skillOptions });
}
