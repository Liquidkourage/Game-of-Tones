/**
 * Event credits ledger, activated events, promo codes, and consumption order.
 */

const MAX_ROLLOVER_CREDITS = 3;
const ROLLOVER_EXPIRY_DAYS = 31;
const EVENT_WINDOW_HOURS = 36;
const MAX_ROUNDS_PER_EVENT = 12;
const AUTO_REFUND_MAX_SONGS = 3;

const BUCKET_PRIORITY = {
  monthly: 1,
  rollover: 2,
  pack: 3,
  single: 4,
  admin: 5,
  coupon: 6,
};

function currentPeriodKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function addHours(d, hours) {
  const x = new Date(d);
  x.setTime(x.getTime() + hours * 3600 * 1000);
  return x;
}

async function ensureEntitlementTables(db) {
  if (!db) return false;
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'none'
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_paused_at TIMESTAMP
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS monthly_credits_granted_period TEXT
  `);
  await db.query(`
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_credit_applied_at TIMESTAMP
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS org_credit_buckets (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      credits_remaining INTEGER NOT NULL CHECK (credits_remaining >= 0),
      credits_initial INTEGER NOT NULL CHECK (credits_initial >= 0),
      expires_at TIMESTAMP,
      period_key TEXT,
      stripe_ref TEXT,
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_org_credit_buckets_org ON org_credit_buckets (organization_id)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS org_events (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      bucket_id INTEGER REFERENCES org_credit_buckets(id),
      credit_consumed BOOLEAN NOT NULL DEFAULT FALSE,
      activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      closes_at TIMESTAMP,
      rounds_started INTEGER NOT NULL DEFAULT 0,
      songs_played INTEGER NOT NULL DEFAULT 0,
      player_peak INTEGER NOT NULL DEFAULT 0,
      full_pdf_issued BOOLEAN NOT NULL DEFAULT FALSE,
      closed_at TIMESTAMP
    )
  `);
  await db.query(`
    ALTER TABLE org_events ADD COLUMN IF NOT EXISTS round_marker_songs_played INTEGER
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_org_events_org_room ON org_events (organization_id, room_id, status)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      stripe_promotion_code_id TEXT,
      percent_off INTEGER,
      amount_off_cents INTEGER,
      bonus_event_credits INTEGER NOT NULL DEFAULT 0,
      max_redemptions INTEGER,
      redeem_by TIMESTAMP,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      promo_code_id INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (promo_code_id, organization_id)
    )
  `);
  return true;
}

function isTrialActive(orgRow) {
  if (!orgRow?.trial_ends_at) return false;
  return new Date(orgRow.trial_ends_at).getTime() > Date.now();
}

function isSubscriptionPaused(orgRow, subscription) {
  if (orgRow?.subscription_paused_at) return true;
  if (subscription?.pause_collection?.behavior) return true;
  return String(orgRow?.subscription_status || '').toLowerCase() === 'paused';
}

function isEnterpriseTier(tier) {
  return String(tier || '').toLowerCase() === 'enterprise';
}

function tierRank(tier) {
  const t = String(tier || '').toLowerCase();
  const ranks = { none: 0, trial: 1, basic: 2, pro: 3, plus: 4, company: 5, enterprise: 6 };
  return ranks[t] ?? 0;
}

function canBuyEventPacks(orgRow, subscription) {
  if (isSubscriptionPaused(orgRow, subscription)) return false;
  const status = String(orgRow?.subscription_status || '').toLowerCase();
  if (!['active', 'trialing'].includes(status)) return false;
  return tierRank(orgRow?.subscription_tier) >= tierRank('basic');
}

async function getTotalAvailableCredits(db, organizationId) {
  await ensureEntitlementTables(db);
  const r = await db.query(
    `SELECT COALESCE(SUM(credits_remaining), 0)::int AS total
     FROM org_credit_buckets
     WHERE organization_id = $1
       AND credits_remaining > 0
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    [organizationId]
  );
  return Number(r.rows[0]?.total) || 0;
}

