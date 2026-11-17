# ShopSmart Grounded Assistant – Test Record

Student: John Michael Agustin
Tested on: November 5, 2026
Frontend: http://localhost:3001 (5173 and 5180 were blocked by Windows, see the design note)
Backend: http://localhost:3000

Before testing I checked my current database at `/api/products` instead of trusting the seed values. In my database the products are ids 13 to 18:

| id | Product | Price | Stock |
|---|---|---|---|
| 13 | Wireless Mouse | ₱650 | 12 |
| 14 | Compact Mechanical Keyboard | ₱1,850 | 8 |
| 15 | USB-C Study Lamp | ₱900 | 10 |
| 16 | 1080p Webcam | ₱1,450 | 6 |
| 17 | Laptop Stand | ₱1,200 | 9 |
| 18 | USB Headset | ₱1,350 | 7 |

All are active. I did not rerun `db:seed` for any test.

## Test cases

**0. Baseline (original starter, before my changes)**
Asked "Which keyboard is below ₱2,000?" and "Do you sell drones?" on the starter.
What I saw: the keyboard question also listed a mouse and a lamp, and the drones question recommended a Wireless Mouse, Study Lamp and Laptop Stand. This is the bug I fixed. Screenshots: `0a`, `0b`.
Result: FAIL (expected, this is the starting point)

**1. Catalog match**
Action: asked "Which keyboard is below ₱2,000?"
Expected: a real in-stock keyboard with the correct price and a working link.
What I saw: the answer recommended only **#14 Compact Mechanical Keyboard, ₱1,850, 8 in stock**, and the source pointed to `/products/14`, which matches the database. On the first run the answer was built from the catalog rules with the note "The AI writer is unavailable right now", because Gemini returned HTTP 404 for gemini-2.5-flash (see the design note). I changed the model to gemini-3.8-flash.
Result: PASS (correct product, price and link)

**2. No match**
Action: asked "Do you sell drones?"
Expected: an honest no-match answer, no products and no sources.
What I saw: "I could not find an in-stock product in the current ShopSmart catalog that matches your request. Try the Products page or ask about another item." `recommendedProducts` and `sources` were both empty, and Gemini was not called.
Result: PASS

**3. Invalid input**
Action: sent `{"question":"hi"}` to `POST /api/assistant/questions`.
Expected: HTTP 422 with the existing error.
What I saw: HTTP 422, `{"error":{"code":"INVALID_QUESTION","message":"Question must contain between 3 and 300 characters."}}`
Result: PASS

**4. Availability (stock 0)**
Action: added a disposable product "TEST Zero-Stock Keyboard", ₱999, stock 0, active, then asked the keyboard question and deleted the product afterwards.
Expected: the stock-0 keyboard is not recommended even though it is cheaper.
What I saw: only the Compact Mechanical Keyboard was recommended. The ₱999 stock-0 keyboard never appeared. After deleting it the product count was back to 6.
Note: this case was run on a test copy of the database (log in `docs/live-test-run.txt`), where the keyboard was id 2.
Result: PASS

**5. Provider failure**
Action: pointed the backend at an unreachable provider address (`GEMINI_BASE_URL=http://127.0.0.1:9/v1beta`), and in a second run used a provider that never answers, with a 3-second limit.
Expected: no endless loading, and a clear message or a rule-based answer.
What I saw: unreachable provider: the answer came back in 0.09 s with the note "The AI writer is unavailable right now…" and the keyboard still linked. Hanging provider: the answer came back after 3.08 s with "The AI writer took too long to respond…".
I also saw this case on my own machine: when Gemini returned 404, the page still answered right away with the rule-based answer and the "unavailable" note.
Note: the two timed runs were on the test copy of the database (log in `docs/live-test-run.txt`).
Result: PASS

**6. Source check**
Action: compared every recommended product and source id with `/api/products/<id>` on my database.
Expected: every id is a real selected product with the same price and stock.
What I saw:
- "Which keyboard is below ₱2,000?" → #14 ₱1,850, stock 8 (matches `/api/products/14`)
- "something for video calls" → #16 1080p Webcam ₱1,450, stock 6 (matches)
- "study items under 1500" → #15 USB-C Study Lamp ₱900 and #17 Laptop Stand ₱1,200 (both match)

Result: PASS

## Other checks

- Products page, search, cart and checkout still work: yes (6 product cards, "keyboard" search shows 1 card, a simulated order was placed successfully on the test copy).
- Rate limit: the 22nd question within a minute returned HTTP 429 "Too many questions in a short time. Please wait a minute and try again."
- API key: not in the frontend code, the API responses or the server logs. `GET /api/assistant/status` only shows `keyConfigured: true`, never the key.
- `npm run check`: passed. Frontend lint, backend lint, 5 frontend tests, 41 backend tests and the production build (log in `docs/npm-run-check.log`).

## Screenshots

`docs/screenshots/`
- `0a-baseline-starter-keyboard.png`, `0b-baseline-starter-drones.png` (before)
- `1-catalog-match.png`
- `2-no-match.png`
- `3-provider-failure.png`

## My contribution

Student: John Michael Agustin

One contribution: I built the grounded assistant: catalog retrieval in `services/assistant.js`, the server-side Gemini call in `services/aiProvider.js`, the checks that reject unsupported prices, stock and product ids, the rule-based fallback, and the updated Assistant page.

One issue I resolved: with my real key every answer fell back to the rule-based answer. I added a status page that shows Gemini's error without the key, found that Google returned HTTP 404 because gemini-2.5-flash is no longer available to new users, and switched to gemini-3.8-flash. I also fixed the frontend not starting on Windows (EACCES on ports 5173 and 5180) by moving it to port 3001 and allowing that port in CORS.
