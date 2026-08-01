"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// QIE-003 — the three-way control that lets a governance owner record the leading/lagging split.
//
// Three states, not a toggle, because "unclassified" is a real position and the majority one on day one.
// A two-way switch would force every indicator into an answer somebody has not made yet, which is the
// fabrication this whole module was built to avoid.

export default function ClassifyControl({ id, current }: { id: string; current: "leading" | "lagging" | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function set(next: "leading" | "lagging" | null) {
    if (next === current) return;
    setBusy(true); setErr(false);
    const res = await fetch(`/api/qie/indicators?id=${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ indicator_class: next }),
    });
    setBusy(false);
    if (!res.ok) { setErr(true); return; }
    router.refresh();
  }

  const btn = (v: "leading" | "lagging" | null, label: string, on: string) =>
    `text-[10px] px-2 py-0.5 rounded border transition-colors ${current === v ? on : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"}`;

  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      <button disabled={busy} onClick={() => set("leading")}
        className={btn("leading", "Leading", "border-[var(--cmp-color-information)] bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]")}>Leading</button>
      <button disabled={busy} onClick={() => set("lagging")}
        className={btn("lagging", "Lagging", "border-gray-300 bg-gray-100 text-gray-700")}>Lagging</button>
      {current && (
        <button disabled={busy} onClick={() => set(null)} title="Clear the classification"
          className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 bg-white text-gray-400 hover:bg-gray-50">×</button>
      )}
      {err && <span className="text-[10px] text-[var(--cmp-text-error)]">failed</span>}
    </span>
  );
}
