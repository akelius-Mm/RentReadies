import { useState } from "react";
import type { PropertyData } from "../lib/usePropertyData";
import { ROOM_TEMPLATES, templateFor } from "../lib/roomTemplates";
import { addRoom, shotProgress } from "../lib/rooms";
import { SEVERITY_COLOR } from "../lib/format";
import { go } from "../lib/router";
import type { RoomType } from "../lib/types";

export default function RoomsTab({ data }: { data: PropertyData }) {
  const { property, rooms, photos, severityByRoom, issueCountByRoom, reload } = data;
  const [adding, setAdding] = useState(rooms.length === 0);

  const add = async (type: RoomType) => {
    await addRoom(property!.id, type, rooms);
    await reload();
  };

  const quickStart = async (types: RoomType[]) => {
    let current = rooms;
    for (const t of types) current = [...current, await addRoom(property!.id, t, current)];
    await reload();
    setAdding(false);
  };

  return (
    <div className="page">
      {rooms.length === 0 && (
        <section className="card">
          <h2>Which rooms does this unit have?</h2>
          <p className="muted small">Pick a layout to start, then add or remove rooms as needed.</p>
          <div className="row wrap">
            <button className="btn" onClick={() => quickStart(["entry", "living", "kitchen", "bathroom", "bedroom", "hallway"])}>
              Studio / 1 bed
            </button>
            <button className="btn" onClick={() => quickStart(["entry", "living", "dining", "kitchen", "hallway", "bathroom", "bedroom", "bedroom", "closet"])}>
              2 bed / 1 bath
            </button>
            <button
              className="btn"
              onClick={() => quickStart(["entry", "living", "dining", "kitchen", "hallway", "bathroom", "bathroom", "bedroom", "bedroom", "bedroom", "laundry"])}
            >
              3 bed / 2 bath
            </button>
          </div>
        </section>
      )}

      <ul className="room-grid">
        {rooms.map((r) => {
          const prog = shotProgress(r, photos);
          const sev = severityByRoom[r.id];
          const count = issueCountByRoom[r.id];
          return (
            <li key={r.id}>
              <a href={`#/p/${r.propertyId}/room/${r.id}`} className="room-card" style={{ borderLeftColor: sev ? SEVERITY_COLOR[sev] : undefined }}>
                <span className="room-icon">{templateFor(r.type).icon}</span>
                <span className="grow">
                  <strong>{r.name}</strong>
                  <span className="progress">
                    <span style={{ width: `${(prog.done / prog.total) * 100}%` }} />
                  </span>
                  <span className="muted small">
                    {prog.done}/{prog.total} shots · {count ? `${count} open item${count > 1 ? "s" : ""}` : r.analyzedAt ? "no issues found" : "not inspected"}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      {adding || rooms.length === 0 ? (
        <section className="card">
          <div className="row">
            <h2 className="grow">Add a room</h2>
            {rooms.length > 0 && (
              <button className="btn ghost small" onClick={() => setAdding(false)}>
                Done
              </button>
            )}
          </div>
          <div className="template-grid">
            {ROOM_TEMPLATES.map((t) => (
              <button key={t.type} className="template" onClick={() => add(t.type)}>
                <span>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="row">
          <button className="btn" onClick={() => setAdding(true)}>
            + Add room
          </button>
          <button className="btn ghost" onClick={() => go(`/p/${property!.id}/map`)}>
            View 3D map
          </button>
        </div>
      )}
    </div>
  );
}
