import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
import type { InventoryItem, Issue, Photo, Property, Room } from "./types";

// Local copy on the phone (works offline). Every change is also queued in "outbox" and
// sent to the shared record on the server by sync.ts.

export type Kind = "property" | "room" | "photo" | "issue" | "inventory";
const STORE: Record<Kind, "properties" | "rooms" | "photos" | "issues" | "inventory"> = {
  property: "properties",
  room: "rooms",
  photo: "photos",
  issue: "issues",
  inventory: "inventory",
};

export interface OutboxEntry {
  key: string; // `${kind}:${id}`
  kind: Kind;
  id: string;
  propertyId: string;
  deleted: boolean;
  version: number; // updatedAt of the change; lets sync skip entries changed again mid-push
}

interface RRSchema extends DBSchema {
  properties: { key: string; value: Property };
  rooms: { key: string; value: Room; indexes: { byProperty: string } };
  photos: { key: string; value: Photo; indexes: { byProperty: string; byRoom: string } };
  issues: { key: string; value: Issue; indexes: { byProperty: string; byRoom: string } };
  inventory: { key: string; value: InventoryItem; indexes: { byProperty: string; byRoom: string } };
  outbox: { key: string; value: OutboxEntry };
  meta: { key: string; value: unknown };
}

type AnyRecord = Property | Room | Photo | Issue | InventoryItem;
type Tx = IDBPTransaction<RRSchema, StoreNames<RRSchema>[], "readwrite" | "versionchange">;

let dbp: Promise<IDBPDatabase<RRSchema>> | null = null;
function db() {
  dbp ??= openDB<RRSchema>("rentreadies", 3, {
    async upgrade(d, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        d.createObjectStore("properties", { keyPath: "id" });
        const rooms = d.createObjectStore("rooms", { keyPath: "id" });
        rooms.createIndex("byProperty", "propertyId");
        const photos = d.createObjectStore("photos", { keyPath: "id" });
        photos.createIndex("byProperty", "propertyId");
        photos.createIndex("byRoom", "roomId");
        const issues = d.createObjectStore("issues", { keyPath: "id" });
        issues.createIndex("byProperty", "propertyId");
        issues.createIndex("byRoom", "roomId");
      }
      if (oldVersion < 2) {
        const inv = d.createObjectStore("inventory", { keyPath: "id" });
        inv.createIndex("byProperty", "propertyId");
        inv.createIndex("byRoom", "roomId");
      }
      if (oldVersion < 3) {
        d.createObjectStore("outbox", { keyPath: "key" });
        d.createObjectStore("meta");
        // Inspections made before syncing existed: queue them all for upload.
        if (oldVersion > 0) {
          for (const kind of Object.keys(STORE) as Kind[]) {
            for (const rec of await tx.objectStore(STORE[kind]).getAll()) {
              await tx.objectStore("outbox").put(entry(kind, rec as AnyRecord, false, (rec as { updatedAt?: number }).updatedAt ?? Date.now()));
            }
          }
        }
      }
    },
  });
  return dbp;
}

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

const propertyIdOf = (kind: Kind, rec: AnyRecord) => (kind === "property" ? rec.id : (rec as Room).propertyId);

function entry(kind: Kind, rec: AnyRecord, deleted: boolean, version: number): OutboxEntry {
  return { key: `${kind}:${rec.id}`, kind, id: rec.id, propertyId: propertyIdOf(kind, rec), deleted, version };
}

// Listeners notified after local writes (sync uses this to push soon after a change).
const listeners = new Set<() => void>();
export const onLocalChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const changed = () => listeners.forEach((fn) => fn());

/** Write records and queue them for sync, in one transaction. */
async function putAll(kind: Kind, recs: AnyRecord[]) {
  if (!recs.length) return;
  const d = await db();
  const tx = d.transaction([STORE[kind], "outbox"], "readwrite");
  const now = Date.now();
  for (const r of recs) {
    const stamped = { ...r, updatedAt: now };
    await tx.objectStore(STORE[kind]).put(stamped as never);
    await tx.objectStore("outbox").put(entry(kind, stamped, false, now));
  }
  await tx.done;
  changed();
}

