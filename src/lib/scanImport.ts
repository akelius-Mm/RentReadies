import { store, uid } from "./db";
import { addRoom } from "./rooms";
import { templateFor } from "./roomTemplates";
import type { PhotoPose, InventoryItem, InventoryKind, Photo, Property, Room, RoomType, RRScan, RRScanPhoto, RRScanRoom, RRScanSurface } from "./types";

const FT_PER_M = 3.28084;
const IN_PER_M = 39.3701;

/** Apply a column-major 4x4 matrix to a point. */
export function transformPoint(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorY: number;
  ceilingY: number;
}

/** Axis-aligned footprint of a scanned room, from its wall end points (falls back to objects). */
export function roomBounds(room: RRScanRoom): RoomBounds | null {
  const pts: [number, number, number][] = [];
  const add = (s: RRScanSurface) => {
    const [w, h, d] = s.dimensions;
    for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) pts.push(transformPoint(s.transform, sx * w, sy * h, sz * d));
  };
  (room.walls.length ? room.walls : room.objects).forEach(add);
  if (!pts.length) return null;
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minZ: Math.min(...pts.map((p) => p[2])),
    maxZ: Math.max(...pts.map((p) => p[2])),
    floorY: Math.min(...pts.map((p) => p[1])),
    ceilingY: Math.max(...pts.map((p) => p[1])),
  };
}

// RoomPlan object categories we keep as inventory. Furniture (bed, sofa, chair, table, TV), cabinets
// ("storage", one per box) and stairs are skipped.
const OBJECT_ITEMS: Record<string, { item: string; kind: InventoryKind; aliases: string[] }> = {
  refrigerator: { item: "Refrigerator", kind: "appliance", aliases: ["refrigerator", "fridge"] },
  stove: { item: "Range / stove", kind: "appliance", aliases: ["range", "stove", "cooktop"] },
  oven: { item: "Oven", kind: "appliance", aliases: ["oven"] },
  dishwasher: { item: "Dishwasher", kind: "appliance", aliases: ["dishwasher"] },
  washerDryer: { item: "Washer / dryer", kind: "appliance", aliases: ["washer", "dryer"] },
  sink: { item: "Sink", kind: "fixture", aliases: ["sink"] },
  toilet: { item: "Toilet", kind: "fixture", aliases: ["toilet"] },
  bathtub: { item: "Bathtub", kind: "fixture", aliases: ["bathtub", "tub", "shower"] },
  fireplace: { item: "Fireplace", kind: "fixture", aliases: ["fireplace"] },
};

/** Does an AI-identified item (e.g. "Kitchen faucet", "Refrigerator") describe this scanned object? */
export function matchesScanCategory(category: string | undefined, itemName: string) {
  const entry = category ? OBJECT_ITEMS[category] : undefined;
  if (!entry) return false;
  const n = itemName.toLowerCase();
  // Avoid "Sink" matching "Under-sink cabinet" or "Kitchen faucet" matching nothing useful.
  return entry.aliases.some((a) => n === a || n.startsWith(a + " ") || n.endsWith(" " + a) || n.includes(" " + a + " "));
}

const inches = (m: number) => Math.round(m * IN_PER_M);

/** Which checklist shot a scan photo of this object fills, by room type. */
function shotFor(roomType: RoomType, p: RRScanPhoto, autoIndex: number): { shotId: string; label: string } {
  if (p.kind === "manual") return { shotId: "extra", label: p.label || "Close-up" };
  if (p.kind === "auto") {
    if (autoIndex === 0) return { shotId: "overview-door", label: "Overview from doorway" };
    if (autoIndex === 1) return { shotId: "overview-back", label: "Overview from far corner" };
    return { shotId: "extra", label: `Walk-through view ${autoIndex + 1}` };
  }
  const byCategory: Record<string, string> = {
    refrigerator: "fridge-outside",
    stove: "range-top",
    oven: "range-top",
    dishwasher: "dishwasher",
    toilet: "toilet",
    bathtub: "tub-shower",
    washerDryer: "washer",
    sink: roomType === "bathroom" ? "vanity" : "sink-faucet",
  };
  const shotId = (p.category && byCategory[p.category]) || "extra";
  const shot = templateFor(roomType).shots.find((s) => s.id === shotId);
  return { shotId: shot ? shotId : "extra", label: shot?.label ?? p.label };
}

