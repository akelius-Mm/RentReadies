# RentReadies

Make-ready inspections for vacated units. Map the unit in 3D, take guided photos room by room, and let AI flag
what has to be fixed before the unit can be rented again: water damage, mold, paint, stains, flooring,
damaged appliances, dirty air vents, cleaning, and more. You get a repair list with cost estimates by trade and
a printable report.

## How it works

1. **Add a unit** and pick a layout (studio, 2 bed / 1 bath, 3 bed / 2 bath) or add rooms one by one.
2. **3D map**
   - *Floor plan*: a 3D model built from the rooms. Drag rooms to match the real layout and set sizes under
     "Room details". Rooms are colored by their worst open issue.
   - *3D scan*: import a LiDAR scan (`.glb`, `.obj`, `.ply`, `.usdz`) from an app like Polycam, Scaniverse or
     3D Scanner App on an iPhone/iPad Pro, or a Matterport export. Pin each room on the scan, then tap a pin to
     open that room.
3. **Rooms & photos**: each room type has its own photo checklist (for example under the kitchen sink, inside
   the oven, toilet base, exhaust fan, air vents). On a phone, each item opens the camera.
4. **Inspect with AI**: sends the room's photos to Claude, which returns each problem with category, severity,
   recommended fix, trade, cost range, and a box on the photo. It also lists shots you missed.
5. **Appliances & finishes**: the same AI pass lists every appliance (type, brand and model when the label is
   readable, color/finish, gas or electric, condition), finish (flooring, countertops, cabinets, paint color and
   sheen, backsplash, tile), and fixture (faucets, lights, hardware finish). The kitchen, laundry, and utility
   checklists include a "model/serial labels" shot so model numbers can be read. Edit or add items by hand; export
   to CSV.
6. **Repairs**: approve, dismiss, schedule, or mark items done; add items by hand; group by room, trade,
   category, or severity.
7. **Report**: totals by trade, items per room with marked-up photos, and the appliance/finish list. Print / save as PDF, or export CSV.

Photos and inspections are stored in the browser (IndexedDB) on the device that took them. Photos are resized
to 1568 px before storage and upload.

## Run it

Requires Node 20+.

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY
npm run dev            # web on http://localhost:5173, API on :8787
```

Production:

```bash
npm run build
npm start              # serves app + API on http://localhost:8787
```

Without `ANTHROPIC_API_KEY` the app still works; AI inspection is disabled and you add items by hand.

To use the camera from a phone, open the app over HTTPS (for example behind your normal reverse proxy) or on the
same network via `npm run dev` (Vite listens on all interfaces).

## Code layout

- `server/index.ts` – Express server; `POST /api/analyze` calls Claude (`claude-opus-5-5`) with the room photos and
  a JSON schema for the findings.
- `src/lib/roomTemplates.ts` – room types and their photo checklists. Edit this to change what inspectors shoot.
- `src/components/Scene3D.tsx` – three.js viewer for the floor plan and imported scans.
- `src/components/RoomView.tsx` – photo capture and AI inspection for one room.
- `src/components/RepairsTab.tsx`, `ReportTab.tsx` – repair list and report.
