"use client";

import { useState } from "react";

// PRODUCT-EXPERIENCE P5 (prepared, OFF): the guided "Add Competen Professional" in Scholar Settings. Rendered only
// while the server gate is on; the route refuses on its own when it is not.
export default function AddProfessional({ accent }: { accent: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/individual/professional-add", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error?.message ?? "Competen Professional could not be added just now."); return; }
      window.location.assign(typeof j.next === "string" && j.next.startsWith("/individual/") ? j.next : "/individual/professional");
    } catch { setErr("That did not work. Check your connection and try again."); } finally { setBusy(false); }
  }
  return (
    <div className="mt-4 rounded-xl border border-gray-200 p-4">
      <p className="text-[14.5px] font-semibold text-gray-900">Add Competen Professional</p>
      <p className="mt-1 text-[13.5px] text-gray-700">For your practice after you qualify, or alongside study. It joins this account: your Scholar record, Passport and profile stay exactly as they are, and you can keep using Scholar.</p>
      <button type="button" onClick={add} disabled={busy}
        className="mt-3 inline-flex min-h-[44px] items-center rounded-xl px-5 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
        {busy ? "Adding…" : "Add Competen Professional"}
      </button>
      {err && <p role="alert" className="mt-2 text-[13px] font-medium text-red-700">{err}</p>}
    </div>
  );
}
