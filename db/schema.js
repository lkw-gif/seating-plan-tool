export const planSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS seating_plans (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_seating_plans_owner_updated
   ON seating_plans(owner_id, updated_at DESC)`,
];
