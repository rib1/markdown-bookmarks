import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  EXTENSION_API_PROTOCOL,
  assessCapabilities,
  browserIdentity,
  extensionClient,
  saveResultMessage
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
  assert.deepEqual(assessCapabilities(compatible, ['url', 'shared_by']), {
    ok: true, warnings: [], unsupportedFields: []
  });
  assert.deepEqual(assessCapabilities(compatible, ['url', 'sender']), {
    ok: true, warnings: [], unsupportedFields: []
  });
});

test('instructs the user to update the browser add-on when the server requires it', () => {
  const result = assessCapabilities({ ...compatible, minimum_extension_protocol: EXTENSION_API_PROTOCOL + 1 });
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /reload or update.*browser add-on/i);
});

test('detects old companions and fields they cannot save', () => {
  assert.match(assessCapabilities(undefined).error, /companion is too old/i);
  assert.match(assessCapabilities({ ...compatible, api_protocol: 1 }).warnings[0], /newer than the companion/i);
  const missingField = assessCapabilities(compatible, ['url', 'shared_via']);
  assert.equal(missingField.ok, true);
  assert.deepEqual(missingField.unsupportedFields, ['shared_via']);
  assert.match(missingField.warnings[0], /cannot save browser field: shared_via/);
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

test('popup defers companion compatibility checks until the user saves', async () => {
  const popup = await fs.readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');
  assert.doesNotMatch(popup, /get-capabilities|capabilities/);
  assert.match(popup, /action: 'save-bookmark'/);
});

test('formats successful partial saves with visible compatibility warnings', () => {
  const message = saveResultMessage({
    ok: true,
    saved: true,
    warnings: [{ message: 'Fields not saved: capture. Update the companion.' }]
  });
  assert.equal(message, 'Saved.\nWarning: Fields not saved: capture. Update the companion.');
  assert.equal(saveResultMessage({ ok: false, error: 'Companion unavailable' }), 'Companion unavailable');
});
