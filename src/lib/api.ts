import { blobToBase64 } from "./image";
import { store, uid } from "./db";
import type { AnalyzeRequest, AnalyzeResponse, InventoryItem, Issue, Photo, Room } from "./types";

const PASSCODE_KEY = "rr-passcode";
export function getPasscode() {
  try {
    return localStorage.getItem(PASSCODE_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setPasscode(v: string) {
  try {
    localStorage.setItem(PASSCODE_KEY, v);
  } catch {
    /* private mode: passcode lasts for this page only */
  }
  memoryPasscode = v;
}
let memoryPasscode = "";
const authHeaders = (): Record<string, string> => {
  const p = getPasscode() || memoryPasscode;
  return p ? { "x-app-passcode": p } : {};
};

export interface AiStatus {
  ai: boolean;
  aiError: string | null;
  passcodeRequired: boolean;
  passcodeOk: boolean;
}

export async function aiStatus(): Promise<AiStatus | null> {
  try {
    const r = await fetch("/api/health", { headers: authHeaders(), cache: "no-store" });
    return r.ok ? r.json() : null;
  } catch {
    return null; // offline or server down
  }
}

const BATCH = 10;

/** Send a room's photos to the AI inspector, store the findings as issues. */
export async function analyzeRoom(room: Room, photos: Photo[], onProgress?: (done: number, total: number) => void) {
  const batches: Photo[][] = [];
  for (let i = 0; i < photos.length; i += BATCH) batches.push(photos.slice(i, i + BATCH));

  const summaries: string[] = [];
  const missing = new Set<string>();
  const newIssues: Issue[] = [];
  const inventory = new Map<string, InventoryItem>();

  for (const [n, batch] of batches.entries()) {
    onProgress?.(n, batches.length);
    const body: AnalyzeRequest = {
      roomType: room.type,
      roomName: room.name,
      photos: await Promise.all(
        batch.map(async (p) => ({ photoId: p.id, label: p.label, mediaType: "image/jpeg" as const, data: await blobToBase64(p.blob) })),
      ),
    };
    if (!navigator.onLine) throw new Error("You're offline. Photos are saved; run the inspection when you have signal.");
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);
    const result = json as AnalyzeResponse;
    summaries.push(result.roomSummary);
    result.missingShots.forEach((s) => missing.add(s));
    for (const it of result.inventory ?? []) {
      // Batches can see the same item twice; keep one per kind+item+brand+color.
      const key = [it.kind, it.item, it.brand, it.colorFinish].map((x) => x.trim().toLowerCase()).join("|");
      const prev = inventory.get(key);
      if (prev && (prev.model || !it.model) && (prev.confidence ?? 0) >= it.confidence) continue;
      inventory.set(key, { ...it, id: prev?.id ?? uid(), propertyId: room.propertyId, roomId: room.id, source: "ai", createdAt: Date.now() });
    }
    for (const f of result.findings) {
      newIssues.push({
        id: uid(),
        propertyId: room.propertyId,
        roomId: room.id,
        photoId: f.photoId,
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        recommendedAction: f.recommendedAction,
        trade: f.trade,
        estCostLow: f.estCostLow,
        estCostHigh: f.estCostHigh,
        confidence: f.confidence,
        bbox: f.bbox,
        source: "ai",
        status: "open",
        createdAt: Date.now(),
      });
    }
  }
  onProgress?.(batches.length, batches.length);

  // Replace earlier AI findings the user hasn't acted on; keep approved/manual ones.
  await store.clearUntouchedAiIssues(room.id);
  await store.putIssues(newIssues);
  await store.replaceAiInventory(room.id, [...inventory.values()]);
  const now = Date.now();
  for (const p of photos) await store.putPhoto({ ...p, analyzedAt: now });
  const missingShots = [...missing];
  await store.putRoom({ ...room, analyzedAt: now, aiSummary: summaries.join(" "), aiMissingShots: missingShots });
  return { count: newIssues.length, inventoryCount: inventory.size, summary: summaries.join(" "), missingShots };
}
