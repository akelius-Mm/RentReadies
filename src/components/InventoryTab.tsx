import { useState } from "react";
import type { PropertyData } from "../lib/usePropertyData";
import type { InventoryItem, Photo } from "../lib/types";
import { InventoryEditor, InventoryList, downloadText, inventoryCsv } from "./Inventory";
import { Modal, PhotoWithBoxes } from "./common";

export default function InventoryTab({ data }: { data: PropertyData }) {
  const { property, rooms, photos, inventory, reload } = data;
  const [groupBy, setGroupBy] = useState<"room" | "kind">("room");
  const [editing, setEditing] = useState<InventoryItem | "new" | null>(null);
  const [viewPhoto, setViewPhoto] = useState<Photo | null>(null);
  if (!property) return null;

  const appliances = inventory.filter((i) => i.kind === "appliance");
  const needsReplace = inventory.filter((i) => i.condition === "replace" || i.condition === "poor").length;

  return (
    <div className="page">
      <div className="row wrap">
        <label className="inline">
          Group by
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as "room" | "kind")}>
            <option value="room">Room</option>
            <option value="kind">Appliance / finish / fixture</option>
          </select>
        </label>
        <span className="grow" />
        <button
          className="btn small"
          disabled={!inventory.length}
          onClick={() => downloadText(inventoryCsv(inventory, rooms), `${property.name.replace(/[^\w\- ]+/g, "")} appliances and finishes.csv`)}
        >
          Export CSV
        </button>
        <button className="btn primary small" disabled={!rooms.length} onClick={() => setEditing("new")}>
          + Add item
        </button>
      </div>

      <div className="summary-bar">
        <div>
          <b>{appliances.length}</b>
          <span>appliances</span>
        </div>
        <div>
          <b>{inventory.length - appliances.length}</b>
          <span>finishes & fixtures</span>
        </div>
        <div>
          <b>{appliances.filter((a) => !a.model).length}</b>
          <span>appliances missing model #</span>
        </div>
        <div>
          <b>{needsReplace}</b>
          <span>poor / replace</span>
        </div>
      </div>

      {inventory.length === 0 && (
        <p className="muted">
          Nothing recorded yet. Run "Inspect with AI" in a room and its appliances, finishes, and fixtures are listed here.
        </p>
      )}

      {groupBy === "kind" ? (
        <InventoryList items={inventory} photos={photos} rooms={rooms} showRoom onEdit={setEditing} onOpenPhoto={setViewPhoto} />
      ) : (
        rooms.map((r) => {
          const list = inventory.filter((i) => i.roomId === r.id);
          if (!list.length) return null;
          return (
            <section key={r.id} className="card">
              <h2>
                <a href={`#/p/${property.id}/room/${r.id}`}>{r.name}</a>
              </h2>
              <InventoryList items={list} photos={photos} onEdit={setEditing} onOpenPhoto={setViewPhoto} />
            </section>
          );
        })
      )}

      {viewPhoto && (
        <Modal wide onClose={() => setViewPhoto(null)}>
          <h3>{viewPhoto.label}</h3>
          <PhotoWithBoxes photo={viewPhoto} issues={[]} />
        </Modal>
      )}
      {editing && (
        <InventoryEditor
          initial={editing === "new" ? undefined : editing}
          propertyId={property.id}
          rooms={rooms}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
