import { useEffect, useState } from "react";
import { useHashRoute } from "./lib/router";
import PropertyList from "./components/PropertyList";
import PropertyView from "./components/PropertyView";
import { aiStatus } from "./lib/api";

export default function App() {
  const route = useHashRoute();
  const [ai, setAi] = useState<boolean | null>(null);
  useEffect(() => {
    aiStatus().then((s) => setAi(s?.ai ?? false));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          RentReadies
        </a>
        {ai === false && <span className="pill warn" title="Set ANTHROPIC_API_KEY on the server">AI off</span>}
      </header>
      <main>
        {route[0] === "p" && route[1] ? (
          <PropertyView propertyId={route[1]} tab={route[2] ?? "map"} roomId={route[2] === "room" ? route[3] : undefined} aiEnabled={ai !== false} />
        ) : (
          <PropertyList />
        )}
      </main>
    </div>
  );
}
