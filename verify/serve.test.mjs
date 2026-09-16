import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, listen } from './serve.mjs';

test('audio supports full, partial, suffix, unsatisfiable and HEAD requests', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gargantua-media-'));
  const server = createServer(root);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(root, 'track.mp3'), '0123456789');
  const url = `http://127.0.0.1:${await listen(server)}/track.mp3`;
  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/mpeg');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(await full.text(), '0123456789');
  for (const [range, body, contentRange] of [
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-99', '89', 'bytes 8-9/10'],
  ]) {
    const response = await fetch(url, { headers: { Range: range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), contentRange);
    assert.equal(response.headers.get('content-length'), String(body.length));
    assert.equal(await response.text(), body);
  }
  for (const range of ['bytes=10-', 'bytes=8-2', 'bytes=-0']) {
    const response = await fetch(url, { headers: { Range: range } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */10');
    await response.arrayBuffer();
  }
  const head = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=2-5' } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
});
