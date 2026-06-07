# TEMPO pricing & billing entitlements

Product source of truth for show credits, subscriptions, and Stripe. Client-facing summary: [`tempo-pricing-sales-guide.pdf`](tempo-pricing-sales-guide.pdf).

Implementation status: **shipped in code** when Stripe Price env vars + webhooks are configured. Event gates apply when `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` are set (`billingReady`).

---

## Plans (monthly)

| Tier | Price | Events / month | Notes |
|------|-------|----------------|-------|
| Trial | $29 once | Unlimited · 7 days | Hard stop after; $29 credit toward first Basic+ invoice |
| Basic | $59 | 5 | Formerly “Starter” |
| Pro | $99 | 10 | |
| Plus | $149 | 20 | |
| Company | $299 | 50 | |
| Enterprise | $499 | Unlimited activations | Same UX; no credit burn |

- **Annual:** 15% off subscription. Trial $29 credit applies **after** that discount on first paid invoice (once per org).
- **Extra event (subscription add-on):** $15 when monthly pool is empty.
- **Event packs (Basic+ only):** 5 / $60 · 10 / $100 · 25 / $200 — requires **active paid subscription** (see Pack gate).

---

## What one credit buys

- **1 event credit** = one **activated event night** in one room, up to **12 rounds**.
- **Unlimited hosts and players** on that event.
- **Multiple rooms same night** = one credit per room (each gets its own `event_id`).
- Credit burns on first **gated action**: full printable PDF, **Start Game**, or explicit **Activate event** (with confirmation).
- **Free before activation:** round planner, local save, **one watermarked preview card** per round.
- **Event window:** up to **36 hours** or until host **End event** (whichever comes first).
- **Auto-refund:** if `songsPlayed ≤ 3`, `players === 0`, and **no full PDF** was issued.

### Credit consumption order

1. Monthly plan allowance (current period)  
2. Rollover (max **3**, oldest first, **1-month expiry**, active subscription only)  
3. Pack inventory  
4. Single-purchase / admin-grant credits  
5. Block → CTA: subscribe, **$15 extra**, or pack (if eligible)

---

## Requirement: pause subscriptions

### Product rules

| While paused | Behavior |
|--------------|----------|
| Monthly credits | **Not issued** for paused months |
| Rollover expiry | **Frozen** — clocks resume on unpause |
| Existing credit pool | **Usable** — hosts can run prepaid nights |
| Pack purchase | **Blocked** (no active subscription) |
| Single event ($15) | **Allowed** — pay-as-you-go path stays open |
| Hosting gate | **Allowed** if org has ≥1 credit or trial still active |
| Customer Portal | Owner can pause / resume (when enabled) |

**Pause vs cancel:** Pause keeps the org, Stripe customer, and credit ledger. Cancel at period end stops renewal; rollover rules apply per cancel policy (forfeit unused rollover when sub lapses — see Rollover).

