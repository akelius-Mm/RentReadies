import type { RoomType } from "./types";

export interface Shot {
  id: string;
  label: string;
  hint: string;
}

export interface RoomTemplate {
  type: RoomType;
  label: string;
  icon: string;
  size: [number, number]; // default width x length in feet
  shots: Shot[];
}

// Shots every room should have.
const base = (extra: Shot[]): Shot[] => [
  { id: "overview-door", label: "Overview from doorway", hint: "Stand in the doorway, capture as much of the room as possible." },
  { id: "overview-back", label: "Overview from far corner", hint: "Opposite corner, looking back at the door." },
  { id: "ceiling", label: "Ceiling & light fixture", hint: "Look for water stains, cracks, dead bulbs." },
  { id: "floor", label: "Floor close-up", hint: "Carpet stains, scratches, chipped tile, transitions." },
  ...extra,
  { id: "vents", label: "Air vents / returns", hint: "Get close so dust buildup is visible." },
  { id: "walls", label: "Walls (marks, holes, scuffs)", hint: "Angle light across the wall to show dents and holes." },
];

const windowShot: Shot = { id: "window", label: "Window, sill & blinds", hint: "Check sill for water marks, blinds for damage, screens." };
const outletShot: Shot = { id: "outlets", label: "Outlets & switch plates", hint: "Cracked or missing cover plates." };
const doorShot: Shot = { id: "door", label: "Door, frame & hardware", hint: "Knob holes, frame damage, closer, stop." };

