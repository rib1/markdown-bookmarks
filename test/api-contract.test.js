import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_PROTOCOL_VERSION,
  ApiContractError,
  apiCapabilities,
  parseBrowserSaveRequest
} from '../src/api-contract.js';

function request(bookmark, protocol = API_PROTOCOL_VERSION) {
  return {
    client: { type: 'browser-extension', version: '0.2.0', api_protocol: protocol },
    bookmark
  };
}

test('advertises API compatibility separately from the unchanged bookmark schema', () => {
  const capabilities = apiCapabilities(1);
  assert.equal(capabilities.app_version, '0.2.0');
  assert.equal(capabilities.api_protocol, 2);
  assert.equal(capabilities.minimum_extension_protocol, 2);
  assert.equal(capabilities.bookmark_schema_version, 1);
  assert.equal(capabilities.features.share_history, 1);
  assert.equal(capabilities.features.capture_history, 1);
  assert.ok(capabilities.accepted_fields.includes('shared_by'));
  assert.ok(capabilities.accepted_fields.includes('capture'));
  assert.deepEqual(capabilities.deprecated_fields, { sender: 'shared_by' });
});

test('accepts the current extension envelope and reports every processed field', () => {
  const parsed = parseBrowserSaveRequest(request({
    url: 'https://example.test/shared',
    title: 'Shared link',
    shared_by: 'Alice'
  }));
  assert.equal(parsed.bookmark.shared_by, 'Alice');
  assert.deepEqual(parsed.processedFields, ['url', 'title', 'shared_by']);
  assert.deepEqual(parsed.warnings, []);
});

test('rejects legacy and future add-on protocols with actionable update messages', () => {
  assert.throws(() => parseBrowserSaveRequest({ url: 'https://example.test/legacy' }), (error) => {
    assert.ok(error instanceof ApiContractError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'browser_addon_update_required');
    assert.match(error.message, /Reload or update.*browser add-on/);
    assert.match(error.message, /Bookmark was not saved/);
    return true;
  });
  assert.throws(() => parseBrowserSaveRequest(request({ url: 'https://example.test/old' }, 1)),
    /browser add-on protocol 1 is no longer supported/i);
  assert.throws(() => parseBrowserSaveRequest(request({ url: 'https://example.test/future' }, 3)),
    /browser add-on is newer than the companion/i);
});

test('rejects unknown fields and safely maps a deprecated sender field', () => {
  assert.throws(() => parseBrowserSaveRequest(request({
    url: 'https://example.test/unknown',
    silently_lost: 'no'
  })), (error) => {
    assert.equal(error.code, 'unsupported_fields');
    assert.match(error.message, /silently_lost/);
    return true;
  });

  const parsed = parseBrowserSaveRequest(request({
    url: 'https://example.test/alias',
    sender: 'Alice'
  }));
  assert.equal(parsed.bookmark.shared_by, 'Alice');
  assert.equal(parsed.bookmark.sender, undefined);
  assert.equal(parsed.warnings[0].code, 'deprecated_field');
});

test('validates structured browser capture metadata', () => {
  const parsed = parseBrowserSaveRequest(request({
    url: 'https://example.test/capture',
    capture: { id: 'save-one', os: 'mac', browser: 'Chrome', device: 'home-mac' }
  }));
  assert.equal(parsed.bookmark.capture.device, 'home-mac');
  assert.throws(() => parseBrowserSaveRequest(request({
    url: 'https://example.test/capture', capture: { hostname: 'private-machine' }
  })), /Unsupported capture field: hostname/);
});
