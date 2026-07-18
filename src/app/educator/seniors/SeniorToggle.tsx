"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SeniorToggle({ userId, senior }: { userId: string; senior: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true); setError(null);
    const res = await fetch("/api/senior-assessors", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, senior: !senior }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Update failed");
    else router.refresh();
    setBusy(false);
  }

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-[9px] text-red-500">{error}</span>}
      <button onClick={toggle} disabled={busy}
        className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
          senior
            ? "text-amber-700 border border-amber-200 hover:bg-amber-50"
            : "bg-purple-600 hover:bg-purple-700 text-white"
        }`}>
        {busy ? "…" : senior ? "Revoke senior status" : "⭐ Make senior assessor"}
      </button>
    </span>
  );
}
