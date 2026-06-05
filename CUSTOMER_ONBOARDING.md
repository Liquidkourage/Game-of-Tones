# TEMPO customer onboarding (organizations)

## Overview

Customers onboard through **Google sign-in** and a **database organization** — not license keys. The org owner creates the venue, invites co-hosts, and optionally pays via Stripe (monthly subscription or one-time support).

## Self-serve flow (recommended)

1. **Sign in with Google** on the app (Home → Host).
2. Open **Organization & billing** (`/org`).
3. **Create organization** (venue / school / team name).
4. **Invite hosts** by email — they sign in with the same Google address.
5. **Connect Spotify** from the host screen (Premium account).
6. **Start hosting** — create a room and run a show.

Optional billing:

- **Monthly support** — `$10` / `$25` / `$50` tiers when `STRIPE_PRICE_MONTHLY_*` env vars are set.
- **Pay as you like** — one-time Checkout amount.

One org payment covers **all hosts** in that organization.

## Platform admin setup (enterprise)

For venues that need a **dedicated Spotify Developer app** or custom branding:

1. Add the org in **`/admin`** (or assign `organization_id` + Spotify credentials).
2. Set **`owner_user_id`** if the customer should manage invites/billing in `/org`.
3. Configure **venue settings** JSON (branding, snippet defaults) in Admin.

See [`ORG_BILLING.md`](ORG_BILLING.md) and [`STRIPE_SETUP.md`](STRIPE_SETUP.md) for Stripe configuration.

## Environment variables (hosting gate)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Orgs, users, invites, billing |
| `TEMPO_APPROVED_HOSTS_ONLY` | When `1`, only allowlisted Google emails can host |
| `TEMPO_REQUIRE_ORG_BILLING` | When `1`, org must have active subscription or prior payment before creating rooms |

## Legacy license keys

`TEMPO-ORG-YEAR-*` keys and `tools/license-generator.js` are **deprecated**. They are not used in the host join flow. Do not send license keys to new customers.

## Customer email template

```
Subject: Welcome to TEMPO — get your venue set up

Hi [Name],

1. Visit: https://YOUR-TEMPO-APP
2. Click Host → Sign in with Google
3. Open Organization & billing (/org) → create "[Venue Name]"
4. Invite co-hosts by email (optional)
5. Connect Spotify Premium and start your first room

Questions? Reply to this email.

— The TEMPO team
```
