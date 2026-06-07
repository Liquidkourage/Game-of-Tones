# Stripe setup for TEMPO (event credits + subscriptions)

Use this once per environment (test first, then live).

## 1. Stripe account

1. Sign in at [https://dashboard.stripe.com](https://dashboard.stripe.com).
2. Turn on **Test mode** while developing.

## 2. Products & prices

Create **one-time** and **recurring** prices in Stripe → **Product catalog**.

### Monthly subscriptions

| Variable | Product |
|----------|---------|
| `STRIPE_PRICE_MONTHLY_BASIC` | Basic — $59/mo (5 events) |
| `STRIPE_PRICE_MONTHLY_PRO` | Pro — $99/mo |
| `STRIPE_PRICE_MONTHLY_PLUS` | Plus — $149/mo |
| `STRIPE_PRICE_MONTHLY_COMPANY` | Company — $299/mo |
| `STRIPE_PRICE_MONTHLY_ENTERPRISE` | Enterprise — $499/mo (unlimited) |

Legacy (optional fallback if Basic+ not set): `STRIPE_PRICE_MONTHLY_10`, `_25`, `_50`.

### One-time

| Variable | Product |
|----------|---------|
| `STRIPE_PRICE_TRIAL_7D` | 7-day trial — $29 |
| `STRIPE_PRICE_SINGLE_EVENT` | Single event pass — $15 |
| `STRIPE_PRICE_PACK_5` | 5 events — $60 |
| `STRIPE_PRICE_PACK_10` | 10 events — $100 |
| `STRIPE_PRICE_PACK_25` | 25 events — $200 |

Copy each **Price ID** (`price_…`) into Railway/env.

## 3. Customer Portal

Stripe → **Settings** → **Billing** → **Customer portal**:

- Enable **Pause payments** (subscription pause)
- Enable cancel / update payment method

Owners use **Manage billing** in `/org`.

## 4. Promotion codes (optional)

Create coupons + promotion codes in Stripe for discounts. Link Stripe promotion code IDs in TEMPO admin:

```http
POST /api/admin/promo-codes
{
  "code": "ACME15",
  "stripePromotionCodeId": "promo_…",
  "bonusEventCredits": 2
}
```

Owners enter the code at subscription checkout in `/org`.

## 5. API keys (Railway → Variables)

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | `sk_test_…` or `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from webhook endpoint |
| `PUBLIC_APP_URL` | App origin (checkout return URLs) |
| `TEMPO_REQUIRE_ORG_BILLING` | `0` = optional gate; `1` = require trial, subscription, or credits to create rooms |

Optional: `STRIPE_WEBHOOK_BASE_URL` if API host ≠ app host.

## 6. Webhook endpoint

**URL:** `https://YOUR_API_HOST/api/webhooks/stripe`

**Events:**

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded` (or `invoice.paid`)
- `invoice.payment_failed`

## 7. Admin: bonus credits for an org

```http
POST /api/admin/organizations/:id/credits
{ "delta": 2, "reason": "Launch partner" }
```

## 8. Verify

1. Owner opens `/org` → buy trial or single event → credits appear.
2. Subscribe to Basic → `invoice.payment_succeeded` grants 5 monthly credits.
3. Host **Start Game** or full print consumes 1 credit (when billing ready).
4. **Preview card** in Round planner does not consume a credit.

Full product rules: [`docs/PRICING.md`](docs/PRICING.md).
