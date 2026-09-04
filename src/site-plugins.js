const plugins = [
  {
    name: 'github',
    matches: (url) => url.hostname === 'github.com' || url.hostname.endsWith('.github.com'),
    apply: (bookmark, url) => {
      const [owner, repository] = url.pathname.split('/').filter(Boolean);
      return {
        ...bookmark,
        site: 'github',
        repository: owner && repository ? `${owner}/${repository.replace(/\.git$/, '')}` : bookmark.repository,
        author: bookmark.author || owner,
        tags: [...new Set([...(bookmark.tags || []), 'github'])]
      };
    }
  },
  {
    name: 'youtube',
    matches: (url) => url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com') || url.hostname === 'youtu.be',
    apply: (bookmark, url) => ({
      ...bookmark,
      site: 'youtube',
      type: 'video',
      video_id: url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || bookmark.video_id,
      tags: [...new Set([...(bookmark.tags || []), 'youtube'])]
    })
  },
  {
    name: 'mural',
    matches: (url) => url.hostname === 'mural.co' || url.hostname.endsWith('.mural.co'),
    apply: (bookmark) => ({
      ...bookmark,
      site: 'mural',
      type: 'whiteboard',
      contexts: [...new Set([...(bookmark.contexts || []), 'work'])],
      tags: [...new Set([...(bookmark.tags || []), 'mural'])]
    })
  },
  {
    name: 'confluence',
    matches: (url) => (url.hostname === 'atlassian.net' || url.hostname.endsWith('.atlassian.net'))
      && (url.pathname.includes('/wiki/') || url.pathname.includes('/display/')),
    apply: (bookmark, url) => {
      const spacesMatch = url.pathname.match(/\/spaces\/([^/]+)/i);
      const displayMatch = url.pathname.match(/\/display\/([^/]+)/i);
      const pageMatch = url.pathname.match(/\/pages\/(\d+)/i);
      return {
        ...bookmark,
        site: 'confluence',
        type: 'page',
        contexts: bookmark.contexts?.length ? bookmark.contexts : ['work'],
        space_key: bookmark.space_key || spacesMatch?.[1] || displayMatch?.[1],
        page_id: bookmark.page_id || pageMatch?.[1],
        tags: [...new Set([...(bookmark.tags || []), 'confluence'])]
      };
    }
  },
  {
    name: 'jira',
    matches: (url) => (url.hostname === 'atlassian.net' || url.hostname.endsWith('.atlassian.net'))
      && url.pathname.startsWith('/browse/'),
    apply: (bookmark, url) => {
      const issueKey = url.pathname.match(/^\/browse\/([A-Z][A-Z0-9]+-\d+)/i)?.[1];
      return {
        ...bookmark,
        site: 'jira',
        type: 'issue',
        contexts: bookmark.contexts?.length ? bookmark.contexts : ['work'],
        issue_key: bookmark.issue_key || issueKey,
        project_key: bookmark.project_key || issueKey?.split('-')[0],
        tags: [...new Set([...(bookmark.tags || []), 'jira'])]
      };
    }
  }
];

export function applySitePlugins(bookmark) {
  const url = new URL(bookmark.url);
  return plugins.filter((plugin) => plugin.matches(url)).reduce((value, plugin) => plugin.apply(value, url), bookmark);
}
