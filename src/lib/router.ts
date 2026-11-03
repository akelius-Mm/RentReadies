import { useEffect, useState } from "react";

export function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.split("/").filter(Boolean);
}

export const go = (path: string) => {
  window.location.hash = path;
};
