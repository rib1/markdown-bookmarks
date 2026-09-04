document.querySelector('#form').addEventListener('submit', async (event) => {
  event.preventDefault();
  document.querySelector('#result').textContent = '';
  const params = new URLSearchParams(location.search);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const capturedTab = params.has('test-url')
    ? { url: params.get('test-url'), title: params.get('test-title') || params.get('test-url') }
    : tab;
  const response = await chrome.runtime.sendMessage({
    url: capturedTab?.url,
    title: capturedTab?.title,
    tags: document.querySelector('#tags').value.split(',')
  });
  document.querySelector('#result').textContent = response.ok ? 'Saved.' : response.error;
});
