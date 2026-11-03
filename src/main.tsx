import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Installable app + offline start. Only in production builds; dev uses Vite's live reload.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker not registered", err));
  });
}

// Ask the browser not to evict saved photos when storage runs low.
navigator.storage?.persist?.().catch(() => {});
