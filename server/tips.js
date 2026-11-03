/**
 * Host tip jar: Stripe Connect Express (card tips → host) + deep-link rails.
 * Tempo takes no platform fee in v1 (application_fee_amount: 0).
 */

const Stripe = require('stripe');

const TIP_MIN_CENTS = 100;
const TIP_MAX_CENTS = 10000;
const DEFAULT_PRESETS = [300, 500, 1000];

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

function trimStr(s, max) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max) : t;
}

/** Allow https links and common payment app schemes. */
function sanitizeTipLink(s, maxLen = 500) {
  const t = trimStr(s, maxLen);
  if (!t) return '';
  try {
    const u = new URL(t);
    const proto = u.protocol.replace(':', '').toLowerCase();
    if (
      proto === 'https' ||
      proto === 'http' ||
      proto === 'venmo' ||
      proto === 'cashapp' ||
      proto === 'paypal'
    ) {
      if (proto === 'http' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return '';
      return u.href.slice(0, maxLen);
    }
  } catch {
    /* ignore */
  }
  return '';
}

function sanitizePresetCents(raw) {
  const arr = Array.isArray(raw) ? raw : DEFAULT_PRESETS;
  const out = [];
  const seen = new Set();
  for (const n of arr) {
    const c = Math.round(Number(n));
    if (!Number.isFinite(c) || c < TIP_MIN_CENTS || c > TIP_MAX_CENTS) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= 6) break;
  }
  return out.length ? out.sort((a, b) => a - b) : [...DEFAULT_PRESETS];
}

function sanitizeTipJar(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const linksIn = o.links && typeof o.links === 'object' ? o.links : {};
  const links = {};
  const venmo = sanitizeTipLink(linksIn.venmo);
  const cashapp = sanitizeTipLink(linksIn.cashapp);
  const paypal = sanitizeTipLink(linksIn.paypal);
  const otherUrl = sanitizeTipLink(linksIn.otherUrl);
  const otherLabel = trimStr(linksIn.otherLabel, 40);
  if (venmo) links.venmo = venmo;
  if (cashapp) links.cashapp = cashapp;
  if (paypal) links.paypal = paypal;
  if (otherUrl) {
    links.otherUrl = otherUrl;
    if (otherLabel) links.otherLabel = otherLabel;
  }
  const accountId = trimStr(o.stripeConnectAccountId, 120);
  return {
    enabled: o.enabled === true,
    displayName: trimStr(o.displayName, 60) || undefined,
    presetCents: sanitizePresetCents(o.presetCents),
    allowCustomAmount: o.allowCustomAmount !== false,
    links,
    stripeConnectAccountId: accountId || undefined,
    stripeConnectChargesEnabled: o.stripeConnectChargesEnabled === true,
  };
}

/** Player-safe payload (no Connect account id). */
function tipJarPublicPayload(tipJar) {
  const t = sanitizeTipJar(tipJar);
  if (!t.enabled) return null;
  const hasLinks = Boolean(
    t.links.venmo || t.links.cashapp || t.links.paypal || t.links.otherUrl,
  );
  const cardTipsEnabled = Boolean(t.stripeConnectAccountId && t.stripeConnectChargesEnabled);
  if (!hasLinks && !cardTipsEnabled) return null;
  return {
    enabled: true,
    displayName: t.displayName || 'Tip the host',
    presetCents: t.presetCents,
    allowCustomAmount: t.allowCustomAmount,
    links: t.links,
    cardTipsEnabled,
  };
}

