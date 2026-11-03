import { lazy, Suspense } from "react";
import { usePropertyData } from "../lib/usePropertyData";
import { range, totals } from "../lib/format";
import { store } from "../lib/db";
import { TURN_TYPES, type TurnType } from "../lib/types";
import RoomsTab from "./RoomsTab";
import RoomView from "./RoomView";
import RepairsTab from "./RepairsTab";
import ReportTab from "./ReportTab";
import InventoryTab from "./InventoryTab";

// three.js is large; only load it when the map is opened.
const MapTab = lazy(() => import("./MapTab"));

const TABS = [
  { id: "map", label: "3D map", short: "Map", icon: "🧊" },
  { id: "rooms", label: "Rooms & photos", short: "Rooms", icon: "📷" },
  { id: "repairs", label: "Repairs", short: "Repairs", icon: "🛠️" },
  { id: "inventory", label: "Appliances & finishes", short: "Items", icon: "🧾" },
  { id: "report", label: "Report", short: "Report", icon: "📄" },
];

export default function PropertyView({
  propertyId,
  tab,
  roomId,
  aiEnabled,
}: {
  propertyId: string;
  tab: string;
  roomId?: string;
  aiEnabled: boolean;
}) {
  const data = usePropertyData(propertyId);
  const { property, issues, rooms, photos } = data;

  if (property === undefined) return <div className="page muted">Loading…</div>;
  if (property === null)
    return (
      <div className="page">
        <p>This inspection wasn't found. It may have been deleted, or it hasn't synced to this phone yet.</p>
        <a href="#/">Back to home</a>
      </div>
    );

  const t = totals(issues);
  const open = issues.filter((i) => i.status !== "dismissed" && i.status !== "done").length;
  const activeTab = roomId ? "rooms" : tab;

  return (
    <div className="property">
      <div className="property-head no-print">
        <div className="grow">
          <h1>{property.name}</h1>
          <p className="muted small">
            {new Date(property.createdAt).toLocaleDateString()}
            {property.inspector ? ` · ${property.inspector}` : ""} · {rooms.length} rooms · {photos.length} photos · {open} open
            items · est. {range(t.low, t.high)}
          </p>
          <div className="row tight wrap">
            <select
              className="small"
              value={property.turnType ?? ""}
              onChange={(e) => store.putProperty({ ...property, turnType: (e.target.value || undefined) as TurnType | undefined }).then(data.reload)}
              aria-label="Turn type"
            >
              <option value="">Turn type…</option>
              {TURN_TYPES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            {property.status === "complete" ? (
              <button
                className="btn small"
                onClick={() => store.putProperty({ ...property, status: "in_progress", completedAt: undefined }).then(data.reload)}
              >
                ✓ Complete {property.completedAt ? new Date(property.completedAt).toLocaleDateString() : ""} · reopen
              </button>
            ) : (
              <button
                className="btn small primary"
                onClick={() => store.putProperty({ ...property, status: "complete", completedAt: Date.now() }).then(data.reload)}
              >
                Mark inspection complete
              </button>
            )}
          </div>
        </div>
      </div>
      <nav className="tabs no-print">
        {TABS.map((x) => (
          <a key={x.id} href={`#/p/${propertyId}/${x.id}`} className={activeTab === x.id ? "active" : ""}>
            <span className="tab-icon" aria-hidden>
              {x.icon}
            </span>
            <span className="tab-long">{x.label}</span>
            <span className="tab-short">{x.short}</span>
          </a>
        ))}
      </nav>
      {roomId ? (
        <RoomView data={data} roomId={roomId} aiEnabled={aiEnabled} />
      ) : activeTab === "rooms" ? (
        <RoomsTab data={data} />
      ) : activeTab === "repairs" ? (
        <RepairsTab data={data} />
      ) : activeTab === "inventory" ? (
        <InventoryTab data={data} />
      ) : activeTab === "report" ? (
        <ReportTab data={data} />
      ) : (
        <Suspense fallback={<div className="page muted">Loading 3D map…</div>}>
          <MapTab data={data} aiEnabled={aiEnabled} />
        </Suspense>
      )}
    </div>
  );
}
