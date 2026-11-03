import { lazy, Suspense } from "react";
import { usePropertyData } from "../lib/usePropertyData";
import { range, totals } from "../lib/format";
import RoomsTab from "./RoomsTab";
import RoomView from "./RoomView";
import RepairsTab from "./RepairsTab";
import ReportTab from "./ReportTab";

// three.js is large; only load it when the map is opened.
const MapTab = lazy(() => import("./MapTab"));

const TABS = [
  { id: "map", label: "3D map" },
  { id: "rooms", label: "Rooms & photos" },
  { id: "repairs", label: "Repairs" },
  { id: "report", label: "Report" },
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
        <p>This unit was not found on this device.</p>
        <a href="#/">Back to units</a>
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
            {rooms.length} rooms · {photos.length} photos · {open} open items · est. {range(t.low, t.high)}
          </p>
        </div>
      </div>
      <nav className="tabs no-print">
        {TABS.map((x) => (
          <a key={x.id} href={`#/p/${propertyId}/${x.id}`} className={activeTab === x.id ? "active" : ""}>
            {x.label}
          </a>
        ))}
      </nav>
      {roomId ? (
        <RoomView data={data} roomId={roomId} aiEnabled={aiEnabled} />
      ) : activeTab === "rooms" ? (
        <RoomsTab data={data} />
      ) : activeTab === "repairs" ? (
        <RepairsTab data={data} />
      ) : activeTab === "report" ? (
        <ReportTab data={data} />
      ) : (
        <Suspense fallback={<div className="page muted">Loading 3D map…</div>}>
          <MapTab data={data} />
        </Suspense>
      )}
    </div>
  );
}
