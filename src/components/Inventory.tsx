import { useState } from "react";
import { store, uid } from "../lib/db";
import {
  CONDITIONS,
  INVENTORY_KINDS,
  INVENTORY_KIND_LABELS,
  type InventoryItem,
  type Photo,
  type Room,
} from "../lib/types";
import { Modal, Thumb } from "./common";

const CONDITION_COLOR: Record<InventoryItem["condition"], string> = {
  good: "#2a9d8f",
  fair: "#e9c46a",
  poor: "#f4a261",
  replace: "#e63946",
  unknown: "#8d99ae",
};

export function ConditionTag({ condition }: { condition: InventoryItem["condition"] }) {
  return (
    <span className="sev" style={{ background: CONDITION_COLOR[condition] }}>
      {condition}
    </span>
  );
}

/** One line such as "Stainless steel · Samsung RF28R7351SG · Gas". */
export const inventoryDetails = (i: InventoryItem) =>
  [i.type, i.colorFinish, [i.brand, i.model].filter(Boolean).join(" "), i.notes].filter((x) => x && x.trim()).join(" · ");

export function InventoryList({
  items,
  photos,
  rooms,
  showRoom,
  onEdit,
  onOpenPhoto,
}: {
  items: InventoryItem[];
  photos: Photo[];
  rooms?: Room[];
  showRoom?: boolean;
  onEdit: (i: InventoryItem) => void;
  onOpenPhoto?: (p: Photo) => void;
}) {
  return (
    <div className="stack">
      {INVENTORY_KINDS.map((kind) => {
        const list = items.filter((i) => i.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind}>
            <h3 className="inv-kind">{INVENTORY_KIND_LABELS[kind]}</h3>
            <ul className="inv-list">
              {list.map((i) => {
                const photo = photos.find((p) => p.id === i.photoId);
                return (
                  <li key={i.id}>
                    {photo ? <Thumb photo={photo} onClick={() => onOpenPhoto?.(photo)} /> : <span className="thumb empty" />}
                    <button className="inv-main" onClick={() => onEdit(i)} title="Edit">
                      <span className="row tight">
                        <strong className="grow">{i.item}</strong>
                        <ConditionTag condition={i.condition} />
                      </span>
                      <span className="small">{inventoryDetails(i) || <span className="muted">No details</span>}</span>
                      {showRoom && rooms && (
                        <span className="muted small">{rooms.find((r) => r.id === i.roomId)?.name ?? ""}</span>
                      )}
                      {!i.model && i.kind === "appliance" && (
                        <span className="muted small">Model # not captured — photograph the label.</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function InventoryEditor({
  initial,
  propertyId,
  rooms,
  defaultRoomId,
  onClose,
  onSaved,
}: {
  initial?: InventoryItem;
  propertyId: string;
  rooms: Room[];
  defaultRoomId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<InventoryItem>(
    initial ?? {
      id: uid(),
      propertyId,
      roomId: defaultRoomId ?? rooms[0]?.id ?? "",
      kind: "appliance",
      item: "",
      type: "",
      colorFinish: "",
      brand: "",
      model: "",
      notes: "",
      condition: "good",
      source: "manual",
      createdAt: Date.now(),
    },
  );
  const set = <K extends keyof InventoryItem>(k: K, v: InventoryItem[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // Edited items become "manual" so a re-inspection won't overwrite them.
    await store.putInventoryItem({ ...f, source: "manual" });
    onSaved();
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={save} className="stack">
        <h2>{initial ? "Edit item" : "Add appliance / finish"}</h2>
        <div className="grid2">
          <label>
            Kind
            <select value={f.kind} onChange={(e) => set("kind", e.target.value as InventoryItem["kind"])}>
              {INVENTORY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {INVENTORY_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Room
            <select value={f.roomId} onChange={(e) => set("roomId", e.target.value)}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Item
            <input value={f.item} onChange={(e) => set("item", e.target.value)} required placeholder="Refrigerator, Countertop…" />
          </label>
          <label>
            Type / material
            <input value={f.type} onChange={(e) => set("type", e.target.value)} placeholder="French-door, Quartz, LVP…" />
          </label>
          <label>
            Color / finish
            <input value={f.colorFinish} onChange={(e) => set("colorFinish", e.target.value)} placeholder="Stainless, Brushed nickel…" />
          </label>
          <label>
            Condition
            <select value={f.condition} onChange={(e) => set("condition", e.target.value as InventoryItem["condition"])}>
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Brand
            <input value={f.brand} onChange={(e) => set("brand", e.target.value)} />
          </label>
          <label>
            Model #
            <input value={f.model} onChange={(e) => set("model", e.target.value)} />
          </label>
        </div>
        <label>
          Notes
          <textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Gas/electric, size, paint code, age…" />
        </label>
        <div className="row">
          {initial && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await store.deleteInventoryItem(f.id);
                onSaved();
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function inventoryCsv(items: InventoryItem[], rooms: Room[]) {
  const header = ["Room", "Kind", "Item", "Type / material", "Color / finish", "Brand", "Model", "Condition", "Notes", "Source"];
  const rows = items.map((i) => [
    rooms.find((r) => r.id === i.roomId)?.name ?? "",
    INVENTORY_KIND_LABELS[i.kind],
    i.item,
    i.type,
    i.colorFinish,
    i.brand,
    i.model,
    i.condition,
    i.notes,
    i.source,
  ]);
  return [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

export function downloadText(text: string, fileName: string, type = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