async function getCreditSummary(db, organizationId) {
  await ensureEntitlementTables(db);
  const r = await db.query(
    `SELECT source,
            COALESCE(SUM(credits_remaining), 0)::int AS remaining
     FROM org_credit_buckets
     WHERE organization_id = $1
       AND credits_remaining > 0
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
     GROUP BY source`,
    [organizationId]
  );
  const bySource = {};
  let total = 0;
  for (const row of r.rows) {
    bySource[row.source] = Number(row.remaining) || 0;
    total += bySource[row.source];
  }
  return { total, bySource };
}

async function grantCredits(db, organizationId, { amount, source, expiresAt = null, periodKey = null, stripeRef = null, note = null }) {
  await ensureEntitlementTables(db);
  const n = Math.round(Number(amount));
  if (!Number.isFinite(n) || n <= 0) throw new Error('grant amount must be positive');
  const src = String(source || 'admin').toLowerCase();
  const r = await db.query(
    `INSERT INTO org_credit_buckets
       (organization_id, source, credits_remaining, credits_initial, expires_at, period_key, stripe_ref, note)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7)
     RETURNING id, credits_remaining, source, expires_at, period_key`,
    [organizationId, src, n, expiresAt, periodKey, stripeRef, note]
  );
  return r.rows[0];
}

async function isOrgRolloverExpiryFrozen(db, organizationId) {
  const r = await db.query(
    `SELECT subscription_paused_at, subscription_status FROM organizations WHERE id = $1`,
    [organizationId]
  );
  return isSubscriptionPaused(r.rows[0] || null);
}

async function expireStaleBuckets(db, organizationId) {
  const freezeRollover = await isOrgRolloverExpiryFrozen(db, organizationId);
  await db.query(
    `UPDATE org_credit_buckets SET credits_remaining = 0
     WHERE organization_id = $1 AND credits_remaining > 0
       AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP
       AND ($2::boolean = FALSE OR source <> 'rollover')`,
    [organizationId, freezeRollover]
  );
}