**Stripe:** Use subscription **`pause_collection`** (`behavior: mark_uncollectible` or `void`) or enable **Pause payments** in [Customer Portal settings](https://dashboard.stripe.com/settings/billing/portal). Map Stripe status to org `subscription_status = paused` and set `subscription_paused_at`.

**TEMPO UI:** Org portal shows **Paused** badge, next resume date, remaining credits, and **Buy single event** CTA.

---

## Requirement: single event credits without a subscription

Hosts who are **not subscribed** (or are paused / post-trial) can still run shows by buying **one event at a time**.

| Product | Price | Who | Grants |
|---------|-------|-----|--------|
| **Single event pass** | **$15** | Any org with Stripe customer (or creates one at checkout) | **+1** event credit, source `single_purchase` |
| Trial | $29 / 7d | New orgs | Unlimited activations for 7 days |
| Pack 5 / 10 / 25 | $60 / $100 / $200 | **Basic+ active sub only** | Pack inventory |

### Rules

- Single-event credits **never expire** (or 12-month expiry — pick at implement time; recommend **no expiry** for simplicity).
- Single-event credits **do not** unlock pack pricing — packs remain subscription-only.
- Checkout: Stripe **one-time** Price `STRIPE_PRICE_SINGLE_EVENT` ($15).
- After payment, webhook adds `+1` to org ledger; host activates event as usual.
- **No subscription required** to complete checkout or to **consume** a single-event credit.

### Sales positioning

> “Not ready for a plan? Run one night for $15 — same unlimited players and up to twelve rounds.”

---

## Requirement: block pack purchases without subscription

**Event packs are only sold to orgs on Basic (or higher) with an active, non-paused subscription.**

### Server checks (before pack Checkout)

```
allow_pack_checkout(org) =
  subscription_tier ∈ { basic, pro, plus, company, enterprise }
  AND subscription_status ∈ { active, trialing }
  AND NOT paused
```

| Org state | Single $15 | Monthly sub | Packs |
|-----------|------------|-------------|-------|
| No sub, post-trial | ✅ | ✅ | ❌ |
| Paused sub | ✅ | Resume only | ❌ |
| Basic+ active | ✅ | ✅ | ✅ |
| Trial (7-day) | N/A (unlimited) | CTA to Basic+ | ❌ |
| Enterprise | N/A | Included | N/A (unlimited) |

**UI:** Hide pack buttons or show disabled state: *“Event packs require an active Basic plan or higher.”*

**Stripe:** Separate one-time Prices for pack SKUs; never expose pack Price IDs to client without server eligibility check.

---

## Requirement: coupon & promo codes

Two layers: **Stripe discounts** (money off checkout) and **TEMPO bonus credits** (ledger grants).

### A. Stripe Promotion Codes (discounts)

Create in Stripe Dashboard or API:

| Type | Example | Applies to |
|------|---------|------------|
| Percent off | `PARTNER20` → 20% off | First subscription invoice |
| Amount off | `LAUNCH50` → $50 off | First annual Basic |
| Trial credit | Handled as customer balance or once coupon `TRIAL29` | First invoice after trial |

**Checkout:** Pass `allow_promotion_codes: true` on subscription Checkout, or `discounts: [{ promotion_code }]` when code validated server-side.

**First org example:** `ACME15` — 15% off first 3 months of Basic — create Promotion Code linked to a Coupon in Stripe; share code with owner; they enter at Checkout.

### B. Admin bonus event credits (TEMPO ledger)

Stripe cannot grant “+2 event nights” natively — grant credits in Postgres when:

- Admin runs **Grant credits** in `/admin` for an org, or  
- Webhook reads subscription/checkout **`metadata`** (e.g. `bonus_event_credits: 2`) and inserts ledger rows.

Suggested table:

```sql
-- org_event_credits ledger (append-only)
organization_id, delta, balance_after, source, source_ref, created_at, expires_at
-- source: monthly | rollover | pack | single_purchase | admin_grant | coupon | refund
```

Admin API (platform admin only):

```
POST /api/admin/organizations/:id/credits
{ "delta": 2, "reason": "Launch partner — ACME", "expiresAt": null }
```

### C. Combined promo (discount + bonus credits)

For “20% off + 2 free events”:

1. Stripe Promotion Code for **20% off** subscription.  
2. Same code stored in TEMPO `promo_codes` table with `bonus_event_credits: 2`.  
3. On `checkout.session.completed` or `customer.subscription.created`, if promo matches → grant credits once per org.

```sql
promo_codes (
  code TEXT UNIQUE,
  stripe_promotion_code_id TEXT,
  bonus_event_credits INT DEFAULT 0,
  max_redemptions INT,
  redeem_by TIMESTAMPTZ,
  active BOOLEAN
)
promo_redemptions (promo_code_id, organization_id, redeemed_at)
```

---

## Pause + rollover + packs (edge cases)

| Question | Answer |
|----------|--------|
| Paused mid-month, 2 of 5 credits unused? | Unused monthly credits roll per normal rules; no new monthly drop while paused. |
| Buy pack then pause? | Pack balance remains; cannot buy more packs until active again. |
| Single event while paused? | Yes. |
| Trial ended, no sub? | Single event $15 only; no packs until Basic+. |

---

## Stripe SKUs to configure

| Env var | Product |
|---------|---------|
| `STRIPE_PRICE_TRIAL_7D` | $29 one-time trial |
| `STRIPE_PRICE_MONTHLY_BASIC` … `ENTERPRISE` | Monthly tiers |
| `STRIPE_PRICE_ANNUAL_BASIC` … | Annual tiers (optional phase 2) |
| `STRIPE_PRICE_SINGLE_EVENT` | **$15 one-time** |
| `STRIPE_PRICE_PACK_5` / `_10` / `_25` | Pack one-times (gated) |
| `STRIPE_PRICE_EXTRA_EVENT` | $15 subscription add-on invoice item (optional; or reuse single-event price) |

Portal: enable **pause**, **cancel**, **update payment method**.

Webhooks to add: `customer.subscription.paused`, `customer.subscription.resumed` (if using Stripe pause API).

---

## Implementation order (suggested)

1. **Ledger + single $15 checkout** — unblocks pay-per-night without sub.  
2. **Subscription tiers** (Basic–Enterprise) + monthly credit grant on invoice paid.  
3. **Pack checkout + gate** — server eligibility.  
4. **Pause** — webhook + portal; freeze rollover expiry.  
5. **Admin credit grant + promo_codes** — first org launch.  
6. **Event activation gate** — `finalize-mix`, print, `start-game` (see show rules).

---

## First org launch checklist

1. Create org in admin or self-serve.  
2. Create Stripe Promotion Code (e.g. `% off Basic`).  
3. `POST /api/admin/organizations/:id/credits` with bonus events (until UI exists).  
4. Owner subscribes with promo at Checkout.  
5. Confirm ledger: monthly + bonus + promo discount on invoice.

---

## Related docs

- [`ORG_BILLING.md`](../ORG_BILLING.md) — current org Stripe integration (legacy $10/$25/$50 tiers until migrated)  
- [`STRIPE_SETUP.md`](../STRIPE_SETUP.md) — keys, webhooks, portal  
- [`.cursor/rules/game-of-tones-show.mdc`](../.cursor/rules/game-of-tones-show.mdc) — play order / activation gates
