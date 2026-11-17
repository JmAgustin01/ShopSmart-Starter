// Integration tests for the Express app without a database (defects D3 and D4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function withServer(options, run) {
  const server = createApp(options).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('health reports ok when the database answers', async () => {
  await withServer({ checkDatabase: async () => {} }, async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'ok' });
  });
});

test('health returns 503 when the database is unreachable (was: 200 ok)', async () => {
  await withServer({ checkDatabase: async () => { throw Object.assign(new Error('down'), { code: 'P1001' }); } }, async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'error', database: 'unreachable' });
  });
});

test('malformed JSON returns 400 INVALID_JSON (was: 400 INTERNAL_ERROR)', async () => {
  await withServer({ checkDatabase: async () => {} }, async (base) => {
    const response = await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"customerName": ' });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'INVALID_JSON');
  });
});

test('unexpected errors do not expose internal codes such as Prisma P1017', async () => {
  const app = createApp({ checkDatabase: async () => {} });
  const handler = app.router.stack.at(-1).handle;
  const response = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const original = console.error; console.error = () => {};
  try { handler(Object.assign(new Error('Server has closed the connection.'), { code: 'P1017' }), { id: 'trace-1' }, response, () => {}); }
  finally { console.error = original; }
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: { code: 'INTERNAL_ERROR', message: 'The server could not complete the request.', traceId: 'trace-1' } });
});
