import { planSchemaStatements } from "../db/schema.js";

const readyDatabases = new WeakSet();

async function ensureSchema(db) {
  if (readyDatabases.has(db)) return;
  await db.batch(
    planSchemaStatements.map((statement) => db.prepare(statement)),
  );
  readyDatabases.add(db);
}

export async function listPlans(db, ownerId) {
  await ensureSchema(db);
  const result = await db
    .prepare(
      `SELECT id, title, created_at, updated_at
       FROM seating_plans
       WHERE owner_id = ?
       ORDER BY updated_at DESC`,
    )
    .bind(ownerId)
    .all();
  return result.results ?? [];
}

export async function findPlan(db, ownerId, id) {
  await ensureSchema(db);
  return db
    .prepare(
      `SELECT id, title, data_json, created_at, updated_at
       FROM seating_plans
       WHERE owner_id = ? AND id = ?`,
    )
    .bind(ownerId, id)
    .first();
}

export async function insertPlan(db, { id, ownerId, title, dataJson, now }) {
  await ensureSchema(db);
  await db
    .prepare(
      `INSERT INTO seating_plans
       (id, owner_id, title, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, ownerId, title, dataJson, now, now)
    .run();
  return findPlan(db, ownerId, id);
}

export async function updatePlan(db, { id, ownerId, title, dataJson, now }) {
  await ensureSchema(db);
  const result = await db
    .prepare(
      `UPDATE seating_plans
       SET title = ?, data_json = ?, updated_at = ?
       WHERE owner_id = ? AND id = ?`,
    )
    .bind(title, dataJson, now, ownerId, id)
    .run();
  if (!result.meta?.changes) return null;
  return findPlan(db, ownerId, id);
}

export async function removePlan(db, ownerId, id) {
  await ensureSchema(db);
  const result = await db
    .prepare("DELETE FROM seating_plans WHERE owner_id = ? AND id = ?")
    .bind(ownerId, id)
    .run();
  return Boolean(result.meta?.changes);
}
