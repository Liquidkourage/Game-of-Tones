/**
 * Reusable show plans / event templates.
 * Payload shape intentionally mirrors host prep rounds so rooms can later load from these records.
 */

async function ensureEventTemplatesTable(db) {
  if (!db) return false;
  await db.query(`
    CREATE TABLE IF NOT EXISTS event_templates (
      id SERIAL PRIMARY KEY,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_event_templates_creator_updated
     ON event_templates (created_by_user_id, updated_at DESC)`,
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_event_templates_org_updated
     ON event_templates (organization_id, updated_at DESC)`,
  );
  return true;
}

function sanitizeTemplateName(name) {
  const value = String(name || '').trim();
  if (!value) throw new Error('Template name is required');
  return value.length > 160 ? value.slice(0, 160) : value;
}

function sanitizeTemplatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { v: 1, rounds: [], currentRoundIndex: -1 };
  }
  const next = {
    ...payload,
    v: typeof payload.v === 'number' ? payload.v : 1,
    rounds: Array.isArray(payload.rounds) ? payload.rounds : [],
    currentRoundIndex:
      typeof payload.currentRoundIndex === 'number' ? payload.currentRoundIndex : -1,
  };
  return next;
}

function mapTemplateRow(row) {
  const payload = sanitizeTemplatePayload(row?.payload);
  return {
    id: row.id,
    name: row.name,
    createdByUserId: row.created_by_user_id,
    organizationId: row.organization_id ?? null,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    roundCount: Array.isArray(payload.rounds) ? payload.rounds.length : 0,
    payload,
  };
}

async function listEventTemplates(db, { userId, organizationId = null, limit = 50 }) {
  if (!db || userId == null) return [];
  await ensureEventTemplatesTable(db);
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const r = await db.query(
    `SELECT id, created_by_user_id, organization_id, name, payload, created_at, updated_at
     FROM event_templates
     WHERE created_by_user_id = $1
        OR ($2::int IS NOT NULL AND organization_id = $2)
     ORDER BY updated_at DESC, id DESC
     LIMIT $3`,
    [userId, organizationId, lim],
  );
  return r.rows.map(mapTemplateRow);
}

async function getEventTemplateById(db, { templateId, userId, organizationId = null }) {
  if (!db || templateId == null || userId == null) return null;
  await ensureEventTemplatesTable(db);
  const id = Number(templateId);
  if (!Number.isFinite(id)) return null;
  const r = await db.query(
    `SELECT id, created_by_user_id, organization_id, name, payload, created_at, updated_at
     FROM event_templates
     WHERE id = $1
       AND (created_by_user_id = $2 OR ($3::int IS NOT NULL AND organization_id = $3))
     LIMIT 1`,
    [id, userId, organizationId],
  );
  return r.rows.length > 0 ? mapTemplateRow(r.rows[0]) : null;
}

async function createEventTemplate(db, { userId, organizationId = null, name, payload }) {
  if (!db) throw new Error('DATABASE_URL required');
  await ensureEventTemplatesTable(db);
  const uid = Number(userId);
  if (!Number.isFinite(uid)) throw new Error('userId is required');
  const templateName = sanitizeTemplateName(name);
  const templatePayload = sanitizeTemplatePayload(payload);
  const r = await db.query(
    `INSERT INTO event_templates (
       created_by_user_id,
       organization_id,
       name,
       payload,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING id, created_by_user_id, organization_id, name, payload, created_at, updated_at`,
    [uid, organizationId, templateName, JSON.stringify(templatePayload)],
  );
  return mapTemplateRow(r.rows[0]);
}

async function updateEventTemplate(db, { templateId, userId, organizationId = null, name, payload }) {
  if (!db) throw new Error('DATABASE_URL required');
  await ensureEventTemplatesTable(db);
  const existing = await getEventTemplateById(db, { templateId, userId, organizationId });
  if (!existing) throw new Error('Template not found');
  const nextName = name != null ? sanitizeTemplateName(name) : existing.name;
  const nextPayload = payload != null ? sanitizeTemplatePayload(payload) : existing.payload;
  const r = await db.query(
    `UPDATE event_templates
     SET name = $2,
         payload = $3::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, created_by_user_id, organization_id, name, payload, created_at, updated_at`,
    [existing.id, nextName, JSON.stringify(nextPayload)],
  );
  return mapTemplateRow(r.rows[0]);
}

async function deleteEventTemplate(db, { templateId, userId, organizationId = null }) {
  if (!db) throw new Error('DATABASE_URL required');
  await ensureEventTemplatesTable(db);
  const existing = await getEventTemplateById(db, { templateId, userId, organizationId });
  if (!existing) throw new Error('Template not found');
  await db.query(`DELETE FROM event_templates WHERE id = $1`, [existing.id]);
  return { ok: true, id: existing.id };
}

module.exports = {
  ensureEventTemplatesTable,
  listEventTemplates,
  getEventTemplateById,
  createEventTemplate,
  updateEventTemplate,
  deleteEventTemplate,
};
