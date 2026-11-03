// Central record of every inspection, stored in SQLite (built into Node).
// Phones keep a local copy for offline use and sync with this database.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const KINDS = ["property", "room", "photo", "issue", "inventory"] as const;
export type Kind = (typeof KINDS)[number];

export interface SyncRecord {
  kind: Kind;
  id: string;
  propertyId: string;
  data: Record<string, unknown> | null; // null = deleted
  updatedAt: number;
}

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
export const BLOB_DIR = path.join(DATA_DIR, "blobs");
fs.mkdirSync(BLOB_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, "rentreadies.db");

export const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS records (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    property_id TEXT NOT NULL,
    data TEXT,                    -- JSON; NULL when deleted
    updated_at INTEGER NOT NULL,  -- client time of the change (last write wins)
    seq INTEGER NOT NULL,         -- server order, for "what changed since"
    PRIMARY KEY (kind, id)
  );
  CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
  CREATE INDEX IF NOT EXISTS records_property ON records(property_id);

  -- Readable views for reporting and for the AI "Ask" feature. Money in US dollars.
  DROP VIEW IF EXISTS inspections;
  CREATE VIEW inspections AS SELECT
    id,
    json_extract(data, '$.name') AS unit,
    json_extract(data, '$.address') AS address,
    COALESCE(json_extract(data, '$.turnType'), 'Not set') AS turn_type,
    json_extract(data, '$.inspector') AS inspector,
    COALESCE(json_extract(data, '$.status'), 'in_progress') AS status,
    date(json_extract(data, '$.createdAt') / 1000, 'unixepoch') AS inspected_on,
    date(json_extract(data, '$.completedAt') / 1000, 'unixepoch') AS completed_on,
    json_extract(data, '$.scan.format') AS scan_format
  FROM records WHERE kind = 'property' AND data IS NOT NULL;

  DROP VIEW IF EXISTS rooms;
  CREATE VIEW rooms AS SELECT
    id,
    property_id AS inspection_id,
    json_extract(data, '$.name') AS name,
    json_extract(data, '$.type') AS room_type,
    json_extract(data, '$.widthFt') AS width_ft,
    json_extract(data, '$.lengthFt') AS length_ft,
    json_extract(data, '$.ceilingFt') AS ceiling_ft,
    json_extract(data, '$.aiSummary') AS ai_summary
  FROM records WHERE kind = 'room' AND data IS NOT NULL;

  DROP VIEW IF EXISTS repair_items;
  CREATE VIEW repair_items AS SELECT
    id,
    property_id AS inspection_id,
    json_extract(data, '$.roomId') AS room_id,
    json_extract(data, '$.title') AS title,
    json_extract(data, '$.category') AS category,
    json_extract(data, '$.severity') AS severity,
    json_extract(data, '$.trade') AS trade,
    json_extract(data, '$.status') AS status,
    json_extract(data, '$.estCostLow') AS cost_low,
    json_extract(data, '$.estCostHigh') AS cost_high,
    json_extract(data, '$.assignee') AS assignee,
    json_extract(data, '$.dueDate') AS due_date,
    date(json_extract(data, '$.completedAt') / 1000, 'unixepoch') AS completed_on,
    json_extract(data, '$.source') AS source,
    json_extract(data, '$.description') AS description,
    json_extract(data, '$.recommendedAction') AS recommended_action,
    date(json_extract(data, '$.createdAt') / 1000, 'unixepoch') AS created_on
  FROM records WHERE kind = 'issue' AND data IS NOT NULL;

  DROP VIEW IF EXISTS appliances_finishes;
  CREATE VIEW appliances_finishes AS SELECT
    id,
    property_id AS inspection_id,
    json_extract(data, '$.roomId') AS room_id,
    json_extract(data, '$.kind') AS kind,
    json_extract(data, '$.item') AS item,
    json_extract(data, '$.type') AS type,
    json_extract(data, '$.colorFinish') AS color_finish,
    json_extract(data, '$.brand') AS brand,
    json_extract(data, '$.model') AS model,
    json_extract(data, '$.condition') AS condition,
    json_extract(data, '$.notes') AS notes
  FROM records WHERE kind = 'inventory' AND data IS NOT NULL;
`);

let seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM records").get() as { s: number }).s;

const getStmt = db.prepare("SELECT updated_at FROM records WHERE kind = ? AND id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO records (kind, id, property_id, data, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(kind, id) DO UPDATE SET property_id = excluded.property_id, data = excluded.data,
    updated_at = excluded.updated_at, seq = excluded.seq
`);

/** Apply changes from a phone. Last write wins per record (by the phone's change time). */
export function pushRecords(records: SyncRecord[]) {
  let applied = 0;
  db.exec("BEGIN");
  try {
    for (const r of records) {
      if (!KINDS.includes(r.kind) || typeof r.id !== "string" || !r.id) continue;
      const existing = getStmt.get(r.kind, r.id) as { updated_at: number } | undefined;
      if (existing && existing.updated_at > r.updatedAt) continue; // server copy is newer
      upsertStmt.run(r.kind, r.id, r.propertyId ?? "", r.data ? JSON.stringify(r.data) : null, r.updatedAt, ++seq);
      applied++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { applied, cursor: seq };
}

/** Everything that changed after `since` (a server cursor). */
export function pullRecords(since: number, limit = 2000) {
  const rows = db
    .prepare("SELECT kind, id, property_id, data, updated_at, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?")
    .all(since, limit) as { kind: Kind; id: string; property_id: string; data: string | null; updated_at: number; seq: number }[];
  return {
    records: rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      propertyId: r.property_id,
      data: r.data ? JSON.parse(r.data) : null,
      updatedAt: r.updated_at,
    })),
    cursor: rows.length ? rows[rows.length - 1].seq : since,
    more: rows.length === limit,
  };
}

const safeId = (id: string) => /^[A-Za-z0-9_-]{1,100}$/.test(id);
export const blobPath = (id: string) => (safeId(id) ? path.join(BLOB_DIR, id) : null);

/** Read-only connection for reports and the AI. Writes fail at the SQLite level. */
export const readDb = new DatabaseSync(DB_FILE, { readOnly: true });
