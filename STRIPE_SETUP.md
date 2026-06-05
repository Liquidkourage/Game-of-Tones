# Stripe setup for TEMPO (subscriptions + pay-as-you-like)

Use this once per environment (test first, then live).

## 1. Stripe account

1. Sign in at [https://dashboard.stripe.com](https://dashboard.stripe.com).
2. Turn on **Test mode** (toggle top-right) while developing.

## 2. Products & prices (monthly tiers)

1. Stripe → **Product catalog** → **Add product** (e.g. "TEMPO monthly support").
2. Add recurring **Prices** (monthly): e.g. $10, $25, $50.
3. Copy each **Price ID** (`price_…`).

In Railway → Variables:

| Variable | Example |
|----------|---------|
| `STRIPE_PRICE_MONTHLY_10` | `price_…` for $10/month |
| `STRIPE_PRICE_MONTHLY_25` | `price_…` for $25/month |
| `STRIPE_PRICE_MONTHLY_50` | `price_…` for $50/month |

At least one tier enables **Monthly support** buttons in `/org`. Pay-as-you-like works without these.

## 3. Customer Portal

Stripe → **Settings** → **Billing** → **Customer portal** → enable.

Owners use **Manage billing** in `/org` to change plan or cancel.

## 4. API keys (Railway → Variables)

| Variable | Where to get it |
|----------|-----------------|
| `STRIPE_SECRET_KEY` | Stripe → **Developers** → **API keys** → **Secret key** (`sk_test_…` or `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | After step 5 — signing secret (`whsec_…`) |
| `PUBLIC_APP_URL` | Your app origin users open in the browser, e.g. `https://tempo.liquidkourage.com` (no trailing slash) |

Optional:

| Variable | When |
|----------|------|
| `STRIPE_WEBHOOK_BASE_URL` | API on a **different** host than the React app — set to the **server** origin (where `/api/webhooks/stripe` is reachable) |
| `TEMPO_REQUIRE_ORG_BILLING` | `0` = pay optional (default). `1` = must have active subscription or prior payment before creating host rooms |

Redeploy after changing variables.

## 5. Webhook endpoint

Stripe must notify your server when checkout completes and when subscriptions change.

### Production (Railway)

1. Stripe → **Developers** → **Webhooks** → **Add endpoint**.
2. **Endpoint URL:** your server URL + `/api/webhooks/stripe`  
   Example (single-service deploy): `https://YOUR-RAILWAY-DOMAIN.railway.app/api/webhooks/stripe`  
   On `/org` as owner, the setup section shows the exact URL to copy when Stripe is not configured yet.
3. **Events:** select:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Create endpoint → reveal **Signing secret** → set `STRIPE_WEBHOOK_SECRET` in Railway → redeploy.

### Local dev

```bash
stripe login
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

Use the `whsec_…` printed by `stripe listen` as `STRIPE_WEBHOOK_SECRET` in your local `.env`.  
Run the Node server on the same port (or adjust the forward URL).

## 6. Verify

1. Redeploy with Stripe vars set.
2. Open **`/org`** as org owner — monthly tier buttons and pay-as-you-like should appear.
3. Subscribe at **$10/month** (test card `4242 4242 4242 4242`, any future expiry, any CVC).
4. Return to `/org?billing=success` — status should show **subscribed** and monthly **active**.
5. Click **Manage billing** — Stripe Customer Portal opens.

If checkout works but status stays **none**, the webhook failed — check Stripe → Webhooks → event log and Railway logs.

## 7. Go live

1. Stripe dashboard → turn off Test mode.
2. Create **live** Products/Prices and update `STRIPE_PRICE_MONTHLY_*` with live Price IDs.
3. Create a **live** webhook endpoint (same path, production domain).
4. Replace Railway vars with **live** `sk_live_…` and live `whsec_…`.
5. Redeploy.

## Security

- Never commit `sk_`, `whsec_`, or `price_` keys to git if you treat them as secrets (Price IDs are lower risk but keep in env).
- Use Railway (or host) secrets only.
- Test and live keys must match test/live webhooks.

See also [`ORG_BILLING.md`](ORG_BILLING.md) for product behavior.
