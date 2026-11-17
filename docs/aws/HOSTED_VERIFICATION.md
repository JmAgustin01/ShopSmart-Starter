# ShopSmart Hosted Verification Record

| Item | Value |
|---|---|
| Site URL | **https://13-212-160-135.sslip.io** |
| API health | https://13-212-160-135.sslip.io/api/health |
| AWS | Free plan account · EC2 `t3.micro` `i-072c46409595ea461` · Region `ap-southeast-1` (Singapore) |
| Code version | GitHub `JmAgustin01/ShopSmart-Starter`, branch `aws-release`. The instance was built from commit `c91fa71`; the service-file fix in `ab0c7aa` was applied on the instance and committed (see improvement 2) |
| Tested | 17 Nov 2026, 08:39–08:46 UTC (16:39–16:46 Manila), from AWS CloudShell and a fresh Chrome tab |
| Release type | **Hosted** (single EC2), fictional data only, simulated checkout |
| Test data | Accounts `ana.<n>@example.com` and `ben.<n>@example.com`; address "45 Fictional Ave, Test City" |

Expected results were written before each run (they are the "expected" column of `deploy/ec2/smoke-test.sh`). Evidence is in `docs/aws/screenshots/`.

## Results against the guide's checks

| Check | Expected observation | Observed | Result |
|---|---|---|---|
| Frontend and direct route | Home loads; a direct visit or refresh of a React route still shows the app | Home 200 (`live-01-home.jpg`). Direct `/products/2`, `/account` and `/assistant` return the app (SPA rewrite) | PASS |
| API connection | Browser calls the intended HTTPS API; `/api/health` responds | `{"status":"ok","database":"ok"}` over a valid certificate; plain HTTP → 308 to HTTPS; bundle calls `/api` on the same origin, 0 references to `localhost` | PASS |
| Catalog and cart | Products appear; search, quantity and totals correct | 6 products; "keyboard" → Compact Mechanical Keyboard only (`live-02`); "drone" → 0; cart 2 × ₱1,850 = **₱3,700** (`live-03`) | PASS |
| Account and order | Guest refused; owner succeeds; another customer denied by direct API request | Guest `GET /api/orders` → **401** `AUTH_REQUIRED`; guest checkout page asks to sign in (`live-04`). Ana reads her order → **200**; Ben requests Ana's order directly → **403** `ORDER_FORBIDDEN`, and his list is empty. After logout → 401. Wrong password → 401 with a generic message | PASS |
| Session cookie | Protected session over HTTPS | `Set-Cookie` has `HttpOnly`, `Secure`, `SameSite=Lax` | PASS |
| Simulated checkout | Valid fictional order saved; invalid or excess quantity refused | Order #1 (₱650) created, stock 12 → 11. Invalid email → 422 naming `email`. Quantity 13 with stock 12 → 409 `INSUFFICIENT_STOCK` | PASS |
| Assistant | Claims and links match current records; no match is clear | "Which keyboard is below ₱2,000?" → Compact Mechanical Keyboard ₱1,850, 8 in stock, source `/products/2`, labelled "Built directly from catalog data" (`live-05`). "Do you sell drones?" → 0 products, `no_match`. "hi" → 422 | PASS |
| AI provider failure | Clear result or verified fallback | Provider is off on this server (`AI_PROVIDER=off`); every answer is the labelled catalog answer. Provider timeout, 429 and outage fallbacks are covered by unit tests (`backend/test/`) | PASS (no live provider) |
| Restart and logs | API recovers after restart; errors traceable without secrets | `sudo reboot`: site back in 15 s; smoke test 32/32 again; order #1 kept, next order #2 (`reboot-recovery-smoke-test.png`). Logs show method, path, status and time only; 0 matches for connection strings, passwords or keys (`server-status.png`) | PASS |
| Database outage | Health reports it; app recovers | **First run failed:** with PostgreSQL stopped the site returned **502** and the API stayed down after the database restarted (`db-outage-before-fix-502.png`). **After the fix:** health **503** `database: unreachable`, products 500 with a trace id, API still active, health 200 again as soon as PostgreSQL was back (`db-outage-after-fix-503.png`) | PASS after fix |
| Network exposure | Only the web entry point is public | Listening: Caddy `*:80`, `*:443`; Express `127.0.0.1:3000`; PostgreSQL `127.0.0.1:5432`. From the internet, ports 3000 and 5432 do not answer | PASS |
| Secrets and credits | No secret in repo, browser files or screenshots; credits within plan | `api.env` mode 640 `root:shopsmart`; DB password generated on the instance; JS bundle scan 0 hits; the repo branch tracks no `.env`. Screenshots crop the account number. Credits US$100.00 remaining (`aws-credits.png`) | PASS |

**Automated hosted smoke test** (`deploy/ec2/smoke-test.sh`): **32 passed, 0 failed** on the first run (`hosted-smoke-test-1.png`), and again after the reboot.

## The two improvements and their retests

### Improvement 1: sign-in and server-side order ownership

- **Before:** no accounts. `POST /api/orders` accepted anyone, and orders had no owner, so a private order route could not be protected.
- **Change:** customer accounts (scrypt password hashes), server-side sessions in an `HttpOnly`/`Secure`/`SameSite=Lax` cookie, `Order.userId` (additive migration that keeps existing orders), and owner-only `GET /api/orders` and `GET /api/orders/:id`.
- **Retest (hosted):** guest 401 → owner 200 → other customer 403 by direct API request → logout 401. All PASS. Also covered by `backend/test/auth.test.js` (7 tests).

### Improvement 2: the API survives a database restart

- **Found during hosted testing:** stopping PostgreSQL also stopped the API because the systemd unit used `Requires=postgresql.service`. Visitors got 502 and the site stayed down after the database came back.
- **Change:** `Wants=` instead of `Requires=` in `deploy/ec2/shopsmart-api.service` (smallest cause). Together with the earlier health-check fix, `/api/health` reports 503 during an outage instead of a false "ok".
- **Retest (hosted):** stop PostgreSQL → health 503 and API still active → start PostgreSQL → health 200 without restarting the API. Then a full reboot → back in 15 s, smoke test 32/32, data kept. PASS.

## Not tested live, and why

- **Sign-in through the web form:** account creation and sign-in were tested through the hosted API and in the local production rehearsal, not typed into the live page by the assistant. The student demonstrates the form flow in the recording, using a fictional account and a password not used anywhere else.
- **Live AI provider:** not enabled, to keep the demo within the free plan and avoid sending any data to a third party.
