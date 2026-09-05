import http from 'node:http';
import {
  API_PROTOCOL_VERSION,
  ApiContractError,
  apiCapabilities,
  parseBrowserSaveRequest
} from './api-contract.js';
import { BOOKMARK_SCHEMA_VERSION, migrateVault } from './migrations/index.js';
import { cleanupStaleSearchResultPages } from './search-results-page.js';
import { saveBookmark, vaultRoot } from './vault.js';

const port = Number(process.env.PORT || 8787);
const vault = vaultRoot();
const startedAt = new Date().toISOString();
const migration = await migrateVault(vault);
const purgedSearchPages = await cleanupStaleSearchResultPages();

function send(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type'
  });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {});
  if (request.method === 'GET' && request.url === '/capabilities') {
    return send(response, 200, apiCapabilities(BOOKMARK_SCHEMA_VERSION));
  }
  if (request.method !== 'POST' || request.url !== '/bookmarks') return send(response, 404, { ok: false, error: 'Not found' });
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', async () => {
    try {
      const parsed = parseBrowserSaveRequest(JSON.parse(raw));
      const result = await saveBookmark({ ...parsed.bookmark, capture_client: parsed.client }, vault);
      const body = {
        ok: !parsed.legacyClient,
        saved: true,
        result,
        processed_fields: parsed.processedFields,
        ignored_fields: parsed.ignoredFields,
        warnings: parsed.warnings
      };
      if (parsed.legacyClient) {
        body.code = 'browser_addon_update_required';
        body.error = parsed.warnings[0].message;
      }
      send(response, 201, body);
    } catch (error) {
      const status = error instanceof ApiContractError ? error.status : 400;
      send(response, status, { ok: false, code: error.code || 'save_failed', error: error.message });
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  const migrationLog = migration.migrationsRun.length
    ? migration.migrationsRun.map(({ script, fromVersion, toVersion }) =>
      `vault migration ran: ${script}; schema: ${fromVersion} -> ${toVersion}`)
    : [`vault migrations: none; schema remains: ${migration.schemaVersion}`];
  console.log([
    `bookmark companion started at: ${startedAt}`,
    ...migrationLog,
    ...(migration.migrationsRun.length ? [
      `vault migration changes: normalized tags: ${migration.normalizedTags}; OS device labels added: ${migration.osLabelsAdded}`
    ] : []),
    `vault AGENTS.md: ${migration.agentInstructions}`,
    `stale search-result pages purged: ${purgedSearchPages}`,
    `bookmark companion listening on ${port}; vault: ${vault}; schema: ${migration.schemaVersion}; migrated: ${migration.migrated}; API protocol: ${API_PROTOCOL_VERSION}`
  ].join('\n'));
});
