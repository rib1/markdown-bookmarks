import { assessCapabilities, browserIdentity, extensionClient } from './compatibility.js';

const companionUrl = 'http://127.0.0.1:8787';
const client = extensionClient(chrome.runtime.getManifest().version);
const legacyFields = new Set([
  'url', 'title', 'contexts', 'tags', 'author', 'published_at',
  'published_at_source', 'published_at_confidence', 'summary'
]);

async function responseJson(response) {
  try { return await response.json(); } catch {
    return { ok: false, error: `Companion returned HTTP ${response.status} without a valid response.` };
  }
}

async function getCapabilities() {
  const response = await fetch(`${companionUrl}/capabilities`);
  if (response.status === 404) return { ok: false, legacy: true };
  if (!response.ok) return responseJson(response);
  const capabilities = await responseJson(response);
  const compatibility = assessCapabilities(capabilities);
  return compatibility.ok ? { ok: true, capabilities } : compatibility;
}

async function saveWithLegacyCompanion(bookmark) {
  const supported = Object.fromEntries(Object.entries(bookmark).filter(([field]) => legacyFields.has(field)));
  const omitted = Object.keys(bookmark).filter((field) => !legacyFields.has(field));
  const response = await fetch(`${companionUrl}/bookmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(supported)
  });
  const result = await responseJson(response);
  if (!result.ok) return result;
  return {
    ...result,
    warnings: [{
      code: 'companion_update_required',
      message: `Saved using a legacy companion${omitted.length ? `; fields not saved: ${omitted.join(', ')}` : ''}. Update and restart the companion to save all available metadata.`
    }]
  };
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
  if (!capabilityResult.ok) {
    if (capabilityResult.legacy) return saveWithLegacyCompanion(bookmark);
    return capabilityResult;
  }
  const compatibility = assessCapabilities(capabilityResult.capabilities, Object.keys(bookmark));
  if (!compatibility.ok) return compatibility;
  const supportedBookmark = Object.fromEntries(Object.entries(bookmark)
    .filter(([field]) => !compatibility.unsupportedFields.includes(field)));
  const response = await fetch(`${companionUrl}/bookmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client, bookmark: supportedBookmark })
  });
  const result = await responseJson(response);
  if (!result.ok) return result;
  const processed = new Set(result.processed_fields || []);
  const unconfirmed = Object.keys(supportedBookmark).filter((field) => !processed.has(field));
  const warnings = [
    ...(compatibility.warnings || []).map((message) => ({ code: 'compatibility_warning', message })),
    ...(result.warnings || [])
  ];
  if (unconfirmed.length) warnings.push({
    code: 'unconfirmed_fields',
    message: `The companion did not confirm field${unconfirmed.length === 1 ? '' : 's'}: ${unconfirmed.join(', ')}. Check the saved bookmark and update the companion.`
  });
  return { ...result, warnings };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const operation = message?.action === 'save-bookmark'
    ? saveBookmark(message.bookmark, message.device)
    : Promise.resolve({ ok: false, error: 'Unsupported browser add-on request.' });
  operation.then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: `Companion unavailable: ${error.message}` }));
  return true;
});
