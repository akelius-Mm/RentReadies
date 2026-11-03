import { store, uid } from "./db";
import { templateFor } from "./roomTemplates";
import type { Photo, Room, RoomType } from "./types";

const ROW_WIDTH_FT = 48;
const GAP = 1;

/** Next free spot on the generated plan: fill rows left-to-right. */
export function nextSlot(rooms: Room[], w: number): { x: number; y: number } {
  if (!rooms.length) return { x: 0, y: 0 };
  const rowY = Math.max(...rooms.map((r) => r.y));
  const row = rooms.filter((r) => r.y === rowY);
  const right = Math.max(...row.map((r) => r.x + r.widthFt));
  if (right + GAP + w <= ROW_WIDTH_FT) return { x: right + GAP, y: rowY };
  const bottom = Math.max(...rooms.map((r) => r.y + r.lengthFt));
  return { x: 0, y: bottom + GAP };
}

export function autoArrange(rooms: Room[]): Room[] {
  const placed: Room[] = [];
  for (const r of rooms) placed.push({ ...r, ...nextSlot(placed, r.widthFt) });
  return placed;
}

export async function addRoom(propertyId: string, type: RoomType, existing: Room[], name?: string) {
  const t = templateFor(type);
  const sameType = existing.filter((r) => r.type === type).length;
  const [w, l] = t.size;
  const room: Room = {
    id: uid(),
    propertyId,
    type,
    name: name?.trim() || (sameType ? `${t.label} ${sameType + 1}` : t.label),
    widthFt: w,
    lengthFt: l,
    ceilingFt: 8,
    ...nextSlot(existing, w),
    createdAt: Date.now(),
  };
  await store.putRoom(room);
  return room;
}

export function shotProgress(room: Room, photos: Photo[]) {
  const shots = templateFor(room.type).shots;
  const have = new Set(photos.filter((p) => p.roomId === room.id).map((p) => p.shotId));
  const done = shots.filter((s) => have.has(s.id)).length;
  return { done, total: shots.length };
}
