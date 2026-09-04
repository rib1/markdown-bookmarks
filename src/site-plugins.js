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
  }
];

export function applySitePlugins(bookmark) {
  const url = new URL(bookmark.url);
  return plugins.filter((plugin) => plugin.matches(url)).reduce((value, plugin) => plugin.apply(value, url), bookmark);
}