function base64ToBlob(b64: string, type = "image/jpeg") {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function isRRScan(x: unknown): x is RRScan {
  return typeof x === "object" && x !== null && (x as RRScan).format === "rentreadies-roomplan" && Array.isArray((x as RRScan).rooms);
}

const ROOM_TYPES: RoomType[] = ["kitchen", "bathroom", "bedroom", "living", "dining", "hallway", "laundry", "closet", "entry", "garage", "exterior", "utility", "other"];

/**
 * Bring a LiDAR scan into a unit: match or create a room for each scanned room, set its measured size and its
 * real position on the floor plan, pin it on the 3D scan, and add detected appliances and fixtures.
 */
export async function importRoomPlanScan(property: Property, existingRooms: Room[], scan: RRScan, fileName: string) {
  await store.putProperty({
    ...property,
    scan: { fileName, blob: new Blob([JSON.stringify(scan)], { type: "application/json" }), format: "roomplan" },
  });

  // Clear links to any previous scan.
  let rooms: Room[] = existingRooms.map((r) => ({ ...r, scanMarker: null, scanIndex: null }));
  for (const r of rooms) await store.putRoom(r);
  for (const i of await store.inventory(property.id)) if (i.source === "scan") await store.deleteInventoryItem(i.id);
  // Photos from an earlier scan are replaced too (their repair items stay, without the photo link).
  for (const p of await store.photos(property.id)) if (p.source === "scan") await store.deletePhoto(p.id);

  const bounds = scan.rooms.map(roomBounds);
  const valid = bounds.filter((b): b is RoomBounds => !!b);
  const originX = valid.length ? Math.min(...valid.map((b) => b.minX)) : 0;
  const originZ = valid.length ? Math.min(...valid.map((b) => b.minZ)) : 0;

  let created = 0;
  let matched = 0;
  let items = 0;
  let photos = 0;
  const roomsWithPhotos: string[] = [];
  for (const [index, sr] of scan.rooms.entries()) {
    const type: RoomType = ROOM_TYPES.includes(sr.type) ? sr.type : "other";
    const name = sr.name?.trim() || templateFor(type).label;
    // Prefer an existing room with the same name, then the first unlinked room of the same type.
    let room: Room | undefined =
      rooms.find((r) => r.scanIndex == null && r.name.trim().toLowerCase() === name.toLowerCase()) ??
      rooms.find((r) => r.scanIndex == null && r.type === type);
    if (room) matched++;
    else {
      room = await addRoom(property.id, type, rooms, name);
      rooms = [...rooms, room];
      created++;
    }

    const b = bounds[index];
    const updated: Room = { ...room, scanIndex: index };
    if (b) {
      updated.widthFt = Math.max(2, Math.round((b.maxX - b.minX) * FT_PER_M * 2) / 2);
      updated.lengthFt = Math.max(2, Math.round((b.maxZ - b.minZ) * FT_PER_M * 2) / 2);
      updated.ceilingFt = Math.max(6, Math.round((b.ceilingY - b.floorY) * FT_PER_M * 2) / 2);
      // Same layout as the real unit on the floor plan.
      updated.x = Math.round((b.minX - originX) * FT_PER_M * 2) / 2;
      updated.y = Math.round((b.minZ - originZ) * FT_PER_M * 2) / 2;
      updated.scanMarker = [(b.minX + b.maxX) / 2, b.floorY + 0.05, (b.minZ + b.maxZ) / 2];
    }
    await store.putRoom(updated);
    rooms = rooms.map((r) => (r.id === updated.id ? updated : r));

    let autoIndex = 0;
    for (const sp of sr.photos ?? []) {
      const { shotId, label } = shotFor(type, sp, sp.kind === "auto" ? autoIndex : 0);
      if (sp.kind === "auto") autoIndex++;
      const photo: Photo = {
        id: uid(),
        propertyId: property.id,
        roomId: updated.id,
        shotId,
        label,
        blob: base64ToBlob(sp.jpeg),
        width: sp.width,
        height: sp.height,
        createdAt: Date.now() + photos, // keeps scan order
        source: "scan",
        pose: { camera: sp.camera, intrinsics: sp.intrinsics, sensor: sp.sensor },
      };
      await store.putPhoto(photo);
      photos++;
    }
    if (sr.photos?.length) roomsWithPhotos.push(updated.id);

    for (const o of sr.objects) {
      const entry = OBJECT_ITEMS[o.category];
      if (!entry) continue;
      const [w, h, d] = o.dimensions;
      const item: InventoryItem = {
        id: uid(),
        propertyId: property.id,
        roomId: updated.id,
        kind: entry.kind,
        item: entry.item,
        type: "",
        colorFinish: "",
        brand: "",
        model: "",
        notes: `Measured by LiDAR: ${inches(w)}″ W × ${inches(d)}″ D × ${inches(h)}″ H`,
        condition: "unknown",
        source: "scan",
        scanCategory: o.category,
        createdAt: Date.now(),
      };
      await store.putInventoryItem(item);
      items++;
    }
  }
  // Rooms that weren't scanned go in a row below the measured layout so nothing overlaps.
  const placed = rooms.filter((r) => r.scanIndex != null);
  if (placed.length) {
    let x = 0;
    const y = Math.max(...placed.map((r) => r.y + r.lengthFt)) + 3;
    for (const r of rooms.filter((q) => q.scanIndex == null)) {
      await store.putRoom({ ...r, x, y });
      x += r.widthFt + 1;
    }
  }

  return { rooms: scan.rooms.length, created, matched, items, photos, roomsWithPhotos };
}

/**
 * World-space ray through a point on a scan photo (x, y as 0..1 of the portrait photo).
 * The photo is the landscape sensor image rotated 90° clockwise, so portrait (x, y) maps to
 * sensor u = y * W, v = (1 - x) * H. ARKit camera space: x right, y up, looking down -Z.
 */
export function photoRay(pose: PhotoPose, x: number, y: number) {
  const [W, H] = pose.sensor;
  const k = pose.intrinsics;
  const fx = k[0], fy = k[4], cx = k[6], cy = k[7];
  const u = y * W;
  const v = (1 - x) * H;
  const dirCam: [number, number, number] = [(u - cx) / fx, -(v - cy) / fy, -1];
  const m = pose.camera;
  const origin: [number, number, number] = [m[12], m[13], m[14]];
  const d: [number, number, number] = [
    m[0] * dirCam[0] + m[4] * dirCam[1] + m[8] * dirCam[2],
    m[1] * dirCam[0] + m[5] * dirCam[1] + m[9] * dirCam[2],
    m[2] * dirCam[0] + m[6] * dirCam[1] + m[10] * dirCam[2],
  ];
  const len = Math.hypot(...d) || 1;
  return { origin, dir: [d[0] / len, d[1] / len, d[2] / len] as [number, number, number] };
}
