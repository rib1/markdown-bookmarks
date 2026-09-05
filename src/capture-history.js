import crypto from 'node:crypto';

const captureFields = new Set(['id', 'os', 'architecture', 'browser', 'browser_version', 'device']);

function optionalText(value, field, maximumLength = 120) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`capture.${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximumLength) throw new Error(`capture.${field} must be at most ${maximumLength} characters`);
  if (/\p{Cc}/u.test(normalized)) throw new Error(`capture.${field} must not contain control characters`);
  return normalized;
}

export function createCaptureEvent(input, savedAt) {
  if (input.capture === undefined) return undefined;
  if (!input.capture || typeof input.capture !== 'object' || Array.isArray(input.capture)) {
    throw new Error('capture must be an object');
  }
  const unknown = Object.keys(input.capture).filter((field) => !captureFields.has(field));
  if (unknown.length) throw new Error(`Unsupported capture field: ${unknown.join(', ')}`);
  const id = optionalText(input.capture.id, 'id', 128) || crypto.randomUUID();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error('capture.id must contain only letters, numbers, dots, underscores, and hyphens');
  }
  const client = input.capture_client || {};
  const os = optionalText(input.capture.os, 'os');
  const device = optionalText(input.capture.device, 'device', 200) || os;
  return {
    id,
    saved_at: savedAt,
    client: 'browser-extension',
    ...(optionalText(client.version, 'extension_version') ? { extension_version: client.version.trim() } : {}),
    ...(device ? { device } : {}),
    ...(os ? { os } : {}),
    ...(optionalText(input.capture.architecture, 'architecture') ? { architecture: input.capture.architecture.trim() } : {}),
    ...(optionalText(input.capture.browser, 'browser') ? { browser: input.capture.browser.trim() } : {}),
    ...(optionalText(input.capture.browser_version, 'browser_version') ? { browser_version: input.capture.browser_version.trim() } : {})
  };
}

export function appendCaptureEvent(history, event) {
  if (!event) return { history, added: false };
  const existing = history.find((entry) => entry && typeof entry === 'object' && entry.id === event.id);
  if (!existing) return { history: [...history, event], added: true };
  const comparableFields = ['device', 'os', 'architecture', 'browser', 'browser_version', 'extension_version'];
  if (comparableFields.some((field) => existing[field] !== event[field])) {
    throw new Error(`capture.id ${event.id} already exists with different source information`);
  }
  return { history, added: false };
}

export function captureHistoryLabels(history) {
  return history.filter((entry) => entry && typeof entry === 'object').map((entry) => {
    if (entry.device) return entry.device;
    return [entry.os, entry.browser].filter(Boolean).join(' · ');
  }).filter(Boolean);
}

export function captureHistorySearchText(history) {
  return history.filter((entry) => entry && typeof entry === 'object')
    .flatMap((entry) => [entry.device, entry.os, entry.architecture, entry.browser, entry.browser_version])
    .filter(Boolean).join(' ');
}
