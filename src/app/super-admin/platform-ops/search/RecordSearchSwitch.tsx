"use client";

import { useState } from "react";

// HQ-RECORD-SEARCH-01: the switch for the HQ palette's record search. Shown only to someone holding hq.platform.governance.manage; the route checks it again.
export default function RecordSearchSwitch({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const flip = async () => {
    setBusy(true); setError("");
    const r = await fetch("/api/hq/search/flag", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) { setEnabled(!enabled); return; }
    setError((await r?.json().catch(() => null))?.error ?? "The switch could not be changed. Try again shortly.");
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-[16rem]">
          <p className="font-semibold text-gray-900">HQ record search: {enabled ? "on" : "off"}</p>
          <p className="mt-0.5 text-gray-700">Shows policies, instruments, frameworks, positions and the staff directory in the HQ search box. It gives nobody extra access: each person still sees only what their own rights allow.</p>
        </div>
        <button type="button" onClick={flip} disabled={busy} className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-4 font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)]">
          {busy ? "Saving…" : enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    </div>
  );
}
