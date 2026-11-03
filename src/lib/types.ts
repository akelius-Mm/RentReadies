// Shared data model for the client and the API server.

export const ISSUE_CATEGORIES = [
  "water_damage",
  "mold",
  "paint",
  "wall_damage",
  "stain",
  "flooring",
  "appliance",
  "hvac_vent",
  "cleaning",
  "plumbing",
  "electrical",
  "fixture",
  "cabinet_counter",
  "door_window",
  "pest",
  "safety",
  "other",
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  water_damage: "Water damage",
  mold: "Mold / mildew",
  paint: "Paint / touch-up",
  wall_damage: "Wall / ceiling damage",
  stain: "Stain",
  flooring: "Flooring",
  appliance: "Appliance",
  hvac_vent: "HVAC / air vent",
  cleaning: "Cleaning",
  plumbing: "Plumbing",
  electrical: "Electrical",
  fixture: "Fixture / hardware",
  cabinet_counter: "Cabinets / counters",
  door_window: "Doors / windows / blinds",
  pest: "Pest evidence",
  safety: "Safety (smoke/CO detector, trip hazard)",
  other: "Other",
};

export const SEVERITIES = ["low", "medium", "high", "urgent"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const TRADES = [
  "Cleaner",
  "Painter",
  "Handyman",
  "Plumber",
  "Electrician",
  "HVAC",
  "Flooring",
  "Appliance tech",
  "Water/mold remediation",
  "Pest control",
  "Other",
] as const;
export type Trade = (typeof TRADES)[number];

export type IssueStatus = "open" | "approved" | "scheduled" | "done" | "dismissed";

/** Normalized 0..1 box on the photo; approximate. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Issue {
  id: string;
  propertyId: string;
  roomId: string;
  photoId?: string;
  category: IssueCategory;
  severity: Severity;
  title: string;
  description: string;
  recommendedAction: string;
  trade: Trade;
  estCostLow: number;
  estCostHigh: number;
  confidence?: number;
  bbox?: BBox | null;
  source: "ai" | "manual";
  status: IssueStatus;
  /** Follow-up: who is responsible and by when. */
  assignee?: string;
  dueDate?: string; // YYYY-MM-DD
  completedAt?: number;
  createdAt: number;
  updatedAt?: number;
  updatedBy?: string;
}

export interface Photo {
  id: string;
  propertyId: string;
  roomId: string;
  shotId: string; // key from the room's shot list, or "extra"
  label: string;
  /** Resized JPEG. Missing on devices that only have the record; then it loads from the server. */
  blob?: Blob;
  width: number;
  height: number;
  createdAt: number;
  analyzedAt?: number;
  /** "scan" = taken by RR Scan during the LiDAR walk-through. */
  source?: "scan";
  updatedAt?: number;
  /** Where the camera was, for photos taken during a LiDAR scan (same coordinates as the scan). */
  pose?: PhotoPose;
}

/** ARKit camera at the moment a scan photo was taken. */
export interface PhotoPose {
  /** Camera-to-world 4x4, column-major. Camera looks down -Z, x right, y up, in sensor (landscape) orientation. */
  camera: number[];
  /** 3x3 intrinsics, column-major, in sensor pixels: fx = [0], fy = [4], cx = [6], cy = [7]. */
  intrinsics: number[];
  /** Sensor image size [width, height] (landscape). The saved photo is this rotated 90° clockwise (portrait). */
  sensor: [number, number];
}

export interface Room {
  id: string;
  propertyId: string;
  type: RoomType;
  name: string;
  // Footprint for the generated 3D floor plan (feet).
  widthFt: number;
  lengthFt: number;
  ceilingFt: number;
  // Position on the plan (feet, top-left corner).
  x: number;
  y: number;
  // Optional marker placed on an imported 3D scan.
  scanMarker?: [number, number, number] | null;
  /** Index of this room in a LiDAR (RoomPlan) scan, when the room came from one. */
  scanIndex?: number | null;
  notes?: string;
  analyzedAt?: number;
  aiSummary?: string;
  aiMissingShots?: string[];
  createdAt: number;
  updatedAt?: number;
}

export const TURN_TYPES = ["Light turn", "Full turn", "Renovation", "Move-in", "Move-out", "Other"] as const;
export type TurnType = (typeof TURN_TYPES)[number];