/** getAll on an index inside a multi-store transaction (idb's types can't express this generically). */
const byIndex = (tx: Tx, kind: Kind, index: "byProperty" | "byRoom", key: string) =>
  (tx.objectStore(STORE[kind]) as unknown as { index(n: string): { getAll(k: string): Promise<AnyRecord[]> } }).index(index).getAll(key);

async function deleteIn(tx: Tx, kind: Kind, rec: AnyRecord) {
  await tx.objectStore(STORE[kind]).delete(rec.id);
  await tx.objectStore("outbox").put(entry(kind, rec, true, Date.now()));
}

export const store = {
  async listProperties() {
    return (await (await db()).getAll("properties")).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async getProperty(id: string) {
    return (await db()).get("properties", id);
  },
  async putProperty(p: Property) {
    await putAll("property", [p]);
  },
  async deleteProperty(id: string) {
    const d = await db();
    const tx = d.transaction(["properties", "rooms", "photos", "issues", "inventory", "outbox"], "readwrite") as unknown as Tx;
    for (const kind of ["room", "photo", "issue", "inventory"] as const) {
      const recs = await byIndex(tx, kind, "byProperty", id);
      for (const r of recs) await deleteIn(tx, kind, r);
    }
    const p = await tx.objectStore("properties").get(id);
    if (p) await deleteIn(tx, "property", p as Property);
    await tx.done;
    changed();
  },

  async rooms(propertyId: string) {
    return (await (await db()).getAllFromIndex("rooms", "byProperty", propertyId)).sort((a, b) => a.createdAt - b.createdAt);
  },
  async allRooms() {
    return (await db()).getAll("rooms");
  },
  async putRoom(r: Room) {
    await putAll("room", [r]);
  },
  async deleteRoom(id: string) {
    const d = await db();
    const tx = d.transaction(["rooms", "photos", "issues", "inventory", "outbox"], "readwrite") as unknown as Tx;
    for (const kind of ["photo", "issue", "inventory"] as const) {
      const recs = await byIndex(tx, kind, "byRoom", id);
      for (const r of recs) await deleteIn(tx, kind, r);
    }
    const room = await tx.objectStore("rooms").get(id);
    if (room) await deleteIn(tx, "room", room as Room);
    await tx.done;
    changed();
  },

  async photos(propertyId: string) {
    return (await db()).getAllFromIndex("photos", "byProperty", propertyId);
  },
  async getPhoto(id: string) {
    return (await db()).get("photos", id);
  },
  async putPhoto(p: Photo) {
    await putAll("photo", [p]);
  },
  async deletePhoto(id: string) {
    const d = await db();
    const photo = await d.get("photos", id);
    if (!photo) return;
    const unlinkIssues = (await d.getAllFromIndex("issues", "byProperty", photo.propertyId)).filter((i) => i.photoId === id);
    const unlinkInv = (await d.getAllFromIndex("inventory", "byProperty", photo.propertyId)).filter((i) => i.photoId === id);
    await putAll("issue", unlinkIssues.map((i) => ({ ...i, photoId: undefined, bbox: null })));
    await putAll("inventory", unlinkInv.map((i) => ({ ...i, photoId: undefined })));
    const tx = d.transaction(["photos", "outbox"], "readwrite") as unknown as Tx;
    await deleteIn(tx, "photo", photo);
    await tx.done;
    changed();
  },

  async issues(propertyId: string) {
    return (await db()).getAllFromIndex("issues", "byProperty", propertyId);
  },
  async allIssues() {
    return (await db()).getAll("issues");
  },
  async putIssue(i: Issue) {
    await putAll("issue", [i]);
  },
  async putIssues(list: Issue[]) {
    await putAll("issue", list);
  },
  async deleteIssue(id: string) {
    const d = await db();
    const issue = await d.get("issues", id);
    if (!issue) return;
    const tx = d.transaction(["issues", "outbox"], "readwrite") as unknown as Tx;
    await deleteIn(tx, "issue", issue);
    await tx.done;
    changed();
  },
  /** Remove AI issues for a room that the user hasn't acted on, before re-analysis. */
  async clearUntouchedAiIssues(roomId: string) {
    const d = await db();
    const tx = d.transaction(["issues", "outbox"], "readwrite") as unknown as Tx;
    const list = (await byIndex(tx, "issue", "byRoom", roomId)) as Issue[];
    for (const i of list) if (i.source === "ai" && i.status === "open") await deleteIn(tx, "issue", i);
    await tx.done;
    changed();
  },

  async inventory(propertyId: string) {
    return (await db()).getAllFromIndex("inventory", "byProperty", propertyId);
  },
  async putInventoryItem(i: InventoryItem) {
    await putAll("inventory", [i]);
  },
  async deleteInventoryItem(id: string) {
    const d = await db();
    const item = await d.get("inventory", id);
    if (!item) return;
    const tx = d.transaction(["inventory", "outbox"], "readwrite") as unknown as Tx;
    await deleteIn(tx, "inventory", item);
    await tx.done;
    changed();
  },
  /** Replace a room's AI-generated inventory; items the user added or edited (source "manual") stay. */
  async replaceAiInventory(roomId: string, items: InventoryItem[]) {
    const d = await db();
    const tx = d.transaction(["inventory", "outbox"], "readwrite") as unknown as Tx;
    const list = (await byIndex(tx, "inventory", "byRoom", roomId)) as InventoryItem[];
    for (const i of list) if (i.source === "ai") await deleteIn(tx, "inventory", i);
    await tx.done;
    await putAll("inventory", items);
  },
};

// ---- Used by sync.ts ---------------------------------------------------------

export const syncStore = {
  async outbox() {
    return (await db()).getAll("outbox");
  },
  async pendingCount() {
    return (await db()).count("outbox");
  },
  /** Drop sent entries, unless the record changed again while it was being sent. */
  async clearSent(sent: OutboxEntry[]) {
    const d = await db();
    const tx = d.transaction("outbox", "readwrite");
    for (const e of sent) {
      const cur = await tx.store.get(e.key);
      if (cur && cur.version === e.version) await tx.store.delete(e.key);
    }
    await tx.done;
  },
  async record(kind: Kind, id: string) {
    return (await (await db()).get(STORE[kind], id)) as AnyRecord | undefined;
  },
  async meta<T>(key: string) {
    return (await (await db()).get("meta", key)) as T | undefined;
  },
  async setMeta(key: string, value: unknown) {
    await (await db()).put("meta", value, key);
  },
  /** Apply a change from the server unless this phone has a newer, unsent edit of the same record. */
  async applyRemote(kind: Kind, id: string, data: AnyRecord | null, updatedAt: number) {
    const d = await db();
    const tx = d.transaction([STORE[kind], "outbox"], "readwrite");
    const pending = await tx.objectStore("outbox").get(`${kind}:${id}`);
    if (pending && pending.version >= updatedAt) {
      await tx.done;
      return false;
    }
    const local = (await tx.objectStore(STORE[kind]).get(id)) as AnyRecord | undefined;
    if (!data) {
      if (local) await tx.objectStore(STORE[kind]).delete(id);
    } else {
      const merged = { ...data } as AnyRecord & { blob?: Blob; scan?: Property["scan"] };
      // Keep files already on this phone; the server record never contains them.
      if (kind === "photo" && (local as Photo | undefined)?.blob) (merged as Photo).blob = (local as Photo).blob;
      if (kind === "property") {
        const ls = (local as Property | undefined)?.scan;
        const rs = (merged as Property).scan;
        if (rs && ls?.blob && ls.blobId === rs.blobId) rs.blob = ls.blob;
      }
      await tx.objectStore(STORE[kind]).put(merged as never);
    }
    await tx.done;
    return true;
  },
  async setPhotoBlob(id: string, blob: Blob) {
    const d = await db();
    const p = await d.get("photos", id);
    if (p) await d.put("photos", { ...p, blob });
  },
  async setScanBlob(propertyId: string, blob: Blob) {
    const d = await db();
    const p = await d.get("properties", propertyId);
    if (p?.scan) await d.put("properties", { ...p, scan: { ...p.scan, blob } });
  },
};
