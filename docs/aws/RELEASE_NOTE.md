# ShopSmart Release Note: AWS Hosted Demo

**Version and date:** ShopSmart 1.1.0, 17 November 2026. GitHub `JmAgustin01/ShopSmart-Starter`, branch `aws-release` (commit `ab0c7aa` or later).

**Deployment status:** **hosted** on one AWS EC2 instance (Free plan account, Region `ap-southeast-1`).
**Site:** https://13-212-160-135.sslip.io · **Health:** https://13-212-160-135.sslip.io/api/health
**Smoke test:** 32/32 passed on 17 Nov 2026, and 32/32 again after a reboot (`HOSTED_VERIFICATION.md`).

## Working features (verified on the hosted URL)

- Product list, details, search with a no-results message, category filter and sort
- Cart with correct totals; refreshing a deep link (`/products/2`, `/account`) opens the app
- Customer accounts: create account, sign in, sign out
- Simulated checkout for signed-in customers only, with field-specific validation and the stock rule
- "My orders": a customer sees only their own orders; another customer's order is refused (403) even by direct API request
- Catalog-grounded assistant with source links and honest no-match answers
- HTTPS everywhere; the API and database are not reachable from the internet
- Recovers on its own after a reboot or a database restart

## Known limitations

- **Cart is in browser memory:** a full page reload empties it.
- **AI phrasing is off:** answers come straight from the catalog, labelled as such. A key would be added only on the server.
- **Single server:** if the instance is terminated the data goes with it; there are no automated backups.
- **URL tied to the public IP:** a stop/start (not a reboot) changes it and needs `FRONTEND_URL` updated.
- **Accounts are basic:** no password reset or email verification. Fictional customers only.

## What changed since the local release candidate

1. Sign-in, sessions and order ownership, with an additive Prisma migration `20261117080425_add_users_sessions_order_owner`
2. `deploy/ec2/`: launch script, user-data bootstrap, Caddyfile, systemd unit, data-safe update script and hosted smoke test
3. API can bind to loopback only (`HOST`)
4. Fix: a database restart no longer stops the API (`Wants` instead of `Requires`)
5. Repository hygiene: `node_modules` and `.env` files are no longer tracked; `.gitignore` added

## Local startup

Follow `README.md`. New since Week 6 part 1: run `npm run db:migrate` once to apply the new migration; it only adds tables and a column. Then use **Sign in → Create an account** before checkout.

## Removal

Planned by **30 Nov 2026**. The commands are in `RESOURCE_REGISTER.md`.

## Student record

Completed individually by **John Michael Agustin**.

- **Test I ran:** the hosted ownership test. Ben requesting Ana's order directly (`GET /api/orders/1`) gets **403 ORDER_FORBIDDEN**, while Ana gets 200.
- **Contribution:** built sign-in and order ownership, deployed the single-EC2 release, and ran the hosted verification.
- **Issue I can explain:** the systemd `Requires=` bug. Stopping PostgreSQL also stopped the API and left the site at 502 after the database returned. `Wants=` keeps the API running, so health reports 503 and the API recovers by itself.