async function rolloverUnusedMonthlyCredits(db, organizationId, previousPeriodKey) {
  if (!previousPeriodKey) return;
  const monthly = await db.query(
    `SELECT id, credits_remaining FROM org_credit_buckets
     WHERE organization_id = $1 AND source = 'monthly' AND period_key = $2 AND credits_remaining > 0`,
    [organizationId, previousPeriodKey]
  );
  let rolloverTotal = await db.query(
    `SELECT COALESCE(SUM(credits_remaining), 0)::int AS n FROM org_credit_buckets
     WHERE organization_id = $1 AND source = 'rollover' AND credits_remaining > 0
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    [organizationId]
  );
  let rolloverRoom = MAX_ROLLOVER_CREDITS - (Number(rolloverTotal.rows[0]?.n) || 0);
  if (rolloverRoom <= 0) {
    await db.query(
      `UPDATE org_credit_buckets SET credits_remaining = 0
       WHERE organization_id = $1 AND source = 'monthly' AND period_key = $2 AND credits_remaining > 0`,
      [organizationId, previousPeriodKey]
    );
    return;
  }
  for (const row of monthly.rows) {
    if (rolloverRoom <= 0) break;
    const move = Math.min(Number(row.credits_remaining) || 0, rolloverRoom);
    if (move <= 0) continue;
    await db.query(`UPDATE org_credit_buckets SET credits_remaining = credits_remaining - $2 WHERE id = $1`, [
      row.id,
      move,
    ]);
    await grantCredits(db, organizationId, {
      amount: move,
      source: 'rollover',
      expiresAt: addDays(new Date(), ROLLOVER_EXPIRY_DAYS),
      note: `Rollover from ${previousPeriodKey}`,
    });
    rolloverRoom -= move;
  }
  await db.query(
    `UPDATE org_credit_buckets SET credits_remaining = 0
     WHERE organization_id = $1 AND source = 'monthly' AND period_key = $2 AND credits_remaining > 0`,
    [organizationId, previousPeriodKey]
  );
}

async function grantMonthlyPlanCredits(db, organizationId, eventsPerMonth, periodKey) {
  if (!eventsPerMonth || eventsPerMonth <= 0) return null;
  const org = await db.query(`SELECT monthly_credits_granted_period FROM organizations WHERE id = $1`, [
    organizationId,
  ]);
  const prev = org.rows[0]?.monthly_credits_granted_period || null;
  if (prev && prev !== periodKey) {
    await rolloverUnusedMonthlyCredits(db, organizationId, prev);
  }
  const dup = await db.query(
    `SELECT 1 FROM org_credit_buckets
     WHERE organization_id = $1 AND source = 'monthly' AND period_key = $2 AND credits_initial >= $3 LIMIT 1`,
    [organizationId, periodKey, eventsPerMonth]
  );
  if (dup.rows.length > 0) {
    await db.query(`UPDATE organizations SET monthly_credits_granted_period = $2 WHERE id = $1`, [
      organizationId,
      periodKey,
    ]);
    return null;
  }
  const bucket = await grantCredits(db, organizationId, {
    amount: eventsPerMonth,
    source: 'monthly',
    periodKey,
    expiresAt: addDays(new Date(), ROLLOVER_EXPIRY_DAYS + 31),
    note: `Monthly plan ${periodKey}`,
  });
  await db.query(`UPDATE organizations SET monthly_credits_granted_period = $2 WHERE id = $1`, [
    organizationId,
    periodKey,
  ]);
  return bucket;
}

/** Pre-grant 12 monthly buckets when an annual subscription invoice is paid. */
async function grantAnnualSubscriptionCredits(db, organizationId, eventsPerMonth, anchorDate = new Date()) {
  if (!eventsPerMonth || eventsPerMonth <= 0) return;
  const anchor = anchorDate instanceof Date ? anchorDate : new Date(anchorDate);
  const org = await db.query(`SELECT monthly_credits_granted_period FROM organizations WHERE id = $1`, [
    organizationId,
  ]);
  const firstPeriodKey = currentPeriodKey(anchor);
  const prev = org.rows[0]?.monthly_credits_granted_period || null;
  if (prev && prev !== firstPeriodKey) {
    await rolloverUnusedMonthlyCredits(db, organizationId, prev);
  }
  let lastGranted = prev;
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + i, 1));
    const periodKey = currentPeriodKey(d);
    const dup = await db.query(
      `SELECT 1 FROM org_credit_buckets
       WHERE organization_id = $1 AND source = 'monthly' AND period_key = $2 AND credits_initial >= $3 LIMIT 1`,
      [organizationId, periodKey, eventsPerMonth]
    );
    if (dup.rows.length > 0) {
      lastGranted = periodKey;
      continue;
    }
    await grantCredits(db, organizationId, {
      amount: eventsPerMonth,
      source: 'monthly',
      periodKey,
      expiresAt: addDays(d, ROLLOVER_EXPIRY_DAYS + 31),
      note: `Annual plan ${periodKey}`,
    });
    lastGranted = periodKey;
  }
  if (lastGranted) {
    await db.query(`UPDATE organizations SET monthly_credits_granted_period = $2 WHERE id = $1`, [
      organizationId,
      lastGranted,
    ]);
  }
}

async function forfeitRolloverCredits(db, organizationId) {
  await ensureEntitlementTables(db);
  await db.query(
    `UPDATE org_credit_buckets SET credits_remaining = 0
     WHERE organization_id = $1 AND source = 'rollover' AND credits_remaining > 0`,
    [organizationId]
  );
}

async function pickBucketForConsumption(db, organizationId) {
  await expireStaleBuckets(db, organizationId);
  const period = currentPeriodKey();
  const r = await db.query(
    `SELECT id, source, credits_remaining, period_key, expires_at
     FROM org_credit_buckets
     WHERE organization_id = $1 AND credits_remaining > 0
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
     ORDER BY
       CASE source
         WHEN 'monthly' THEN 1 WHEN 'rollover' THEN 2 WHEN 'pack' THEN 3
         WHEN 'single' THEN 4 WHEN 'admin' THEN 5 WHEN 'coupon' THEN 6 ELSE 9
       END,
       CASE WHEN source = 'monthly' AND period_key = $2 THEN 0 ELSE 1 END,
       CASE WHEN source = 'rollover' THEN expires_at END NULLS LAST,
       id ASC
     LIMIT 1`,
    [organizationId, period]
  );
  return r.rows[0] || null;
}

async function getActiveEventForRoom(db, organizationId, roomId) {
  await ensureEntitlementTables(db);
  const r = await db.query(
    `SELECT * FROM org_events
     WHERE organization_id = $1 AND room_id = $2 AND status = 'active'
       AND (closes_at IS NULL OR closes_at > CURRENT_TIMESTAMP)
     ORDER BY id DESC LIMIT 1`,
    [organizationId, roomId]
  );
  return r.rows[0] || null;
}

async function createEvent(db, organizationId, roomId, { bucketId = null, creditConsumed = false } = {}) {
  const closesAt = addHours(new Date(), EVENT_WINDOW_HOURS);
  const r = await db.query(
    `INSERT INTO org_events
       (organization_id, room_id, status, bucket_id, credit_consumed, closes_at)
     VALUES ($1, $2, 'active', $3, $4, $5)
     RETURNING *`,
    [organizationId, roomId, bucketId, !!creditConsumed, closesAt]
  );
  return r.rows[0];
}

async function consumeOneCredit(db, organizationId) {
  const bucket = await pickBucketForConsumption(db, organizationId);
  if (!bucket) return null;
  await db.query(`UPDATE org_credit_buckets SET credits_remaining = credits_remaining - 1 WHERE id = $1`, [bucket.id]);
  return bucket;
}

/**
 * Ensure an active event exists for this room; consume credit when billing applies.
 * Returns { event, activated, error? }
 */
async function ensureActivatedEvent(db, orgRow, roomId, { billingReady = false } = {}) {
  await ensureEntitlementTables(db);
  if (!orgRow?.id || !roomId) return { event: null, activated: false, skipped: true };

  const existing = await getActiveEventForRoom(db, orgRow.id, roomId);
  if (existing) return { event: existing, activated: false, alreadyActive: true };

  if (!billingReady) {
    const ev = await createEvent(db, orgRow.id, roomId, { creditConsumed: false });
    return { event: ev, activated: true, skipped: true };
  }

  if (isTrialActive(orgRow)) {
    const ev = await createEvent(db, orgRow.id, roomId, { creditConsumed: false });
    return { event: ev, activated: true, trial: true };
  }

  if (isEnterpriseTier(orgRow.subscription_tier)) {
    const status = String(orgRow.subscription_status || '').toLowerCase();
    if (['active', 'trialing'].includes(status)) {
      const ev = await createEvent(db, orgRow.id, roomId, { creditConsumed: false });
      return { event: ev, activated: true, enterprise: true };
    }
  }

  const bucket = await consumeOneCredit(db, orgRow.id);
  if (!bucket) {
    return {
      event: null,
      activated: false,
      error: 'no_credits',
      message: 'No event credits available. Buy a single event ($15), subscribe, or add a pack (Basic+).',
    };
  }

  const ev = await createEvent(db, orgRow.id, roomId, {
    bucketId: bucket.id,
    creditConsumed: true,
  });
  return { event: ev, activated: true, consumed: true, bucketId: bucket.id };
}

async function markFullPdfIssued(db, eventId) {
  if (!eventId) return;
  await db.query(`UPDATE org_events SET full_pdf_issued = TRUE WHERE id = $1`, [eventId]);
}

async function incrementEventRound(db, organizationId, roomId) {
  const ev = await getActiveEventForRoom(db, organizationId, roomId);
  if (!ev) return null;
  const rounds = Number(ev.rounds_started) || 0;
  const songs = Number(ev.songs_played) || 0;
  const marker =
    ev.round_marker_songs_played == null ? null : Number(ev.round_marker_songs_played);

  // Legacy row (created before the marker column): rounds_started accumulated one
  // per Start Game press, counting false starts and crash recoveries. Self-heal
  // once: this start becomes round 1 of the real count.
  if (marker == null && rounds > 0) {
    await db.query(
      `UPDATE org_events SET rounds_started = 1, round_marker_songs_played = $2 WHERE id = $1`,
      [ev.id, songs]
    );
    return ev;
  }

  // Restart of the current round — no songs played since the last counted start
  // (false starts, crash recovery, repeated Start Game while prepping). Don't burn
  // a round; just refresh the marker.
  const isRestart = rounds > 0 && songs <= marker;
  if (isRestart) {
    await db.query(`UPDATE org_events SET round_marker_songs_played = $2 WHERE id = $1`, [
      ev.id,
      songs,
    ]);
    return ev;
  }

  if (rounds >= MAX_ROUNDS_PER_EVENT) {
    return { error: 'max_rounds', message: `This event supports up to ${MAX_ROUNDS_PER_EVENT} rounds.` };
  }
  await db.query(
    `UPDATE org_events SET rounds_started = rounds_started + 1, round_marker_songs_played = $2 WHERE id = $1`,
    [ev.id, songs]
  );
  return ev;
}

async function updateEventStats(db, organizationId, roomId, { songsPlayed, playerCount }) {
  const ev = await getActiveEventForRoom(db, organizationId, roomId);
  if (!ev) return;
  const sp = Number(songsPlayed);
  const pp = Number(playerCount);
  await db.query(
    `UPDATE org_events SET
       songs_played = GREATEST(songs_played, $2),
       player_peak = GREATEST(player_peak, $3)
     WHERE id = $1`,
    [ev.id, Number.isFinite(sp) ? sp : 0, Number.isFinite(pp) ? pp : 0]
  );
}

async function tryAutoRefundEvent(db, organizationId, roomId) {
  const ev = await getActiveEventForRoom(db, organizationId, roomId);
  if (!ev || !ev.credit_consumed || !ev.bucket_id) return false;
  if (ev.full_pdf_issued) return false;
  if (Number(ev.songs_played) > AUTO_REFUND_MAX_SONGS) return false;
  if (Number(ev.player_peak) > 0) return false;

  await db.query(`UPDATE org_credit_buckets SET credits_remaining = credits_remaining + 1 WHERE id = $1`, [
    ev.bucket_id,
  ]);
  await db.query(
    `UPDATE org_events SET status = 'void', closed_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [ev.id]
  );
  return true;
}

