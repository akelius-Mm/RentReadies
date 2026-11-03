// Dashboard numbers and the "Ask" feature (plain-English questions answered from the records).
import Anthropic from "@anthropic-ai/sdk";
import { readDb } from "./db.js";

type Row = Record<string, unknown>;
const q = (sql: string, ...params: (string | number)[]) => readDb.prepare(sql).all(...params) as Row[];
const one = (sql: string, ...params: (string | number)[]) => (readDb.prepare(sql).get(...params) ?? {}) as Row;

const ACTIVE = "status NOT IN ('dismissed')";
const OPEN = "status NOT IN ('dismissed', 'done')";

export function stats() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    today,
    totals: one(`SELECT
        (SELECT COUNT(*) FROM inspections) AS inspections,
        (SELECT COUNT(*) FROM inspections WHERE status = 'complete') AS completed,
        (SELECT COUNT(*) FROM repair_items WHERE ${OPEN}) AS open_items,
        (SELECT COUNT(*) FROM repair_items WHERE ${OPEN} AND due_date < ?) AS overdue_items,
        (SELECT COUNT(*) FROM repair_items WHERE ${OPEN} AND (assignee IS NULL OR assignee = '')) AS unassigned_items,
        (SELECT COALESCE(SUM(cost_low), 0) FROM repair_items WHERE ${OPEN}) AS open_cost_low,
        (SELECT COALESCE(SUM(cost_high), 0) FROM repair_items WHERE ${OPEN}) AS open_cost_high`, today),
    byTurnType: q(`SELECT i.turn_type, COUNT(DISTINCT i.id) AS inspections,
        ROUND(AVG(c.low)) AS avg_cost_low, ROUND(AVG(c.high)) AS avg_cost_high
      FROM inspections i LEFT JOIN (
        SELECT inspection_id, SUM(cost_low) AS low, SUM(cost_high) AS high FROM repair_items WHERE ${ACTIVE} GROUP BY inspection_id
      ) c ON c.inspection_id = i.id
      GROUP BY i.turn_type ORDER BY inspections DESC`),
    byMonth: q(`SELECT substr(inspected_on, 1, 7) AS month, turn_type, COUNT(*) AS inspections
      FROM inspections WHERE inspected_on >= date('now', 'start of month', '-11 months')
      GROUP BY month, turn_type ORDER BY month`),
    topCategories: q(`SELECT category, COUNT(*) AS items, SUM(cost_high) AS cost_high
      FROM repair_items WHERE ${ACTIVE} AND created_on >= date('now', '-90 days')
      GROUP BY category ORDER BY items DESC LIMIT 8`),
    notReady: q(`SELECT i.id, i.unit, i.turn_type, i.inspector, i.inspected_on,
        COUNT(r.id) AS open_items, SUM(CASE WHEN r.due_date < ? THEN 1 ELSE 0 END) AS overdue
      FROM inspections i JOIN repair_items r ON r.inspection_id = i.id AND r.${OPEN}
      GROUP BY i.id ORDER BY overdue DESC, i.inspected_on LIMIT 25`, today),
    byAssignee: q(`SELECT COALESCE(NULLIF(assignee, ''), 'Unassigned') AS assignee, COUNT(*) AS open_items,
        SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue
      FROM repair_items WHERE ${OPEN} GROUP BY 1 ORDER BY open_items DESC`, today),
  };
}

// ---- Ask ------------------------------------------------------------------

const MODEL = "claude-opus-5-5";
const MAX_ROWS = 200;
const MAX_TURNS = 10;

