export default {
  name: 'youtube',
  matches: (url) => url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com') || url.hostname === 'youtu.be',
  apply: (bookmark, url) => {
    const videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || bookmark.video_id;
    return {
      ...bookmark,
      site: 'youtube',
      type: 'video',
      video_id: videoId,
      canonical_url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : bookmark.canonical_url,
      tags: [...new Set([...(bookmark.tags || []), 'youtube'])]
    };
  }
};
