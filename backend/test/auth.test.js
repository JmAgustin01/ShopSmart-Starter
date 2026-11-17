// Week 6 AWS release: sign-in and order ownership, tested through the real Express app.
// Required by the deployment guide: guest refused, owner succeeds, another customer denied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { canReadOrder, hashPassword, parseCookies, sessionCookie, verifyPassword } from '../src/lib/auth.js';
import { createFakeDb } from './support/fakeDb.js';

const PRODUCTS = [{ id: 1, name: 'Wireless Mouse', description: 'Quiet mouse', category: 'Accessories', price: '650.00', stock: 5 }];
const ORDER = { customerName: 'Ana Test', email: 'ana@example.com', address: '45 Fictional Ave, Test City', items: [{ productId: 1, quantity: 2 }] };

async function withServer(run) {
  const db = createFakeDb({ products: PRODUCTS });
  const server = createApp({ checkDatabase: async () => {}, db }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = (path, { cookie, body, method = body ? 'POST' : 'GET' } = {}) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined
  });
  const signUp = async (name, email) => {
    const response = await call('/auth/register', { body: { name, email, password: 'correct horse 42' } });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try { await run({ call, signUp, db }); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('passwords are hashed with a salt and verified', async () => {
  const stored = await hashPassword('correct horse 42');
  assert.match(stored, /^scrypt\$/);
  assert.doesNotMatch(stored, /correct horse/);
  assert.notEqual(stored, await hashPassword('correct horse 42'));
  assert.equal(await verifyPassword('correct horse 42', stored), true);
  assert.equal(await verifyPassword('wrong password', stored), false);
});

test('session cookie is HttpOnly, SameSite=Lax and Secure in production', () => {
  const cookie = sessionCookie('abc', { secure: true });
  for (const part of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/']) assert.ok(cookie.includes(part), part);
  assert.deepEqual(parseCookies('a=1; shopsmart_session=xyz'), { a: '1', shopsmart_session: 'xyz' });
});

test('ownership rule: only the account that placed an order may read it', () => {
  assert.equal(canReadOrder({ id: 1 }, { userId: 1 }), true);
  assert.equal(canReadOrder({ id: 2 }, { userId: 1 }), false);
  assert.equal(canReadOrder(null, { userId: 1 }), false);
  assert.equal(canReadOrder({ id: 1 }, { userId: null }), false); // older orders with no owner stay private
});

test('guest is refused: checkout and order reads return 401', async () => {
  await withServer(async ({ call }) => {
    for (const [path, options] of [['/orders', { body: ORDER }], ['/orders'], ['/orders/1'], ['/auth/me']]) {
      const response = await call(path, options);
      assert.equal(response.status, 401, path);
      assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
    }
  });
});

test('owner succeeds; another customer is denied by direct API request', async () => {
  await withServer(async ({ call, signUp, db }) => {
    const ana = await signUp('Ana Test', 'ana@example.com');
    const ben = await signUp('Ben Test', 'ben@example.com');

    const created = await call('/orders', { cookie: ana, body: ORDER });
    assert.equal(created.status, 201);
    const order = await created.json();
    assert.equal(order.total, 1300);
    assert.equal(order.userId, undefined, 'owner id is not sent to the browser');
    assert.equal(db.data.orders[0].userId, db.data.users[0].id, 'order saved with its owner');

    const own = await call(`/orders/${order.id}`, { cookie: ana });
    assert.equal(own.status, 200);
    assert.equal((await own.json()).items[0].productName, 'Wireless Mouse');
    assert.equal((await (await call('/orders', { cookie: ana })).json()).length, 1);

    const other = await call(`/orders/${order.id}`, { cookie: ben });
    assert.equal(other.status, 403);
    assert.equal((await other.json()).error.code, 'ORDER_FORBIDDEN');
    assert.deepEqual(await (await call('/orders', { cookie: ben })).json(), [], "Ben's list does not include Ana's order");
  });
});

test('wrong password and unknown email give the same 401; duplicate email is refused', async () => {
  await withServer(async ({ call, signUp }) => {
    await signUp('Ana Test', 'Ana@Example.com');
    const wrong = await call('/auth/login', { body: { email: 'ana@example.com', password: 'nope-nope' } });
    const unknown = await call('/auth/login', { body: { email: 'nobody@example.com', password: 'nope-nope' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual((await wrong.json()).error.message, (await unknown.json()).error.message);
    const ok = await call('/auth/login', { body: { email: 'ANA@example.com', password: 'correct horse 42' } });
    assert.equal(ok.status, 200, 'email is not case-sensitive');
    const duplicate = await call('/auth/register', { body: { name: 'Ana Two', email: 'ana@example.com', password: 'correct horse 42' } });
    assert.equal(duplicate.status, 409);
    const weak = await call('/auth/register', { body: { name: 'Cy', email: 'cy@example.com', password: 'short' } });
    assert.equal(weak.status, 422);
  });
});

test('logout ends the session on the server', async () => {
  await withServer(async ({ call, signUp }) => {
    const ana = await signUp('Ana Test', 'ana@example.com');
    assert.equal((await call('/auth/me', { cookie: ana })).status, 200);
    const out = await call('/auth/logout', { cookie: ana, method: 'POST' });
    assert.equal(out.status, 204);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await call('/auth/me', { cookie: ana })).status, 401, 'old cookie no longer works');
  });
});
