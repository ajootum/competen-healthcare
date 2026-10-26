"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// YOUR STUDIES, EDITED IN PLACE -- COMPETEN-INDIVIDUAL-PROFILE-HFE, on the Scholar context (387, 402).
//
// Programme, level and institution, from the governed options only, saved through /api/individual/scholar/programme.
// Changing them never rewrites earlier study: migration 402's trigger closes the current period and opens a new
// one, and the periods are listed below, read-only.

type Opt = { code: string; label: string };
export type StudyOptions = { programmes: (Opt & { levels: Opt[] })[]; institutions: Opt[]; asksLevel: boolean; asksInstitution: boolean };
export type StudyPeriod = { programmeLabel: string; levelLabel: string | null; institutionLabel: string | null; effectiveFrom: string; effectiveTo: string | null };

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const selectCls = `mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14.5px] text-gray-900 ${focusRing}`;
const small = `inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center justify-center rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-50 ${focusRing}`;
const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default function StudyContext({ accent, options, current, periods, historyNote }: {
  accent: string; options: StudyOptions | null; current: { programme: string | null; level: string | null; institution: string | null };
  periods: StudyPeriod[] | null; historyNote: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [programme, setProgramme] = useState(current.programme ?? "");
  const [level, setLevel] = useState(current.level ?? "");
  const [institution, setInstitution] = useState(current.institution ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (editing) first.current?.focus(); }, [editing]);

  if (!options) return <p className="text-[13.5px] text-gray-600">Study details are not available here yet.</p>;
  const prog = options.programmes.find(p => p.code === programme) ?? null;
  const label = (list: Opt[], code: string | null) => list.find(o => o.code === code)?.label ?? null;
  const shown: [string, string | null][] = [
    ["Programme", label(options.programmes, current.programme)],
    // Only where the programme has levels: a programme without them has nothing to record here.
    ...((options.programmes.find(p => p.code === current.programme)?.levels.length ?? 0) > 0
      ? [["Level or year", label(options.programmes.find(p => p.code === current.programme)?.levels ?? [], current.level)] as [string, string | null]] : []),
    ...(options.asksInstitution ? [["Institution", label(options.institutions, current.institution)] as [string, string | null]] : []),
  ];
  const levelMissing = !!prog && prog.levels.length > 0 && !level;

  function cancel() { setProgramme(current.programme ?? ""); setLevel(current.level ?? ""); setInstitution(current.institution ?? ""); setErr(null); setEditing(false); }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!programme) { setErr("Choose your programme, or cancel to keep it as it is."); return; }
    if (levelMissing) { setErr("Choose your level or year for this programme."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/individual/scholar/programme", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: programme, level: level || null, institution: institution || null }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error ?? "Your studies could not be saved. Nothing was changed."); return; }
      setEditing(false); setStatus("Saved. Your earlier study keeps the context it was done in.");
      router.refresh();
    } catch { setErr("Competen could not be reached. Nothing was changed."); } finally { setBusy(false); }
  }

  return (
    <div>
      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-[13px] font-semibold text-green-800">{status}</p>
      {!editing ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <dl className="grid flex-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {shown.map(([k, v]) => (
              <div key={k}><dt className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{k}</dt>
                <dd className="text-[14.5px] text-gray-900">{v ?? <span className="italic text-gray-500">Not recorded</span>}</dd></div>
            ))}
          </dl>
          <button type="button" onClick={() => setEditing(true)} className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
            {current.programme ? "Edit your studies" : "Add your studies"}
          </button>
        </div>
      ) : (
        <form onSubmit={save} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); cancel(); } }} noValidate className="grid gap-4 sm:grid-cols-2">
          <label className="block text-[13px] font-semibold text-gray-800">Programme
            <select ref={first} value={programme} onChange={e => { setProgramme(e.target.value); setLevel(""); setErr(null); }} className={selectCls}
              aria-invalid={!!err && !programme} required>
              <option value="">Choose…</option>
              {options.programmes.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
          </label>
          {prog && prog.levels.length > 0 && (
            <label className="block text-[13px] font-semibold text-gray-800">Level or year
              <select value={level} onChange={e => { setLevel(e.target.value); setErr(null); }} className={selectCls} aria-invalid={levelMissing && !!err} required>
                <option value="">Choose…</option>
                {prog.levels.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
          )}
          {options.asksInstitution && (
            <label className="block text-[13px] font-semibold text-gray-800">Institution (optional)
              <select value={institution} onChange={e => setInstitution(e.target.value)} className={selectCls}>
                <option value="">Not stated</option>
                {options.institutions.map(i => <option key={i.code} value={i.code}>{i.label}</option>)}
              </select>
            </label>
          )}
          {err && <p role="alert" className="sm:col-span-2 text-[12.5px] font-semibold text-red-700">{err}</p>}
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={`${small} border-transparent text-white`} style={{ background: accent }}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" onClick={cancel} disabled={busy} className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>Cancel</button>
          </div>
        </form>
      )}
      {periods === null ? (historyNote && <p className="mt-3 text-[12.5px] text-gray-500">{historyNote}</p>) : periods.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-gray-600">Earlier study contexts ({periods.length - 1})</summary>
          <ol className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3 text-[12.5px] text-gray-600">
            {periods.filter(p => p.effectiveTo).map((p, i) => (
              <li key={i}>{[p.programmeLabel, p.levelLabel, p.institutionLabel].filter(Boolean).join(" · ")} · {fmt(p.effectiveFrom)} to {fmt(p.effectiveTo!)}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
