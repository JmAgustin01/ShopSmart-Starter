# Submission Checklist – ShopSmart Grounded Assistant

Student: John Michael Agustin

## What the handout asks for, and where it is

| Handout requirement | Where to find it |
|---|---|
| Updated project or repository link | https://github.com/JmAgustin01/ShopSmart-Starter (or `ShopSmart-submission.zip`) |
| One-page design note with request flow and five design decisions | `docs/WEEK5_DESIGN_NOTE.md` |
| Brief test record covering the six cases | `docs/WEEK5_TEST_RECORD.md` |
| Screenshots: catalog match, no match, provider failure | `docs/screenshots/1-catalog-match.png`, `2-no-match.png`, `3-provider-failure.png` |
| Baseline screenshot (work plan, 0–20 min) | `docs/screenshots/0a-baseline-starter-keyboard.png`, `0b-baseline-starter-drones.png` |
| Screenshot or log of `npm run check` | `docs/npm-run-check.log` (lint, 5 frontend + 41 backend tests, build: all passed) |
| One contribution and one issue resolved | bottom of `docs/WEEK5_TEST_RECORD.md` |
| No `backend/.env` in the submission | `.gitignore` excludes it; the ZIP was checked and has no `.env` |

## Required behavior checklist

| Requirement | Done | How |
|---|---|---|
| `POST /api/assistant/questions` still works from the page | ✔ | Same endpoint and request field |
| In-stock product recommended with real price and working link | ✔ | Test case 1: #14, ₱1,850, `/products/14` |
| Response keeps `answer`, `recommendedProducts`, `sources` with valid ids | ✔ | Test case 6 |
| Impossible request gives honest no match | ✔ | Test case 2 |
| Invalid question still rejected | ✔ | Test case 3: HTTP 422 |
| Key stays out of browser, repo, response and logs | ✔ | Key only in `backend/.env`, sent in a header, never logged |
| Failed provider ends loading with a fallback | ✔ | Test case 5 |
| Browsing, cart and checkout still work | ✔ | "Other checks" in the test record |

## Where the code is

| Part | File |
|---|---|
| Catalog query (public fields, active only), rate limit, validation | `backend/src/routes/assistant.js` |
| Retrieval, verification, fallback | `backend/src/services/assistant.js` |
| Gemini API call (server only) | `backend/src/services/aiProvider.js` |
| Answer page: waiting state, notice, links, sources | `frontend/src/pages/AssistantPage.jsx` |
| 20-second page timeout and error messages | `frontend/src/services/api.js` |
| Tests | `backend/test/assistant.test.js` |
| Setup steps for the AI key | `README.md`, "Week 5" section |

## Before you submit

- [ ] `backend/.env` has `GEMINI_MODEL=gemini-3.8-flash`, so real AI answers work
- [ ] Open the ZIP or repo and confirm `backend/.env` is not there
- [ ] Open each linked product and compare its price and stock with the answer
- [ ] Be ready to explain one server decision and one test result
