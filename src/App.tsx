import { useCallback, useEffect, useState } from "react";
import { useHashRoute } from "./lib/router";
import Home from "./components/Home";
import FollowUp from "./components/FollowUp";
import PropertyView from "./components/PropertyView";
import { aiStatus, setPasscode, type AiStatus } from "./lib/api";
import { onSyncStatus, startSync, syncNow, type SyncStatus } from "./lib/sync";
import { myName, setMyName } from "./lib/me";

export default function App() {
  const route = useHashRoute();
  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [tried, setTried] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [sync, setSync] = useState<SyncStatus>({ state: "idle", pending: 0 });
  const [name, setName] = useState(myName());
  const [nameDraft, setNameDraft] = useState("");

  const refresh = useCallback(() => aiStatus().then(setStatus), []);
  useEffect(() => {
    refresh();
    const on = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) refresh();
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    const off = onSyncStatus(setSync);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      off();
    };
  }, [refresh]);

  const needsCode = Boolean(status?.passcodeRequired && !status.passcodeOk);
  const aiEnabled = Boolean(status?.ai && !needsCode);

  // Sync with the shared record once we know the passcode is right (or none is needed).
  useEffect(() => {
    if (status && !needsCode) startSync();
  }, [status, needsCode]);

  const syncLabel =
    !online || sync.state === "offline"
      ? `Offline${sync.pending ? ` · ${sync.pending} to send` : ""}`
      : sync.state === "syncing"
        ? "Syncing…"
        : sync.state === "error"
          ? "Sync issue"
          : sync.pending
            ? `${sync.pending} to send`
            : "Saved";

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span className="brand-name">RentReadies</span>
        </a>
        <nav className="topnav">
          <a href="#/" className={!route[0] ? "active" : ""}>
            Home
          </a>
          <a href="#/followup" className={route[0] === "followup" ? "active" : ""}>
            Follow-up
          </a>
        </nav>
        <span className="grow" />
        {(!online || (status && !needsCode)) && (
          <button
            className={`pill ${sync.state === "error" ? "warn" : ""}`}
            title={sync.error ?? (sync.lastSynced ? `Last synced ${new Date(sync.lastSynced).toLocaleTimeString()}` : "")}
            onClick={() => syncNow()}
          >
            {syncLabel}
          </button>
        )}
        {online && status && !needsCode && !status.ai && (
          <span className="pill warn" title={status.aiError ?? ""}>
            AI off
          </span>
        )}
      </header>

      {needsCode && (
        <form
          className="banner no-print"
          onSubmit={async (e) => {
            e.preventDefault();
            setPasscode(code.trim());
            setTried(true);
            await refresh();
          }}
        >
          <span className="grow">{tried ? "Wrong passcode. Try again." : "Enter the team passcode to sync and use AI."}</span>
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Passcode" autoComplete="current-password" />
          <button className="btn small primary">OK</button>
        </form>
      )}
      {!needsCode && !name && (
        <form
          className="banner no-print"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nameDraft.trim()) return;
            setMyName(nameDraft);
            setName(nameDraft.trim());
          }}
        >
          <span className="grow">What's your name? It's saved on inspections and repairs you update.</span>
          <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Your name" autoComplete="name" />
          <button className="btn small primary">Save</button>
        </form>
      )}
      {sync.state === "error" && sync.error && online && (
        <div className="banner warn no-print">
          <span className="grow small">{sync.error} Your work is saved on this phone and will be sent when this is fixed.</span>
          <button className="btn small" onClick={() => syncNow()}>
            Retry
          </button>
        </div>
      )}
      {status && !needsCode && !status.ai && status.aiError && online && (
        <div className="banner warn no-print">
          <span className="grow small">{status.aiError}</span>
          <button className="btn small" onClick={refresh}>
            Retry
          </button>
        </div>
      )}

      <main>
        {route[0] === "p" && route[1] ? (
          <PropertyView propertyId={route[1]} tab={route[2] ?? "rooms"} roomId={route[2] === "room" ? route[3] : undefined} aiEnabled={aiEnabled} />
        ) : route[0] === "followup" ? (
          <FollowUp />
        ) : (
          <Home aiEnabled={aiEnabled} online={online && !needsCode} />
        )}
      </main>
    </div>
  );
}
