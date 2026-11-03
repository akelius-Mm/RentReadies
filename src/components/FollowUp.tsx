import { useCallback, useEffect, useMemo, useState } from "react";
import { store } from "../lib/db";
import { onRemoteData } from "../lib/sync";
import { useHashLocation } from "../lib/router";
import { myName } from "../lib/me";
import { SEVERITY_RANK, range, totals } from "../lib/format";
import type { Issue, IssueStatus, Property, Room } from "../lib/types";
import { SeverityTag } from "./common";

type Filter = "open" | "overdue" | "unassigned" | "mine" | "done";

const today = () => new Date().toISOString().slice(0, 10);
const isOpen = (i: Issue) => i.status !== "done" && i.status !== "dismissed";

export default function FollowUp() {
  const { query } = useHashLocation();
  const [filter, setFilter] = useState<Filter>((query.get("filter") as Filter) || "open");
  const [assignee, setAssignee] = useState(query.get("assignee") ?? "");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  const load = useCallback(async () => {
    const [i, p, r] = await Promise.all([store.allIssues(), store.listProperties(), store.allRooms()]);
    setIssues(i);
    setProperties(p);
    setRooms(r);
  }, []);
  useEffect(() => {
    load();
    return onRemoteData(load);
  }, [load]);

  const me = myName();
  const people = useMemo(
    () => [...new Set([me, ...issues.map((i) => i.assignee ?? ""), ...properties.map((p) => p.inspector ?? "")].filter(Boolean))].sort(),
    [issues, properties, me],
  );

  const shown = useMemo(() => {
    const t = today();
    return issues
      .filter((i) => {
        if (filter === "done") return i.status === "done";
        if (!isOpen(i)) return false;
        if (filter === "overdue" && !(i.dueDate && i.dueDate < t)) return false;
        if (filter === "unassigned" && i.assignee) return false;
        if (filter === "mine" && i.assignee !== me) return false;
        if (assignee && (assignee === "Unassigned" ? Boolean(i.assignee) : i.assignee !== assignee)) return false;
        return true;
      })
      .sort((a, b) =>
        filter === "done"
          ? (b.completedAt ?? 0) - (a.completedAt ?? 0)
          : (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
      );
  }, [issues, filter, assignee, me]);

  const byUnit = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of shown) m.set(i.propertyId, [...(m.get(i.propertyId) ?? []), i]);
    return [...m.entries()];
  }, [shown]);

  const update = async (i: Issue, patch: Partial<Issue>) => {
    const next: Issue = { ...i, ...patch, updatedBy: me || undefined };
    if (patch.status === "done" && !i.completedAt) next.completedAt = Date.now();
    if (patch.status && patch.status !== "done") next.completedAt = undefined;
    await store.putIssue(next);
    setIssues((list) => list.map((x) => (x.id === i.id ? next : x)));
  };

  const t = totals(shown);
  const FILTERS: [Filter, string][] = [
    ["open", "All open"],
    ["overdue", "Overdue"],
    ["unassigned", "No owner"],
    ["mine", "Mine"],
    ["done", "Done"],
  ];

  return (
    <div className="page">
      <h1>Follow-up</h1>
      <div className="chips">
        {FILTERS.map(([f, label]) => (
          <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
        {assignee && (
          <button className="chip active" onClick={() => setAssignee("")}>
            {assignee} ✕
          </button>
        )}
      </div>
      <p className="muted small">
        {shown.length} item{shown.length === 1 ? "" : "s"} · {range(t.low, t.high)}
      </p>

      <datalist id="people">
        {people.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {byUnit.length === 0 && <p className="muted">Nothing here.</p>}
      {byUnit.map(([pid, list]) => {
        const p = properties.find((x) => x.id === pid);
        return (
          <section key={pid} className="card">
            <a href={`#/p/${pid}/repairs`} className="row">
              <h2 className="grow">{p?.name ?? "Unknown unit"}</h2>
              <span className="muted small">{p?.turnType}</span>
            </a>
            <ul className="fu-list">
              {list.map((i) => {
                const overdue = isOpen(i) && i.dueDate && i.dueDate < today();
                return (
                  <li key={i.id} className={overdue ? "overdue" : ""}>
                    <div className="row tight wrap">
                      <SeverityTag severity={i.severity} />
                      <strong className="grow">{i.title}</strong>
                      <span className="muted small">
                        {rooms.find((r) => r.id === i.roomId)?.name} · {i.trade} · {range(i.estCostLow, i.estCostHigh)}
                      </span>
                    </div>
                    <div className="fu-controls">
                      <input
                        list="people"
                        defaultValue={i.assignee ?? ""}
                        placeholder="Owner"
                        onBlur={(e) => e.target.value.trim() !== (i.assignee ?? "") && update(i, { assignee: e.target.value.trim() || undefined })}
                      />
                      <input
                        type="date"
                        value={i.dueDate ?? ""}
                        onChange={(e) => update(i, { dueDate: e.target.value || undefined })}
                        aria-label="Due date"
                      />
                      <select value={i.status} onChange={(e) => update(i, { status: e.target.value as IssueStatus })} aria-label="Status">
                        <option value="open">Needs review</option>
                        <option value="approved">Approved</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="done">Done</option>
                        <option value="dismissed">Dismissed</option>
                      </select>
                      {isOpen(i) && (
                        <button className="btn small primary" onClick={() => update(i, { status: "done" })}>
                          Done ✓
                        </button>
                      )}
                    </div>
                    {overdue && <p className="small error-text">Overdue since {i.dueDate}</p>}
                    {i.status === "done" && i.completedAt && (
                      <p className="small muted">
                        Done {new Date(i.completedAt).toLocaleDateString()}
                        {i.updatedBy ? ` by ${i.updatedBy}` : ""}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
