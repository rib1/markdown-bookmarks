document.querySelector('#form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const response = await chrome.runtime.sendMessage({
    url: tab.url,
    title: tab.title,
    tags: document.querySelector('#tags').value.split(',')
  });
  document.querySelector('#result').textContent = response.ok ? 'Saved.' : response.error;
});
