/**
 * Org billing: Stripe Checkout (subscriptions, trial, single event, packs) + event credits.
 */

const Stripe = require('stripe');
const eventCredits = require('./eventCredits');

const MIN_AMOUNT_CENTS = 100;
const MAX_AMOUNT_CENTS = 500_000;
const SINGLE_EVENT_USD = 15;

const SUBSCRIPTION_ACTIVE_STATUSES = new Set(['active', 'trialing']);

/** @type {Array<{ key: string, label: string, usd: number, eventsPerMonth: number|null, unlimited?: boolean, env: string, annualEnv?: string }>} */
const SUBSCRIPTION_TIER_SPECS = [
  { key: 'basic', label: 'Basic — $59/mo', usd: 59, eventsPerMonth: 5, env: 'STRIPE_PRICE_MONTHLY_BASIC' },
  { key: 'pro', label: 'Pro — $99/mo', usd: 99, eventsPerMonth: 10, env: 'STRIPE_PRICE_MONTHLY_PRO' },
  { key: 'plus', label: 'Plus — $149/mo', usd: 149, eventsPerMonth: 20, env: 'STRIPE_PRICE_MONTHLY_PLUS' },
  { key: 'company', label: 'Company — $299/mo', usd: 299, eventsPerMonth: 50, env: 'STRIPE_PRICE_MONTHLY_COMPANY' },
  {
    key: 'enterprise',
    label: 'Enterprise — $499/mo',
    usd: 499,
    eventsPerMonth: null,
    unlimited: true,
    env: 'STRIPE_PRICE_MONTHLY_ENTERPRISE',
  },
];

/** Legacy tiers (optional backward compat) */
const LEGACY_TIER_SPECS = [
  { key: '10', label: '$10/month', usd: 10, eventsPerMonth: null, env: 'STRIPE_PRICE_MONTHLY_10' },
  { key: '25', label: '$25/month', usd: 25, eventsPerMonth: null, env: 'STRIPE_PRICE_MONTHLY_25' },
  { key: '50', label: '$50/month', usd: 50, eventsPerMonth: null, env: 'STRIPE_PRICE_MONTHLY_50' },
];

const PACK_SPECS = [
  { key: 'pack_5', label: '5 events — $60', credits: 5, usd: 60, env: 'STRIPE_PRICE_PACK_5' },
  { key: 'pack_10', label: '10 events — $100', credits: 10, usd: 100, env: 'STRIPE_PRICE_PACK_10' },
  { key: 'pack_25', label: '25 events — $200', credits: 25, usd: 200, env: 'STRIPE_PRICE_PACK_25' },
];

const ONE_TIME_PRODUCTS = [
  { key: 'trial_7d', label: '7-day trial — $29', usd: 29, env: 'STRIPE_PRICE_TRIAL_7D' },
  { key: 'single_event', label: 'Single event — $15', usd: SINGLE_EVENT_USD, env: 'STRIPE_PRICE_SINGLE_EVENT' },
];

function priceFromEnv(envName) {
  return (process.env[envName] || '').trim();
}

/** Stripe Price ID when set; otherwise ad-hoc price_data (works in test mode without catalog setup). */
function oneTimeLineItem({ priceId, usd, name, description }) {
  const id = String(priceId || '').trim();
  if (id) return { price: id, quantity: 1 };
  const cents = Math.round(Number(usd) * 100);
  if (!Number.isFinite(cents) || cents < MIN_AMOUNT_CENTS) {
    throw new Error('Invalid one-time product amount');
  }
  return {
    price_data: {
      currency: 'usd',
      unit_amount: cents,
      product_data: { name, description },
    },
    quantity: 1,
  };
}

