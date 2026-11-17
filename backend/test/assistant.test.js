import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTICES, answerQuestion, buildAssistantResponse, parseBudget, rankProducts, redactPersonalInfo, selectCandidates, verifyDraft } from '../src/services/assistant.js';
import { ProviderError, buildGenerationConfig, parseDraft, requestGeminiDraft } from '../src/services/aiProvider.js';

const products = [
  { id: 1, name: 'Keyboard', category: 'Accessories', description: 'Mechanical keyboard', price: 1800, stock: 2 },
  { id: 2, name: 'Mouse', category: 'Accessories', description: 'Wireless mouse', price: 600, stock: 3 }
];

// Mirrors the seeded catalog, plus a disposable out-of-stock and an inactive fixture.
// Prices are strings here on purpose: Prisma Decimal values are not plain numbers.
const catalog = [
  { id: 11, name: 'Wireless Mouse', description: 'Quiet wireless mouse with adjustable sensitivity and USB receiver.', category: 'Accessories', price: '650.00', stock: 12, active: true },
  { id: 12, name: 'Compact Mechanical Keyboard', description: 'Hot-swappable compact keyboard with tactile switches.', category: 'Accessories', price: '1850.00', stock: 8, active: true },
  { id: 13, name: 'USB-C Study Lamp', description: 'Adjustable desk lamp with three brightness levels.', category: 'Study', price: '900.00', stock: 10, active: true },
  { id: 14, name: '1080p Webcam', description: 'Full HD webcam with privacy cover and built-in microphone.', category: 'Video', price: '1450.00', stock: 6, active: true },
  { id: 15, name: 'USB Headset', description: 'Over-ear headset with noise-reducing boom microphone.', category: 'Audio', price: '1350.00', stock: 7, active: true },
  { id: 90, name: 'Test Monitor Zero Stock', description: 'Disposable fixture monitor.', category: 'Display', price: '5000.00', stock: 0, active: true },
  { id: 91, name: 'Retired Speaker', description: 'Inactive speaker fixture.', category: 'Audio', price: '800.00', stock: 5, active: false }
];
const KEYBOARD_Q = 'Which keyboard is below ₱2,000?';
const silent = { warn: () => {} };

// ---- Original starter tests (kept) ----
test('parseBudget extracts a peso budget', () => assert.equal(parseBudget('below ₱2,000'), 2000));
test('rankProducts respects the budget', () => assert.deepEqual(rankProducts(products, 'mouse below 700').map((p) => p.id), [2]));
test('assistant response contains traceable sources', () => assert.equal(buildAssistantResponse(products, 'keyboard').sources[0].id, 1));

// ---- Retrieval ----
test('parseBudget ignores model numbers such as 1080p', () => assert.equal(parseBudget('Do you have a 1080p webcam?'), null));
test('parseBudget reads "1500 pesos" and "under php 900"', () => {
  assert.equal(parseBudget('headset for 1500 pesos'), 1500);
  assert.equal(parseBudget('lamp under php 900'), 900);
});

test('catalog match: keyboard below ₱2,000 selects the real keyboard with a numeric price', () => {
  const { selected } = selectCandidates(catalog, KEYBOARD_Q);
  assert.deepEqual(selected.map((p) => p.id), [12]);
  assert.equal(selected[0].price, 1850);
  assert.equal(typeof selected[0].price, 'number');
  assert.deepEqual(Object.keys(selected[0]).sort(), ['category', 'description', 'id', 'name', 'price', 'stock']);
});

test('no match: an absent category returns nothing (was: every product)', () => {
  const result = selectCandidates(catalog, 'Do you sell drones?');
  assert.equal(result.selected.length, 0);
  assert.equal(result.reason, 'no_match');
});

test('availability: a stock 0 product is never selected', () => {
  const result = selectCandidates(catalog, 'I need a monitor');
  assert.equal(result.selected.length, 0);
  assert.equal(result.reason, 'out_of_stock');
});

