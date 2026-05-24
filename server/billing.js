/**
 * Org billing: Stripe Checkout (pay-as-you-like) + optional host gate.
 */

const Stripe = require('stripe');

const MIN_AMOUNT_CENTS = 100;
const MAX_AMOUNT_CENTS = 500_000;

function isBillingGateEnabled() {
  const v = String(process.env.TEMPO_REQUIRE_ORG_BILLING || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function isStripeConfigured() {
  return !!(process.env.STRIPE_SECRET_KEY || '').trim();
}

function isWebhookSecretConfigured() {
  return !!(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

function stripeKeyMode() {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (key.startsWith('sk_live_')) return 'live';
  if (key.startsWith('sk_test_')) return 'test';
  return key ? 'unknown' : null;
}

function getStripe() {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key);
}

function publicAppOrigin() {
  const raw = (
    process.env.PUBLIC_APP_URL ||
    process.env.CLIENT_APP_URL ||
    process.env.CLIENT_URL ||
    ''
  ).trim();
  if (raw) return raw.replace(/\/$/, '');
  return 'http://localhost:3000';
}

/** Base URL for Stripe webhooks (API host). Defaults to PUBLIC_APP_URL on single-service deploys. */
function webhookBaseOrigin() {
  const raw = (process.env.STRIPE_WEBHOOK_BASE_URL || process.env.API_PUBLIC_URL || '').trim();
  if (raw) return raw.replace(/\/$/, '');
  return publicAppOrigin();
}

function stripeWebhookUrl() {
  return `${webhookBaseOrigin()}/api/webhooks/stripe`;
}

function billingSetupStatus(req) {
  return {
    stripeSecretConfigured: isStripeConfigured(),
    stripeWebhookConfigured: isWebhookSecretConfigured(),
    stripeKeyMode: stripeKeyMode(),
    publicAppUrl: publicAppOrigin(),
    webhookUrl: req ? stripeWebhookUrlFromRequest(req) : stripeWebhookUrl(),
    webhookUrlEnv: stripeWebhookUrl(),
    gateEnabled: isBillingGateEnabled(),
    ready: isStripeConfigured() && isWebhookSecretConfigured(),
  };
}

function stripeWebhookUrlFromRequest(req) {
  if (!req || !req.get) return stripeWebhookUrl();
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  if (!host) return stripeWebhookUrl();
  return `${proto}://${host}/api/webhooks/stripe`;
}

async function ensureBillingTables(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS org_payments (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      stripe_checkout_session_id TEXT UNIQUE,
      stripe_payment_intent_id TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_org_payments_org_id ON org_payments (organization_id)
  `);
  return true;
}

/** When gate is off, all orgs pass. When on, org must have paid at least once (supporter). */
function isOrgBillingActive(orgRow) {
  if (!isBillingGateEnabled()) return true;
  if (!orgRow) return false;
  if (orgRow.billing_status === 'supporter') return true;
  if (orgRow.lifetime_paid_cents > 0) return true;
  return false;
}

function billingSummaryFromOrg(orgRow) {
  if (!orgRow) {
    return {
      gateEnabled: isBillingGateEnabled(),
      stripeConfigured: isStripeConfigured(),
      active: !isBillingGateEnabled(),
      status: 'none',
      lifetimePaidCents: 0,
      lastPaymentAt: null,
    };
  }
  return {
    gateEnabled: isBillingGateEnabled(),
    stripeConfigured: isStripeConfigured(),
    active: isOrgBillingActive(orgRow),
    status: orgRow.billing_status || 'none',
    lifetimePaidCents: Number(orgRow.lifetime_paid_cents) || 0,
    lastPaymentAt: orgRow.last_payment_at || null,
  };
}

async function recordOrgPayment(db, {
  organizationId,
  sessionId,
  paymentIntentId,
  amountCents,
  currency,
  status,
}) {
  await ensureBillingTables(db);
  await db.query(
    `INSERT INTO org_payments (organization_id, stripe_checkout_session_id, stripe_payment_intent_id, amount_cents, currency, status, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END)
     ON CONFLICT (stripe_checkout_session_id) DO UPDATE SET
       status = EXCLUDED.status,
       stripe_payment_intent_id = COALESCE(EXCLUDED.stripe_payment_intent_id, org_payments.stripe_payment_intent_id),
       completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN CURRENT_TIMESTAMP ELSE org_payments.completed_at END`,
    [organizationId, sessionId, paymentIntentId || null, amountCents, currency || 'usd', status]
  );
  if (status === 'completed' && amountCents > 0) {
    await db.query(
      `UPDATE organizations SET
         billing_status = 'supporter',
         lifetime_paid_cents = COALESCE(lifetime_paid_cents, 0) + $2,
         last_payment_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [organizationId, amountCents]
    );
  }
}

async function createPayAsYouLikeCheckout(db, { organizationId, orgName, amountCents, hostUserId }) {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured on this server (STRIPE_SECRET_KEY)');
  }
  const cents = Math.round(Number(amountCents));
  if (!Number.isFinite(cents) || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) {
    throw new Error(`Amount must be between $${(MIN_AMOUNT_CENTS / 100).toFixed(2)} and $${(MAX_AMOUNT_CENTS / 100).toFixed(2)}`);
  }
  await ensureBillingTables(db);
  const stripe = getStripe();
  const appBase = publicAppOrigin();
  const label = String(orgName || 'TEMPO').trim() || 'TEMPO';
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: `TEMPO support — ${label}`,
            description: 'Pay-as-you-like. Covers all hosts in your organization.',
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${appBase}/org?billing=success`,
    cancel_url: `${appBase}/org?billing=cancelled`,
    metadata: {
      organization_id: String(organizationId),
      host_user_id: String(hostUserId),
    },
  });
  await recordOrgPayment(db, {
    organizationId,
    sessionId: session.id,
    paymentIntentId: null,
    amountCents: cents,
    currency: 'usd',
    status: 'pending',
  });
  return { sessionId: session.id, url: session.url };
}

async function listOrgPayments(db, organizationId, limit = 20) {
  await ensureBillingTables(db);
  const r = await db.query(
    `SELECT id, amount_cents, currency, status, created_at, completed_at
     FROM org_payments
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [organizationId, Math.min(50, Math.max(1, limit))]
  );
  return r.rows;
}

