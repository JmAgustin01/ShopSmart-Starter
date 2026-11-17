# Decision Record: ShopSmart AWS Deployment

**Decision date:** 17 November 2026 · **Decided by:** John Michael Agustin · **Status:** deployed for a short classroom demonstration

## Context

ShopSmart needs a short, hosted demonstration where a visitor can browse products, use the cart and ask the assistant, and a fictional test customer can sign in, place a simulated order and see only their own orders. Only fictional data is used. The account is on the AWS **Free plan** with **US$100 credits** (credit expires 9 Nov 2027; free access ends **9 May 2027**). The demo needs to run for days, not months.

## Options considered

| Option | For | Against |
|---|---|---|
| **A. Single EC2 host** (chosen) | One resource to create, watch and delete. One HTTPS entry point. Lowest credit use. Easy to explain end to end. | Single point of failure. I maintain the OS, PostgreSQL, backups, HTTPS and cleanup. Data lives on the instance's volume. |
| B. Amplify + EC2 + RDS | Each service's job is visible. Managed database backups. | Three services to configure and pay for. RDS must be private, and the API still needs its own HTTPS endpoint for an Amplify (HTTPS) page. More credit use and more cleanup. |
| C. Local release only | No cost, no hosting risk. | Does not show the hosted customer journey the guide asks for. |

## Decision

**Option A: one EC2 `t3.micro` (Ubuntu 24.04) in `ap-southeast-1` (Singapore)**, the Region nearest the Philippines.

| Concern | How it is handled |
|---|---|
| Public entry | **Caddy** on ports 443/80 with an automatic HTTPS certificate for `<public-ip>.sslip.io` (a free DNS name that points at the instance's IP). Port 80 only redirects to HTTPS and answers the certificate check. |
| Frontend | Vite build files served by Caddy, with a single-page-app rewrite to `index.html`. Built with `VITE_API_URL=/api`, so the browser calls the API on the **same HTTPS origin**: no mixed content and no cross-site cookie. |
| API | Express runs as a **systemd** service (`shopsmart-api`): restarts on failure, starts after a reboot. Listens on **127.0.0.1:3000 only**, reachable only through Caddy. Logs go to `journalctl -u shopsmart-api`; request logs show method, path, status and time, never bodies, cookies or secrets. |
| Database | PostgreSQL 16 on the same instance, listening on **localhost only**. Port 5432 is not in the security group. Schema applied with **`prisma migrate deploy`** (committed migrations only). The seed runs **once**, only when the product table is empty. |
| Sign-in | Accounts with scrypt-hashed passwords. Server-side sessions with an `HttpOnly`, `SameSite=Lax`, `Secure` cookie. Every `/api/orders` route needs a session; an order can be read only by the account that placed it (guest **401**, other customer **403**). |
| Secrets | `DATABASE_URL` uses a password **generated on the instance** at first boot and stored only in `/etc/shopsmart/api.env` (mode 640, root and the service user). The user-data script contains no secret, because user data is visible in the EC2 console. No `.env`, key or password is in Git or the frontend bundle. |
| AI provider | **Off** (`AI_PROVIDER=off`). The assistant answers straight from the current catalog and the page labels these answers as catalog answers. A paid provider is not required for this demo. A key would go only in `api.env`. |
| Admin access | No key pair. SSH (22) is allowed only from AWS's **EC2 Instance Connect** address range, so an administrator connects through the console with their AWS sign-in. |
| AWS identity vs ShopSmart identity | IAM decides who can manage the instance. ShopSmart's own accounts and the API's ownership check decide who can read an order. Giving someone AWS access does not give them anyone's orders. |

## Consequences and what would change before a real online release

- **Single point of failure:** if the instance or its volume is deleted, the data is gone. For a real release: RDS (private, automated backups), or at least scheduled `pg_dump` to S3.
- **The URL depends on the public IP:** stopping and starting the instance changes the IP and therefore the `sslip.io` hostname, and the frontend's `FRONTEND_URL` setting. For a real release: a registered domain and an Elastic IP or a load balancer.
- **Certificates:** `sslip.io` shares Let's Encrypt's per-domain limit with all its users. Caddy falls back to ZeroSSL automatically. A real domain removes this risk.
- **Shopper data:** only fictional customers. Real customers would need a privacy notice, password reset, email verification, rate limits shared across instances, and a security review.
