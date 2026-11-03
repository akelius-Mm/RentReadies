import { useRef, useState } from "react";
import type { PropertyData } from "../lib/usePropertyData";
import Scene3D from "./Scene3D";
import { store } from "../lib/db";
import { autoArrange } from "../lib/rooms";
import { go } from "../lib/router";
import { SEVERITY_COLOR } from "../lib/format";
import { SEVERITIES, type ScanFormat } from "../lib/types";
import { templateFor } from "../lib/roomTemplates";

const FORMATS: ScanFormat[] = ["glb", "gltf", "obj", "ply", "usdz"];

export default function MapTab({ data }: { data: PropertyData }) {
  const { property, rooms, severityByRoom, issueCountByRoom, reload } = data;
  const [mode, setMode] = useState<"plan" | "scan">(property?.scan ? "scan" : "plan");
  const [placing, setPlacing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!property) return null;

  const onScanFile = async (file?: File) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() as ScanFormat;
    if (!FORMATS.includes(ext)) {
      setError(`Unsupported file type .${ext}. Use ${FORMATS.map((f) => "." + f).join(", ")}.`);
      return;
    }
    setError(null);
    await store.putProperty({ ...property, scan: { fileName: file.name, blob: file, format: ext } });
    // Old markers belong to the old model.
    for (const r of rooms) if (r.scanMarker) await store.putRoom({ ...r, scanMarker: null });
    await reload();
    setMode("scan");
  };

  const unplaced = rooms.filter((r) => !r.scanMarker);

  return (
    <div className="map-tab">
      <input ref={fileRef} type="file" hidden accept=".glb,.gltf,.obj,.ply,.usdz" onChange={(e) => onScanFile(e.target.files?.[0])} />
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
          <button className="btn small" onClick={() => fileRef.current?.click()}>
            {property.scan ? "Replace scan" : "Import scan"}
          </button>
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
          />
          {mode === "plan" && rooms.length === 0 && (
            <div className="map-empty">
              <p>No rooms yet.</p>
              <a className="btn primary" href={`#/p/${property.id}/rooms`}>
                Add rooms
              </a>
            </div>
          )}
          {mode === "scan" && !property.scan && (
            <div className="map-empty">
              <p>
                <b>Import a 3D scan of the unit.</b>
              </p>
              <p className="small">
                Walk the unit with a LiDAR scanning app on an iPhone/iPad Pro (for example Polycam, Scaniverse, 3D Scanner App)
                or export from Matterport, then import the <b>.glb</b>, .obj, .ply or .usdz file here.
              </p>
              <button className="btn primary" onClick={() => fileRef.current?.click()}>
                Import scan file
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
                {mode === "scan" && property.scan && (
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
