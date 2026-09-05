import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTENSION_API_PROTOCOL,
  assessCapabilities,
  browserIdentity,
  extensionClient
} from '../extension/compatibility.js';

const compatible = {
  api_protocol: EXTENSION_API_PROTOCOL,
  minimum_extension_protocol: EXTENSION_API_PROTOCOL,
  accepted_fields: ['url', 'title', 'shared_by'],
  deprecated_fields: { sender: 'shared_by' }
};

test('builds browser add-on identity and accepts supported fields', () => {
  assert.deepEqual(extensionClient('0.2.0'), {
    type: 'browser-extension', version: '0.2.0', api_protocol: EXTENSION_API_PROTOCOL
  });
  assert.deepEqual(assessCapabilities(compatible, ['url', 'shared_by']), { ok: true });
  assert.deepEqual(assessCapabilities(compatible, ['url', 'sender']), { ok: true });
});

test('instructs the user to update the browser add-on when the server requires it', () => {
  const result = assessCapabilities({ ...compatible, minimum_extension_protocol: EXTENSION_API_PROTOCOL + 1 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'browser_addon_update_required');
  assert.match(result.error, /Reload or update.*browser add-on/);
});

test('detects old companions and fields they cannot save', () => {
  assert.match(assessCapabilities(undefined).error, /companion is too old/i);
  assert.match(assessCapabilities({ ...compatible, api_protocol: 1 }).error, /newer than the companion/i);
  const missingField = assessCapabilities(compatible, ['url', 'shared_via']);
  assert.equal(missingField.ok, false);
  assert.match(missingField.error, /cannot save browser field: shared_via/);
});

test('uses browser brands when available and falls back to the user agent', () => {
  assert.deepEqual(browserIdentity([
    { brand: 'Not A(Brand', version: '99' },
    { brand: 'Chromium', version: '140' },
    { brand: 'Google Chrome', version: '140' }
  ]), { browser: 'Google Chrome', browser_version: '140' });
  assert.deepEqual(browserIdentity([], 'Mozilla/5.0 Chrome/140.0.1 Safari/537.36'),
    { browser: 'Chrome', browser_version: '140.0.1' });
});
