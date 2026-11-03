import { useState } from "react";
import type { PropertyData } from "../lib/usePropertyData";
import { CATEGORY_LABELS, TRADES } from "../lib/types";
import { SEVERITY_RANK, money, range, totals } from "../lib/format";
import { PhotoWithBoxes, SeverityTag } from "./common";
import { ConditionTag, inventoryDetails } from "./Inventory";
import { INVENTORY_KIND_LABELS } from "../lib/types";

export default function ReportTab({ data }: { data: PropertyData }) {
  const { property, rooms, photos, issues, inventory } = data;
  const [includeReview, setIncludeReview] = useState(true);
  const [includePhotos, setIncludePhotos] = useState(true);
  const [includeInventory, setIncludeInventory] = useState(true);
  if (!property) return null;

  const items = issues.filter(
    (i) => i.status !== "dismissed" && i.status !== "done" && (includeReview || i.status !== "open"),
  );
  const t = totals(items);
  const byTrade = TRADES.map((tr) => ({ trade: tr, list: items.filter((i) => i.trade === tr) })).filter((x) => x.list.length);

  const exportCsv = () => {
    const header = ["Room", "Item", "Category", "Severity", "Trade", "Status", "Cost low", "Cost high", "Details", "Recommended fix", "Source", "Owner", "Due", "Completed"];
    const rows = items.map((i) => [
      rooms.find((r) => r.id === i.roomId)?.name ?? "",
      i.title,
      CATEGORY_LABELS[i.category],
      i.severity,
      i.trade,
      i.status,
      i.estCostLow,
      i.estCostHigh,
      i.description,
      i.recommendedAction,
      i.source,
      i.assignee ?? "",
      i.dueDate ?? "",
      i.completedAt ? new Date(i.completedAt).toISOString().slice(0, 10) : "",
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${property.name.replace(/[^\w\- ]+/g, "")} make-ready.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="page report">
      <div className="row wrap no-print">
        <label className="inline">
          <input type="checkbox" checked={includeReview} onChange={(e) => setIncludeReview(e.target.checked)} /> Include items not yet reviewed
        </label>
        <label className="inline">
          <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} /> Photos
        </label>
        <label className="inline">
          <input type="checkbox" checked={includeInventory} onChange={(e) => setIncludeInventory(e.target.checked)} /> Appliances & finishes
        </label>
        <span className="grow" />
        <button className="btn small" onClick={exportCsv}>
          Export CSV
        </button>
        <button className="btn primary small" onClick={() => window.print()}>
          Print / save PDF
        </button>
      </div>

      <header className="report-head">
        <h1>Make-ready report</h1>
        <p>
          <b>{property.name}</b>
          {property.address ? ` — ${property.address}` : ""}
        </p>
        <p className="small">
          {property.turnType ?? "Turn type not set"} · inspected {new Date(property.createdAt).toLocaleDateString()}
          {property.inspector ? ` by ${property.inspector}` : ""}
          {property.status === "complete" && property.completedAt ? ` · completed ${new Date(property.completedAt).toLocaleDateString()}` : ""}
        </p>
        <p className="muted small">Prepared {new Date().toLocaleDateString()} · Costs are estimates; confirm with vendors.</p>
      </header>

      <section className="summary-bar">
        <div>
          <b>{t.count}</b>
          <span>repair items</span>
        </div>
        <div>
          <b>{range(t.low, t.high)}</b>
          <span>estimated total</span>
        </div>
        <div>
          <b>{items.filter((i) => i.severity === "urgent" || i.severity === "high").length}</b>
          <span>high / urgent</span>
        </div>
      </section>

      <section>
        <h2>By trade</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Trade</th>
              <th className="num">Items</th>
              <th className="num">Estimate</th>
            </tr>
          </thead>
          <tbody>
            {byTrade.map(({ trade, list }) => {
              const x = totals(list);
              return (
                <tr key={trade}>
                  <td>{trade}</td>
                  <td className="num">{list.length}</td>
                  <td className="num">{range(x.low, x.high)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th className="num">{t.count}</th>
              <th className="num">{range(t.low, t.high)}</th>
            </tr>
          </tfoot>
        </table>
      </section>

      {rooms.map((room) => {
        const list = items.filter((i) => i.roomId === room.id).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
        if (!list.length) return null;
        const rt = totals(list);
        const photoIds = [...new Set(list.map((i) => i.photoId).filter(Boolean))] as string[];
        return (
          <section key={room.id} className="report-room">
            <div className="row">
              <h2 className="grow">{room.name}</h2>
              <span className="muted">{range(rt.low, rt.high)}</span>
            </div>
            {room.aiSummary && <p className="small muted">{room.aiSummary}</p>}
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th>Trade</th>
                  <th className="num">Estimate</th>
                </tr>
              </thead>
              <tbody>
                {list.map((i, n) => (
                  <tr key={i.id}>
                    <td>{n + 1}</td>
                    <td>
                      <SeverityTag severity={i.severity} /> <b>{i.title}</b>
                      {i.recommendedAction && <div className="small">{i.recommendedAction}</div>}
                    </td>
                    <td>{i.trade}</td>
                    <td className="num">{i.estCostLow === i.estCostHigh ? money(i.estCostLow) : range(i.estCostLow, i.estCostHigh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {includePhotos && photoIds.length > 0 && (
              <div className="report-photos">
                {photoIds.map((pid) => {
                  const p = photos.find((x) => x.id === pid);
                  return p ? (
                    <figure key={pid}>
                      <PhotoWithBoxes photo={p} issues={list} numberOf={(i) => list.indexOf(i) + 1} />
                      <figcaption className="small muted">{p.label}</figcaption>
                    </figure>
                  ) : null;
                })}
              </div>
            )}
          </section>
        );
      })}

      {includeInventory && inventory.length > 0 && (
        <section className="report-room">
          <h2>Appliances & finishes</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Item</th>
                <th>Details</th>
                <th>Condition</th>
              </tr>
            </thead>
            <tbody>
              {rooms.flatMap((r) =>
                inventory
                  .filter((i) => i.roomId === r.id)
                  .sort((a, b) => a.kind.localeCompare(b.kind))
                  .map((i) => (
                    <tr key={i.id}>
                      <td>{r.name}</td>
                      <td>
                        <b>{i.item}</b>
                        <div className="small muted">{INVENTORY_KIND_LABELS[i.kind]}</div>
                      </td>
                      <td className="small">{inventoryDetails(i)}</td>
                      <td>
                        <ConditionTag condition={i.condition} />
                      </td>
                    </tr>
                  )),
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
