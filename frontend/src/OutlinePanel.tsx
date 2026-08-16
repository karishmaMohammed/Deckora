import type { OutlineItem } from "./types.ts";

interface OutlinePanelProps {
  items: OutlineItem[];
  loading: boolean;
  onReset: () => void;
  resetting: boolean;
}

export function OutlinePanel({ items, loading, onReset, resetting }: OutlinePanelProps) {
  return (
    <section className="panel outline-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Document</p>
          <h1>Outline</h1>
          <p className="meta">
            {loading ? "Loading…" : `${items.length} ${items.length === 1 ? "item" : "items"}`}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onReset} disabled={resetting}>
          {resetting ? "Resetting…" : "Reset seed"}
        </button>
      </header>
      <ol className="outline-list">
        {loading && items.length === 0 ? <li className="muted empty">Loading outline…</li> : null}
        {!loading && items.length === 0 ? (
          <li className="muted empty">Empty outline. Ask the agent to start one.</li>
        ) : null}
        {items.map((item) => (
          <li key={item.id} className="outline-item">
            <span className="pos">{String(item.position).padStart(2, "0")}</span>
            <div>
              <h2>{item.title}</h2>
              <p>{item.description || "No description"}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
