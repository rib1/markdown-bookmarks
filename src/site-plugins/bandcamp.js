const reservedSubdomains = new Set(['daily', 'discover', 'fan', 'www']);

function artistFromHostname(hostname) {
  const labels = hostname.split('.');
  if (labels.length !== 3) return undefined;
  const artist = labels[0].toLowerCase();
  return reservedSubdomains.has(artist) ? undefined : artist;
}

export default {
  name: 'bandcamp',
  matches: (url) => url.hostname === 'bandcamp.com' || url.hostname.endsWith('.bandcamp.com'),
  apply: (bookmark, url) => {
    const pageType = url.pathname.match(/^\/(album|track)(?:\/|$)/i)?.[1]?.toLowerCase();
    return {
      ...bookmark,
      site: 'bandcamp',
      type: pageType || 'music',
      author: bookmark.author || artistFromHostname(url.hostname),
      tags: [...new Set([...(bookmark.tags || []), 'bandcamp'])]
    };
  }
};
