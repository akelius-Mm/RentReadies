import { blobToBase64 } from "./image";
import { store, uid } from "./db";
import type { AnalyzeRequest, AnalyzeResponse, InventoryItem, Issue, Photo, Room } from "./types";

export async function aiStatus(): Promise<{ ai: boolean } | null> {
  try {
    const r = await fetch("/api/health");
    return r.ok ? r.json() : null;
  } catch {
    return null;
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
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