/** Stripe recurring Price ID when set; otherwise ad-hoc price_data (monthly interval). */
function subscriptionLineItem({ priceId, tierSpec }) {
  const id = String(priceId || '').trim();
  if (id) return { price: id, quantity: 1 };
  const cents = Math.round(Number(tierSpec.usd) * 100);
  if (!Number.isFinite(cents) || cents < MIN_AMOUNT_CENTS) {
    throw new Error('Invalid subscription tier amount');
  }
  const creditsNote = tierSpec.unlimited
    ? 'Unlimited event activations'
    : `${tierSpec.eventsPerMonth} event credits per month`;
  const tierName = tierSpec.key.charAt(0).toUpperCase() + tierSpec.key.slice(1);
  return {
    price_data: {
      currency: 'usd',
      unit_amount: cents,
      recurring: { interval: 'month' },
      product_data: {
        name: `TEMPO ${tierName} — $${tierSpec.usd}/mo`,
        description: `${creditsNote}. One credit = one activated event night (up to 12 rounds).`,
      },
    },
    quantity: 1,
  };
}

function isBillingGateEnabled() {
  const v = String(process.env.TEMPO_REQUIRE_ORG_BILLING || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function isBillingReady() {
  return isStripeConfigured() && isWebhookSecretConfigured();
}

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

function webhookBaseOrigin() {
  const raw = (process.env.STRIPE_WEBHOOK_BASE_URL || process.env.API_PUBLIC_URL || '').trim();
  if (raw) return raw.replace(/\/$/, '');
  return publicAppOrigin();
}

function stripeWebhookUrl() {
  return `${webhookBaseOrigin()}/api/webhooks/stripe`;
}

function tierForKey(key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return null;
  return SUBSCRIPTION_TIER_SPECS.find((s) => s.key === k) || LEGACY_TIER_SPECS.find((s) => s.key === k) || null;
}

function getSubscriptionTiers() {
  const tiers = SUBSCRIPTION_TIER_SPECS.map(({ key, label, usd, eventsPerMonth, unlimited, env }) => {
    const priceId = priceFromEnv(env) || null;
    return {
      key,
      label,
      usd,
      priceId,
      eventsPerMonth,
      unlimited: !!unlimited,
      catalogPriceConfigured: !!priceId,
    };
  });
  if (tiers.some((t) => t.catalogPriceConfigured)) return tiers;
  for (const spec of LEGACY_TIER_SPECS) {
    const priceId = priceFromEnv(spec.env);
    if (priceId) {
      tiers.push({
        key: spec.key,
        label: spec.label,
        usd: spec.usd,
        priceId,
        eventsPerMonth: spec.eventsPerMonth,
        unlimited: false,
        catalogPriceConfigured: true,
      });
    }
  }
  return tiers;
}

function getPackProducts() {
  return PACK_SPECS.map(({ key, label, usd, credits, env }) => ({
    key,
    label,
    usd,
    credits,
    priceId: priceFromEnv(env) || null,
    catalogPriceConfigured: !!priceFromEnv(env),
  }));
}

function getOneTimeProducts() {
  return ONE_TIME_PRODUCTS.map(({ key, label, usd, env }) => ({
    key,
    label,
    usd,
    priceId: priceFromEnv(env) || null,
    catalogPriceConfigured: !!priceFromEnv(env),
  }));
}

function tierForPriceId(priceId) {
  const id = String(priceId || '').trim();
  if (!id) return null;
  for (const spec of [...SUBSCRIPTION_TIER_SPECS, ...LEGACY_TIER_SPECS]) {
    if (priceFromEnv(spec.env) === id) return spec;
  }
  return null;
}

function resolveTierSpecForSubscription(subscription) {
  const fromMeta = tierForKey(subscription?.metadata?.tier_key);
  if (fromMeta) return fromMeta;
  const priceId = subscription?.items?.data?.[0]?.price?.id;
  return tierForPriceId(priceId);
}

function isSubscriptionsConfigured() {
  return isStripeConfigured();
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
    subscriptionTiersConfigured: tiers.filter((t) => t.catalogPriceConfigured).length,
    subscriptionTiersAvailable: tiers.length,
    subscriptionTiers: tiers.map(({ key, label, usd, eventsPerMonth, unlimited }) => ({
      key,
      label,
      usd,
      eventsPerMonth,
      unlimited,
    })),
    packProducts: getPackProducts().map(({ key, label, usd, credits }) => ({ key, label, usd, credits })),
    oneTimeProducts: getOneTimeProducts().map(({ key, label, usd }) => ({ key, label, usd })),
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
  await eventCredits.ensureEntitlementTables(db);
  await db.query(`
    CREATE TABLE IF NOT EXISTS org_payments (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      stripe_checkout_session_id TEXT UNIQUE,
      stripe_payment_intent_id TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'pending',
      purchase_type TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    )
  `);
  await db.query(`ALTER TABLE org_payments ADD COLUMN IF NOT EXISTS purchase_type TEXT`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_org_payments_org_id ON org_payments (organization_id)
  `);
  return true;
}

function isSubscriptionActive(orgRow, subscription) {
  if (!orgRow) return false;
  if (eventCredits.isSubscriptionPaused(orgRow, subscription)) return false;
  const status = String(orgRow.subscription_status || '').toLowerCase();
  if (SUBSCRIPTION_ACTIVE_STATUSES.has(status)) return true;
  if (status === 'past_due') return true;
  return false;
}

async function isOrgBillingActive(db, orgRow) {
  if (!isBillingGateEnforced()) return true;
  if (!orgRow) return false;
  if (eventCredits.isTrialActive(orgRow)) return true;
  if (isSubscriptionActive(orgRow)) return true;
  if (orgRow.billing_status === 'supporter' || orgRow.billing_status === 'subscribed') return true;
  if (Number(orgRow.lifetime_paid_cents) > 0) return true;
  if (db) {
    const credits = await eventCredits.getTotalAvailableCredits(db, orgRow.id);
    if (credits > 0) return true;
  }
  return false;
}

async function billingSummaryFromOrg(db, orgRow) {
  const gateEnabled = isBillingGateEnabled();
  const gateEnforced = isBillingGateEnforced();
  const billingReady = isBillingReady();
  const tiers = getSubscriptionTiers();
  const packs = getPackProducts();
  const oneTime = getOneTimeProducts();

  const base = {
    gateEnabled,
    gateEnforced,
    billingReady,
    stripeConfigured: isStripeConfigured(),
    subscriptionsConfigured: isSubscriptionsConfigured(),
    subscriptionTiers: tiers,
    packProducts: packs.map(({ key, label, usd, credits }) => ({ key, label, usd, credits })),
    oneTimeProducts: oneTime.map(({ key, label, usd }) => ({ key, label, usd })),
    singleEventUsd: SINGLE_EVENT_USD,
  };

  if (!orgRow) {
    return {
      ...base,
      active: !gateEnforced,
      status: 'none',
      lifetimePaidCents: 0,
      lastPaymentAt: null,
      subscriptionStatus: 'none',
      subscriptionPeriodEnd: null,
      subscriptionActive: false,
      subscriptionTier: 'none',
      subscriptionPaused: false,
      trialActive: false,
      trialEndsAt: null,
      credits: { total: 0, bySource: {} },
      packsEligible: false,
      enterpriseUnlimited: false,
    };
  }

  const subStatus = orgRow.subscription_status || 'none';
  const credits = db ? await eventCredits.getCreditSummary(db, orgRow.id) : { total: 0, bySource: {} };
  const trialActive = eventCredits.isTrialActive(orgRow);
  const subscriptionPaused = eventCredits.isSubscriptionPaused(orgRow);
  const tier = orgRow.subscription_tier || 'none';
  const enterpriseUnlimited =
    eventCredits.isEnterpriseTier(tier) && ['active', 'trialing'].includes(String(subStatus).toLowerCase());

  return {
    ...base,
    active: db ? await isOrgBillingActive(db, orgRow) : isSubscriptionActive(orgRow),
    status: orgRow.billing_status || 'none',
    lifetimePaidCents: Number(orgRow.lifetime_paid_cents) || 0,
    lastPaymentAt: orgRow.last_payment_at || null,
    subscriptionStatus: subStatus,
    subscriptionPeriodEnd: orgRow.subscription_period_end || null,
    subscriptionActive: isSubscriptionActive(orgRow),
    subscriptionTier: tier,
    subscriptionPaused,
    trialActive,
    trialEndsAt: orgRow.trial_ends_at || null,
    credits,
    packsEligible: eventCredits.canBuyEventPacks(orgRow),
    enterpriseUnlimited,
  };
}

async function getOrganizationBillingRow(db, organizationId) {
  await ensureBillingTables(db);
  const r = await db.query(
    `SELECT id, billing_status, lifetime_paid_cents, last_payment_at, stripe_customer_id,
            stripe_subscription_id, subscription_status, subscription_period_end, subscription_price_id,
            subscription_tier, trial_ends_at, subscription_paused_at, monthly_credits_granted_period
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

  const paused = eventCredits.isSubscriptionPaused(null, subscription);
  const tierSpec = resolveTierSpecForSubscription(subscription);
  const tierKey = tierSpec?.key || subscription.metadata?.tier_key || null;

  let billingStatus = null;
  if (paused) billingStatus = 'paused';
  else if (status === 'active' || status === 'trialing') billingStatus = 'subscribed';
  else if (status === 'past_due') billingStatus = 'past_due';
  else if (status === 'canceled' || status === 'unpaid') billingStatus = 'supporter';

  await db.query(
    `UPDATE organizations SET
       stripe_subscription_id = $2,
       subscription_status = $3,
       subscription_period_end = $4,
       subscription_price_id = COALESCE($5, subscription_price_id),
       stripe_customer_id = COALESCE(stripe_customer_id, $6),
       billing_status = COALESCE($7, billing_status),
       subscription_tier = COALESCE($8, subscription_tier),
       subscription_paused_at = CASE WHEN $9 THEN COALESCE(subscription_paused_at, CURRENT_TIMESTAMP) ELSE NULL END
     WHERE id = $1`,
    [
      organizationId,
      subId,
      paused ? 'paused' : status,
      periodEnd,
      priceId,
      customerId,
      billingStatus,
      tierKey,
      paused,
    ]
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

async function recordOrgPayment(db, payload) {
  await ensureBillingTables(db);
  const {
    organizationId,
    sessionId,
    paymentIntentId,
    amountCents,
    currency,
    status,
    purchaseType,
  } = payload;
  await db.query(
    `INSERT INTO org_payments (organization_id, stripe_checkout_session_id, stripe_payment_intent_id, amount_cents, currency, status, purchase_type, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END)
     ON CONFLICT (stripe_checkout_session_id) DO UPDATE SET
       status = EXCLUDED.status,
       purchase_type = COALESCE(EXCLUDED.purchase_type, org_payments.purchase_type),
       stripe_payment_intent_id = COALESCE(EXCLUDED.stripe_payment_intent_id, org_payments.stripe_payment_intent_id),
       completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN CURRENT_TIMESTAMP ELSE org_payments.completed_at END`,
    [organizationId, sessionId, paymentIntentId || null, amountCents, currency || 'usd', status, purchaseType || null]
  );
  if (status === 'completed' && amountCents > 0) {
    await db.query(
      `UPDATE organizations SET
         billing_status = CASE WHEN billing_status IN ('subscribed', 'trial') THEN billing_status ELSE 'supporter' END,
         lifetime_paid_cents = COALESCE(lifetime_paid_cents, 0) + $2,
         last_payment_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [organizationId, amountCents]
    );
  }
}

async function createCheckoutSession(db, { organizationId, orgName, hostUserId, mode, lineItems, metadata, allowPromotionCodes, discounts }) {
  if (!isStripeConfigured()) throw new Error('STRIPE_SECRET_KEY is not configured');
  await ensureBillingTables(db);
  const stripe = getStripe();
  const appBase = publicAppOrigin();
  const customerId = await getOrCreateStripeCustomer(stripe, db, organizationId, orgName);
  const sessionParams = {
    mode,
    customer: customerId,
    payment_method_types: ['card'],
    line_items: lineItems,
    success_url: `${appBase}/org?billing=success`,
    cancel_url: `${appBase}/org?billing=cancelled`,
    metadata: {
      organization_id: String(organizationId),
      host_user_id: String(hostUserId),
      ...metadata,
    },
  };
  if (mode === 'subscription') {
    sessionParams.subscription_data = {
      metadata: {
        organization_id: String(organizationId),
        tier_key: metadata.tier_key || '',
      },
    };
    if (allowPromotionCodes) sessionParams.allow_promotion_codes = true;
    if (discounts?.length) sessionParams.discounts = discounts;
  }
  const session = await stripe.checkout.sessions.create(sessionParams);
  return { sessionId: session.id, url: session.url };
}

/** Legacy pay-as-you-like */
async function createPayAsYouLikeCheckout(db, { organizationId, orgName, amountCents, hostUserId }) {
  const cents = Math.round(Number(amountCents));
  if (!Number.isFinite(cents) || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) {
    throw new Error(
      `Amount must be between $${(MIN_AMOUNT_CENTS / 100).toFixed(2)} and $${(MAX_AMOUNT_CENTS / 100).toFixed(2)}`
    );
  }
  const checkout = await createCheckoutSession(db, {
    organizationId,
    orgName,
    hostUserId,
    mode: 'payment',
    lineItems: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: `TEMPO support — ${orgName}`,
            description: 'Legacy pay-as-you-like. Consider a subscription or single event pass.',
          },
        },
        quantity: 1,
      },
    ],
    metadata: { purchase_type: 'legacy_support' },
  });
  await recordOrgPayment(db, {
    organizationId,
    sessionId: checkout.sessionId,
    paymentIntentId: null,
    amountCents: cents,
    currency: 'usd',
    status: 'pending',
    purchaseType: 'legacy_support',
  });
  return checkout;
}

async function createTrialCheckout(db, { organizationId, orgName, hostUserId }) {
  const product = ONE_TIME_PRODUCTS.find((p) => p.key === 'trial_7d');
  const priceId = product ? priceFromEnv(product.env) : '';
  const orgRow = await getOrganizationBillingRow(db, organizationId);
  if (eventCredits.isTrialActive(orgRow) || orgRow?.trial_ends_at) {
    throw new Error('This organization already used a trial.');
  }
  const label = String(orgName || 'TEMPO').trim() || 'TEMPO';
  const checkout = await createCheckoutSession(db, {
    organizationId,
    orgName,
    hostUserId,
    mode: 'payment',
    lineItems: [
      oneTimeLineItem({
        priceId,
        usd: product?.usd ?? 29,
        name: `TEMPO 7-day trial — ${label}`,
        description: 'Unlimited event nights for 7 days. $29 credited toward first Basic+ subscription.',
      }),
    ],
    metadata: { purchase_type: 'trial_7d' },
  });
  await recordOrgPayment(db, {
    organizationId,
    sessionId: checkout.sessionId,
    amountCents: 2900,
    currency: 'usd',
    status: 'pending',
    purchaseType: 'trial_7d',
  });
  return checkout;
}

async function createSingleEventCheckout(db, { organizationId, orgName, hostUserId }) {
  const priceId = priceFromEnv('STRIPE_PRICE_SINGLE_EVENT');
  const label = String(orgName || 'TEMPO').trim() || 'TEMPO';
  const checkout = await createCheckoutSession(db, {
    organizationId,
    orgName,
    hostUserId,
    mode: 'payment',
    lineItems: [
      oneTimeLineItem({
        priceId,
        usd: SINGLE_EVENT_USD,
        name: `TEMPO single event — ${label}`,
        description: 'One activated event night — up to 12 rounds, unlimited players. No subscription required.',
      }),
    ],
    metadata: { purchase_type: 'single_event' },
  });
  await recordOrgPayment(db, {
    organizationId,
    sessionId: checkout.sessionId,
    amountCents: SINGLE_EVENT_USD * 100,
    currency: 'usd',
    status: 'pending',
    purchaseType: 'single_event',
  });
  return checkout;
}

async function createPackCheckout(db, { organizationId, orgName, hostUserId, packKey }) {
  const orgRow = await getOrganizationBillingRow(db, organizationId);
  if (!eventCredits.canBuyEventPacks(orgRow)) {
    throw new Error('Event packs require an active Basic (or higher) subscription. Subscribe first, or buy a single event for $15.');
  }
  const pack = PACK_SPECS.find((p) => p.key === packKey);
  if (!pack) throw new Error('Unknown pack');
  const priceId = priceFromEnv(pack.env);
  const label = String(orgName || 'TEMPO').trim() || 'TEMPO';
  const checkout = await createCheckoutSession(db, {
    organizationId,
    orgName,
    hostUserId,
    mode: 'payment',
    lineItems: [
      oneTimeLineItem({
        priceId,
        usd: pack.usd,
        name: `TEMPO event pack — ${pack.label}`,
        description: `${pack.credits} event credits for ${label}. Requires active Basic+ subscription.`,
      }),
    ],
    metadata: { purchase_type: pack.key, pack_credits: String(pack.credits) },
  });
  await recordOrgPayment(db, {
    organizationId,
    sessionId: checkout.sessionId,
    amountCents: pack.usd * 100,
    currency: 'usd',
    status: 'pending',
    purchaseType: pack.key,
  });
  return { ...checkout, packKey: pack.key, credits: pack.credits };
}

async function createSubscriptionCheckout(db, { organizationId, orgName, tierKey, priceId, hostUserId, promoCode }) {
  const key = String(tierKey || '').trim().toLowerCase();
  const tier = tierForKey(key);
  if (!tier) {
    throw new Error('Unknown subscription tier');
  }
  const catalogPriceId = priceFromEnv(tier.env);
  const resolvedPriceId = String(priceId || catalogPriceId || '').trim() || null;
  const orgRow = await getOrganizationBillingRow(db, organizationId);
  if (isSubscriptionActive(orgRow) && !eventCredits.isSubscriptionPaused(orgRow)) {
    throw new Error('Your organization already has an active subscription. Use Manage billing to change, pause, or cancel.');
  }

  let discounts;
  let tempoPromoId = null;
  if (promoCode) {
    const promo = await eventCredits.findPromoByCode(db, promoCode);
    if (promo?.stripe_promotion_code_id) {
      discounts = [{ promotion_code: promo.stripe_promotion_code_id }];
    }
    if (promo) tempoPromoId = String(promo.id);
  }

  const checkout = await createCheckoutSession(db, {
    organizationId,
    orgName,
    hostUserId,
    mode: 'subscription',
    lineItems: [subscriptionLineItem({ priceId: resolvedPriceId, tierSpec: tier })],
    metadata: {
      purchase_type: 'subscription',
      tier_key: tier.key,
      tempo_promo_id: tempoPromoId || '',
    },
    allowPromotionCodes: !discounts,
    discounts,
  });
  return { ...checkout, tier: tier.key };
}

async function createBillingPortalSession(db, { organizationId }) {
  if (!isStripeConfigured()) throw new Error('STRIPE_SECRET_KEY is not configured');
  const orgRow = await getOrganizationBillingRow(db, organizationId);
  if (!orgRow?.stripe_customer_id) {
    throw new Error('No Stripe customer on file yet. Start a plan or one-time payment first.');
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
    `SELECT id, amount_cents, currency, status, purchase_type, created_at, completed_at
     FROM org_payments
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [organizationId, Math.min(50, Math.max(1, limit))]
  );
  return r.rows;
}

async function fulfillOneTimePurchase(db, orgId, session) {
  const purchaseType = session.metadata?.purchase_type || session.metadata?.purchaseType || '';
  const amount = session.amount_total != null ? session.amount_total : 0;
  const stripeRef = typeof session.payment_intent === 'string' ? session.payment_intent : session.id;

  if (purchaseType === 'trial_7d') {
    await eventCredits.startTrial(db, orgId, 7);
    return;
  }
  if (purchaseType === 'single_event') {
    await eventCredits.grantCredits(db, orgId, {
      amount: 1,
      source: 'single',
      stripeRef,
      note: 'Single event pass',
    });
    return;
  }
  if (purchaseType.startsWith('pack_')) {
    const pack = PACK_SPECS.find((p) => p.key === purchaseType);
    const credits = pack?.credits || parseInt(session.metadata?.pack_credits || '0', 10);
    if (credits > 0) {
      await eventCredits.grantCredits(db, orgId, {
        amount: credits,
        source: 'pack',
        stripeRef,
        note: pack?.label || purchaseType,
      });
    }
    return;
  }
  if (purchaseType === 'legacy_support' && amount > 0) {
    /* lifetime_paid updated in recordOrgPayment */
  }
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
      const tierSpec =
        tierForKey(session.metadata?.tier_key) || tierForPriceId(subscription.items?.data?.[0]?.price?.id);
      const tierKey = tierSpec?.key || session.metadata?.tier_key || null;
      if (tierKey) await eventCredits.setSubscriptionTier(db, orgId, tierKey);
      if (tierSpec?.eventsPerMonth) {
        await eventCredits.grantMonthlyPlanCredits(
          db,
          orgId,
          tierSpec.eventsPerMonth,
          eventCredits.currentPeriodKey()
        );
      }
    }
    const promoId = parseInt(session.metadata?.tempo_promo_id || '', 10);
    if (Number.isFinite(promoId) && promoId > 0) {
      await eventCredits.redeemPromoBonusCredits(db, orgId, promoId);
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
  const purchaseType = session.metadata?.purchase_type || 'one_time';
  await recordOrgPayment(db, {
    organizationId: orgId,
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    amountCents: amount,
    currency: session.currency || 'usd',
    status: 'completed',
    purchaseType,
  });
  await fulfillOneTimePurchase(db, orgId, session);

  const customerId = typeof session.customer === 'string' ? session.customer : null;
  if (customerId) {
    await db.query('UPDATE organizations SET stripe_customer_id = $2 WHERE id = $1 AND stripe_customer_id IS NULL', [
      orgId,
      customerId,
    ]);
  }
}

async function handleInvoicePaid(db, stripe, invoice) {
  const subRef = invoice.subscription;
  const subId = typeof subRef === 'string' ? subRef : subRef?.id;
  if (!subId) return;
  const subscription = await stripe.subscriptions.retrieve(subId);
  if (eventCredits.isSubscriptionPaused(null, subscription)) return;
  const orgId = await resolveOrganizationIdForSubscription(db, subscription);
  if (!orgId) return;
  const tierSpec = resolveTierSpecForSubscription(subscription);
  if (!tierSpec || tierSpec.unlimited || !tierSpec.eventsPerMonth) return;
  const periodStart = invoice.period_start ? new Date(invoice.period_start * 1000) : new Date();
  const periodKey = eventCredits.currentPeriodKey(periodStart);
  await eventCredits.grantMonthlyPlanCredits(db, orgId, tierSpec.eventsPerMonth, periodKey);
}

async function gateHostedEventAction(db, orgRow, roomId, { billingReady = false } = {}) {
  if (!billingReady || !orgRow?.id || !roomId) {
    return { ok: true, skipped: true };
  }
  const result = await eventCredits.ensureActivatedEvent(db, orgRow, roomId, { billingReady: true });
  if (result.error) {
    return {
      ok: false,
      code: result.error,
      message: result.message,
      orgPortalUrl: '/org',
    };
  }
  return { ok: true, event: result.event, activated: result.activated };
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
    } else if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
      await handleInvoicePaid(db, stripe, event.data.object);
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
  SINGLE_EVENT_USD,
  SUBSCRIPTION_TIER_SPECS,
  PACK_SPECS,
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
  getOrganizationBillingRow,
  createPayAsYouLikeCheckout,
  createTrialCheckout,
  createSingleEventCheckout,
  createPackCheckout,
  createSubscriptionCheckout,
  createBillingPortalSession,
  getSubscriptionTiers,
  getPackProducts,
  getOneTimeProducts,
  listOrgPayments,
  handleStripeWebhook,
  gateHostedEventAction,
  publicAppOrigin,
  stripeWebhookUrl,
  billingSetupStatus,
  eventCredits,
};
