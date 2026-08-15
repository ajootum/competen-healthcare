"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// CPR-PI-001 v2 s6 "create/save cohort". A saved cohort is a NAME over registered segment ids --
// this control never composes a filter, it only names the one currently open, so what gets saved
// is exactly what the screen just showed. Retire lives on the saved chip itself.

export default function CohortSaveControl({ segmentIds, noVisitDays }: {
  segmentIds: string[]; noVisitDays: number | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const save = async () => {
    if (name.trim().length < 1 || busy) return;
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/v1/practice/cohorts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", name: name.trim(), segmentIds, noVisitDays }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) { setNote(data?.error?.message ?? "That did not work."); return; }
    setName("");
    setNote("Saved.");
    router.refresh();
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <input value={name} onChange={e => setName(e.target.value)} maxLength={80}
        onKeyDown={e => { if (e.key === "Enter") save(); }}
        placeholder="Name this cohort to reuse it&hellip;"
        className="w-56 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-[var(--cp-primary)]" />
      <button type="button" onClick={save} disabled={busy || name.trim().length < 1}
        className="rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-40">
        Save cohort
      </button>
      {note && <span className="text-[10px] text-gray-500">{note}</span>}
    </div>
  );
}