async function ensureHostTipsTable(db) {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS host_tips (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      room_id TEXT,
      player_id TEXT,
      player_name TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      rail TEXT NOT NULL DEFAULT 'stripe',
      stripe_checkout_session_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_host_tips_org_created
    ON host_tips (organization_id, created_at DESC)
  `);
}

async function getTipJarForOrganization(db, organizationId) {
  const r = await db.query('SELECT venue_settings FROM organizations WHERE id = $1', [organizationId]);
  if (!r.rows.length) return sanitizeTipJar({});
  let vs = r.rows[0].venue_settings;
  if (typeof vs === 'string') {
    try {
      vs = JSON.parse(vs);
    } catch {
      vs = {};
    }
  }
  return sanitizeTipJar(vs && typeof vs === 'object' ? vs.tipJar : {});
}

async function patchTipJarForOrganization(db, organizationId, patch) {
  const r = await db.query('SELECT venue_settings FROM organizations WHERE id = $1', [organizationId]);
  if (!r.rows.length) throw new Error('organization not found');
  let vs = r.rows[0].venue_settings;
  if (typeof vs === 'string') {
    try {
      vs = JSON.parse(vs);
    } catch {
      vs = {};
    }
  }
  if (!vs || typeof vs !== 'object') vs = {};
  const current = sanitizeTipJar(vs.tipJar);
  const merged = sanitizeTipJar({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
  // Preserve nested links merge when patch only sets some link keys
  if (patch && typeof patch === 'object' && patch.links && typeof patch.links === 'object') {
    merged.links = sanitizeTipJar({
      ...merged,
      links: { ...current.links, ...patch.links },
    }).links;
  }
  const nextVs = { ...vs, tipJar: merged };
  await db.query(`UPDATE organizations SET venue_settings = $2::jsonb WHERE id = $1`, [
    organizationId,
    JSON.stringify(nextVs),
  ]);
  return merged;
}

async function createConnectOnboardingLink(db, { organizationId, hostUserId, returnPath }) {
  const tipJar = await getTipJarForOrganization(db, organizationId);
  const stripe = getStripe();
  let accountId = tipJar.stripeConnectAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        organization_id: String(organizationId),
        host_user_id: String(hostUserId || ''),
        tempo: 'host_tip_jar',
      },
    });
    accountId = account.id;
    await patchTipJarForOrganization(db, organizationId, {
      stripeConnectAccountId: accountId,
      stripeConnectChargesEnabled: false,
    });
  } else {
    // Refresh charges_enabled from Stripe
    try {
      const acct = await stripe.accounts.retrieve(accountId);
      const ready = !!(acct.charges_enabled && acct.details_submitted);
      if (ready !== tipJar.stripeConnectChargesEnabled) {
        await patchTipJarForOrganization(db, organizationId, {
          stripeConnectChargesEnabled: ready,
        });
      }
    } catch {
      /* ignore */
    }
  }

  const origin = publicAppOrigin();
  let path = typeof returnPath === 'string' ? returnPath.trim() : '';
  if (!path.startsWith('/') || path.startsWith('//')) path = '/org';
  const sep = path.includes('?') ? '&' : '?';
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}${path}${sep}tipJar=connect_refresh`,
    return_url: `${origin}${path}${sep}tipJar=connect_return`,
    type: 'account_onboarding',
  });
  return { url: accountLink.url, accountId };
}

async function refreshConnectStatus(db, organizationId) {
  const tipJar = await getTipJarForOrganization(db, organizationId);
  if (!tipJar.stripeConnectAccountId) {
    return { ...tipJar, stripeConnectChargesEnabled: false };
  }
  const stripe = getStripe();
  const acct = await stripe.accounts.retrieve(tipJar.stripeConnectAccountId);
  const ready = !!(acct.charges_enabled && acct.details_submitted);
  if (ready !== tipJar.stripeConnectChargesEnabled) {
    return patchTipJarForOrganization(db, organizationId, {
      stripeConnectChargesEnabled: ready,
    });
  }
  return tipJar;
}

function clampTipAmountCents(raw) {
  const c = Math.round(Number(raw));
  if (!Number.isFinite(c)) return null;
  if (c < TIP_MIN_CENTS || c > TIP_MAX_CENTS) return null;
  return c;
}

