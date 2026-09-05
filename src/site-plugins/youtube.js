export default {
  name: 'youtube',
  matches: (url) => url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com') || url.hostname === 'youtu.be',
  apply: (bookmark, url) => ({
    ...bookmark,
    site: 'youtube',
    type: 'video',
    video_id: url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || bookmark.video_id,
    tags: [...new Set([...(bookmark.tags || []), 'youtube'])]
  })
};
