import { useEffect, useState } from "react";
import { store, uid } from "../lib/db";
import type { Property } from "../lib/types";
import { go } from "../lib/router";

export default function PropertyList() {
  const [list, setList] = useState<Property[] | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");

  const load = () => store.listProperties().then(setList);
  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const p: Property = { id: uid(), name: name.trim(), address: address.trim(), createdAt: Date.now(), updatedAt: Date.now() };
    await store.putProperty(p);
    go(`/p/${p.id}/rooms`);
  };

  return (
    <div className="page">
      <section className="card">
        <h1>New make-ready inspection</h1>
        <p className="muted">
          Add the unit, map its rooms in 3D, take the guided photos in each room, and get a list of repairs with cost
          estimates.
        </p>
        <form onSubmit={create} className="stack">
          <label>
            Unit name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 123 Main St, Apt 4B" required />
          </label>
          <label>
            Address (optional)
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="City, state" />
          </label>
          <button className="btn primary" type="submit">
            Start inspection
          </button>
        </form>
      </section>

      <section>
        <h2>Units</h2>
        {list === null ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="muted">No units yet.</p>
        ) : (
          <ul className="list">
            {list.map((p) => (
              <li key={p.id} className="list-item">
                <a href={`#/p/${p.id}/map`} className="grow">
                  <strong>{p.name}</strong>
                  <span className="muted small">
                    {p.address ? `${p.address} · ` : ""}updated {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </a>
                <button
                  className="btn ghost small"
                  onClick={async () => {
                    if (confirm(`Delete ${p.name} and all its photos?`)) {
                      await store.deleteProperty(p.id);
                      load();
                    }
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
