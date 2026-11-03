import { useCallback, useEffect, useMemo, useState } from "react";
import { store } from "./db";
import { onRemoteData } from "./sync";
import type { InventoryItem, Issue, Photo, Property, Room, Severity } from "./types";
import { activeIssues, worstSeverity } from "./format";

export function usePropertyData(propertyId: string) {
  const [property, setProperty] = useState<Property | null | undefined>(undefined);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  const reload = useCallback(async () => {
    const [p, r, ph, is, inv] = await Promise.all([
      store.getProperty(propertyId),
      store.rooms(propertyId),
      store.photos(propertyId),
      store.issues(propertyId),
      store.inventory(propertyId),
    ]);
    setProperty(p ?? null);
    setRooms(r);
    setPhotos(ph.sort((a, b) => a.createdAt - b.createdAt));
    setIssues(is.sort((a, b) => a.createdAt - b.createdAt));
    setInventory(inv.sort((a, b) => a.createdAt - b.createdAt));
  }, [propertyId]);

  useEffect(() => {
    reload();
    // Changes made by teammates arrive through sync.
    return onRemoteData(reload);
  }, [reload]);

  const derived = useMemo(() => {
    const severityByRoom: Record<string, Severity | null> = {};
    const issueCountByRoom: Record<string, number> = {};
    for (const r of rooms) {
      const ri = issues.filter((i) => i.roomId === r.id);
      severityByRoom[r.id] = worstSeverity(ri);
      issueCountByRoom[r.id] = activeIssues(ri).filter((i) => i.status !== "done").length;
    }
    return { severityByRoom, issueCountByRoom };
  }, [rooms, issues]);

  return { property, rooms, photos, issues, inventory, reload, ...derived };
}

export type PropertyData = ReturnType<typeof usePropertyData>;