test('inactive products are never selected', () => assert.equal(selectCandidates(catalog, 'speaker').selected.length, 0));
test('over budget is reported honestly', () => assert.equal(selectCandidates(catalog, 'keyboard under 1000').reason, 'over_budget'));
test('plural and synonym words still match', () => {
  assert.deepEqual(selectCandidates(catalog, 'any keyboards?').selected.map((p) => p.id), [12]);
  assert.deepEqual(selectCandidates(catalog, 'good headphones for class').selected.map((p) => p.id), [15]);
});

// ---- Orchestration with a fake provider (no network) ----
test('no match does not call the provider and returns no products or sources', async () => {
  let called = false;
  const result = await answerQuestion({ catalog, question: 'Do you sell drones?', draftProvider: async () => { called = true; }, logger: silent });
  assert.equal(called, false);
  assert.equal(result.mode, 'no_match');
  assert.deepEqual(result.recommendedProducts, []);
  assert.deepEqual(result.sources, []);
});

test('valid AI draft is accepted and products come from the database', async () => {
  const result = await answerQuestion({
    catalog, question: KEYBOARD_Q, logger: silent,
    draftProvider: async () => ({ answer: 'The Compact Mechanical Keyboard costs ₱1,850 and has tactile, hot-swappable switches.', productIds: [12] })
  });
  assert.equal(result.mode, 'ai');
  assert.deepEqual(result.recommendedProducts, [{ id: 12, name: 'Compact Mechanical Keyboard', price: 1850, category: 'Accessories', stock: 8 }]);
  assert.deepEqual(result.sources.map((s) => s.id), [12]);
});

for (const [label, draft] of [
  ['invented product id', { answer: 'Try the Compact Mechanical Keyboard for ₱1,850.', productIds: [999] }],
  ['wrong price', { answer: 'The Compact Mechanical Keyboard is only ₱1,500.', productIds: [12] }],
  ['invented spec number', { answer: 'The Compact Mechanical Keyboard (₱1,850) has a 60% layout.', productIds: [12] }],
  ['invented feature', { answer: 'The Compact Mechanical Keyboard (₱1,850) has RGB lighting and Bluetooth.', productIds: [12] }],
  ['invented policy', { answer: 'The Compact Mechanical Keyboard (₱1,850) comes with a warranty.', productIds: [12] }],
  ['availability contradiction', { answer: 'The Compact Mechanical Keyboard is out of stock.', productIds: [12] }],
  ['wrong stock claim', { answer: 'Hurry, only 2 left of the Compact Mechanical Keyboard (₱1,850)!', productIds: [12] }],
  ['budget passed off as price', { answer: 'The Compact Mechanical Keyboard costs ₱2,000.', productIds: [12] }]
]) {
  test(`draft with ${label} is replaced by the verified rule answer`, async () => {
    const result = await answerQuestion({ catalog, question: KEYBOARD_Q, draftProvider: async () => draft, logger: silent });
    assert.equal(result.mode, 'rules');
    assert.match(result.notice, /could not be verified/);
    assert.match(result.answer, /Compact Mechanical Keyboard \(₱1,850, 8 in stock\)/);
    assert.deepEqual(result.sources.map((s) => s.id), [12]);
  });
}

test('draft naming a product it does not recommend is rejected', () => {
  const { selected } = selectCandidates(catalog, KEYBOARD_Q);
  const check = verifyDraft({ answer: 'Get the Compact Mechanical Keyboard (₱1,850) and a Wireless Mouse.', productIds: [12] }, { selected, catalog, question: KEYBOARD_Q, budget: 2000 });
  assert.equal(check.problem, 'unlisted_product_named');
});

for (const reason of ['timeout', 'rate_limited', 'unavailable', 'invalid_format', 'not_configured']) {
  test(`provider failure (${reason}) falls back to rules with a notice`, async () => {
    const result = await answerQuestion({ catalog, question: KEYBOARD_Q, logger: silent, draftProvider: async () => { throw new ProviderError(reason, 'x'); } });
    assert.equal(result.mode, 'rules');
    assert.equal(result.notice, NOTICES[reason]);
    assert.deepEqual(result.recommendedProducts.map((p) => p.id), [12]);
  });
}

test('an unexpected provider bug also falls back instead of crashing', async () => {
  const result = await answerQuestion({ catalog, question: KEYBOARD_Q, logger: silent, draftProvider: async () => { throw new Error('boom'); } });
  assert.equal(result.mode, 'rules');
  assert.equal(result.notice, NOTICES.unavailable);
});

