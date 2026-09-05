export const EXTENSION_API_PROTOCOL = 2;

export function extensionClient(version) {
  return {
    type: 'browser-extension',
    version,
    api_protocol: EXTENSION_API_PROTOCOL
  };
}

export function browserIdentity(brands = [], userAgent = '') {
  const meaningful = brands.filter(({ brand }) => !/not.?a.?brand/i.test(brand));
  const preferred = meaningful.find(({ brand }) => !/^Chromium$/i.test(brand)) || meaningful[0];
  if (preferred) return { browser: preferred.brand, browser_version: preferred.version };
  const patterns = [
    ['Microsoft Edge', /Edg\/([\d.]+)/],
    ['Firefox', /Firefox\/([\d.]+)/],
    ['Chrome', /Chrome\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/]
  ];
  for (const [browser, pattern] of patterns) {
    const version = userAgent.match(pattern)?.[1];
    if (version) return { browser, browser_version: version };
  }
  return { browser: 'Unknown' };
}

export function assessCapabilities(capabilities, requestedFields = []) {
  if (!capabilities || !Number.isInteger(capabilities.api_protocol)) {
    return {
      ok: false,
      code: 'companion_update_required',
      error: 'The companion is too old to verify browser add-on compatibility. Update and restart the Markdown Bookmarks companion before saving.'
    };
  }
  if (capabilities.minimum_extension_protocol > EXTENSION_API_PROTOCOL) {
    return {
      ok: false,
      code: 'browser_addon_update_required',
      error: 'Browser add-on is out of date and may not save all bookmark fields. Reload or update the Markdown Bookmarks browser add-on before saving.'
    };
  }
  if (capabilities.api_protocol < EXTENSION_API_PROTOCOL) {
    return {
      ok: false,
      code: 'companion_update_required',
      error: 'The browser add-on is newer than the companion. Update and restart the Markdown Bookmarks companion before saving.'
    };
  }
  const acceptedFields = new Set([
    ...(capabilities.accepted_fields || []),
    ...Object.keys(capabilities.deprecated_fields || {})
  ]);
  const unsupported = requestedFields.filter((field) => !acceptedFields.has(field));
  if (unsupported.length) {
    return {
      ok: false,
      code: 'companion_update_required',
      error: `The companion cannot save browser field${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}. Update the companion before saving.`
    };
  }
  return { ok: true };
}
