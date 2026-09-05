function resourceId(value) {
  const id = value?.replace(/\.[a-z0-9]+$/i, '');
  return id && /^[a-z0-9]+$/i.test(id) ? id : undefined;
}

function resourceMetadata(url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() === 'a') {
    return { type: 'album', imgur_id: resourceId(parts[1]) };
  }
  if (parts[0]?.toLowerCase() === 'gallery') {
    return { type: 'gallery', imgur_id: resourceId(parts[1]) };
  }
  if (url.hostname === 'i.imgur.com') {
    return { type: 'image', imgur_id: resourceId(parts.at(-1)) };
  }
  if (parts.length === 1) {
    return { type: 'image', imgur_id: resourceId(parts[0]) };
  }
  return {};
}

export default {
  name: 'imgur',
  matches: (url) => url.hostname === 'imgur.com' || url.hostname.endsWith('.imgur.com'),
  apply: (bookmark, url) => {
    const metadata = resourceMetadata(url);
    return {
      ...bookmark,
      site: 'imgur',
      type: metadata.type || bookmark.type || 'bookmark',
      imgur_id: bookmark.imgur_id || metadata.imgur_id,
      tags: [...new Set([...(bookmark.tags || []), 'imgur'])]
    };
  }
};
