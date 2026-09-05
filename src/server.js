import http from 'node:http';
import { saveBookmark, vaultRoot } from './vault.js';

const port = Number(process.env.PORT || 8787);
const vault = vaultRoot();

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

server.listen(port, '0.0.0.0', () => console.log(`bookmark companion listening on ${port}`));