export const ROOM_TEMPLATES: RoomTemplate[] = [
  {
    type: "kitchen",
    label: "Kitchen",
    icon: "🍳",
    size: [12, 10],
    shots: base([
      { id: "under-sink", label: "Under the sink", hint: "Open the cabinet. Water stains, swelling, leaks, mold." },
      { id: "sink-faucet", label: "Sink & faucet", hint: "Stains, chips, caulk, faucet condition." },
      { id: "counters", label: "Countertops & backsplash", hint: "Burns, chips, stains, caulk gaps." },
      { id: "cabinets", label: "Cabinet doors & drawers", hint: "Hinges, fronts, inside shelves." },
      { id: "range-top", label: "Stovetop / burners", hint: "Grates, drip pans, knobs, grease." },
      { id: "oven-inside", label: "Inside the oven", hint: "Open the door. Burnt residue, racks." },
      { id: "range-hood", label: "Range hood / microwave", hint: "Filter grease, light, fan." },
      { id: "fridge-outside", label: "Refrigerator (outside)", hint: "Dents, handle, door seal." },
      { id: "fridge-inside", label: "Refrigerator (inside & freezer)", hint: "Shelves, drawers, cleanliness, ice maker." },
      { id: "dishwasher", label: "Dishwasher (inside)", hint: "Racks, rust, residue, door seal." },
      {
        id: "appliance-labels",
        label: "Appliance model/serial labels",
        hint: "Fridge: inside door frame or wall. Range: behind the bottom drawer. Dishwasher: edge of the door. Microwave: inside the door.",
      },
      windowShot,
      outletShot,
    ]),
  },
  {
    type: "bathroom",
    label: "Bathroom",
    icon: "🛁",
    size: [8, 6],
    shots: base([
      { id: "toilet", label: "Toilet (incl. base)", hint: "Get the base where it meets the floor — water damage shows here." },
      { id: "tub-shower", label: "Tub / shower", hint: "Grout, caulk, mildew, chips, soap scum." },
      { id: "shower-head", label: "Shower head & valve", hint: "Mineral buildup, leaks." },
      { id: "vanity", label: "Vanity, sink & faucet", hint: "Top, sink, faucet, cabinet doors." },
      { id: "under-vanity", label: "Under the vanity", hint: "Open the cabinet. Leaks, swelling, mold." },
      { id: "mirror", label: "Mirror & medicine cabinet", hint: "Desilvering, cracks." },
      { id: "exhaust-fan", label: "Exhaust fan", hint: "Dust buildup, ceiling stains around it." },
      { id: "accessories", label: "Towel bars, TP holder", hint: "Loose or missing hardware." },
      outletShot,
    ]),
  },
  {
    type: "bedroom",
    label: "Bedroom",
    icon: "🛏️",
    size: [12, 11],
    shots: base([
      { id: "closet", label: "Closet (inside)", hint: "Doors/tracks, shelf, rod, floor." },
      windowShot,
      doorShot,
      outletShot,
      { id: "smoke-detector", label: "Smoke detector", hint: "Present, not painted over, not missing." },
    ]),
  },
  {
    type: "living",
    label: "Living room",
    icon: "🛋️",
    size: [16, 14],
    shots: base([windowShot, outletShot, { id: "smoke-detector", label: "Smoke / CO detector", hint: "Present and intact." }]),
  },
  {
    type: "dining",
    label: "Dining room",
    icon: "🍽️",
    size: [11, 10],
    shots: base([windowShot, outletShot]),
  },
  {
    type: "hallway",
    label: "Hallway",
    icon: "🚪",
    size: [4, 12],
    shots: base([
      { id: "thermostat", label: "Thermostat", hint: "Present, working display." },
      { id: "smoke-detector", label: "Smoke / CO detector", hint: "Present and intact." },
      { id: "hvac-filter", label: "HVAC return & filter", hint: "Open the grille; photo the filter." },
    ]),
  },
  {
    type: "entry",
    label: "Entry",
    icon: "🔑",
    size: [6, 6],
    shots: base([
      { id: "front-door", label: "Front door (both sides)", hint: "Lock, deadbolt, peephole, weatherstrip." },
      { id: "intercom", label: "Doorbell / intercom", hint: "" },
    ]),
  },
  {
    type: "laundry",
    label: "Laundry",
    icon: "🧺",
    size: [6, 6],
    shots: base([
      { id: "washer", label: "Washer (inside & hoses)", hint: "Drum, gasket mold, hose condition." },
      { id: "dryer", label: "Dryer & vent", hint: "Lint trap, vent connection." },
      { id: "water-heater", label: "Water heater", hint: "Rust, leaks at the base, pan." },
      { id: "appliance-labels", label: "Appliance model/serial labels", hint: "Washer: under the lid or back. Dryer: inside the door. Water heater: side sticker." },
    ]),
  },
  {
    type: "closet",
    label: "Closet",
    icon: "👕",
    size: [5, 4],
    shots: [
      { id: "overview-door", label: "Closet overview", hint: "" },
      { id: "doors", label: "Doors & tracks", hint: "Off-track bifold/sliders." },
      { id: "shelf-rod", label: "Shelf & rod", hint: "" },
      { id: "floor", label: "Floor", hint: "" },
    ],
  },
  {
    type: "utility",
    label: "Utility / mechanical",
    icon: "🔧",
    size: [6, 6],
    shots: [
      { id: "overview-door", label: "Overview", hint: "" },
      { id: "furnace", label: "Furnace / air handler", hint: "Filter, rust, condensate line." },
      { id: "appliance-labels", label: "Equipment rating plates", hint: "Furnace, AC, and water heater stickers with model and serial." },
      { id: "water-heater", label: "Water heater", hint: "Rust, leaks, drain pan." },
      { id: "panel", label: "Electrical panel", hint: "Cover, labels." },
      { id: "floor", label: "Floor (look for leaks)", hint: "" },
    ],
  },
  {
    type: "garage",
    label: "Garage",
    icon: "🚗",
    size: [20, 20],
    shots: base([{ id: "garage-door", label: "Garage door & opener", hint: "" }]),
  },
  {
    type: "exterior",
    label: "Exterior / balcony",
    icon: "🌳",
    size: [10, 6],
    shots: [
      { id: "overview", label: "Overview", hint: "" },
      { id: "railing", label: "Railings", hint: "Loose or rusted." },
      { id: "surface", label: "Deck / patio surface", hint: "Rot, cracks, trip hazards." },
      { id: "exterior-door", label: "Exterior door & slider", hint: "Track, lock, screen." },
      { id: "lights", label: "Exterior lights", hint: "" },
    ],
  },
  {
    type: "other",
    label: "Other room",
    icon: "📦",
    size: [10, 10],
    shots: base([windowShot, outletShot]),
  },
];

export const templateFor = (t: RoomType) => ROOM_TEMPLATES.find((r) => r.type === t) ?? ROOM_TEMPLATES[ROOM_TEMPLATES.length - 1];
