import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: companionVersion } = require('../package.json');

export const API_PROTOCOL_VERSION = 2;
export const MINIMUM_EXTENSION_PROTOCOL = 2;

export const BOOKMARK_INPUT_FIELDS = [
  'url',
  'title',
  'contexts',
  'tags',
  'author',
  'published_at',
  'published_at_source',
  'published_at_confidence',
  'summary',
  'shared_by',
  'shared_via',
  'share_event_id',
  'capture'
];

export const DEPRECATED_BOOKMARK_FIELDS = { sender: 'shared_by' };

const stringFields = new Set(BOOKMARK_INPUT_FIELDS.filter((field) => !['contexts', 'tags', 'capture'].includes(field)));

export class ApiContractError extends Error {
  constructor(message, { status = 422, code = 'invalid_request' } = {}) {
    super(message);
    this.name = 'ApiContractError';
    this.status = status;
    this.code = code;
  }
}

export function apiCapabilities(bookmarkSchemaVersion) {
  return {
    app_version: companionVersion,
    api_protocol: API_PROTOCOL_VERSION,
    minimum_extension_protocol: MINIMUM_EXTENSION_PROTOCOL,
    bookmark_schema_version: bookmarkSchemaVersion,
    features: {
      share_history: 1,
      capture_history: 1,
      processed_field_receipt: 1
    },
    accepted_fields: [...BOOKMARK_INPUT_FIELDS],
    deprecated_fields: { ...DEPRECATED_BOOKMARK_FIELDS }
  };
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clientCompatibilityWarnings(client) {
  const warnings = [];
  if (!plainObject(client) || !Number.isInteger(client.api_protocol)) {
    warnings.push({
      code: 'browser_addon_update_required',
      message: 'Bookmark saved with the fields supplied by a legacy browser add-on. Reload or update the Markdown Bookmarks browser add-on to capture all available metadata.'
    });
    return warnings;
  }
  if (client.api_protocol < MINIMUM_EXTENSION_PROTOCOL) {
    warnings.push({
      code: 'browser_addon_update_required',
      message: `Bookmark saved with browser add-on protocol ${client.api_protocol}. Reload or update the Markdown Bookmarks browser add-on to capture all available metadata.`
    });
  }
  if (client.api_protocol > API_PROTOCOL_VERSION) {
    warnings.push({
      code: 'companion_update_required',
      message: 'The browser add-on is newer than the companion. Supported fields were saved; update and restart the companion to save all available metadata.'
    });
  }
  if (client.type !== 'browser-extension' || typeof client.version !== 'string' || !client.version.trim()) {
    warnings.push({
      code: 'browser_addon_update_required',
      message: 'Browser add-on identity was missing or invalid. Supported fields were saved; reload or update the browser add-on.'
    });
  }
  return warnings;
}

function normalizeBookmark(input, warnings) {
  if (!plainObject(input)) throw new ApiContractError('bookmark must be an object');
  const allowed = new Set([...BOOKMARK_INPUT_FIELDS, ...Object.keys(DEPRECATED_BOOKMARK_FIELDS)]);
  const unknown = Object.keys(input).filter((field) => !allowed.has(field));
  if (unknown.length) {
    warnings.push({
      code: 'unsupported_fields_ignored',
      fields: unknown,
      message: `Bookmark saved, but unsupported field${unknown.length === 1 ? ' was' : 's were'} omitted: ${unknown.join(', ')}. Update the companion to save them.`
    });
  }
  const bookmark = Object.fromEntries(Object.entries(input).filter(([field]) => allowed.has(field)));
  if (typeof bookmark.url !== 'string' || !bookmark.url.trim()) {
    throw new ApiContractError('url must be a non-empty string');
  }
  for (const field of stringFields) {
    if (bookmark[field] !== undefined && typeof bookmark[field] !== 'string') {
      throw new ApiContractError(`${field} must be a string`);
    }
  }
  for (const field of ['contexts', 'tags']) {
    if (bookmark[field] !== undefined
      && (!Array.isArray(bookmark[field]) || bookmark[field].some((value) => typeof value !== 'string'))) {
      throw new ApiContractError(`${field} must be a list of strings`);
    }
  }
  if (bookmark.sender !== undefined && typeof bookmark.sender !== 'string') {
    throw new ApiContractError('sender must be a string');
  }
  if (bookmark.capture !== undefined) {
    if (!plainObject(bookmark.capture)) throw new ApiContractError('capture must be an object');
    const allowedCaptureFields = new Set(['id', 'os', 'architecture', 'browser', 'browser_version', 'device']);
    const unknownCaptureFields = Object.keys(bookmark.capture).filter((field) => !allowedCaptureFields.has(field));
    if (unknownCaptureFields.length) {
      warnings.push({
        code: 'unsupported_fields_ignored',
        fields: unknownCaptureFields.map((field) => `capture.${field}`),
        message: `Bookmark saved, but unsupported capture field${unknownCaptureFields.length === 1 ? ' was' : 's were'} omitted: ${unknownCaptureFields.join(', ')}.`
      });
    }
    bookmark.capture = Object.fromEntries(Object.entries(bookmark.capture)
      .filter(([field]) => allowedCaptureFields.has(field)));
    if (Object.values(bookmark.capture).some((value) => typeof value !== 'string')) {
      throw new ApiContractError('capture fields must be strings');
    }
  }
  return { bookmark, ignoredFields: unknown };
}

export function parseBrowserSaveRequest(payload) {
  if (!plainObject(payload)) throw new ApiContractError('Request body must be an object');
  const legacyClient = !Object.hasOwn(payload, 'bookmark');
  const warnings = [];
  const input = legacyClient ? payload : payload.bookmark;
  const client = legacyClient ? undefined : payload.client;
  if (legacyClient) warnings.push(...clientCompatibilityWarnings(undefined));
  else {
    warnings.push(...clientCompatibilityWarnings(client));
    const envelopeFields = Object.keys(payload).filter((field) => !['client', 'bookmark'].includes(field));
    if (envelopeFields.length) warnings.push({
      code: 'unsupported_fields_ignored',
      fields: envelopeFields,
      message: `Unsupported request field${envelopeFields.length === 1 ? '' : 's'} were ignored: ${envelopeFields.join(', ')}.`
    });
  }
  const normalized = normalizeBookmark(input, warnings);
  const bookmark = normalized.bookmark;
  if (bookmark.sender !== undefined) {
    if (bookmark.shared_by !== undefined && bookmark.shared_by !== bookmark.sender) {
      throw new ApiContractError('sender and shared_by contain conflicting values');
    }
    bookmark.shared_by ??= bookmark.sender;
    delete bookmark.sender;
    warnings.push({
      code: 'deprecated_field',
      field: 'sender',
      replacement: 'shared_by',
      message: 'The sender field is deprecated; its value was stored as shared_by.'
    });
  }

  return {
    bookmark,
    client,
    warnings,
    processedFields: Object.keys(input).filter((field) => !normalized.ignoredFields.includes(field)),
    ignoredFields: normalized.ignoredFields,
    legacyClient
  };
}
