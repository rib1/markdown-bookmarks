import http from 'node:http';
import { migrateVault } from './migrations/index.js';
import { saveBookmark, vaultRoot } from './vault.js';

const port = Number(process.env.PORT || 8787);
const vault = vaultRoot();
const migration = await migrateVault(vault);

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
  if (request.method !== 'POST' || request.url !== '/bookmarks') return send(response, 404, { ok: false, error: 'Not found' });
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', async () => {
    try {
      const result = await saveBookmark(JSON.parse(raw), vault);
      send(response, 201, { ok: true, result });
    } catch (error) {
      send(response, 400, { ok: false, error: error.message });
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  const migrationLog = migration.migrationsRun.length
    ? migration.migrationsRun.map(({ script, fromVersion, toVersion }) =>
      `vault migration ran: ${script}; schema: ${fromVersion} -> ${toVersion}`)
    : [`vault migrations: none; schema remains: ${migration.schemaVersion}`];
  console.log([
    ...migrationLog,
    `bookmark companion listening on ${port}; vault: ${vault}; schema: ${migration.schemaVersion}; migrated: ${migration.migrated}`
  ].join('\n'));
});
