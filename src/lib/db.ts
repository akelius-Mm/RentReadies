import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Issue, Photo, Property, Room } from "./types";

interface RRSchema extends DBSchema {
  properties: { key: string; value: Property };
  rooms: { key: string; value: Room; indexes: { byProperty: string } };
  photos: { key: string; value: Photo; indexes: { byProperty: string; byRoom: string } };
  issues: { key: string; value: Issue; indexes: { byProperty: string; byRoom: string } };
}

let dbp: Promise<IDBPDatabase<RRSchema>> | null = null;
function db() {
  dbp ??= openDB<RRSchema>("rentreadies", 1, {
    upgrade(d) {
      d.createObjectStore("properties", { keyPath: "id" });
      const rooms = d.createObjectStore("rooms", { keyPath: "id" });
      rooms.createIndex("byProperty", "propertyId");
      const photos = d.createObjectStore("photos", { keyPath: "id" });
      photos.createIndex("byProperty", "propertyId");
      photos.createIndex("byRoom", "roomId");
      const issues = d.createObjectStore("issues", { keyPath: "id" });
      issues.createIndex("byProperty", "propertyId");
      issues.createIndex("byRoom", "roomId");
    },
  });
  return dbp;
}

export const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export const store = {
  async listProperties() {
    return (await (await db()).getAll("properties")).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async getProperty(id: string) {
    return (await db()).get("properties", id);
  },
  async putProperty(p: Property) {
    await (await db()).put("properties", { ...p, updatedAt: Date.now() });
  },
  async deleteProperty(id: string) {
    const d = await db();
    const tx = d.transaction(["properties", "rooms", "photos", "issues"], "readwrite");
    for (const name of ["rooms", "photos", "issues"] as const) {
      const keys = await tx.objectStore(name).index("byProperty").getAllKeys(id);
      for (const k of keys) await tx.objectStore(name).delete(k);
    }
    await tx.objectStore("properties").delete(id);
    await tx.done;
  },

  async rooms(propertyId: string) {
    return (await (await db()).getAllFromIndex("rooms", "byProperty", propertyId)).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
  },
  async putRoom(r: Room) {
    await (await db()).put("rooms", r);
  },
  async deleteRoom(id: string) {
    const d = await db();
    const tx = d.transaction(["rooms", "photos", "issues"], "readwrite");
    for (const name of ["photos", "issues"] as const) {
      const keys = await tx.objectStore(name).index("byRoom").getAllKeys(id);
      for (const k of keys) await tx.objectStore(name).delete(k);
    }
    await tx.objectStore("rooms").delete(id);
    await tx.done;
  },

  async photos(propertyId: string) {
    return (await db()).getAllFromIndex("photos", "byProperty", propertyId);
  },
  async putPhoto(p: Photo) {
    await (await db()).put("photos", p);
  },
  async deletePhoto(id: string) {
    const d = await db();
    const tx = d.transaction(["photos", "issues"], "readwrite");
    const issues = await tx.objectStore("issues").getAll();
    for (const i of issues) if (i.photoId === id) await tx.objectStore("issues").put({ ...i, photoId: undefined, bbox: null });
    await tx.objectStore("photos").delete(id);
    await tx.done;
  },

  async issues(propertyId: string) {
    return (await db()).getAllFromIndex("issues", "byProperty", propertyId);
  },
  async putIssue(i: Issue) {
    await (await db()).put("issues", i);
  },
  async putIssues(list: Issue[]) {
    const d = await db();
    const tx = d.transaction("issues", "readwrite");
    for (const i of list) await tx.store.put(i);
    await tx.done;
  },
  async deleteIssue(id: string) {
    await (await db()).delete("issues", id);
  },
  /** Remove AI issues for a room that the user hasn't acted on, before re-analysis. */
  async clearUntouchedAiIssues(roomId: string) {
    const d = await db();
    const tx = d.transaction("issues", "readwrite");
    for (const i of await tx.store.index("byRoom").getAll(roomId)) {
      if (i.source === "ai" && i.status === "open") await tx.store.delete(i.id);
    }
    await tx.done;
  },
};
