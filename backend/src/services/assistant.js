// backend/src/services/assistant.js
// Grounded product assistant (Week 5).
//
// Flow for one question:
//   1. selectCandidates  – ShopSmart code picks eligible catalog facts (active, in stock, relevant, in budget).
//   2. no candidates     – answer honestly with "no match" and DO NOT call the AI provider.
//   3. requestDraft      – the AI provider phrases an answer from those facts only (server side).
//   4. verifyDraft       – ShopSmart code checks ids, prices, numbers, names and claims.
//   5. fallback          – if the provider fails or the draft fails a check, use the rule-based answer.
// recommendedProducts and sources are ALWAYS built from database records, never from model text.

import { ProviderError, requestGeminiDraft } from './aiProvider.js';

const MAX_CANDIDATES = 3;

// Words that say nothing about WHICH product is wanted.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'are', 'any', 'can', 'what', 'which', 'who', 'how', 'does', 'have', 'has',
  'there', 'this', 'that', 'than', 'from', 'want', 'need', 'looking', 'look', 'find', 'show', 'give', 'get', 'buy', 'sell',
  'please', 'recommend', 'suggest', 'good', 'best', 'great', 'nice', 'cheap', 'cheaper', 'cheapest', 'affordable',
  'product', 'products', 'item', 'items', 'thing', 'things', 'something', 'anything', 'one', 'some', 'available', 'stock',
  'below', 'under', 'less', 'more', 'max', 'maximum', 'budget', 'price', 'priced', 'cost', 'costs', 'within', 'most',
  'peso', 'pesos', 'php', 'shopsmart', 'store', 'shop', 'catalog', 'option', 'options', 'would', 'could', 'should', 'like'
]);

// Small synonym list so everyday words still reach catalog wording.
const SYNONYMS = {
  headphone: ['headset'], headphones: ['headset'], earphone: ['headset'], earphones: ['headset'],
  mic: ['microphone'], camera: ['webcam'], cam: ['webcam'], light: ['lamp'], mice: ['mouse'], notebook: ['laptop']
};

export function parseBudget(question) {
  const normalized = question.replaceAll(',', '').toLowerCase();
  // Prefer numbers that follow a budget word: "below 2000", "under ₱1500", "budget of 900".
  const cued = normalized.match(/(?:below|under|less than|cheaper than|max(?:imum)?|budget(?: of| is)?|up to|within|no more than|at most)\s*(?:₱|php)?\s*(\d{2,6})(?:\.\d{1,2})?/);
  if (cued) return Number(cued[1]);
  // Otherwise accept an explicit currency amount: "₱2000", "php 900", "1500 pesos".
  const currency = normalized.match(/(?:₱|php)\s*(\d{2,6})(?:\.\d{1,2})?|\b(\d{2,6})(?:\.\d{1,2})?\s*(?:pesos?|php)\b/);
  if (currency) return Number(currency[1] || currency[2]);
  // A bare number such as "1080p webcam" is NOT treated as a budget.
  return null;
}

export function extractTerms(question) {
  return [...new Set(question.toLowerCase().split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !/^\d+$/.test(term) && !STOPWORDS.has(term)))];
}

function termVariants(term) {
  const variants = new Set([term, ...(SYNONYMS[term] || [])]);
  if (term.length > 3 && term.endsWith('s')) variants.add(term.slice(0, -1)); // keyboards -> keyboard
  return [...variants];
}

function scoreProduct(product, terms) {
  const text = `${product.name} ${product.category} ${product.description}`.toLowerCase();
  return terms.reduce((score, term) => score + (termVariants(term).some((variant) => text.includes(variant)) ? 1 : 0), 0);
}

// Converts a database row into the only fields the assistant (and the AI provider) may use.
// Prisma returns price as a Decimal, so it is converted deliberately to a 2-decimal Number.
export function toFact(product) {
  return {
    id: Number(product.id),
    name: String(product.name),
    category: String(product.category),
    description: String(product.description),
    price: Math.round(Number(product.price) * 100) / 100,
    stock: Number(product.stock)
  };
}

// Picks the catalog subset for one question. Returns why nothing qualified, if so.
export function selectCandidates(products, question, limit = MAX_CANDIDATES) {
  const terms = extractTerms(question);
  const budget = parseBudget(question);
  const active = products.filter((product) => product.active !== false).map((product) => ({ ...toFact(product), score: scoreProduct(product, terms) }));
  const relevant = terms.length ? active.filter((product) => product.score > 0) : active;
  const inStock = relevant.filter((product) => product.stock > 0);
  const inBudget = inStock.filter((product) => budget === null || product.price <= budget);
  const selected = inBudget
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, limit)
    .map(({ id, name, category, description, price, stock }) => ({ id, name, category, description, price, stock }));

  let reason = null;
  if (selected.length === 0) {
    if (relevant.length > 0 && inStock.length === 0) reason = 'out_of_stock';
    else if (inStock.length > 0) reason = 'over_budget';
    else reason = 'no_match';
  }
  return { selected, budget, terms, reason };
}

