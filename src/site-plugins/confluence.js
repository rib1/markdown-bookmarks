export default {
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
};