async function createHostTipCheckout(db, {
  organizationId,
  roomId,
  amountCents,
  playerId,
  playerName,
}) {
  const tipJar = await getTipJarForOrganization(db, organizationId);
  if (!tipJar.enabled) {
    const err = new Error('Tipping is not enabled for this host.');
    err.code = 'tips_disabled';
    throw err;
  }
  if (!tipJar.stripeConnectAccountId || !tipJar.stripeConnectChargesEnabled) {
    const err = new Error('Host has not finished Stripe setup for card tips.');
    err.code = 'tips_card_unavailable';
    throw err;
  }
  const cents = clampTipAmountCents(amountCents);
  if (cents == null) {
    const err = new Error(
      `Tip amount must be between $${(TIP_MIN_CENTS / 100).toFixed(2)} and $${(TIP_MAX_CENTS / 100).toFixed(2)}.`,
    );
    err.code = 'tips_bad_amount';
    throw err;
  }

  const stripe = getStripe();
  const origin = publicAppOrigin();
  const label = tipJar.displayName || 'Tip the host';
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: `${origin}/play/${encodeURIComponent(roomId)}?tip=thanks`,
    cancel_url: `${origin}/play/${encodeURIComponent(roomId)}?tip=cancel`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: {
            name: label,
            description: `Tip for room ${roomId}`,
          },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: 0,
      transfer_data: {
        destination: tipJar.stripeConnectAccountId,
      },
      metadata: {
        type: 'host_tip',
        organization_id: String(organizationId),
        room_id: String(roomId || ''),
        player_id: String(playerId || ''),
        player_name: String(playerName || '').slice(0, 80),
      },
    },
    metadata: {
      type: 'host_tip',
      organization_id: String(organizationId),
      room_id: String(roomId || ''),
      player_id: String(playerId || ''),
      player_name: String(playerName || '').slice(0, 80),
      amount_cents: String(cents),
    },
  });

  return { sessionId: session.id, url: session.url, amountCents: cents };
}

/**
 * @returns {Promise<{ handled: boolean, tip?: object }>}
 */
async function handleTipCheckoutCompleted(db, session) {
  if (!session || session.metadata?.type !== 'host_tip') {
    return { handled: false };
  }
  await ensureHostTipsTable(db);
  const organizationId = parseInt(session.metadata.organization_id || '', 10);
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return { handled: true };
  }
  const amountCents =
    clampTipAmountCents(session.metadata.amount_cents) ||
    (session.amount_total != null ? Math.round(Number(session.amount_total)) : null);
  if (amountCents == null) return { handled: true };

  const roomId = String(session.metadata.room_id || '').trim() || null;
  const playerId = String(session.metadata.player_id || '').trim() || null;
  const playerName = String(session.metadata.player_name || '').trim() || null;
  const currency = String(session.currency || 'usd').toLowerCase();

  try {
    const ins = await db.query(
      `INSERT INTO host_tips (
         organization_id, room_id, player_id, player_name, amount_cents, currency, rail,
         stripe_checkout_session_id, status
       ) VALUES ($1,$2,$3,$4,$5,$6,'stripe',$7,'completed')
       ON CONFLICT (stripe_checkout_session_id) DO NOTHING
       RETURNING id, organization_id, room_id, player_id, player_name, amount_cents, currency, created_at`,
      [
        organizationId,
        roomId,
        playerId,
        playerName,
        amountCents,
        currency,
        session.id,
      ],
    );
    const tip = ins.rows[0] || null;
    return { handled: true, tip };
  } catch (e) {
    console.error('[tips] record tip failed:', e?.message || e);
    return { handled: true };
  }
}

module.exports = {
  TIP_MIN_CENTS,
  TIP_MAX_CENTS,
  DEFAULT_PRESETS,
  sanitizeTipJar,
  tipJarPublicPayload,
  ensureHostTipsTable,
  getTipJarForOrganization,
  patchTipJarForOrganization,
  createConnectOnboardingLink,
  refreshConnectStatus,
  createHostTipCheckout,
  handleTipCheckoutCompleted,
  clampTipAmountCents,
  publicAppOrigin,
};
