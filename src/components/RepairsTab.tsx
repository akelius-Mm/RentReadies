import { useMemo, useState } from "react";
import type { PropertyData } from "../lib/usePropertyData";
import { CATEGORY_LABELS, type Issue, type Photo } from "../lib/types";
import { SEVERITY_RANK, range, totals } from "../lib/format";
import { store } from "../lib/db";
import { IssueCard, IssueEditor, Modal, PhotoWithBoxes } from "./common";

type GroupBy = "room" | "trade" | "category" | "severity";
type Filter = "active" | "open" | "approved" | "scheduled" | "done" | "dismissed" | "all";

export default function RepairsTab({ data }: { data: PropertyData }) {
  const { property, rooms, photos, issues, reload } = data;
  const [groupBy, setGroupBy] = useState<GroupBy>("room");
  const [filter, setFilter] = useState<Filter>("active");
  const [editing, setEditing] = useState<Issue | "new" | null>(null);
  const [viewPhoto, setViewPhoto] = useState<Photo | null>(null);

  const filtered = useMemo(
    () =>
      issues.filter((i) =>
        filter === "all" ? true : filter === "active" ? i.status !== "dismissed" && i.status !== "done" : i.status === filter,
      ),
    [issues, filter],
  );

  const groups = useMemo(() => {
    const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? "Unknown room";
    const key = (i: Issue) =>
      groupBy === "room" ? roomName(i.roomId) : groupBy === "trade" ? i.trade : groupBy === "category" ? CATEGORY_LABELS[i.category] : i.severity;
    const m = new Map<string, Issue[]>();
    for (const i of [...filtered].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])) {
      const k = key(i);
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    const entries = [...m.entries()];
    if (groupBy === "severity") entries.sort((a, b) => SEVERITY_RANK[b[0] as Issue["severity"]] - SEVERITY_RANK[a[0] as Issue["severity"]]);
    else if (groupBy === "room") {
      const order = (n: string) => rooms.findIndex((r) => r.name === n);
      entries.sort((a, b) => order(a[0]) - order(b[0]));
    } else entries.sort((a, b) => totals(b[1]).high - totals(a[1]).high);
    return entries;
  }, [filtered, groupBy, rooms]);

  const t = totals(filtered);
  const openCount = issues.filter((i) => i.status === "open").length;

  return (
    <div className="page">
      <div className="row wrap">
        <label className="inline">
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="active">To do</option>
            <option value="open">Needs review</option>
            <option value="approved">Approved</option>
            <option value="scheduled">Scheduled</option>
            <option value="done">Done</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="inline">
          Group by
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="room">Room</option>
            <option value="trade">Trade / vendor</option>
            <option value="category">Category</option>
            <option value="severity">Severity</option>
          </select>
        </label>
        <span className="grow" />
        {openCount > 0 && (
          <button
            className="btn small"
            onClick={async () => {
              if (!confirm(`Approve all ${openCount} items that need review?`)) return;
              await store.putIssues(issues.filter((i) => i.status === "open").map((i) => ({ ...i, status: "approved" as const })));
              reload();
            }}
          >
            Approve all ({openCount})
          </button>
        )}
        <button className="btn primary small" disabled={!rooms.length} onClick={() => setEditing("new")}>
          + Add item
        </button>
      </div>

      <div className="summary-bar">
        <div>
          <b>{t.count}</b>
          <span>items</span>
        </div>
        <div>
          <b>{range(t.low, t.high)}</b>
          <span>estimated</span>
        </div>
      </div>

      {groups.length === 0 && <p className="muted">Nothing here. Inspect rooms to find repairs.</p>}
      {groups.map(([name, list]) => {
        const gt = totals(list);
        return (
          <section key={name}>
            <div className="row group-head">
              <h3 className="grow" style={{ textTransform: groupBy === "severity" ? "capitalize" : undefined }}>
                {name}
              </h3>
              <span className="muted small">
                {list.length} · {range(gt.low, gt.high)}
              </span>
            </div>
            <div className="stack">
              {list.map((i) => {
                const photo = photos.find((p) => p.id === i.photoId);
                return (
                  <IssueCard
                    key={i.id}
                    issue={i}
                    photo={photo}
                    room={groupBy === "room" ? undefined : rooms.find((r) => r.id === i.roomId)}
                    onChanged={reload}
                    onEdit={() => setEditing(i)}
                    onOpenPhoto={photo ? () => setViewPhoto(photo) : undefined}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {viewPhoto && (
        <Modal wide onClose={() => setViewPhoto(null)}>
          <h3>{viewPhoto.label}</h3>
          <PhotoWithBoxes photo={viewPhoto} issues={issues} />
        </Modal>
      )}
      {editing && (
        <IssueEditor
          initial={editing === "new" ? undefined : editing}
          propertyId={property!.id}
          rooms={rooms}
          photos={photos}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
