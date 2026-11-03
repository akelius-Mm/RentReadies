// Keeps this phone and the shared record on the server in step.
// Push: send queued local changes (photos/scan files first). Pull: fetch changes made by others.
import { authHeaders } from "./api";
import { onLocalChange, syncStore, type Kind, type OutboxEntry } from "./db";
import type { Photo, Property } from "./types";

export interface SyncStatus {
  state: "idle" | "syncing" | "offline" | "error";
  pending: number;
  lastSynced?: number;
  error?: string;
}

let status: SyncStatus = { state: "idle", pending: 0 };
const statusListeners = new Set<(s: SyncStatus) => void>();
const dataListeners = new Set<() => void>();

const setStatus = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  statusListeners.forEach((fn) => fn(status));
};

export const onSyncStatus = (fn: (s: SyncStatus) => void) => {
  statusListeners.add(fn);
  fn(status);
  return () => {
    statusListeners.delete(fn);
  };
};
/** Called when changes from other people arrived, so screens can reload. */
export const onRemoteData = (fn: () => void) => {
  dataListeners.add(fn);
  return () => {
    dataListeners.delete(fn);
  };
};

/** Fields that never go to the server record (files travel separately). */
function serverCopy(kind: Kind, rec: Record<string, unknown>) {
  const copy = { ...rec };
  if (kind === "photo") delete copy.blob;
  if (kind === "property" && copy.scan) {
    const scan = { ...(copy.scan as Record<string, unknown>) };
    delete scan.blob;
    copy.scan = scan;
  }
  return copy;
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(path, { ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
  if (res.status === 401) throw new Error("Passcode needed to sync.");
  if (!res.ok) throw new Error(`Sync failed (server ${res.status}).`);
  return res;
}

const uploaded = new Set<string>(); // blob ids sent this session

async function uploadBlob(id: string, blob: Blob, type: string) {
  if (uploaded.has(id)) return;
  await api(`/api/blobs/${id}`, { method: "PUT", body: blob, headers: { "Content-Type": type } });
  uploaded.add(id);
}

async function push() {
  const entries = await syncStore.outbox();
  for (let i = 0; i < entries.length; i += 100) {
    const batch: OutboxEntry[] = entries.slice(i, i + 100);
    const records = [];
    for (const e of batch) {
      const rec = e.deleted ? undefined : await syncStore.record(e.kind, e.id);
      if (rec && e.kind === "photo" && (rec as Photo).blob) await uploadBlob(e.id, (rec as Photo).blob!, "image/jpeg");
      if (rec && e.kind === "property") {
        const scan = (rec as Property).scan;
        // application/octet-stream so the server stores scan JSON as a file instead of parsing it.
        if (scan?.blob && scan.blobId) await uploadBlob(scan.blobId, scan.blob, "application/octet-stream");
      }
      records.push({
        kind: e.kind,
        id: e.id,
        propertyId: e.propertyId,
        data: rec ? serverCopy(e.kind, rec as unknown as Record<string, unknown>) : null,
        updatedAt: e.version,
      });
    }
    await api("/api/sync/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ records }) });
    await syncStore.clearSent(batch);
  }
}

async function pull() {
  let cursor = (await syncStore.meta<number>("cursor")) ?? 0;
  let changedAny = false;
  for (;;) {
    const res = await api(`/api/sync/pull?since=${cursor}`);
    const page = (await res.json()) as {
      records: { kind: Kind; id: string; data: Record<string, unknown> | null; updatedAt: number }[];
      cursor: number;
      more: boolean;
    };
    for (const r of page.records) {
      if (await syncStore.applyRemote(r.kind, r.id, r.data as never, r.updatedAt)) changedAny = true;
    }
    cursor = page.cursor;
    await syncStore.setMeta("cursor", cursor);
    if (!page.more) break;
  }
  if (changedAny) dataListeners.forEach((fn) => fn());
}

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!navigator.onLine) {
      setStatus({ state: "offline", pending: await syncStore.pendingCount() });
      return;
    }
    setStatus({ state: "syncing" });
    try {
      await push();
      await pull();
      setStatus({ state: "idle", error: undefined, lastSynced: Date.now(), pending: await syncStore.pendingCount() });
    } catch (e) {
      setStatus({ state: "error", error: (e as Error).message, pending: await syncStore.pendingCount() });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

let started = false;
/** Start background sync: now, every 30 s, when back online, and shortly after local edits. */
export function startSync() {
  if (started) return;
  started = true;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  onLocalChange(() => {
    clearTimeout(debounce);
    debounce = setTimeout(syncNow, 2000);
    syncStore.pendingCount().then((pending) => setStatus({ pending }));
  });
  window.addEventListener("online", () => syncNow());
  window.addEventListener("offline", () => setStatus({ state: "offline" }));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && syncNow());
  setInterval(syncNow, 30_000);
  syncNow();
}

// ---- Files that live on the server ---------------------------------------------

/** URL for a photo whose file isn't on this phone. */
export function remotePhotoUrl(id: string) {
  const k = authHeaders()["x-app-passcode"];
  return `/api/blobs/${id}${k ? `?k=${encodeURIComponent(k)}` : ""}`;
}

/** The photo file, downloading (and keeping) it if this phone doesn't have it yet. */
export async function photoBlob(p: Photo): Promise<Blob> {
  if (p.blob) return p.blob;
  const res = await api(`/api/blobs/${p.id}`);
  const blob = await res.blob();
  await syncStore.setPhotoBlob(p.id, blob);
  return blob;
}

/** The 3D scan file, downloading it if needed. */
export async function scanBlob(p: Property): Promise<Blob | null> {
  if (!p.scan) return null;
  if (p.scan.blob) return p.scan.blob;
  if (!p.scan.blobId) return null;
  const res = await api(`/api/blobs/${p.scan.blobId}`);
  const blob = await res.blob();
  await syncStore.setScanBlob(p.id, blob);
  return blob;
}
