import { useEffect, useState } from "react";
import type { Issue, IssueStatus, Photo, Room } from "../lib/types";
import { CATEGORY_LABELS, ISSUE_CATEGORIES, SEVERITIES, TRADES } from "../lib/types";
import { SEVERITY_COLOR, range } from "../lib/format";
import { store, uid } from "../lib/db";
import { remotePhotoUrl } from "../lib/sync";
import { myName } from "../lib/me";

/** Image URL for a photo: the copy on this phone, or the shared copy on the server. */
export function usePhotoUrl(photo: Photo) {
  const local = useObjectUrl(photo.blob);
  return photo.blob ? local : remotePhotoUrl(photo.id);
}

export function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function PhotoWithBoxes({
  photo,
  issues,
  className,
  numberOf,
}: {
  photo: Photo;
  issues: Issue[];
  className?: string;
  /** Label for each box; defaults to the issue's position among this photo's issues. */
  numberOf?: (issue: Issue) => number;
}) {
  const url = usePhotoUrl(photo);
  const onPhoto = issues.filter((i) => i.photoId === photo.id && i.status !== "dismissed");
  const boxes = onPhoto.filter((i) => i.bbox);
  return (
    <div className={`photo-boxes ${className ?? ""}`}>
      {url && <img src={url} alt={photo.label} />}
      {boxes.map((i) => (
        <div
          key={i.id}
          className="bbox"
          title={i.title}
          style={{
            left: `${i.bbox!.x * 100}%`,
            top: `${i.bbox!.y * 100}%`,
            width: `${i.bbox!.w * 100}%`,
            height: `${i.bbox!.h * 100}%`,
            borderColor: SEVERITY_COLOR[i.severity],
          }}
        >
          <span style={{ background: SEVERITY_COLOR[i.severity] }}>{numberOf ? numberOf(i) : onPhoto.indexOf(i) + 1}</span>
        </div>
      ))}
    </div>
  );
}

export function Thumb({ photo, onClick, badge }: { photo: Photo; onClick?: () => void; badge?: number }) {
  const url = usePhotoUrl(photo);
  return (
    <button className="thumb" onClick={onClick} title={photo.label}>
      {url && <img src={url} alt={photo.label} loading="lazy" />}
      {badge ? <span className="thumb-badge">{badge}</span> : null}
    </button>
  );
}

export function SeverityTag({ severity }: { severity: Issue["severity"] }) {
  return (
    <span className="sev" style={{ background: SEVERITY_COLOR[severity] }}>
      {severity}
    </span>
  );
}