/** One inspection of one unit. A unit inspected again later gets a new record with the same name. */
export interface Property {
  id: string;
  name: string; // unit, e.g. "123 Main St #4B"
  address?: string;
  turnType?: TurnType;
  inspector?: string;
  status?: "in_progress" | "complete";
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
  /** LiDAR/3D scan. The file itself syncs separately; `blob` is only on devices that have downloaded it. */
  scan?: { fileName: string; blob?: Blob; blobId?: string; format: ScanFormat } | null;
}

export type ScanFormat = "glb" | "gltf" | "obj" | "ply" | "usdz" | "roomplan";

export type RoomType =
  | "kitchen"
  | "bathroom"
  | "bedroom"
  | "living"
  | "dining"
  | "hallway"
  | "laundry"
  | "closet"
  | "entry"
  | "garage"
  | "exterior"
  | "utility"
  | "other";

// ---- Inventory: appliances, finishes, fixtures ------------------------------

export const INVENTORY_KINDS = ["appliance", "finish", "fixture"] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];
export const INVENTORY_KIND_LABELS: Record<InventoryKind, string> = {
  appliance: "Appliances",
  finish: "Finishes",
  fixture: "Fixtures & hardware",
};

export const CONDITIONS = ["good", "fair", "poor", "replace", "unknown"] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface InventoryFields {
  kind: InventoryKind;
  /** What it is: "Refrigerator", "Countertop", "Kitchen faucet", "Wall paint". */
  item: string;
  /** Type / material: "French-door, bottom freezer", "Quartz", "Luxury vinyl plank". */
  type: string;
  /** Color and finish: "Stainless steel", "White shaker", "Brushed nickel", "Light gray, eggshell". */
  colorFinish: string;
  brand: string;
  model: string;
  /** Gas / electric, size, approx. age, or anything else useful for ordering or matching. */
  notes: string;
  condition: Condition;
}

export interface InventoryItem extends InventoryFields {
  id: string;
  propertyId: string;
  roomId: string;
  photoId?: string;
  confidence?: number;
  /** "scan" = detected by the LiDAR scan (with measured size); AI details are merged into it. */
  source: "ai" | "manual" | "scan";
  /** RoomPlan object category, for items that came from a LiDAR scan. */
  scanCategory?: string;
  createdAt: number;
  updatedAt?: number;
}

// ---- LiDAR scan (written by the RR Scan iPhone app, RoomPlan) ------------------
// Coordinates are meters, y up, in one shared space for the whole unit.
// transform is a 4x4 matrix in column-major order; dimensions are [width, height, depth].

export interface RRScanSurface {
  transform: number[];
  dimensions: [number, number, number];
}

export interface RRScanObject extends RRScanSurface {
  category: string; // refrigerator, stove, oven, dishwasher, washerDryer, sink, toilet, bathtub, ...
}

export interface RRScanPhoto extends PhotoPose {
  id: string;
  /** "object" = best view of a detected appliance/fixture, "auto" = overview, "manual" = shutter button. */
  kind: "object" | "auto" | "manual";
  label: string;
  category?: string;
  /** Base64 JPEG, portrait. */
  jpeg: string;
  width: number;
  height: number;
}

export interface RRScanRoom {
  name: string;
  type: RoomType;
  photos?: RRScanPhoto[];
  walls: RRScanSurface[];
  doors: RRScanSurface[];
  windows: RRScanSurface[];
  openings: RRScanSurface[];
  objects: RRScanObject[];
}

export interface RRScan {
  format: "rentreadies-roomplan";
  version: 1;
  createdAt: string;
  unitName?: string;
  device?: string;
  rooms: RRScanRoom[];
}

// ---- API contract -------------------------------------------------------

export interface AnalyzeRequest {
  roomType: RoomType;
  roomName: string;
  photos: { photoId: string; label: string; mediaType: "image/jpeg"; data: string }[];
}

export interface AnalyzedFinding {
  photoId: string;
  category: IssueCategory;
  severity: Severity;
  title: string;
  description: string;
  recommendedAction: string;
  trade: Trade;
  estCostLow: number;
  estCostHigh: number;
  confidence: number;
  bbox: BBox | null;
}

export interface AnalyzedInventoryItem extends InventoryFields {
  photoId: string;
  confidence: number;
}

export interface AnalyzeResponse {
  findings: AnalyzedFinding[];
  inventory: AnalyzedInventoryItem[];
  roomSummary: string;
  missingShots: string[];
}
