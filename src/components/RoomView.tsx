import { useRef, useState } from "react";
import type { PropertyData } from "../lib/usePropertyData";
import { templateFor, type Shot } from "../lib/roomTemplates";
import { resizeImage } from "../lib/image";
import { store, uid } from "../lib/db";
import { analyzeRoom } from "../lib/api";
import { go } from "../lib/router";
import { range, totals } from "../lib/format";
import type { Issue, Photo } from "../lib/types";
import { IssueCard, IssueEditor, Modal, PhotoWithBoxes, Thumb } from "./common";
import { InventoryEditor, InventoryList } from "./Inventory";
import type { InventoryItem } from "../lib/types";

export default function RoomView({ data, roomId, aiEnabled }: { data: PropertyData; roomId: string; aiEnabled: boolean }) {
  const { rooms, photos, issues, inventory, reload, property } = data;
  const room = rooms.find((r) => r.id === roomId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewPhoto, setViewPhoto] = useState<Photo | null>(null);
  const [editing, setEditing] = useState<Issue | "new" | null>(null);
  const [newPhotoId, setNewPhotoId] = useState<string | undefined>();
  const [editingInv, setEditingInv] = useState<InventoryItem | "new" | null>(null);
  const [showDims, setShowDims] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingShot = useRef<Shot | null>(null);

  if (!room) return <div className="page muted">Room not found.</div>;

  const template = templateFor(room.type);
  const roomPhotos = photos.filter((p) => p.roomId === room.id);
  const roomIssues = issues.filter((i) => i.roomId === room.id);
  const roomInventory = inventory.filter((i) => i.roomId === room.id);
  const visibleIssues = roomIssues.filter((i) => i.status !== "dismissed");
  const dismissedCount = roomIssues.length - visibleIssues.length;
  const unanalyzed = roomPhotos.filter((p) => !p.analyzedAt).length;
  const t = totals(roomIssues);
  const extras = roomPhotos.filter((p) => !template.shots.some((s) => s.id === p.shotId));

  const capture = (shot: Shot | null) => {
    pendingShot.current = shot;
    fileRef.current!.value = "";
    fileRef.current!.click();
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const shot = pendingShot.current;
    setBusy("Saving photos…");
    try {
      for (const file of Array.from(files)) {
        const { blob, width, height } = await resizeImage(file);
        await store.putPhoto({
          id: uid(),
          propertyId: room.propertyId,
          roomId: room.id,
          shotId: shot?.id ?? "extra",
          label: shot?.label ?? "Additional photo",
          blob,
          width,
          height,
          createdAt: Date.now(),
        });
      }
      await reload();
    } catch (e) {
      setError(`Could not read that photo: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    setError(null);
    setBusy("AI is inspecting photos…");
    try {
      await analyzeRoom(room, roomPhotos, (d, n) => n > 1 && setBusy(`AI is inspecting photos… (${d}/${n})`));
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const updateRoom = async (patch: Partial<typeof room>) => {
    await store.putRoom({ ...room, ...patch });
    reload();
  };

  return (
    <div className="page">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => onFiles(e.target.files)} />

      <div className="row">
        <a href={`#/p/${room.propertyId}/rooms`} className="btn ghost small">
          ← Rooms
        </a>
        <span className="grow" />
        <button className="btn ghost small" onClick={() => setShowDims((s) => !s)}>
          Room details
        </button>
      </div>

      <div className="row">
        <span className="room-icon big">{template.icon}</span>
        <input className="title-input grow" value={room.name} onChange={(e) => updateRoom({ name: e.target.value })} aria-label="Room name" />
      </div>

      {showDims && (
        <section className="card">
          <div className="grid3">
            <label>
              Width (ft)
              <input type="number" min={2} value={room.widthFt} onChange={(e) => updateRoom({ widthFt: Math.max(2, Number(e.target.value)) })} />
            </label>
            <label>
              Length (ft)
              <input type="number" min={2} value={room.lengthFt} onChange={(e) => updateRoom({ lengthFt: Math.max(2, Number(e.target.value)) })} />
            </label>
            <label>
              Ceiling (ft)
              <input type="number" min={6} value={room.ceilingFt} onChange={(e) => updateRoom({ ceilingFt: Math.max(6, Number(e.target.value)) })} />
            </label>
          </div>
          <label>
            Notes
            <textarea rows={2} value={room.notes ?? ""} onChange={(e) => updateRoom({ notes: e.target.value })} />
          </label>
          <button
            className="btn danger small"
            onClick={async () => {
              if (!confirm(`Delete ${room.name} with its photos and repair items?`)) return;
              await store.deleteRoom(room.id);
              await reload();
              go(`/p/${room.propertyId}/rooms`);
            }}
          >
            Delete room
          </button>
        </section>
      )}

      <section className="card">
        <h2>Photo checklist</h2>
        <p className="muted small">Tap a shot to take its photo. Get close to anything that looks wrong.</p>
        <ul className="shots">
          {template.shots.map((s) => {
            const shotPhotos = roomPhotos.filter((p) => p.shotId === s.id);
            return (
              <li key={s.id} className={shotPhotos.length ? "done" : ""}>
                <button className="shot-btn" onClick={() => capture(s)}>
                  <span className="check">{shotPhotos.length ? "✓" : "📷"}</span>
                  <span className="grow">
                    <strong>{s.label}</strong>
                    {s.hint && <span className="muted small block">{s.hint}</span>}
                  </span>
                </button>
                {shotPhotos.length > 0 && (
                  <div className="thumbs">
                    {shotPhotos.map((p) => (
                      <Thumb key={p.id} photo={p} onClick={() => setViewPhoto(p)} badge={issueCountFor(p, roomIssues)} />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
          <li>
            <button className="shot-btn" onClick={() => capture(null)}>
              <span className="check">＋</span>
              <span className="grow">
                <strong>Other photo</strong>
                <span className="muted small block">Anything else that needs attention.</span>
              </span>
            </button>
            {extras.length > 0 && (
              <div className="thumbs">
                {extras.map((p) => (
                  <Thumb key={p.id} photo={p} onClick={() => setViewPhoto(p)} badge={issueCountFor(p, roomIssues)} />
                ))}
              </div>
            )}
          </li>
        </ul>
      </section>

      <section className="card sticky-actions">
        <div className="row wrap">
          <button className="btn primary" disabled={!roomPhotos.length || !!busy || !aiEnabled} onClick={analyze}>
            {room.analyzedAt ? (unanalyzed ? `Re-inspect (${unanalyzed} new photos)` : "Re-inspect with AI") : "Inspect with AI"}
          </button>
          <button className="btn" onClick={() => setEditing("new")}>
            + Add item
          </button>
        </div>
        {!aiEnabled && (
          <p className="small warn-text" title="Offline, passcode needed, or the server isn't signed in to Claude.">
            AI unavailable right now. Photos are saved; inspect later.
          </p>
        )}
        {busy && (
          <p className="small">
            <span className="spinner" /> {busy}
          </p>
        )}
        {error && <p className="small error-text">{error}</p>}
      </section>

      {room.aiSummary && (
        <section className="card">
          <h3>AI summary</h3>
          <p>{room.aiSummary}</p>
          {room.aiMissingShots && room.aiMissingShots.length > 0 && (
            <>
              <p className="small">
                <b>Go back and photograph:</b>
              </p>
              <ul className="small">
                {room.aiMissingShots.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section>
        <div className="row">
          <h2 className="grow">Repairs in this room</h2>
          <span className="muted small">
            {t.count} items · {range(t.low, t.high)}
          </span>
        </div>
        {visibleIssues.length === 0 ? (
          <p className="muted">{room.analyzedAt ? "Nothing flagged." : "Take photos, then run the AI inspection."}</p>
        ) : (
          <div className="stack">
            {visibleIssues.map((i) => {
              const photo = roomPhotos.find((p) => p.id === i.photoId);
              return (
                <IssueCard
                  key={i.id}
                  issue={i}
                  photo={photo}
                  onChanged={reload}
                  onEdit={() => setEditing(i)}
                  onOpenPhoto={photo ? () => setViewPhoto(photo) : undefined}
                />
              );
            })}
          </div>
        )}
        {dismissedCount > 0 && <p className="muted small">{dismissedCount} dismissed item(s) hidden.</p>}
      </section>

      <section>
        <div className="row">
          <h2 className="grow">Appliances & finishes</h2>
          <button className="btn ghost small" onClick={() => setEditingInv("new")}>
            + Add
          </button>
        </div>
        {roomInventory.length === 0 ? (
          <p className="muted">{room.analyzedAt ? "Nothing recorded. Re-inspect or add items by hand." : "The AI inspection lists them for you."}</p>
        ) : (
          <InventoryList items={roomInventory} photos={roomPhotos} onEdit={setEditingInv} onOpenPhoto={setViewPhoto} />
        )}
      </section>

      {editingInv && (
        <InventoryEditor
          initial={editingInv === "new" ? undefined : editingInv}
          propertyId={property!.id}
          rooms={rooms}
          defaultRoomId={room.id}
          onClose={() => setEditingInv(null)}
          onSaved={reload}
        />
      )}

      {viewPhoto && (
        <Modal wide onClose={() => setViewPhoto(null)}>
          <h3>{viewPhoto.label}</h3>
          <PhotoWithBoxes photo={viewPhoto} issues={roomIssues} />
          <ol className="small">
            {roomIssues
              .filter((i) => i.photoId === viewPhoto.id && i.status !== "dismissed")
              .map((i) => (
                <li key={i.id}>
                  <b>{i.title}</b> — {range(i.estCostLow, i.estCostHigh)}
                </li>
              ))}
          </ol>
          <div className="row">
            <button
              className="btn danger small"
              onClick={async () => {
                if (!confirm("Delete this photo?")) return;
                await store.deletePhoto(viewPhoto.id);
                setViewPhoto(null);
                reload();
              }}
            >
              Delete photo
            </button>
            <span className="grow" />
            <button
              className="btn small"
              onClick={() => {
                setNewPhotoId(viewPhoto.id);
                setEditing("new");
                setViewPhoto(null);
              }}
            >
              + Add item for this photo
            </button>
          </div>
        </Modal>
      )}

      {editing && (
        <IssueEditor
          initial={editing === "new" ? undefined : editing}
          propertyId={property!.id}
          rooms={rooms}
          photos={photos}
          defaultRoomId={room.id}
          defaultPhotoId={newPhotoId}
          onClose={() => {
            setEditing(null);
            setNewPhotoId(undefined);
          }}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function issueCountFor(p: Photo, issues: Issue[]) {
  return issues.filter((i) => i.photoId === p.id && i.status !== "dismissed").length;
}
