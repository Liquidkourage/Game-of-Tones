# Stripe setup for TEMPO (pay-as-you-like)

Use this once per environment (test first, then live).

## 1. Stripe account

1. Sign in at [https://dashboard.stripe.com](https://dashboard.stripe.com).
2. Turn on **Test mode** (toggle top-right) while developing.

## 2. API keys (Railway → Variables)

| Variable | Where to get it |
|----------|-----------------|
| `STRIPE_SECRET_KEY` | Stripe → **Developers** → **API keys** → **Secret key** (`sk_test_…` or `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | After step 3 — signing secret (`whsec_…`) |
| `PUBLIC_APP_URL` | Your app origin users open in the browser, e.g. `https://tempo.liquidkourage.com` (no trailing slash) |

Optional:

| Variable | When |
|----------|------|
| `STRIPE_WEBHOOK_BASE_URL` | API on a **different** host than the React app — set to the **server** origin (where `/api/webhooks/stripe` is reachable) |
| `TEMPO_REQUIRE_ORG_BILLING` | `0` = pay optional (default). `1` = must pay before creating host rooms |

Redeploy after changing variables.

## 3. Webhook endpoint

Stripe must notify your server when checkout completes.

### Production (Railway)

1. Stripe → **Developers** → **Webhooks** → **Add endpoint**.
2. **Endpoint URL:** your server URL + `/api/webhooks/stripe`  
   Example (single-service deploy): `https://YOUR-RAILWAY-DOMAIN.railway.app/api/webhooks/stripe`  
   On `/org` as owner, the **Pay as you like** section shows the exact URL to copy when Stripe is not configured yet.
3. **Events:** select `checkout.session.completed`.
4. Create endpoint → reveal **Signing secret** → set `STRIPE_WEBHOOK_SECRET` in Railway → redeploy.

### Local dev

```bash
stripe login
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

Use the `whsec_…` printed by `stripe listen` as `STRIPE_WEBHOOK_SECRET` in your local `.env`.  
Run the Node server on the same port (or adjust the forward URL).

## 4. Verify

1. Redeploy with all three vars set (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_APP_URL`).
2. Open **`/org`** as org owner — pay buttons should appear (no “not configured” message).
3. Pay **$1** in test mode with card `4242 4242 4242 4242`, any future expiry, any CVC.
4. Return to `/org?billing=success` — status should show **supporter** and lifetime amount.

If checkout works but status stays **none**, the webhook failed — check Stripe → Webhooks → event log and Railway logs.

## 5. Go live

1. Stripe dashboard → turn off Test mode.
2. Create a **live** webhook endpoint (same path, production domain).
3. Replace Railway vars with **live** `sk_live_…` and live `whsec_…`.
4. Redeploy.

## Security

- Never commit `sk_` or `whsec_` keys to git.
- Use Railway (or host) secrets only.
- Test and live keys must match test/live webhooks.

See also [`ORG_BILLING.md`](ORG_BILLING.md) for product behavior.
