import { useCallback, useEffect, useState } from "react";
import { useHashRoute } from "./lib/router";
import PropertyList from "./components/PropertyList";
import PropertyView from "./components/PropertyView";
import { aiStatus, setPasscode, type AiStatus } from "./lib/api";

export default function App() {
  const route = useHashRoute();
  const [status, setStatus] = useState<AiStatus | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [tried, setTried] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  const refresh = useCallback(() => aiStatus().then(setStatus), []);
  useEffect(() => {
    refresh();
    const on = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) refresh();
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, [refresh]);

  const needsCode = status?.passcodeRequired && !status.passcodeOk;
  const aiEnabled = Boolean(status?.ai && !needsCode);

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          RentReadies
        </a>
        <span className="grow" />
        {!online ? (
          <span className="pill" title="Photos and edits are saved on this phone">Offline</span>
        ) : status && !needsCode && !status.ai ? (
          <span className="pill warn" title={status.aiError ?? ""}>AI off</span>
        ) : null}
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
          <span className="grow">{tried ? "Wrong passcode. Try again." : "Enter the team passcode to turn on AI inspection."}</span>
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Passcode" autoComplete="current-password" />
          <button className="btn small primary">OK</button>
        </form>
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
          <PropertyView propertyId={route[1]} tab={route[2] ?? "map"} roomId={route[2] === "room" ? route[3] : undefined} aiEnabled={aiEnabled} />
        ) : (
          <PropertyList />
        )}
      </main>
    </div>
  );
}