async function handleStripeWebhook(db, req, res) {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    res.status(503).send('STRIPE_WEBHOOK_SECRET not configured');
    return;
  }
  if (!db) {
    res.status(503).send('database unavailable');
    return;
  }
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('Stripe webhook signature failed:', err?.message || err);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orgId = parseInt(session.metadata?.organization_id || '', 10);
    const amount = session.amount_total != null ? session.amount_total : 0;
    if (Number.isFinite(orgId) && orgId > 0) {
      await recordOrgPayment(db, {
        organizationId: orgId,
        sessionId: session.id,
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        amountCents: amount,
        currency: session.currency || 'usd',
        status: 'completed',
      });
      const customerId = typeof session.customer === 'string' ? session.customer : null;
      if (customerId) {
        await db.query('UPDATE organizations SET stripe_customer_id = $2 WHERE id = $1 AND stripe_customer_id IS NULL', [
          orgId,
          customerId,
        ]);
      }
    }
  }

  res.json({ received: true });
}

module.exports = {
  MIN_AMOUNT_CENTS,
  MAX_AMOUNT_CENTS,
  isBillingGateEnabled,
  isStripeConfigured,
  isWebhookSecretConfigured,
  isOrgBillingActive,
  billingSummaryFromOrg,
  ensureBillingTables,
  createPayAsYouLikeCheckout,
  listOrgPayments,
  handleStripeWebhook,
  publicAppOrigin,
  stripeWebhookUrl,
  billingSetupStatus,
};
