/**
 * Org billing: Stripe Checkout (pay-as-you-like + monthly subscriptions) + optional host gate.
 */

const Stripe = require('stripe');

const MIN_AMOUNT_CENTS = 100;
const MAX_AMOUNT_CENTS = 500_000;

const SUBSCRIPTION_ACTIVE_STATUSES = new Set(['active', 'trialing']);

const SUBSCRIPTION_TIER_SPECS = [
  { key: '10', label: '$10/month', usd: 10, env: 'STRIPE_PRICE_MONTHLY_10' },
  { key: '25', label: '$25/month', usd: 25, env: 'STRIPE_PRICE_MONTHLY_25' },
  { key: '50', label: '$50/month', usd: 50, env: 'STRIPE_PRICE_MONTHLY_50' },
];

function isBillingGateEnabled() {
  const v = String(process.env.TEMPO_REQUIRE_ORG_BILLING || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Stripe Checkout + webhooks must work before we block hosting — avoids lockout before setup. */
function isBillingReady() {
  return isStripeConfigured() && isWebhookSecretConfigured();
}

/** Env gate is on and Stripe can actually take payment and update org status. */
function isBillingGateEnforced() {
  return isBillingGateEnabled() && isBillingReady();
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

function getSubscriptionTiers() {
  const tiers = [];
  for (const spec of SUBSCRIPTION_TIER_SPECS) {
    const priceId = (process.env[spec.env] || '').trim();
    if (priceId) {
      tiers.push({ key: spec.key, label: spec.label, usd: spec.usd, priceId });
    }
  }
  return tiers;
}

function isSubscriptionsConfigured() {
  return getSubscriptionTiers().length > 0;
}

function billingSetupStatus(req) {
  const tiers = getSubscriptionTiers();
  return {
    stripeSecretConfigured: isStripeConfigured(),
    stripeWebhookConfigured: isWebhookSecretConfigured(),
    stripeKeyMode: stripeKeyMode(),
    publicAppUrl: publicAppOrigin(),
    webhookUrl: req ? stripeWebhookUrlFromRequest(req) : stripeWebhookUrl(),
    webhookUrlEnv: stripeWebhookUrl(),
    gateEnabled: isBillingGateEnabled(),
    gateEnforced: isBillingGateEnforced(),
    billingReady: isBillingReady(),
    ready: isBillingReady(),
    subscriptionTiersConfigured: tiers.length,
    subscriptionTiers: tiers.map(({ key, label, usd }) => ({ key, label, usd })),
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

function isSubscriptionActive(orgRow) {
  if (!orgRow) return false;
  const status = String(orgRow.subscription_status || '').toLowerCase();
  if (SUBSCRIPTION_ACTIVE_STATUSES.has(status)) return true;
  if (status === 'past_due') return true;
  return false;
}

/** When gate is not enforced, all orgs pass. When enforced, org needs subscription or prior payment. */
function isOrgBillingActive(orgRow) {
  if (!isBillingGateEnforced()) return true;
  if (!orgRow) return false;
  if (isSubscriptionActive(orgRow)) return true;
  if (orgRow.billing_status === 'supporter' || orgRow.billing_status === 'subscribed') return true;
  if (Number(orgRow.lifetime_paid_cents) > 0) return true;
  return false;
}

function billingSummaryFromOrg(orgRow) {
  const gateEnabled = isBillingGateEnabled();
  const gateEnforced = isBillingGateEnforced();
  const billingReady = isBillingReady();
  const tiers = getSubscriptionTiers().map(({ key, label, usd, priceId }) => ({ key, label, usd, priceId }));
  if (!orgRow) {
    return {
      gateEnabled,
      gateEnforced,
      billingReady,
      stripeConfigured: isStripeConfigured(),
      subscriptionsConfigured: isSubscriptionsConfigured(),
      subscriptionTiers: tiers,
      active: !gateEnforced,
      status: 'none',
      lifetimePaidCents: 0,
      lastPaymentAt: null,
      subscriptionStatus: 'none',
      subscriptionPeriodEnd: null,
      subscriptionActive: false,
    };
  }
  const subStatus = orgRow.subscription_status || 'none';
  return {
    gateEnabled,
    gateEnforced,
    billingReady,
    stripeConfigured: isStripeConfigured(),
    subscriptionsConfigured: isSubscriptionsConfigured(),
    subscriptionTiers: tiers,
    active: isOrgBillingActive(orgRow),
    status: orgRow.billing_status || 'none',
    lifetimePaidCents: Number(orgRow.lifetime_paid_cents) || 0,
    lastPaymentAt: orgRow.last_payment_at || null,
    subscriptionStatus: subStatus,
    subscriptionPeriodEnd: orgRow.subscription_period_end || null,
    subscriptionActive: isSubscriptionActive(orgRow),
  };
}

async function getOrganizationBillingRow(db, organizationId) {
  const r = await db.query(
    `SELECT id, billing_status, lifetime_paid_cents, last_payment_at, stripe_customer_id,
            stripe_subscription_id, subscription_status, subscription_period_end, subscription_price_id
     FROM organizations WHERE id = $1`,
    [organizationId]
  );
  return r.rows[0] || null;
}

async function getOrCreateStripeCustomer(stripe, db, organizationId, orgName) {
  const row = await getOrganizationBillingRow(db, organizationId);
  if (!row) throw new Error('Organization not found');
  if (row.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripe.customers.create({
    name: String(orgName || 'TEMPO').trim() || 'TEMPO',
    metadata: { organization_id: String(organizationId) },
  });
  await db.query('UPDATE organizations SET stripe_customer_id = $2 WHERE id = $1', [organizationId, customer.id]);
  return customer.id;
}

async function applySubscriptionToOrg(db, organizationId, subscription) {
  if (!subscription) return;
  const status = subscription.status || 'none';
  const periodEnd =
    subscription.current_period_end != null ? new Date(subscription.current_period_end * 1000) : null;
  const subId = subscription.id || null;
  const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || null;

  let billingStatus = null;
  if (status === 'active' || status === 'trialing') billingStatus = 'subscribed';
  else if (status === 'past_due') billingStatus = 'past_due';
  else if (status === 'canceled' || status === 'unpaid') billingStatus = 'supporter';

  await db.query(
    `UPDATE organizations SET
       stripe_subscription_id = $2,
       subscription_status = $3,
       subscription_period_end = $4,
       subscription_price_id = COALESCE($5, subscription_price_id),
       stripe_customer_id = COALESCE(stripe_customer_id, $6),
       billing_status = COALESCE($7, billing_status)
     WHERE id = $1`,
    [organizationId, subId, status, periodEnd, priceId, customerId, billingStatus]
  );
}

async function resolveOrganizationIdForSubscription(db, subscription) {
  const metaId = parseInt(subscription.metadata?.organization_id || '', 10);
  if (Number.isFinite(metaId) && metaId > 0) return metaId;
  const subId = subscription.id;
  if (!subId) return null;
  const r = await db.query('SELECT id FROM organizations WHERE stripe_subscription_id = $1 LIMIT 1', [subId]);
  return r.rows[0]?.id ?? null;
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
         billing_status = CASE WHEN billing_status = 'subscribed' THEN billing_status ELSE 'supporter' END,
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
    throw new Error(
      `Amount must be between $${(MIN_AMOUNT_CENTS / 100).toFixed(2)} and $${(MAX_AMOUNT_CENTS / 100).toFixed(2)}`
    );
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

async function createSubscriptionCheckout(db, { organizationId, orgName, priceId, hostUserId }) {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured on this server (STRIPE_SECRET_KEY)');
  }
  const tier = getSubscriptionTiers().find((t) => t.priceId === priceId);
  if (!tier) {
    throw new Error('Subscription tier is not configured on this server (check STRIPE_PRICE_MONTHLY_* env vars)');
  }
  const orgRow = await getOrganizationBillingRow(db, organizationId);
  if (!orgRow) throw new Error('Organization not found');
  if (isSubscriptionActive(orgRow)) {
    throw new Error('Your organization already has an active subscription. Use Manage billing to change or cancel.');
  }

  await ensureBillingTables(db);
  const stripe = getStripe();
  const appBase = publicAppOrigin();
  const customerId = await getOrCreateStripeCustomer(stripe, db, organizationId, orgName);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appBase}/org?billing=success`,
    cancel_url: `${appBase}/org?billing=cancelled`,
    metadata: {
      organization_id: String(organizationId),
      host_user_id: String(hostUserId),
    },
    subscription_data: {
      metadata: {
        organization_id: String(organizationId),
      },
    },
  });
  return { sessionId: session.id, url: session.url, tier: tier.key };
}

async function createBillingPortalSession(db, { organizationId }) {
  if (!isStripeConfigured()) {
    throw new Error('Stripe is not configured on this server (STRIPE_SECRET_KEY)');
  }
  const orgRow = await getOrganizationBillingRow(db, organizationId);
  if (!orgRow?.stripe_customer_id) {
    throw new Error('No Stripe customer on file yet. Start a monthly plan or one-time payment first.');
  }
  const stripe = getStripe();
  const appBase = publicAppOrigin();
  const session = await stripe.billingPortal.sessions.create({
    customer: orgRow.stripe_customer_id,
    return_url: `${appBase}/org?billing=portal`,
  });
  return { url: session.url };
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

async function handleCheckoutSessionCompleted(db, stripe, session) {
  const orgId = parseInt(session.metadata?.organization_id || '', 10);
  if (!Number.isFinite(orgId) || orgId <= 0) return;

  if (session.mode === 'subscription') {
    const subRef = session.subscription;
    const subId = typeof subRef === 'string' ? subRef : subRef?.id;
    if (subId) {
      const subscription = await stripe.subscriptions.retrieve(subId);
      await applySubscriptionToOrg(db, orgId, subscription);
    }
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
    if (customerId) {
      await db.query('UPDATE organizations SET stripe_customer_id = $2 WHERE id = $1 AND stripe_customer_id IS NULL', [
        orgId,
        customerId,
      ]);
    }
    return;
  }

  const amount = session.amount_total != null ? session.amount_total : 0;
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

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutSessionCompleted(db, stripe, event.data.object);
    } else if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = event.data.object;
      const orgId = await resolveOrganizationIdForSubscription(db, subscription);
      if (orgId) await applySubscriptionToOrg(db, orgId, subscription);
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const subRef = invoice.subscription;
      const subId = typeof subRef === 'string' ? subRef : subRef?.id;
      if (subId) {
        const subscription = await stripe.subscriptions.retrieve(subId);
        const orgId = await resolveOrganizationIdForSubscription(db, subscription);
        if (orgId) await applySubscriptionToOrg(db, orgId, subscription);
      }
    }
  } catch (err) {
    console.error('Stripe webhook handler error:', err?.message || err);
    res.status(500).json({ error: 'webhook_handler_failed' });
    return;
  }

  res.json({ received: true });
}

module.exports = {
  MIN_AMOUNT_CENTS,
  MAX_AMOUNT_CENTS,
  isBillingGateEnabled,
  isBillingGateEnforced,
  isBillingReady,
  isStripeConfigured,
  isWebhookSecretConfigured,
  isSubscriptionsConfigured,
  isSubscriptionActive,
  isOrgBillingActive,
  billingSummaryFromOrg,
  ensureBillingTables,
  createPayAsYouLikeCheckout,
  createSubscriptionCheckout,
  createBillingPortalSession,
  getSubscriptionTiers,
  listOrgPayments,
  handleStripeWebhook,
  publicAppOrigin,
  stripeWebhookUrl,
  billingSetupStatus,
};
