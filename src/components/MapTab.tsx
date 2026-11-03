import { useEffect, useMemo, useRef, useState } from "react";
import type { PropertyData } from "../lib/usePropertyData";
import Scene3D, { type IssueRay } from "./Scene3D";
import { store, uid } from "../lib/db";
import { autoArrange } from "../lib/rooms";
import { go } from "../lib/router";
import { SEVERITY_COLOR } from "../lib/format";
import { SEVERITIES, type ScanFormat } from "../lib/types";
import { templateFor } from "../lib/roomTemplates";
import { analyzeRoom, createScanSlot, fetchScan, scanAppLink } from "../lib/api";
import { importRoomPlanScan, isRRScan, photoRay } from "../lib/scanImport";
import { scanBlob } from "../lib/sync";
import type { RRScan } from "../lib/types";

const FORMATS: (ScanFormat | "json")[] = ["json", "glb", "gltf", "obj", "ply", "usdz"];

export default function MapTab({ data, aiEnabled }: { data: PropertyData; aiEnabled: boolean }) {
  const { property, rooms, photos, issues, severityByRoom, issueCountByRoom, reload } = data;
  const [inspecting, setInspecting] = useState<string | null>(null);

  // Each open problem marked on a scan photo becomes a pin where it is in the 3D scan.
  const issueRays = useMemo<IssueRay[]>(() => {
    const out: IssueRay[] = [];
    for (const i of issues) {
      if (i.status === "dismissed" || i.status === "done" || !i.photoId) continue;
      const pose = photos.find((p) => p.id === i.photoId)?.pose;
      if (!pose) continue;
      const cx = i.bbox ? i.bbox.x + i.bbox.w / 2 : 0.5;
      const cy = i.bbox ? i.bbox.y + i.bbox.h / 2 : 0.5;
      out.push({ id: i.id, roomId: i.roomId, severity: i.severity, title: i.title, ...photoRay(pose, cx, cy) });
    }
    return out;
  }, [issues, photos]);
  const [mode, setMode] = useState<"plan" | "scan">(property?.scan ? "scan" : "plan");
  const [placing, setPlacing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lidar, setLidar] = useState<{ slot: string; link: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const importScan = async (scan: RRScan, fileName: string) => {
    const r = await importRoomPlanScan(property!, rooms, scan, fileName);
    await reload();
    setMode("scan");
    const summary =
      `LiDAR scan imported: ${r.rooms} room${r.rooms === 1 ? "" : "s"} measured` +
      (r.created ? ` (${r.created} new)` : "") +
      (r.items ? `, ${r.items} appliance${r.items === 1 ? "" : "s"} and fixture${r.items === 1 ? "" : "s"}` : "") +
      (r.photos ? `, ${r.photos} photos` : "") +
      ".";
    setNotice(summary);
    if (r.roomsWithPhotos.length && aiEnabled) await inspectRooms(r.roomsWithPhotos, summary);
    else if (r.roomsWithPhotos.length) setNotice(`${summary} AI is unavailable right now; open each room and tap Inspect with AI later.`);
  };

  /** Run the AI inspection on each room from the scan, one after another. */
  const inspectRooms = async (roomIds: string[], summary: string) => {
    const [allRooms, allPhotos] = await Promise.all([store.rooms(property!.id), store.photos(property!.id)]);
    const failed: string[] = [];
    let found = 0;
    for (const [n, id] of roomIds.entries()) {
      const room = allRooms.find((r) => r.id === id);
      const roomPhotos = allPhotos.filter((p) => p.roomId === id).sort((a, b) => a.createdAt - b.createdAt);
      if (!room || !roomPhotos.length) continue;
      setInspecting(`AI is inspecting ${room.name} (${n + 1} of ${roomIds.length})…`);
      try {
        const res = await analyzeRoom(room, roomPhotos);
        found += res.count;
      } catch (e) {
        failed.push(`${room.name}: ${(e as Error).message}`);
      }
      await reload();
    }
    setInspecting(null);
    setNotice(`${summary} AI found ${found} item${found === 1 ? "" : "s"} to fix.`);
    if (failed.length) setError(`Not inspected: ${failed.join("; ")}`);
  };

  // Wait for RR Scan to upload. Poll every 3 s, and right away when the user switches back to this app.
  useEffect(() => {
    if (!lidar) return;
    let stopped = false;
    const poll = async () => {
      try {
        const scan = await fetchScan(lidar.slot);
        if (stopped || !scan) return;
        stopped = true;
        setLidar(null);
        if (!isRRScan(scan)) throw new Error("The scan that arrived isn't a RentReadies scan.");
        await importScan(scan, `LiDAR scan ${new Date().toLocaleString()}`);
      } catch (e) {
        if (stopped) return;
        stopped = true;
        setLidar(null);
        setError((e as Error).message);
      }
    };
    const t = setInterval(poll, 3000);
    const onVis = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lidar]);

  // A scan made on another phone: fetch the 3D file the first time this unit's map is opened here.
  useEffect(() => {
    if (property?.scan && !property.scan.blob && property.scan.blobId && navigator.onLine) {
      scanBlob(property)
        .then(() => reload())
        .catch(() => setError("Couldn't download the 3D scan. Check your connection."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property?.scan?.blobId]);

  if (!property) return null;

  const startLidar = async () => {
    setError(null);
    setNotice(null);
    try {
      const slot = await createScanSlot();
      const link = scanAppLink(slot, property.name, rooms.map((r) => ({ name: r.name, type: r.type })));
      setLidar({ slot, link });
      window.location.href = link;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onScanFile = async (file?: File) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() as ScanFormat | "json";
    if (!FORMATS.includes(ext)) {
      setError(`Unsupported file type .${ext}. Use ${FORMATS.map((f) => "." + f).join(", ")}.`);
      return;
    }
    setError(null);
    if (ext === "json") {
      try {
        const parsed = JSON.parse(await file.text());
        if (!isRRScan(parsed)) throw new Error();
        await importScan(parsed, file.name);
      } catch {
        setError("This .json file isn't a scan from the RR Scan app.");
      }
      return;
    }
    if (ext === "roomplan") return;
    await store.putProperty({ ...property, scan: { fileName: file.name, blob: file, blobId: `scan-${uid()}`, format: ext } });
    // Old markers belong to the old model.
    for (const r of rooms) if (r.scanMarker) await store.putRoom({ ...r, scanMarker: null });
    await reload();
    setMode("scan");
  };

  // Rooms from a LiDAR scan are placed automatically; others can be pinned by hand.
  const unplaced = rooms.filter((r) => !r.scanMarker && r.scanIndex == null);

  return (
    <div className="map-tab">
      <input ref={fileRef} type="file" hidden accept=".json,.glb,.gltf,.obj,.ply,.usdz,application/json" onChange={(e) => onScanFile(e.target.files?.[0])} />
      <div className="map-toolbar">
        <div className="segmented">
          <button className={mode === "plan" ? "active" : ""} onClick={() => { setMode("plan"); setPlacing(null); }}>
            Floor plan
          </button>
          <button className={mode === "scan" ? "active" : ""} onClick={() => setMode("scan")}>
            3D scan
          </button>
        </div>
        {mode === "plan" && rooms.length > 0 && (
          <button
            className="btn ghost small"
            onClick={async () => {
              for (const r of autoArrange(rooms)) await store.putRoom(r);
              reload();
            }}
          >
            Auto-arrange
          </button>
        )}
        {mode === "scan" && (
          <>
            <button className="btn small primary" onClick={startLidar}>
              📡 {property.scan?.format === "roomplan" ? "Rescan with LiDAR" : "LiDAR scan"}
            </button>
            <button className="btn small ghost" onClick={() => fileRef.current?.click()}>
              Import file
            </button>
          </>
        )}
        <span className="grow" />
        <span className="legend small">
          {SEVERITIES.map((s) => (
            <span key={s}>
              <i style={{ background: SEVERITY_COLOR[s] }} />
              {s}
            </span>
          ))}
        </span>
      </div>

      <div className="map-body">
        <div className="map-canvas">
          <Scene3D
            mode={mode}
            rooms={rooms}
            severityByRoom={severityByRoom}
            issueCountByRoom={issueCountByRoom}
            scan={property.scan ?? null}
            placingRoomId={placing}
            onSelectRoom={(id) => go(`/p/${property.id}/room/${id}`)}
            onMoveRoom={async (id, x, y) => {
              const r = rooms.find((q) => q.id === id);
              if (r) await store.putRoom({ ...r, x, y });
              reload();
            }}
            onPlaceMarker={async (id, point) => {
              const r = rooms.find((q) => q.id === id);
              if (r) await store.putRoom({ ...r, scanMarker: point });
              const next = unplaced.find((q) => q.id !== id);
              setPlacing(next?.id ?? null);
              reload();
            }}
            onScanError={setError}
            issueRays={issueRays}
          />
          {mode === "plan" && rooms.length === 0 && (
            <div className="map-empty">
              <p>No rooms yet.</p>
              <a className="btn primary" href={`#/p/${property.id}/rooms`}>
                Add rooms
              </a>
            </div>
          )}
          {mode === "scan" && !property.scan && !lidar && (
            <div className="map-empty">
              <p>
                <b>Scan the unit with LiDAR.</b>
              </p>
              <p className="small">
                Opens the RR Scan app on an iPhone or iPad Pro. Scan each room; the walls, doors, windows, room sizes and appliances
                come back here automatically.
              </p>
              <button className="btn primary" onClick={startLidar}>
                📡 Start LiDAR scan
              </button>
              <p className="small muted">
                Or <button className="link" onClick={() => fileRef.current?.click()}>import a file</button> (RR Scan .json, or .glb/.obj/.ply/.usdz
                from Polycam, Scaniverse or Matterport).
              </p>
            </div>
          )}
          {lidar && (
            <div className="map-empty">
              <p>
                <span className="spinner" /> <b>Waiting for the scan from RR Scan…</b>
              </p>
              <p className="small">Scan each room in RR Scan, tap <b>Send to RentReadies</b>, then come back here. It imports by itself.</p>
              <p className="small muted">
                RR Scan didn't open? It needs to be installed on this iPhone or iPad Pro (see the README).{" "}
                <a className="link" href={lidar.link}>
                  Try again
                </a>
              </p>
              <button className="btn ghost small" onClick={() => setLidar(null)}>
                Cancel
              </button>
            </div>
          )}
          {placing && (
            <div className="map-hint">
              Tap the scan where <b>{rooms.find((r) => r.id === placing)?.name}</b> is.{" "}
              <button className="btn ghost small" onClick={() => setPlacing(null)}>
                Stop
              </button>
            </div>
          )}
        </div>

        <aside className="map-side">
          {error && <p className="small error-text">{error}</p>}
          {notice && (
            <div className="small notice">
              {notice}
              {!inspecting && issues.length > 0 && (
                <>
                  {" "}
                  <a className="link" href={`#/p/${property.id}/repairs`}>
                    View repairs →
                  </a>
                </>
              )}
            </div>
          )}
          {inspecting && (
            <p className="small">
              <span className="spinner" /> {inspecting}
            </p>
          )}
          {mode === "scan" && issueRays.length > 0 && (
            <p className="muted small">Pins show where each problem is. Tap a pin to open its room.</p>
          )}
          <p className="muted small">
            {mode === "plan"
              ? "Drag rooms to match the layout. Tap a room to open its photos and repairs."
              : property.scan
                ? "Pin each room on the scan, then tap a pin to open the room."
                : ""}
          </p>
          <ul className="side-rooms">
            {rooms.map((r) => (
              <li key={r.id}>
                <a href={`#/p/${property.id}/room/${r.id}`} className="grow">
                  <i style={{ background: severityByRoom[r.id] ? SEVERITY_COLOR[severityByRoom[r.id]!] : "#8d99ae" }} />
                  {templateFor(r.type).icon} {r.name}
                  {issueCountByRoom[r.id] ? <span className="muted"> · {issueCountByRoom[r.id]}</span> : null}
                </a>
                {mode === "scan" && property.scan && r.scanIndex == null && (
                  <button className={`btn small ${placing === r.id ? "primary" : "ghost"}`} onClick={() => setPlacing(placing === r.id ? null : r.id)}>
                    {r.scanMarker ? "Move pin" : "Pin"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {mode === "scan" && property.scan && (
            <p className="muted small">
              Scan: {property.scan.fileName}
              {unplaced.length > 0 && rooms.length > 0 && (
                <>
                  {" "}
                  ·{" "}
                  <button className="link" onClick={() => setPlacing(unplaced[0].id)}>
                    pin {unplaced.length} remaining room{unplaced.length > 1 ? "s" : ""}
                  </button>
                </>
              )}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
