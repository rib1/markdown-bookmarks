export default {
  name: 'github',
  matches: (url) => url.hostname === 'github.com' || url.hostname.endsWith('.github.com'),
  apply: (bookmark, url) => {
    const parts = url.pathname.split('/').filter(Boolean);
    const owner = parts[0];
    const repository = parts[1]?.replace(/\.git$/, '');
    let canonicalUrl = bookmark.canonical_url;
    if (owner && repository && parts.length === 2) {
      canonicalUrl = `https://github.com/${owner}/${repository}`;
    }
    return {
      ...bookmark,
      site: 'github',
      repository: owner && repository ? `${owner}/${repository}` : bookmark.repository,
      author: bookmark.author || owner,
      canonical_url: canonicalUrl,
      tags: [...new Set([...(bookmark.tags || []), 'github'])]
    };
  }
};
