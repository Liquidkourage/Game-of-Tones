# Organization onboarding & billing

## Overview

Hosts belong to an **organization**. The **owner** creates the org, invites other hosts by email, and pays via **Stripe**:

- **Monthly subscription** — suggested tiers ($10 / $25 / $50) when configured
- **Pay-as-you-like** — one-time Checkout ($10 / $25 / $50 / $100 or custom)

One payment or subscription covers **all hosts** in that org.

## Self-serve flow

1. Sign in with Google on the app (Home → Host).
2. Open **Organization & billing** (`/org`).
3. **Create organization** (venue / team name).
4. **Invite hosts** — adds email to allowlist and links them when they sign in.
5. **Subscribe monthly** or **pay as you like** — Stripe Checkout; webhooks update org status.

Invited hosts sign in with the **same Google email** they were invited with.

**Stripe Dashboard + Railway setup:** see [`STRIPE_SETUP.md`](STRIPE_SETUP.md).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Required for orgs, invites, payments |
| `STRIPE_SECRET_KEY` | Stripe API (Checkout + Customer Portal) |
| `STRIPE_WEBHOOK_SECRET` | Verify `POST /api/webhooks/stripe` |
| `PUBLIC_APP_URL` | Checkout success/cancel URLs (e.g. `https://app.example.com`) |
| `STRIPE_PRICE_MONTHLY_10` | Stripe Price ID for $10/month tier (optional) |
| `STRIPE_PRICE_MONTHLY_25` | Stripe Price ID for $25/month tier (optional) |
| `STRIPE_PRICE_MONTHLY_50` | Stripe Price ID for $50/month tier (optional) |
| `TEMPO_REQUIRE_ORG_BILLING` | `0` (default) = hosting allowed without payment; `1` = require active subscription or prior payment |

Configure at least one `STRIPE_PRICE_MONTHLY_*` to show monthly tiers in `/org`.

## Stripe webhook

Register in the Stripe Dashboard:

- **URL:** `https://YOUR_API_HOST/api/webhooks/stripe`
- **Events:**
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

The route uses raw body parsing (registered before `express.json`).

Enable **Customer Portal** in Stripe (Settings → Billing → Customer portal) so owners can change/cancel subscriptions.

## API (host JWT)

| Method | Path | Who |
|--------|------|-----|
| GET | `/api/org/me` | Signed-in host |
| POST | `/api/org` | Create org (owner) |
| POST | `/api/org/invites` | Owner invites email |
| DELETE | `/api/org/invites` | Owner removes pending invite |
| GET | `/api/org/billing/tiers` | Configured subscription tiers |
| POST | `/api/org/billing/subscribe` | Owner — body `{ "tierKey": "25" }` or `{ "priceId": "price_…" }` |
| POST | `/api/org/billing/checkout` | Owner — body `{ "amountCents": 2500 }` (one-time) |
| POST | `/api/org/billing/portal` | Owner — Stripe Customer Portal URL |

`GET /api/auth/me` includes `organization` and `billing` summaries.

## Gating hosting

When `TEMPO_REQUIRE_ORG_BILLING=1`, `POST /api/host/rooms` returns **402** if the host has no org or billing is inactive — **but only after** Stripe is fully configured (`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`). Until then, hosting stays open so you are not locked out while finishing setup.

**Active billing** means any of:

- Stripe subscription `active`, `trialing`, or `past_due`
- Prior one-time payment (`billing_status: supporter` or `lifetime_paid_cents > 0`)

Until you flip that flag, everyone can still host; the org portal encourages voluntary support.

## Admin vs org portal

- **`/admin`** — platform admins (`TEMPO_ADMIN_EMAILS`): all orgs, enterprise Spotify apps, venue JSON.
- **`/org`** — org **owners**: invites, monthly subscription, pay-as-you-like, member list.

Enterprise Spotify credentials are still configured in Admin (or env); self-serve orgs use the server default Spotify app until a custom app is assigned.

## Legacy license keys

License keys (`TEMPO-ORG-YEAR-*`) are **not** used for onboarding or billing. See [`CUSTOMER_ONBOARDING.md`](CUSTOMER_ONBOARDING.md).
