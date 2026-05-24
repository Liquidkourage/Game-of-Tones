# Organization onboarding & pay-as-you-like billing

## Overview

Hosts belong to an **organization**. The **owner** creates the org, invites other hosts by email, and pays via **Stripe Checkout** (pay-as-you-like: $10 / $25 / $50 / $100 or a custom amount). One payment covers **all hosts** in that org.

## Self-serve flow

1. Sign in with Google on the app (Home → Host).
2. Open **Organization & billing** (`/org`) or go directly to `/org`.
3. **Create organization** (venue / team name).
4. **Invite hosts** — adds email to allowlist and links them when they sign in.
5. **Pay as you like** — redirects to Stripe; webhook marks the org as `supporter`.

Invited hosts sign in with the **same Google email** they were invited with.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Required for orgs, invites, payments |
| `STRIPE_SECRET_KEY` | Stripe API (Checkout sessions) |
| `STRIPE_WEBHOOK_SECRET` | Verify `POST /api/webhooks/stripe` |
| `PUBLIC_APP_URL` | Checkout success/cancel URLs (e.g. `https://app.example.com`) |
| `TEMPO_REQUIRE_ORG_BILLING` | `0` (default) = hosting allowed without payment; `1` = require org + at least one completed payment |

## Stripe webhook

Register in the Stripe Dashboard:

- **URL:** `https://YOUR_API_HOST/api/webhooks/stripe`
- **Events:** `checkout.session.completed`

The route uses raw body parsing (registered before `express.json`).

## API (host JWT)

| Method | Path | Who |
|--------|------|-----|
| GET | `/api/org/me` | Signed-in host |
| POST | `/api/org` | Create org (owner) |
| POST | `/api/org/invites` | Owner invites email |
| DELETE | `/api/org/invites` | Owner removes pending invite |
| POST | `/api/org/billing/checkout` | Owner — body `{ "amountCents": 2500 }` |

`GET /api/auth/me` includes `organization` and `billing` summaries.

## Gating hosting

When `TEMPO_REQUIRE_ORG_BILLING=1`, `POST /api/host/rooms` returns **402** if the host has no org or the org has never completed a payment (`billing_status: supporter` or `lifetime_paid_cents > 0`).

Until you flip that flag, everyone can still host; the org portal encourages voluntary support.

## Admin vs org portal

- **`/admin`** — platform admins (`TEMPO_ADMIN_EMAILS`): all orgs, enterprise Spotify apps, venue JSON.
- **`/org`** — org **owners**: invites, pay-as-you-like, member list.

Enterprise Spotify credentials are still configured in Admin (or env); self-serve orgs use the server default Spotify app until a custom app is assigned.
