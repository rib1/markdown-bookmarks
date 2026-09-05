export default {
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
};