/** End active org event for a room; auto-refund credit when eligibility rules pass. */
async function closeActiveOrgEvent(db, organizationId, roomId, { tryRefund = true } = {}) {
  if (tryRefund) {
    const refunded = await tryAutoRefundEvent(db, organizationId, roomId);
    if (refunded) return { closed: true, refunded: true };
  }
  const ev = await getActiveEventForRoom(db, organizationId, roomId);
  if (!ev) return { closed: false, refunded: false };
  await db.query(
    `UPDATE org_events SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'active'`,
    [ev.id]
  );
  return { closed: true, refunded: false };
}

/** Recent events for the account page: includes auto-expired actives (status still 'active' but past closes_at). */
async function listRecentOrgEvents(db, organizationId, limit = 20) {
  await ensureEntitlementTables(db);
  const n = Math.min(100, Math.max(1, Math.round(Number(limit) || 20)));
  const r = await db.query(
    `SELECT id, room_id, status, credit_consumed, activated_at, closes_at, closed_at,
            rounds_started, songs_played, player_peak,
            (status = 'active' AND closes_at IS NOT NULL AND closes_at <= CURRENT_TIMESTAMP) AS expired
     FROM org_events
     WHERE organization_id = $1
     ORDER BY activated_at DESC NULLS LAST, id DESC
     LIMIT $2`,
    [organizationId, n]
  );
  return r.rows;
}

