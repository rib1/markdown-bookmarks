import { assessCapabilities, browserIdentity, extensionClient } from './compatibility.js';

const companionUrl = 'http://127.0.0.1:8787';
const client = extensionClient(chrome.runtime.getManifest().version);

async function responseJson(response) {
  try { return await response.json(); } catch {
    return { ok: false, error: `Companion returned HTTP ${response.status} without a valid response.` };
  }
}

async function getCapabilities() {
  const response = await fetch(`${companionUrl}/capabilities`);
  if (!response.ok) return {
    ok: false,
    error: 'The companion is too old to verify browser add-on compatibility. Update and restart the Markdown Bookmarks companion before saving.'
  };
  const capabilities = await responseJson(response);
  const compatibility = assessCapabilities(capabilities);
  return compatibility.ok ? { ok: true, capabilities } : compatibility;
}

async function captureContext(device) {
  const platform = await chrome.runtime.getPlatformInfo();
  const identity = browserIdentity(navigator.userAgentData?.brands, navigator.userAgent);
  return {
    id: crypto.randomUUID(),
    os: platform.os,
    architecture: platform.arch,
    ...identity,
    ...(device ? { device } : {})
  };
}

async function saveBookmark(bookmark, device) {
  const capture = await captureContext(device);
  bookmark = {
    ...bookmark,
    capture,
    ...((bookmark.shared_by || bookmark.shared_via) ? { share_event_id: capture.id } : {})
  };
  const capabilityResult = await getCapabilities();
  if (!capabilityResult.ok) return capabilityResult;
  const compatibility = assessCapabilities(capabilityResult.capabilities, Object.keys(bookmark));
  if (!compatibility.ok) return compatibility;
  const response = await fetch(`${companionUrl}/bookmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client, bookmark })
  });
  const result = await responseJson(response);
  if (!result.ok) return result;
  const processed = new Set(result.processed_fields || []);
  const unconfirmed = Object.keys(bookmark).filter((field) => !processed.has(field));
  if (unconfirmed.length) return {
    ok: false,
    code: 'unconfirmed_fields',
    error: `The companion did not confirm saving field${unconfirmed.length === 1 ? '' : 's'}: ${unconfirmed.join(', ')}. Check compatibility before retrying.`
  };
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const operation = message?.action === 'get-capabilities'
    ? getCapabilities()
    : message?.action === 'save-bookmark'
      ? saveBookmark(message.bookmark, message.device)
      : Promise.resolve({ ok: false, error: 'Unsupported browser add-on request.' });
  operation.then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: `Companion unavailable: ${error.message}` }));
  return true;
});