// Kept for the original tests and for callers that only need the ranking.
export function rankProducts(products, question) {
  return selectCandidates(products, question, Infinity).selected;
}

export function formatPeso(value) {
  return `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function toRecommendation(fact) {
  return { id: fact.id, name: fact.name, price: fact.price, category: fact.category, stock: fact.stock };
}

function toSource(fact) {
  return { type: 'product', id: fact.id, name: fact.name, price: fact.price, url: `/products/${fact.id}` };
}

export function noMatchAnswer(reason, budget) {
  if (reason === 'out_of_stock') return 'A product matching your request is in the ShopSmart catalog, but it is currently out of stock, so I cannot recommend it right now.';
  if (reason === 'over_budget') return `I found matching products, but none are in stock at or below ${formatPeso(budget)}. You could try a higher budget.`;
  return 'I could not find an in-stock product in the current ShopSmart catalog that matches your request. Try the Products page or ask about another item.';
}

export function ruleAnswer(selected) {
  if (selected.length === 1) {
    const [product] = selected;
    return `Based on the current ShopSmart catalog, the ${product.name} (${formatPeso(product.price)}, ${product.stock} in stock) matches your request. ${product.description}`;
  }
  const list = selected.map((product) => `${product.name} (${formatPeso(product.price)})`).join(', ');
  return `Based on the current ShopSmart catalog, consider: ${list}. All are currently in stock.`;
}

function respond({ answer, facts, mode, notice = null }) {
  return { answer, recommendedProducts: facts.map(toRecommendation), sources: facts.map(toSource), mode, notice };
}

// Original synchronous, rule-only builder. Still used as the fallback.
export function buildAssistantResponse(products, question) {
  const { selected, budget, reason } = selectCandidates(products, question);
  if (selected.length === 0) return respond({ answer: noMatchAnswer(reason, budget), facts: [], mode: 'no_match' });
  return respond({ answer: ruleAnswer(selected), facts: selected, mode: 'rules' });
}

// Claim words the model must not use unless the chosen products' own facts contain them.
const RISKY_CLAIMS = ['warranty', 'guarantee', 'shipping', 'delivery', 'discount', 'sale', 'promo', 'voucher', 'refund',
  'bluetooth', 'rgb', 'backlit', 'wireless', 'waterproof', 'battery', '4k', 'gaming', 'ergonomic'];
// Price claims written in words. The ₱ number check below cannot see these, so "the mouse is free"
// or "half price" would otherwise pass as verified (defect D1, PDC50 quality challenge).
const PRICE_CLAIM_WORDS = ['free', 'half price', 'half off', 'costs nothing', 'no cost', 'no charge', 'complimentary',
  'gratis', 'buy one', 'take one', 'bogo', 'clearance', 'markdown', 'price drop', 'lowest price', 'price match'];
const UNAVAILABLE_WORDS = /out of stock|sold out|unavailable|not available/i;
const BUDGET_CONTEXT = /\b(below|under|less than|within|budget|up to|cheaper than|no more than|at most|limit)\W*(?:(?:your|the|a|an|of|is)\W+)*$/i;
const STOCK_CLAIM = /(\d+)\s*(?:units?|pcs|pieces|items?)?\s*(?:left|in stock|available|remaining)\b/gi;

function numbersIn(text) {
  return (String(text).replaceAll(',', '').match(/\d+(?:\.\d+)?/g) || []).map(Number);
}

// Removes contact details a customer might type, so they never reach the AI provider.
export function redactPersonalInfo(question) {
  return question
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email removed]')
    .replace(/(?:\+63|\b0)\s?9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g, '[phone removed]')
    .replace(/\b\d{10,}\b/g, '[number removed]');
}

// Checks an AI draft against the facts ShopSmart selected. Returns { ok, facts } or { ok:false, problem }.
export function verifyDraft(draft, { selected, catalog = [], question = '', budget = null }) {
  const byId = new Map(selected.map((fact) => [fact.id, fact]));
  const ids = [...new Set(draft.productIds)];
  if (ids.length === 0) return { ok: false, problem: 'no_products_chosen' };
  if (ids.some((id) => !byId.has(id))) return { ok: false, problem: 'unknown_product_id' };
  const chosen = ids.map((id) => byId.get(id));
  const answer = draft.answer;
  const plain = answer.replaceAll(',', '');
  const lower = answer.toLowerCase();

  if (answer.length > 700) return { ok: false, problem: 'answer_too_long' };

  // Prices written with ₱ or PHP must equal a chosen product's current price.
  // The customer's own budget may be repeated only in budget wording ("under your ₱2,000 budget").
  const prices = new Set(chosen.map((fact) => fact.price));
  for (const match of plain.matchAll(/(?:₱|php\s*)(\d+(?:\.\d+)?)/gi)) {
    const value = Number(match[1]);
    const before = plain.slice(Math.max(0, match.index - 30), match.index);
    const isBudgetMention = budget !== null && value === budget && BUDGET_CONTEXT.test(before);
    if (!prices.has(value) && !isBudgetMention) return { ok: false, problem: 'unsupported_price' };
  }

  // Stock claims ("8 in stock", "only 2 left") must equal a chosen product's current stock.
  const stocks = new Set(chosen.map((fact) => fact.stock));
  for (const match of plain.matchAll(STOCK_CLAIM)) {
    if (!stocks.has(Number(match[1]))) return { ok: false, problem: 'unsupported_stock' };
  }

  // Any other number must come from the selected facts or the question (blocks invented specs like "60% layout").
  const allowedNumbers = new Set([0, 1, 2, 3, ...numbersIn(question)]);
  for (const fact of chosen) [fact.price, fact.stock, fact.id, ...numbersIn(`${fact.name} ${fact.description}`)].forEach((n) => allowedNumbers.add(n));
  if (numbersIn(answer).some((n) => !allowedNumbers.has(n))) return { ok: false, problem: 'unsupported_number' };

  // Every chosen product is in stock, so the draft must not call it unavailable.
  if (UNAVAILABLE_WORDS.test(answer)) return { ok: false, problem: 'availability_contradiction' };

  // The draft may only name products it recommends.
  const chosenIds = new Set(ids);
  const others = [...catalog.map(toFact), ...selected].filter((fact) => !chosenIds.has(fact.id));
  if (others.some((fact) => lower.includes(fact.name.toLowerCase()))) return { ok: false, problem: 'unlisted_product_named' };

  // Feature or policy claims must appear in the chosen products' facts.
  const factText = chosen.map((fact) => `${fact.name} ${fact.category} ${fact.description}`).join(' ').toLowerCase();
  if (RISKY_CLAIMS.some((word) => new RegExp(`\\b${word}\\b`).test(lower) && !factText.includes(word))) return { ok: false, problem: 'unsupported_claim' };

  // Price claims in words are allowed only when the chosen products' own facts contain them ("Hands-free Headset").
  if (PRICE_CLAIM_WORDS.some((phrase) => new RegExp(`\\b${phrase}\\b`).test(lower) && !factText.includes(phrase))) return { ok: false, problem: 'unsupported_price_claim' };

  return { ok: true, facts: chosen };
}

// What the customer sees above the rule-based answer, per failure type.
const FROM_CATALOG = 'so this answer was built directly from the ShopSmart catalog.';
export const NOTICES = {
  timeout: `The AI writer took too long to respond, ${FROM_CATALOG}`,
  rate_limited: `The AI writer is busy right now (usage limit reached), ${FROM_CATALOG}`,
  invalid_format: `The AI writer returned an answer we could not read, ${FROM_CATALOG}`,
  unavailable: `The AI writer is unavailable right now, ${FROM_CATALOG}`,
  not_configured: `AI phrasing is turned off on this server, ${FROM_CATALOG}`,
  verification: `The AI draft could not be verified against the catalog, ${FROM_CATALOG}`
};

// Last provider outcome, shown by GET /api/assistant/status to help diagnose setup problems.
let lastProviderResult = { at: null, result: 'not called yet' };
export function getLastProviderResult() { return lastProviderResult; }

// Main entry used by the route. draftProvider is injectable so tests never call a real API.
export async function answerQuestion({ catalog, question, draftProvider = requestGeminiDraft, logger = console }) {
  const { selected, budget, reason } = selectCandidates(catalog, question);

  // No eligible product: answer honestly and skip the provider entirely.
  if (selected.length === 0) return respond({ answer: noMatchAnswer(reason, budget), facts: [], mode: 'no_match' });

  let draft;
  try {
    draft = await draftProvider(redactPersonalInfo(question), selected);
  } catch (error) {
    const why = error instanceof ProviderError ? error.reason : 'unavailable';
    lastProviderResult = { at: new Date().toISOString(), result: `fallback: ${why}`, detail: error instanceof ProviderError ? error.message : 'unexpected error' };
    // Log the reason and our own short message only: never the key, prompt or provider body.
    if (why !== 'not_configured') logger.warn(`[assistant] provider fallback: ${why}${error instanceof ProviderError ? ` (${error.message})` : ''}`);
    return respond({ answer: ruleAnswer(selected), facts: selected, mode: 'rules', notice: NOTICES[why] || NOTICES.unavailable });
  }

  const check = verifyDraft(draft, { selected, catalog, question, budget });
  lastProviderResult = { at: new Date().toISOString(), result: check.ok ? 'ok: draft accepted' : `draft rejected: ${check.problem}` };
  if (!check.ok) {
    logger.warn(`[assistant] draft rejected: ${check.problem}`);
    return respond({ answer: ruleAnswer(selected), facts: selected, mode: 'rules', notice: NOTICES.verification });
  }
  return respond({ answer: draft.answer, facts: check.facts, mode: 'ai' });
}
