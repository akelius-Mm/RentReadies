# RR Scan (iPhone / iPad Pro)

LiDAR room scanner for RentReadies, built on Apple's RoomPlan. It scans a unit room by room and sends the
walls, doors, windows, room sizes and detected appliances/fixtures (refrigerator, stove, oven, dishwasher,
washer/dryer, sink, toilet, bathtub, fireplace) back to the RentReadies web app.

## Requirements

- A Mac with **Xcode 15 or newer**
- An iPhone or iPad **with LiDAR**: iPhone 12 Pro / 13 Pro / 14 Pro / 15 Pro / 16 Pro (and Pro Max), or iPad Pro 2020+
- iOS / iPadOS **17** or newer
- An Apple ID (free works for installing on your own phone; a paid Apple Developer account is needed for TestFlight / sharing with the team)

## Build and install

```bash
brew install xcodegen
cd ios/RRScan
xcodegen                 # creates RRScan.xcodeproj
open RRScan.xcodeproj
```

In Xcode: select the **RRScan** target → **Signing & Capabilities** → pick your Team. Plug in the iPhone, pick it
as the run destination, and press **Run**. The first time, on the phone: Settings → General → VPN & Device
Management → trust your developer certificate.

## Use

1. In RentReadies (on the same phone), open a unit → **3D map** → **3D scan** → **LiDAR scan**. RR Scan opens
   with the unit's rooms listed.
2. Tap **Scan** next to a room, walk the room slowly pointing at every wall, door, window and appliance, tap
   **Done**, then **Save room**. Repeat for each room **without closing the app** so the rooms line up.
3. Tap **Send to RentReadies**, then switch back to RentReadies. It imports the scan by itself: rooms get their
   measured size and real position on the floor plan, the 3D scan shows walls/doors/windows with each room's floor
   colored by its problems, and appliances are added to Appliances & finishes with their measured width.

Without a link from RentReadies you can still scan and use **Share scan file…** (AirDrop, Save to Files), then
import the `.json` in RentReadies → 3D map → 3D scan → Import file.

## Files

- `Sources/ScanModel.swift` – rooms, the shared AR session, building and sending the scan
- `Sources/CaptureView.swift` – RoomPlan capture screen
- `Sources/ScanFile.swift` – scan file format (must match `RRScan` in `src/lib/types.ts`)
- `Sources/RRScanApp.swift` – main screen
