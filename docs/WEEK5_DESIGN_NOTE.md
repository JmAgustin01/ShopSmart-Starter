# ShopSmart Grounded Assistant – Design Note

Student: John Michael Agustin · Repo: https://github.com/JmAgustin01/ShopSmart-Starter · Provider: Google Gemini API (free tier), gemini-3.8-flash

## Flow
```
AssistantPage.jsx --POST /api/assistant/questions {question}--> routes/assistant.js
  (rate limit 20/min, 3-300 chars else 422, load active products: public fields only)
  --> services/assistant.js answerQuestion()
        selectCandidates() -> no match? honest answer, AI not called
        aiProvider.js (Gemini) -> verifyDraft() -> failed? rule-based answer + notice
  <-- { answer, recommendedProducts, sources, mode, notice } --> answer panel with product links and Sources
```
The question enters at the React form, `answerQuestion()` handles it on the server, and the result appears in the "Assistant response" panel. I kept `answer`, `recommendedProducts` and `sources`, and only added `mode` and `notice`.

## Retrieval
The route selects `id, name, description, category, price, stock` from active products only; orders are never queried. `selectCandidates()` matches question words (plus plurals and a few synonyms) against name, category and description, removes stock-0 and over-budget items, and keeps the top 3. A budget only counts after words like "below/under" or a ₱ sign, so "1080p" is not a budget. Prisma's Decimal price is converted with `Number()` and rounded to 2 decimals. The provider sees only these six fields because that is all an answer needs and none of it is private.

## Provider
Official Gemini REST API (`generateContent`) using Node's `fetch`, in `backend/src/services/aiProvider.js`. The key is in `backend/.env` (git-ignored), sent in the `x-goog-api-key` header, and never logged or returned. The model must reply as JSON `{ answer, productIds }`, with an 8-second timeout. Emails and phone numbers are removed from the question before sending.

## Verification
`verifyDraft()` rejects the draft if an id was not selected for this request, a ₱ price or stock number does not match the database, it adds numbers or features not in the facts (e.g. "60% layout", "RGB", "warranty"), calls an in-stock item unavailable, or names a product it did not recommend. Links, prices and sources are always rebuilt from database rows, never taken from the model's text.

## Fallback
No match, out of stock or over budget: an honest message, no links, and Gemini is not called. Timeout, rate limit, malformed output or a failed check: the rule-based answer (name, price, stock, description) plus a note saying which one happened. The page stops waiting after 20 seconds, so it never loads forever.

## Five design decisions
1. **Fields sent:** only id, name, category, description, price and stock for at most 3 pre-selected products. Enough to answer, nothing private.
2. **No invented ids:** the model returns ids only, each is checked against the selected set, and links come from the database.
3. **No match:** the server answers honestly without calling the provider, so nothing can be made up and quota is saved.
4. **Provider down:** the existing rules still answer for the same verified products, with a visible notice.
5. **Public data and permissions:** the assistant reads only the public catalog (same as `GET /api/products`), never orders, and never changes stock. If accounts are added, permissions belong in Express middleware on protected routes.

## Evidence
The first failing case was **No match** on the original starter: "Do you sell drones?" recommended a mouse, lamp and laptop stand (screenshots `0a`, `0b`). The cause was that products with score 0 were still recommended. I fixed it by requiring a matching product word, and verified it with unit tests and by asking again on the running app. Later issues: Gemini returned HTTP 404 because gemini-2.5-flash is no longer available to new users (found with my `/api/assistant/status` page, fixed by switching to gemini-3.8-flash); Windows blocked ports 5173 and 5180 (EACCES), so the frontend runs on 3001 and CORS allows localhost ports in development.

**Limitations:** keyword matching can miss unusual wording, and the strict checks sometimes replace a good AI answer with the rule-based one, which is always correct.
