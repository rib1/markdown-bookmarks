import { saveBookmark } from './vault.js';

const input = process.stdin;
let buffer = Buffer.alloc(0);

function reply(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

input.on('data', async (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < length + 4) return;
    const message = JSON.parse(buffer.subarray(4, length + 4).toString('utf8'));
    buffer = buffer.subarray(length + 4);
    try { reply({ ok: true, result: await saveBookmark(message) }); }
    catch (error) { reply({ ok: false, error: error.message }); }
  }
});