const SCHEMA = `SQLite database of make-ready inspections for rental units. Query only these views:

inspections(id, unit, address, turn_type, inspector, status, inspected_on, completed_on, scan_format)
  - One row per inspection of a unit. The same unit can be inspected several times (different dates).
  - turn_type: 'Light turn', 'Full turn', 'Renovation', 'Move-in', 'Move-out', 'Other', or 'Not set'.
  - status: 'in_progress' or 'complete'. Dates are 'YYYY-MM-DD' text.
rooms(id, inspection_id, name, room_type, width_ft, length_ft, ceiling_ft, ai_summary)
  - room_type: kitchen, bathroom, bedroom, living, dining, hallway, laundry, closet, entry, garage, exterior, utility, other.
repair_items(id, inspection_id, room_id, title, category, severity, trade, status, cost_low, cost_high,
             assignee, due_date, completed_on, source, description, recommended_action, created_on)
  - category: water_damage, mold, paint, wall_damage, stain, flooring, appliance, hvac_vent, cleaning, plumbing,
    electrical, fixture, cabinet_counter, door_window, pest, safety, other.
  - severity: low, medium, high, urgent. trade: Cleaner, Painter, Handyman, Plumber, Electrician, HVAC, Flooring,
    Appliance tech, Water/mold remediation, Pest control, Other.
  - status: 'open' (found, not reviewed yet), 'approved', 'scheduled', 'done', 'dismissed' (not a real problem).
    "Open" or "outstanding" work means status NOT IN ('done','dismissed'). Always exclude 'dismissed' from counts of problems found.
  - cost_low / cost_high: estimated US dollars. source: 'ai' or 'manual'. due_date is 'YYYY-MM-DD' or NULL.
appliances_finishes(id, inspection_id, room_id, kind, item, type, color_finish, brand, model, condition, notes)
  - kind: appliance, finish, fixture. condition: good, fair, poor, replace, unknown.

Join repair_items/rooms/appliances_finishes to inspections on inspection_id = inspections.id, and to rooms on room_id = rooms.id.`;

const SYSTEM = `You answer questions from property-management staff about their make-ready inspections, using the run_sql tool on their database.

${SCHEMA}

How to answer:
- Always get numbers from the database with run_sql. Never estimate or invent figures.
- Interpret everyday wording sensibly: "full turns" = turn_type 'Full turn'; "repaint"/"paint" = repair_items.category 'paint'; "last month" = the previous calendar month; "this year" = since January 1 of the current year.
- Answer in a few short sentences: the number first, then what it includes (date range, filters) and, when useful, a short list of units (at most 10, then "and N more").
- If the database doesn't record what was asked (for example labor hours or actual invoiced cost), say so plainly and offer the closest thing it does record.
- Plain text only, no markdown tables.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "run_sql",
    description: `Run one read-only SQLite SELECT query against the inspection views and get the rows back as JSON (at most ${MAX_ROWS} rows).`,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["sql"],
      properties: { sql: { type: "string", description: "A single SELECT (or WITH ... SELECT) statement." } },
    },
    strict: true,
  },
];

function runSql(sql: unknown): { ok: boolean; result: string } {
  if (typeof sql !== "string" || !/^\s*(select|with)\b/i.test(sql)) return { ok: false, result: "Only SELECT queries are allowed." };
  if (/;\s*\S/.test(sql)) return { ok: false, result: "Send one statement at a time." };
  try {
    const rows = readDb.prepare(sql).all() as Row[];
    const truncated = rows.length > MAX_ROWS;
    return { ok: true, result: JSON.stringify({ rows: rows.slice(0, MAX_ROWS), rowCount: rows.length, truncated }) };
  } catch (e) {
    return { ok: false, result: `SQL error: ${(e as Error).message}` };
  }
}

export async function ask(client: Anthropic, question: string) {
  const today = new Date().toISOString().slice(0, 10);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `Today is ${today}.\n\nQuestion: ${question}` },
  ];
  const queries: string[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    if (response.stop_reason === "refusal") return { answer: "The AI declined to answer that question.", queries };
    // Keep the full assistant turn (thinking blocks included) so the conversation stays valid.
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) {
      const answer = response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      return { answer: answer || "No answer was produced. Try rephrasing the question.", queries };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((t) => {
      const sql = (t.input as { sql?: unknown }).sql;
      if (typeof sql === "string") queries.push(sql);
      const r = runSql(sql);
      return { type: "tool_result", tool_use_id: t.id, content: r.result, is_error: !r.ok };
    });
    messages.push({ role: "user", content: results });
  }
  return { answer: "That question needed too many steps. Try asking something narrower.", queries };
}
