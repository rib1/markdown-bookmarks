chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  fetch('http://127.0.0.1:8787/bookmarks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message)
  }).then((response) => response.json()).then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: `Companion unavailable: ${error.message}` }));
  return true;
});
