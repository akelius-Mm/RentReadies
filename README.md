# RentReadies

Make-ready inspections for vacated units. Map the unit in 3D, take guided photos room by room, and let AI flag
what has to be fixed before the unit can be rented again: water damage, mold, paint, stains, flooring,
damaged appliances, dirty air vents, cleaning, and more. You get a repair list with cost estimates by trade and
a printable report.

## How it works

1. **Add a unit** and pick a layout (studio, 2 bed / 1 bath, 3 bed / 2 bath) or add rooms one by one.
2. **3D map**
   - *LiDAR walk-through* (iPhone / iPad Pro): tap **LiDAR scan** and the **RR Scan** app (`ios/RRScan`, built
     on Apple's RoomPlan) opens the camera. Walk each room once: it maps the room and takes the photos as you go
     (best shot of each appliance/fixture, overviews, plus close-ups with the shutter). When you send it back,
     RentReadies imports everything, **runs the AI inspection on every room by itself**, and pins each problem
     where it is in the 3D scan. On import: each room gets its measured size and real position, the 3D view shows the walls, doors, windows
     and appliances with each room's floor colored by its worst problem, and detected appliances and fixtures
     (refrigerator, range, oven, dishwasher, washer/dryer, sink, toilet, tub) go into Appliances & finishes with
     measured dimensions. The AI later adds brand, model and finish to those same items. See
     [ios/RRScan/README.md](ios/RRScan/README.md) to build and install the scanner.
   - *Floor plan*: a 3D model built from the rooms. Drag rooms to match the real layout and set sizes under
     "Room details". Rooms are colored by their worst open issue.
   - *Other scan files*: you can also import `.glb`, `.obj`, `.ply` or `.usdz` from Polycam, Scaniverse or
     Matterport and pin each room by hand.
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

## Put it online (no computer needed)

1. Create a free account at [render.com](https://render.com) and connect your GitHub.
2. **New → Blueprint**, pick this repository. Render reads `render.yaml`.
3. Fill in `ANTHROPIC_API_KEY` (from [console.anthropic.com](https://console.anthropic.com) → API keys) and an
   `APP_PASSCODE`, then **Apply**. After a few minutes you get an address like `https://rentreadies.onrender.com`.
4. On the iPhone, open that address in **Safari** → Share → **Add to Home Screen**. Enter the passcode once.

The free plan sleeps when idle; the first open after a while takes about a minute.

## Use it on your phone with your Claude login

The app runs on your phone; a small server on your computer does the AI inspection using your Claude login.
Photos and inspections are saved on the phone, so you can walk a unit with no signal and run the AI later.

**1. Sign in to Claude on your computer** (one time). Install the `ant` CLI
(macOS: `brew install anthropics/tap/ant`; other systems: see
[releases](https://github.com/anthropics/anthropic-cli/releases)), then:

```bash
ant auth login        # opens the browser; pick your org/workspace
ant auth status       # should show your profile as the active credential
```

Make sure `ANTHROPIC_API_KEY` is **not** set in your shell. If it is, it overrides your login.

**2. Start the server** (Node 20+):

```bash
npm install
cp .env.example .env   # set APP_PASSCODE to something only your team knows
npm run build
npm start
```

The log should say `Claude credentials: Claude login profile` and `AI inspection ready`.

**3. Give your phone an HTTPS address.** Phones only install web apps from HTTPS
addresses. Use an address that stays the same: the app's saved data belongs to that address.

- **Recommended: [Tailscale](https://tailscale.com)** (private, free for personal use). Install it on the computer
  and the phone, sign in to both, then on the computer run `tailscale serve --bg 8787`. Open the
  `https://<computer>.<tailnet>.ts.net` address it prints on your phone. Only your devices can reach it.
- **Quick trial: Cloudflare quick tunnel.** `cloudflared tunnel --url http://localhost:8787` prints a public
  `https://….trycloudflare.com` address. It changes every time, so don't install the app from it, and keep
  `APP_PASSCODE` set.

**4. Install it.** iPhone: open the address in Safari → Share → **Add to Home Screen**. Android: open it in
Chrome → ⋮ → **Install app**. Enter the passcode once when asked.

Keep the computer on and the server running when you want to run AI inspections. If the login expires, the app
shows "No working Claude login"; run `ant auth login` again on the computer.

Your Claude login is meant for your own use. To run this for a whole team on a shared server, use an API key
(`ANTHROPIC_API_KEY`) or workload identity federation instead.

## Develop

```bash
npm run dev            # web on http://localhost:5173 (hot reload), API on :8787
```

Without any Claude credential the app still works; AI inspection is off and you add items by hand.

## Code layout

- `server/index.ts` – Express server; `POST /api/analyze` calls Claude (`claude-opus-5-5`) with the room photos and
  a JSON schema for the findings and inventory. Uses whichever Claude credential the SDK finds (API key, OAuth
  token, or `ant auth login` profile) and checks `APP_PASSCODE`.
- `public/sw.js` – service worker so the installed app opens offline.
- `src/lib/roomTemplates.ts` – room types and their photo checklists. Edit this to change what inspectors shoot.
- `src/components/Scene3D.tsx` – three.js viewer for the floor plan and imported scans.
- `src/components/RoomView.tsx` – photo capture and AI inspection for one room.
- `src/components/RepairsTab.tsx`, `ReportTab.tsx` – repair list and report.