test('budget may be repeated only as the budget, and correct stock claims pass', () => {
  const { selected } = selectCandidates(catalog, KEYBOARD_Q);
  const ctx = { selected, catalog, question: KEYBOARD_Q, budget: 2000 };
  assert.equal(verifyDraft({ answer: 'Under your ₱2,000 budget, the Compact Mechanical Keyboard costs ₱1,850 and has 8 in stock.', productIds: [12] }, ctx).ok, true);
});

test('contact details are removed before the question reaches the provider', async () => {
  let sentQuestion;
  await answerQuestion({ catalog, logger: silent, question: 'keyboard below 2000, email me at jm@example.com or 0917 123 4567',
    draftProvider: async (q) => { sentQuestion = q; throw new ProviderError('timeout', 'x'); } });
  assert.doesNotMatch(sentQuestion, /jm@example\.com|0917/);
  assert.match(sentQuestion, /keyboard below 2000/);
  assert.equal(redactPersonalInfo('call +639171234567'), 'call [phone removed]');
});

test('Gemini 2.5 Flash gets thinking switched off so the JSON is not cut short', () => {
  assert.deepEqual(buildGenerationConfig('gemini-2.5-flash').thinkingConfig, { thinkingBudget: 0 });
  assert.equal(buildGenerationConfig('gemini-3-flash-preview').thinkingConfig, undefined);
});

// ---- Provider client ----
test('parseDraft rejects non-JSON and wrong shapes', () => {
  assert.throws(() => parseDraft('Sure! Here you go'), { reason: 'invalid_format' });
  assert.throws(() => parseDraft('{"text":"hi"}'), { reason: 'invalid_format' });
  assert.deepEqual(parseDraft('```json\n{"answer":"Hi","productIds":[12]}\n```'), { answer: 'Hi', productIds: [12] });
});

const config = { provider: 'gemini', apiKey: 'test-key-123', model: 'gemini-test', baseUrl: 'https://example.invalid/v1beta', timeoutMs: 50 };
const facts = selectCandidates(catalog, KEYBOARD_Q).selected;

test('provider request keeps the key in a header and sends only product facts', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"answer":"ok","productIds":[12]}' }] } }] }), { status: 200 });
  };
  const draft = await requestGeminiDraft(KEYBOARD_Q, facts, config, fakeFetch);
  assert.deepEqual(draft, { answer: 'ok', productIds: [12] });
  assert.equal(sent.url.includes('test-key-123'), false);
  assert.equal(sent.init.headers['x-goog-api-key'], 'test-key-123');
  assert.doesNotMatch(sent.init.body, /email|address|customerName|order/i);
});

test('provider client maps HTTP 429, 500, network and timeout errors', async () => {
  await assert.rejects(requestGeminiDraft('q', facts, config, async () => new Response('{}', { status: 429 })), { reason: 'rate_limited' });
  await assert.rejects(requestGeminiDraft('q', facts, config, async () => new Response('{}', { status: 503 })), { reason: 'unavailable' });
  await assert.rejects(requestGeminiDraft('q', facts, config, async () => { throw new TypeError('fetch failed'); }), { reason: 'unavailable' });
  // AbortSignal.timeout timers do not keep Node alive, so hold the loop open while "hanging".
  const hang = (_url, init) => new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => {}, 5000);
    init.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(init.signal.reason); });
  });
  await assert.rejects(requestGeminiDraft('q', facts, config, hang), { reason: 'timeout' });
  await assert.rejects(requestGeminiDraft('q', facts, { ...config, apiKey: '' }), { reason: 'not_configured' });
});

test('provider error text is kept for diagnosis but never includes the key', async () => {
  const fake = async () => new Response(JSON.stringify({ error: { message: 'API key not valid. Key test-key-123 rejected.' } }), { status: 400 });
  await assert.rejects(requestGeminiDraft('q', facts, config, fake), (error) => {
    assert.equal(error.reason, 'unavailable');
    assert.match(error.message, /HTTP 400: API key not valid/);
    assert.doesNotMatch(error.message, /test-key-123/);
    return true;
  });
});
