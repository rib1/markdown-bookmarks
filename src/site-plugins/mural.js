export default {
  name: 'mural',
  matches: (url) => url.hostname === 'mural.co' || url.hostname.endsWith('.mural.co'),
  apply: (bookmark) => ({
    ...bookmark,
    site: 'mural',
    type: 'whiteboard',
    contexts: [...new Set([...(bookmark.contexts || []), 'work'])],
    tags: [...new Set([...(bookmark.tags || []), 'mural'])]
  })
};
