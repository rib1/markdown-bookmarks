import github from './github.js';
import youtube from './youtube.js';
import mural from './mural.js';
import confluence from './confluence.js';
import jira from './jira.js';
import bandcamp from './bandcamp.js';

const plugins = [github, youtube, mural, confluence, jira, bandcamp];

export function applySitePlugins(bookmark) {
  const url = new URL(bookmark.url);
  return plugins.filter((plugin) => plugin.matches(url))
    .reduce((value, plugin) => plugin.apply(value, url), bookmark);
}
