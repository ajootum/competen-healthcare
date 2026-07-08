"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GraphControls({
  totalEdges, nodeTypes, embeddingTotal, embeddingDone,
}: {
  totalEdges: number; nodeTypes: number; embeddingTotal: number; embeddingDone: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function rebuild() {
    setBusy(true); setMsg("");
    const res = await fetch("/api/graph/rebuild", { method: "POST" });
    setBusy(false);
    if (res.ok) { const d = await res.json(); setMsg(`Rebuilt — ${d.edges.toLocaleString()} edges derived.`); router.refresh(); }
    else setMsg("Rebuild failed.");
  }

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Graph Edges", value: totalEdges.toLocaleString(), color: "text-rose-600" },
          { label: "Node Types", value: nodeTypes, color: "text-indigo-600" },
          { label: "Embeddings", value: embeddingTotal.toLocaleString(), color: "text-teal-600" },
          { label: "Embedded", value: `${embeddingTotal ? Math.round((embeddingDone / embeddingTotal) * 100) : 0}%`, color: "text-violet-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={rebuild} disabled={busy}
          className="px-4 py-2 bg-rose-600 text-white text-sm font-semibold rounded-lg hover:bg-rose-700 disabled:opacity-50">
          {busy ? "Rebuilding…" : "Rebuild Graph"}
        </button>
        {msg && <span className="text-xs text-gray-500">{msg}</span>}
      </div>
      <p className="text-[10px] text-gray-400 mt-2">
        Rebuild derives edges deterministically from the framework → domain → practice → CPU → competency → skill hierarchy plus resource and curriculum links. No AI required.
      </p>
    </div>
  );
}