export function Modal({ onClose, children, wide }: { onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Needs review",
  approved: "Approved",
  scheduled: "Scheduled",
  done: "Done",
  dismissed: "Dismissed",
};

export function IssueCard({
  issue,
  photo,
  room,
  onChanged,
  onEdit,
  onOpenPhoto,
}: {
  issue: Issue;
  photo?: Photo;
  room?: Room;
  onChanged: () => void;
  onEdit: () => void;
  onOpenPhoto?: () => void;
}) {
  const setStatus = async (status: IssueStatus) => {
    await store.putIssue({
      ...issue,
      status,
      completedAt: status === "done" ? (issue.completedAt ?? Date.now()) : undefined,
      updatedBy: myName() || undefined,
    });
    onChanged();
  };
  const overdue = issue.dueDate && issue.status !== "done" && issue.status !== "dismissed" && issue.dueDate < new Date().toISOString().slice(0, 10);
  return (
    <div className={`issue ${issue.status}`}>
      {photo && <Thumb photo={photo} onClick={onOpenPhoto} />}
      <div className="grow">
        <div className="row tight">
          <SeverityTag severity={issue.severity} />
          <strong className="grow">{issue.title}</strong>
        </div>
        <div className="muted small">
          {room ? `${room.name} · ` : ""}
          {CATEGORY_LABELS[issue.category]} · {issue.trade} · {range(issue.estCostLow, issue.estCostHigh)}
          {issue.source === "ai" && issue.confidence !== undefined ? ` · AI ${Math.round(issue.confidence * 100)}%` : ""}
        </div>
        {(issue.assignee || issue.dueDate) && (
          <div className={`small ${overdue ? "error-text" : ""}`}>
            {issue.assignee ? `👤 ${issue.assignee}` : "No owner"}
            {issue.dueDate ? ` · due ${issue.dueDate}${overdue ? " (overdue)" : ""}` : ""}
          </div>
        )}
        {issue.description && <p className="small">{issue.description}</p>}
        {issue.recommendedAction && (
          <p className="small">
            <b>Fix:</b> {issue.recommendedAction}
          </p>
        )}
        <div className="row wrap tight">
          <select value={issue.status} onChange={(e) => setStatus(e.target.value as IssueStatus)} className="small">
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {issue.status === "open" && (
            <>
              <button className="btn small" onClick={() => setStatus("approved")}>
                Approve
              </button>
              <button className="btn ghost small" onClick={() => setStatus("dismissed")}>
                Not an issue
              </button>
            </>
          )}
          <button className="btn ghost small" onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

export function IssueEditor({
  initial,
  propertyId,
  rooms,
  photos,
  defaultRoomId,
  defaultPhotoId,
  onClose,
  onSaved,
}: {
  initial?: Issue;
  propertyId: string;
  rooms: Room[];
  photos: Photo[];
  defaultRoomId?: string;
  defaultPhotoId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Issue>(
    initial ?? {
      id: uid(),
      propertyId,
      roomId: defaultRoomId ?? rooms[0]?.id ?? "",
      photoId: defaultPhotoId,
      category: "paint",
      severity: "medium",
      title: "",
      description: "",
      recommendedAction: "",
      trade: "Handyman",
      estCostLow: 0,
      estCostHigh: 0,
      source: "manual",
      status: "approved",
      createdAt: Date.now(),
    },
  );
  const set = <K extends keyof Issue>(k: K, v: Issue[K]) => setF((x) => ({ ...x, [k]: v }));
  const roomPhotos = photos.filter((p) => p.roomId === f.roomId);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await store.putIssue({
      ...f,
      estCostHigh: Math.max(f.estCostLow, f.estCostHigh),
      completedAt: f.status === "done" ? (f.completedAt ?? Date.now()) : undefined,
      updatedBy: myName() || undefined,
    });
    onSaved();
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={save} className="stack">
        <h2>{initial ? "Edit repair item" : "Add repair item"}</h2>
        <label>
          What needs doing
          <input value={f.title} onChange={(e) => set("title", e.target.value)} required placeholder="e.g. Repaint water-stained ceiling" />
        </label>
        <div className="grid2">
          <label>
            Room
            <select value={f.roomId} onChange={(e) => set("roomId", e.target.value)}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Photo
            <select value={f.photoId ?? ""} onChange={(e) => set("photoId", e.target.value || undefined)}>
              <option value="">None</option>
              {roomPhotos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select value={f.category} onChange={(e) => set("category", e.target.value as Issue["category"])}>
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select value={f.severity} onChange={(e) => set("severity", e.target.value as Issue["severity"])}>
              {SEVERITIES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Trade
            <select value={f.trade} onChange={(e) => set("trade", e.target.value as Issue["trade"])}>
              {TRADES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="grid2 tight">
            <label>
              Cost low $
              <input type="number" min={0} value={f.estCostLow} onChange={(e) => set("estCostLow", Number(e.target.value))} />
            </label>
            <label>
              Cost high $
              <input type="number" min={0} value={f.estCostHigh} onChange={(e) => set("estCostHigh", Number(e.target.value))} />
            </label>
          </div>
        </div>
        <div className="grid2">
          <label>
            Owner
            <input value={f.assignee ?? ""} onChange={(e) => set("assignee", e.target.value || undefined)} placeholder="Who's handling it" />
          </label>
          <label>
            Due
            <input type="date" value={f.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || undefined)} />
          </label>
        </div>
        <label>
          Details
          <textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
        </label>
        <label>
          Recommended fix
          <textarea rows={2} value={f.recommendedAction} onChange={(e) => set("recommendedAction", e.target.value)} />
        </label>
        <div className="row">
          {initial && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await store.deleteIssue(f.id);
                onSaved();
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