async function startTrial(db, organizationId, days = 7) {
  const ends = addDays(new Date(), days);
  await db.query(
    `UPDATE organizations SET subscription_tier = 'trial', trial_ends_at = $2, billing_status = 'trial' WHERE id = $1`,
    [organizationId, ends]
  );
  return ends;
}

async function setSubscriptionTier(db, organizationId, tier) {
  await db.query(`UPDATE organizations SET subscription_tier = $2 WHERE id = $1`, [organizationId, tier]);
}

async function findPromoByCode(db, code) {
  await ensureEntitlementTables(db);
  const r = await db.query(
    `SELECT * FROM promo_codes WHERE UPPER(code) = UPPER($1) AND active = TRUE LIMIT 1`,
    [String(code || '').trim()]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.redeem_by && new Date(row.redeem_by).getTime() < Date.now()) return null;
  if (row.max_redemptions != null) {
    const c = await db.query(`SELECT COUNT(*)::int AS n FROM promo_redemptions WHERE promo_code_id = $1`, [row.id]);
    if ((c.rows[0]?.n || 0) >= row.max_redemptions) return null;
  }
  return row;
}

async function redeemPromoBonusCredits(db, organizationId, promoId) {
  const promo = await db.query(`SELECT * FROM promo_codes WHERE id = $1`, [promoId]);
  const row = promo.rows[0];
  if (!row || !row.bonus_event_credits) return;
  const red = await db.query(
    `SELECT 1 FROM promo_redemptions WHERE promo_code_id = $1 AND organization_id = $2`,
    [promoId, organizationId]
  );
  if (red.rows.length > 0) return;
  await db.query(
    `INSERT INTO promo_redemptions (promo_code_id, organization_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [promoId, organizationId]
  );
  await grantCredits(db, organizationId, {
    amount: row.bonus_event_credits,
    source: 'coupon',
    note: `Promo ${row.code}`,
  });
}

async function createPromoCode(db, payload) {
  await ensureEntitlementTables(db);
  const code = String(payload.code || '').trim();
  if (!code) throw new Error('code is required');
  const r = await db.query(
    `INSERT INTO promo_codes
       (code, stripe_promotion_code_id, percent_off, amount_off_cents, bonus_event_credits, max_redemptions, redeem_by, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, TRUE))
     RETURNING *`,
    [
      code,
      payload.stripePromotionCodeId || null,
      payload.percentOff ?? null,
      payload.amountOffCents ?? null,
      payload.bonusEventCredits ?? 0,
      payload.maxRedemptions ?? null,
      payload.redeemBy ?? null,
      payload.active,
    ]
  );
  return r.rows[0];
}

async function listPromoCodes(db) {
  await ensureEntitlementTables(db);
  const r = await db.query(`SELECT * FROM promo_codes ORDER BY created_at DESC LIMIT 200`);
  return r.rows;
}

module.exports = {
  MAX_ROUNDS_PER_EVENT,
  EVENT_WINDOW_HOURS,
  currentPeriodKey,
  ensureEntitlementTables,
  isTrialActive,
  isSubscriptionPaused,
  isEnterpriseTier,
  tierRank,
  canBuyEventPacks,
  getTotalAvailableCredits,
  getCreditSummary,
  grantCredits,
  grantMonthlyPlanCredits,
  grantAnnualSubscriptionCredits,
  rolloverUnusedMonthlyCredits,
  forfeitRolloverCredits,
  getActiveEventForRoom,
  ensureActivatedEvent,
  markFullPdfIssued,
  incrementEventRound,
  updateEventStats,
  tryAutoRefundEvent,
  closeActiveOrgEvent,
  listRecentOrgEvents,
  startTrial,
  setSubscriptionTier,
  findPromoByCode,
  redeemPromoBonusCredits,
  createPromoCode,
  listPromoCodes,
};
