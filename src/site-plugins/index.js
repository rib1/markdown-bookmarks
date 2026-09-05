import github from './github.js';
import youtube from './youtube.js';
import mural from './mural.js';
import confluence from './confluence.js';
import jira from './jira.js';

const plugins = [github, youtube, mural, confluence, jira];

export function applySitePlugins(bookmark) {
  const url = new URL(bookmark.url);
  return plugins.filter((plugin) => plugin.matches(url))
    .reduce((value, plugin) => plugin.apply(value, url), bookmark);
}
