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

function validateClient(client) {
  if (!plainObject(client) || !Number.isInteger(client.api_protocol)) {
    throw new ApiContractError(
      'Browser add-on is out of date and may not save all bookmark fields. Reload or update the Markdown Bookmarks browser add-on and try again. Bookmark was not saved.',
      { status: 409, code: 'browser_addon_update_required' }
    );
  }
  if (client.api_protocol < MINIMUM_EXTENSION_PROTOCOL) {
    throw new ApiContractError(
      `Browser add-on protocol ${client.api_protocol} is no longer supported. Reload or update the Markdown Bookmarks browser add-on and try again. Bookmark was not saved.`,
      { status: 409, code: 'browser_addon_update_required' }
    );
  }
  if (client.api_protocol > API_PROTOCOL_VERSION) {
    throw new ApiContractError(
      'The browser add-on is newer than the companion. Update and restart the Markdown Bookmarks companion, then try again. Bookmark was not saved.',
      { status: 409, code: 'companion_update_required' }
    );
  }
  if (client.type !== 'browser-extension' || typeof client.version !== 'string' || !client.version.trim()) {
    throw new ApiContractError('Invalid browser add-on identity.', { status: 422, code: 'invalid_client' });
  }
}

function validateBookmark(bookmark) {
  if (!plainObject(bookmark)) throw new ApiContractError('bookmark must be an object');
  const allowed = new Set([...BOOKMARK_INPUT_FIELDS, ...Object.keys(DEPRECATED_BOOKMARK_FIELDS)]);
  const unknown = Object.keys(bookmark).filter((field) => !allowed.has(field));
  if (unknown.length) {
    throw new ApiContractError(
      `Bookmark was not saved because the companion does not support field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Update the companion and try again.`,
      { status: 422, code: 'unsupported_fields' }
    );
  }
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
      throw new ApiContractError(`Unsupported capture field: ${unknownCaptureFields.join(', ')}`);
    }
    if (Object.values(bookmark.capture).some((value) => typeof value !== 'string')) {
      throw new ApiContractError('capture fields must be strings');
    }
  }
}

export function parseBrowserSaveRequest(payload) {
  if (!plainObject(payload) || !Object.hasOwn(payload, 'bookmark')) {
    throw new ApiContractError(
      'Browser add-on is out of date and may not save all bookmark fields. Reload or update the Markdown Bookmarks browser add-on and try again. Bookmark was not saved.',
      { status: 409, code: 'browser_addon_update_required' }
    );
  }
  const envelopeFields = Object.keys(payload).filter((field) => !['client', 'bookmark'].includes(field));
  if (envelopeFields.length) throw new ApiContractError(`Unsupported request field: ${envelopeFields.join(', ')}`);
  validateClient(payload.client);
  validateBookmark(payload.bookmark);

  const bookmark = { ...payload.bookmark };
  const warnings = [];
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
    client: payload.client,
    warnings,
    processedFields: Object.keys(payload.bookmark)
  };
}
