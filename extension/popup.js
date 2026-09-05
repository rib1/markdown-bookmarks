import { saveResultMessage } from './compatibility.js';

const form = document.querySelector('#form');
const resultOutput = document.querySelector('#result');
const sharedByInput = document.querySelector('#shared-by');
const deviceInput = document.querySelector('#device');

async function loadRecentSenders() {
  const { recentSenders = [], deviceLabel = '' } = await chrome.storage.local.get(['recentSenders', 'deviceLabel']);
  deviceInput.value = deviceLabel;
  document.querySelector('#recent-senders').replaceChildren(...recentSenders.map((sender) => {
    const option = document.createElement('option');
    option.value = sender;
    return option;
  }));
}

async function rememberSender(sender) {
  if (!sender) return;
  const { recentSenders = [] } = await chrome.storage.local.get('recentSenders');
  const updated = [sender, ...recentSenders.filter((value) => value !== sender)].slice(0, 10);
  await chrome.storage.local.set({ recentSenders: updated });
}

loadRecentSenders();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  resultOutput.textContent = '';
  const params = new URLSearchParams(location.search);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const capturedTab = params.has('test-url')
    ? { url: params.get('test-url'), title: params.get('test-title') || params.get('test-url') }
    : tab;
  let pageData = {};
  if (!params.has('test-url') && capturedTab?.id) {
    [pageData] = await chrome.scripting.executeScript({ target: { tabId: capturedTab.id }, func: extractPageMetadata });
  }
  const sharedBy = sharedByInput.value.trim();
  const sharedVia = document.querySelector('#shared-via').value.trim();
  const bookmark = {
    url: capturedTab?.url,
    title: capturedTab?.title,
    contexts: document.querySelector('#context').value ? [document.querySelector('#context').value] : [],
    ...pageData?.result,
    tags: document.querySelector('#tags').value.split(','),
    ...(sharedBy ? { shared_by: sharedBy } : {}),
    ...(sharedVia ? { shared_via: sharedVia } : {}),
  };
  const device = deviceInput.value.trim();
  const response = await chrome.runtime.sendMessage({ action: 'save-bookmark', bookmark, device });
  if (response.ok || response.saved) {
    await rememberSender(sharedBy);
    await chrome.storage.local.set({ deviceLabel: device });
  }
  resultOutput.textContent = saveResultMessage(response);
});

function extractPageMetadata() {
  const meta = (selector) => document.querySelector(selector)?.content?.trim() || '';
  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
    try {
      const value = JSON.parse(node.textContent);
      return Array.isArray(value) ? value : [value];
    } catch { return []; }
  }).find((value) => value && (value.datePublished || value.author));
  const author = meta('meta[name="author"]') || meta('meta[property="article:author"]') ||
    (typeof jsonLd?.author === 'string' ? jsonLd.author : jsonLd?.author?.name) || '';
  const published = meta('meta[property="article:published_time"]') || meta('meta[name="date"]') ||
    jsonLd?.datePublished || document.querySelector('time[datetime]')?.dateTime || '';
  const publishedAt = published.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const paragraph = [...document.querySelectorAll('article p, main p, p')]
    .map((node) => node.innerText.trim()).find((text) => text.length >= 80) || '';
  return {
    author,
    published_at: publishedAt,
    published_at_source: publishedAt ? (jsonLd?.datePublished ? 'schema.org' : 'article-meta') : '',
    published_at_confidence: publishedAt ? 'high' : '',
    summary: (description || paragraph).slice(0, 500)
  };
}
