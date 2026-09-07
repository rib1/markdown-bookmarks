export default {
  name: 'hs.fi',
  matches: (url) => url.hostname === 'hs.fi' || url.hostname.endsWith('.hs.fi'),
  apply: (bookmark) => ({
    ...bookmark,
    site: 'hs.fi',
    type: bookmark.type || 'article',
    tags: [...new Set([...(bookmark.tags || []), 'hs.fi'])]
  })
};
