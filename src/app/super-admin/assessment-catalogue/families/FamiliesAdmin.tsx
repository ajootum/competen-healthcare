"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Family } from "@/lib/assessment/catalogue/families";
import { btnGhost, btnPrimary, callApi, input, CodeChip } from "../ui";

const API = "/api/hq/assessment-catalogue/config";

export default function FamiliesAdmin({ families }: { families: Family[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});

  async function run(body: Record<string, unknown>, after?: () => void) {
    setBusy(true); setError(null);
    const r = await callApi(API, body);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    after?.();
    router.refresh();
  }

  return (
    <div>
      {error && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">{error}</p>}
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
        {families.map(f => {
          const value = edits[f.code] ?? f.label;
          return (
            <li key={f.code} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <CodeChip code={f.code} />
              <input aria-label={`Name of family ${f.code}`} className={`${input} min-w-[200px] flex-1`} value={value} onChange={e => setEdits(p => ({ ...p, [f.code]: e.target.value }))} maxLength={120} />
              <span className="w-28 text-[12px] text-gray-700">{f.instruments} {f.instruments === 1 ? "instrument" : "instruments"}</span>
              <button type="button" className={btnGhost} disabled={busy || value.trim() === f.label} onClick={() => run({ action: "family_update", code: f.code, label: value }, () => setEdits(p => { const n = { ...p }; delete n[f.code]; return n; }))}>Save name</button>
              <button type="button" className={btnGhost} disabled={busy} aria-pressed={f.isActive} onClick={() => run({ action: "family_update", code: f.code, isActive: !f.isActive })}>{f.isActive ? "Hide" : "Show"}</button>
              {!f.isActive && <span className="text-[12px] font-semibold text-gray-700">Hidden</span>}
            </li>
          );
        })}
      </ul>
      <form className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-gray-100 bg-white p-4" onSubmit={e => { e.preventDefault(); void run({ action: "family_create", code, label, position: families.length * 10 + 10 }, () => { setCode(""); setLabel(""); }); }}>
        <label className="text-[12px] font-semibold text-gray-800">Code
          <input className={`${input} mt-1 w-28 uppercase`} value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6} pattern="[A-Z]{1,6}" placeholder="CA" required />
        </label>
        <label className="min-w-[200px] flex-1 text-[12px] font-semibold text-gray-800">Name
          <input className={`${input} mt-1`} value={label} onChange={e => setLabel(e.target.value)} maxLength={120} required />
        </label>
        <button type="submit" className={btnPrimary} disabled={busy}>Add family</button>
        <p className="w-full text-[12px] text-gray-600">The code is one to six capital letters and cannot be changed afterwards.</p>
      </form>
    </div>
  );
}
