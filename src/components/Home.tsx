import { useCallback, useEffect, useMemo, useState } from "react";
import { store, uid } from "../lib/db";
import { TURN_TYPES, CATEGORY_LABELS, type IssueCategory, type Issue, type Property, type TurnType } from "../lib/types";
import { go } from "../lib/router";
import { askQuestion, getStats, type Stats } from "../lib/api";
import { onRemoteData, syncNow } from "../lib/sync";
import { myName } from "../lib/me";
import { money, range } from "../lib/format";

const SUGGESTIONS = [
  "How many full turns did we do last month?",
  "Which units still have open water damage?",
  "What's our average repair estimate per turn type?",
  "How many units needed a full repaint this year?",
  "Which repairs are overdue and who owns them?",
];

export default function Home({ aiEnabled, online }: { aiEnabled: boolean; online: boolean }) {
  const [list, setList] = useState<Property[] | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const [p, i] = await Promise.all([store.listProperties(), store.allIssues()]);
    setList(p);
    setIssues(i);
  }, []);
  const loadStats = useCallback(async () => {
    if (!online) return;
    try {
      await syncNow(); // make sure this phone's latest work is in the numbers
      setStats(await getStats());
      setStatsError(null);
    } catch (e) {
      setStatsError((e as Error).message);
    }
  }, [online]);

  useEffect(() => {
    load();
    loadStats();
    return onRemoteData(() => {
      load();
      loadStats();
    });
  }, [load, loadStats]);

  const openByProperty = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of issues) if (i.status !== "done" && i.status !== "dismissed") m[i.propertyId] = (m[i.propertyId] ?? 0) + 1;
    return m;
  }, [issues]);

  const shown = (list ?? []).filter((p) => {
    const f = filter.trim().toLowerCase();
    return !f || [p.name, p.address, p.inspector, p.turnType].some((x) => x?.toLowerCase().includes(f));
  });

  return (
    <div className="page">
      <AskBox aiEnabled={aiEnabled && online} />
      <NewInspection />
      <Dashboard stats={stats} error={statsError} online={online} />

      <section>
        <div className="row">
          <h2 className="grow">Inspections</h2>
          <input className="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search unit, person, type" />
        </div>
        {list === null ? (
          <p className="muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="muted">{list.length ? "No matches." : "No inspections yet."}</p>
        ) : (
          <ul className="list">
            {shown.map((p) => (
              <li key={p.id} className="list-item">
                <a href={`#/p/${p.id}/rooms`} className="grow">
                  <span className="row tight wrap">
                    <strong>{p.name}</strong>
                    {p.turnType && <span className="tag">{p.turnType}</span>}
                    {p.status === "complete" ? <span className="tag done">Complete</span> : <span className="tag">In progress</span>}
                  </span>
                  <span className="muted small">
                    {new Date(p.createdAt).toLocaleDateString()}
                    {p.inspector ? ` · ${p.inspector}` : ""}
                    {openByProperty[p.id] ? ` · ${openByProperty[p.id]} open item${openByProperty[p.id] > 1 ? "s" : ""}` : ""}
                  </span>
                </a>
                <button
                  className="btn ghost small"
                  onClick={async () => {
                    if (confirm(`Delete the inspection of ${p.name} for everyone, with all its photos and repairs?`)) {
                      await store.deleteProperty(p.id);
                      load();
                    }
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewInspection() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [turnType, setTurnType] = useState<TurnType>("Full turn");

  if (!open)
    return (
      <button className="btn primary big" onClick={() => setOpen(true)}>
        + New inspection
      </button>
    );

  return (
    <section className="card">
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const p: Property = {
            id: uid(),
            name: name.trim(),
            address: address.trim(),
            turnType,
            inspector: myName(),
            status: "in_progress",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await store.putProperty(p);
          go(`/p/${p.id}/rooms`);
        }}
      >
        <h2>New inspection</h2>
        <label>
          Unit
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 123 Main St, Apt 4B" required autoFocus />
        </label>
        <div className="grid2">
          <label>
            Turn type
            <select value={turnType} onChange={(e) => setTurnType(e.target.value as TurnType)}>
              {TURN_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Address (optional)
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="City, state" />
          </label>
        </div>
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="btn primary grow">Start inspection</button>
        </div>
      </form>
    </section>
  );
}

function AskBox({ aiEnabled }: { aiEnabled: boolean }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ q: string; answer: string; queries: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await syncNow();
      const r = await askQuestion(q.trim());
      setResult({ q: q.trim(), ...r });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card ask">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
      >
        <input
          className="grow"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={aiEnabled ? "Ask about your inspections…" : "Ask is available when online with AI on"}
          disabled={!aiEnabled}
          enterKeyHint="send"
        />
        <button className="btn primary" disabled={!aiEnabled || busy || !question.trim()}>
          {busy ? <span className="spinner" /> : "Ask"}
        </button>
      </form>
      {!result && !busy && (
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="chip"
              disabled={!aiEnabled}
              onClick={() => {
                setQuestion(s);
                submit(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {busy && <p className="small muted">Looking through the records…</p>}
      {error && <p className="small error-text">{error}</p>}
      {result && !busy && (
        <div className="answer">
          <p className="small muted">{result.q}</p>
          <p className="answer-text">{result.answer}</p>
          {result.queries.length > 0 && (
            <details className="small muted">
              <summary>How this was worked out</summary>
              {result.queries.map((q, i) => (
                <pre key={i}>{q}</pre>
              ))}
            </details>
          )}
          <button className="link small" onClick={() => setResult(null)}>
            Ask something else
          </button>
        </div>
      )}
    </section>
  );
}

function Dashboard({ stats, error, online }: { stats: Stats | null; error: string | null; online: boolean }) {
  if (!online) return <p className="muted small">Team numbers show here when you're online.</p>;
  if (error) return <p className="small error-text">{error}</p>;
  if (!stats) return <p className="muted small">Loading team numbers…</p>;
  const t = stats.totals;
  return (
    <section className="stack">
      <div className="summary-bar">
        <a href="#/followup">
          <b>{t.open_items}</b>
          <span>open repairs</span>
        </a>
        <a href="#/followup?filter=overdue" className={t.overdue_items ? "alert" : ""}>
          <b>{t.overdue_items}</b>
          <span>overdue</span>
        </a>
        <a href="#/followup?filter=unassigned">
          <b>{t.unassigned_items}</b>
          <span>no owner</span>
        </a>
        <div>
          <b>{range(t.open_cost_low, t.open_cost_high)}</b>
          <span>open estimate</span>
        </div>
      </div>

      <div className="dash-grid">
        <div className="card">
          <h3>By turn type</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="num">Inspections</th>
                <th className="num">Avg estimate</th>
              </tr>
            </thead>
            <tbody>
              {stats.byTurnType.map((r) => (
                <tr key={r.turn_type}>
                  <td>{r.turn_type}</td>
                  <td className="num">{r.inspections}</td>
                  <td className="num">{r.avg_cost_high != null ? range(r.avg_cost_low ?? 0, r.avg_cost_high) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <MonthChart rows={stats.byMonth} />
        </div>

        <div className="card">
          <h3>Not rent-ready</h3>
          {stats.notReady.length === 0 ? (
            <p className="muted small">Every inspected unit is clear.</p>
          ) : (
            <ul className="mini-list">
              {stats.notReady.map((u) => (
                <li key={u.id}>
                  <a href={`#/p/${u.id}/repairs`}>
                    <strong>{u.unit}</strong>
                    <span className="muted small">
                      {" "}
                      {u.turn_type} · {u.open_items} open{u.overdue ? ` · ` : ""}
                    </span>
                    {u.overdue ? <span className="small error-text">{u.overdue} overdue</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h3>Most common repairs (90 days)</h3>
          <ul className="mini-list">
            {stats.topCategories.map((c) => (
              <li key={c.category}>
                {CATEGORY_LABELS[c.category as IssueCategory] ?? c.category}
                <span className="muted small">
                  {" "}
                  · {c.items} · up to {money(c.cost_high)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3>Who owns open repairs</h3>
          <ul className="mini-list">
            {stats.byAssignee.map((a) => (
              <li key={a.assignee}>
                <a href={`#/followup?assignee=${encodeURIComponent(a.assignee)}`}>
                  {a.assignee}
                  <span className="muted small"> · {a.open_items} open</span>
                  {a.overdue ? <span className="small error-text"> · {a.overdue} overdue</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Inspections per month, stacked by turn type. */
function MonthChart({ rows }: { rows: Stats["byMonth"] }) {
  const months = [...new Set(rows.map((r) => r.month))];
  if (months.length < 2) return null;
  const types = [...new Set(rows.map((r) => r.turn_type))];
  const max = Math.max(...months.map((m) => rows.filter((r) => r.month === m).reduce((s, r) => s + r.inspections, 0)));
  const colors = ["#14213d", "#fca311", "#2a9d8f", "#8d99ae", "#e76f51", "#6d597a", "#b5b5b5"];
  return (
    <div className="month-chart" aria-label="Inspections per month by turn type">
      <div className="bars">
        {months.map((m) => {
          const total = rows.filter((r) => r.month === m).reduce((s, r) => s + r.inspections, 0);
          return (
            <div key={m} className="bar-col" title={`${m}: ${total}`}>
              <div className="bar" style={{ height: `${(total / max) * 100}%` }}>
                {types.map((t, i) => {
                  const n = rows.find((r) => r.month === m && r.turn_type === t)?.inspections ?? 0;
                  return n ? <span key={t} style={{ flex: n, background: colors[i % colors.length] }} title={`${t}: ${n}`} /> : null;
                })}
              </div>
              <span className="bar-label">{m.slice(5)}</span>
            </div>
          );
        })}
      </div>
      <div className="legend small">
        {types.map((t, i) => (
          <span key={t}>
            <i style={{ background: colors[i % colors.length] }} />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
