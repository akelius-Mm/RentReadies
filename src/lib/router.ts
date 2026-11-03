import { useEffect, useState } from "react";

function read() {
  const raw = window.location.hash.slice(1) || "/";
  const [path, query = ""] = raw.split("?");
  return { parts: path.split("/").filter(Boolean), query: new URLSearchParams(query) };
}

export function useHashRoute() {
  return useHashLocation().parts;
}

/** Path parts and ?query of the hash, e.g. #/followup?filter=overdue. */
export function useHashLocation() {
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const on = () => setLoc(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return loc;
}

export const go = (path: string) => {
  window.location.hash = path;
};
