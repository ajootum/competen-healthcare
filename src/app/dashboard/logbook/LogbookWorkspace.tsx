"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import EvidencePanel, { type EvidenceItem } from "@/components/EvidencePanel";

// Clinical Skills Logbook workspace (Skills Logbook Redesign spec).
// Workers log skills in under a minute; supervisors verify; verified entries
// and assessor scorings together form the procedural record.

export type SkillOption = { id: string; name: string; competencyId: string | null; competencyName: string | null; cpuId: string | null };
export type EntryRow = {
  id: string; skillName: string; competencyName: string | null; domainName: string | null;
  performedAt: string; location: string | null; supervision: string; notes: string | null;
  status: string; verifierName: string | null; verifierComment: string | null;
  evidence: EvidenceItem[];
};
export type ScoredRow = { skill: string; competency: string; score: number; assessor: string; date: string | null };

const SUPERVISION_UI: Record<string, { label: string; miller: string; cls: string }> = {
  observed:    { label: "Observed",    miller: "P1 · Knows",     cls: "bg-gray-100 text-gray-600" },
  assisted:    { label: "Assisted",    miller: "P2 · Knows How", cls: "bg-blue-50 text-blue-600" },
  supervised:  { label: "Supervised",  miller: "P2 · Knows How", cls: "bg-amber-50 text-amber-700" },
  independent: { label: "Independent", miller: "P3 · Shows How", cls: "bg-green-50 text-green-700" },
};
const STATUS_UI: Record<string, { label: string; cls: string }> = {
  pending:           { label: "Awaiting verification", cls: "bg-amber-50 text-amber-700" },
  verified:          { label: "Verified",              cls: "bg-green-50 text-green-700" },
  rejected:          { label: "Rejected",              cls: "bg-red-50 text-red-600" },
  changes_requested: { label: "Changes requested",     cls: "bg-orange-50 text-orange-600" },
};

const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function LogbookWorkspace({ skills, entries, scored }: {
  skills: SkillOption[]; entries: EntryRow[]; scored: ScoredRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "competency" | "status">("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    skill_id: "", skill_name: "", custom: false,
    performed_at: "", location: "", supervision_level: "supervised", notes: "",
  });

  // KPI figures (self-logged entries)
  const independent = entries.filter(e => e.supervision === "independent").length;
  const underSupervision = entries.filter(e => e.supervision !== "independent").length;
  const pending = entries.filter(e => e.status === "pending").length;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return entries.filter(e =>
      !s || [e.skillName, e.competencyName, e.domainName, e.location].some(v => (v ?? "").toLowerCase().includes(s)));
  }, [entries, q]);

  const grouped = useMemo(() => {
    if (tab === "all") return [["", filtered]] as [string, EntryRow[]][];
    const key = tab === "competency"
      ? (e: EntryRow) => e.competencyName ?? "Unlinked skills"
      : (e: EntryRow) => STATUS_UI[e.status]?.label ?? e.status;
    const m = new Map<string, EntryRow[]>();
    for (const e of filtered) {
      const k = key(e);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [filtered, tab]);

  async function submit() {
    setBusy(true); setErr(null);
    const sel = skills.find(s => s.id === form.skill_id);
    const res = await fetch("/api/logbook", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skill_id: form.custom ? null : form.skill_id || null,
        skill_name: form.custom ? form.skill_name : sel?.name ?? form.skill_name,
        competency_id: form.custom ? null : sel?.competencyId ?? null,
        cpu_id: form.custom ? null : sel?.cpuId ?? null,
        performed_at: form.performed_at || undefined,
        location: form.location, supervision_level: form.supervision_level, notes: form.notes,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? "Failed to log skill.");
      return;
    }
    setOpen(false);
    setForm({ skill_id: "", skill_name: "", custom: false, performed_at: "", location: "", supervision_level: "supervised", notes: "" });
    router.refresh();
  }

  const input = "border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-500/30";
  const card = "bg-white rounded-xl border border-gray-100";
  const valid = form.custom ? form.skill_name.trim().length > 1 : !!form.skill_id;

  return (
    <>
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Clinical Skills Logbook</h1>
          <p className="text-gray-400 text-sm mt-0.5">Your verified record of clinical skills — from supervised practice to independent performance.</p>
        </div>
        <button onClick={() => setOpen(true)}
          className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg">
          ＋ Log a Skill
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Skills Logged", value: entries.length, sub: "your logbook entries", color: "text-blue-600" },
          { label: "Independent (P3)", value: independent, sub: "performed independently", color: "text-green-600" },
          { label: "Under Supervision", value: underSupervision, sub: "building towards independent", color: "text-orange-500" },
          { label: "Awaiting Verification", value: pending, sub: "with your supervisor", color: "text-violet-600" },
        ].map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <p className="text-[10px] text-gray-400 font-medium mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Entries */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center gap-1 px-3 pt-3 border-b border-gray-50">
          {([["all", "All Skills"], ["competency", "By Competency"], ["status", "By Status"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === k ? "border-teal-600 text-teal-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
              {l}
            </button>
          ))}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search skills…"
            className="ml-auto mb-1.5 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-4xl mb-3">📖</p>
            <p className="font-semibold text-gray-700">{entries.length === 0 ? "No skills logged yet" : "No matches"}</p>
            {entries.length === 0 && (
              <>
                <p className="text-gray-400 text-sm mt-2 mb-4">Your logbook becomes a comprehensive record of your clinical skills across all your competency cycles.</p>
                <button onClick={() => setOpen(true)}
                  className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg">
                  ＋ Log Your First Skill
                </button>
              </>
            )}
          </div>
        ) : grouped.map(([groupLabel, rows]) => (
          <div key={groupLabel || "all"}>
            {groupLabel && <p className="px-4 pt-3 pb-1 text-[9px] font-bold text-gray-400 uppercase tracking-widest">{groupLabel} ({rows.length})</p>}
            {rows.map(e => {
              const sup = SUPERVISION_UI[e.supervision] ?? SUPERVISION_UI.supervised;
              const st = STATUS_UI[e.status] ?? STATUS_UI.pending;
              return (
                <div key={e.id} className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                  <span className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center text-base shrink-0">🖊️</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{e.skillName}</p>
                    <p className="text-[10px] text-gray-400" suppressHydrationWarning>
                      {e.competencyName ? `${e.competencyName} · ` : ""}{fmt(e.performedAt)}{e.location ? ` · ${e.location}` : ""}
                    </p>
                    {e.verifierComment && (
                      <p className="text-[11px] text-gray-500 italic mt-1">&ldquo;{e.verifierComment}&rdquo;{e.verifierName ? ` — ${e.verifierName}` : ""}</p>
                    )}
                    <EvidencePanel entryId={e.id} initial={e.evidence} canAttach />
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${sup.cls}`} title={sup.miller}>{sup.label}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${st.cls}`}>{st.label}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Assessor-scored record */}
      {scored.length > 0 && (
        <div className={`${card} p-5 mt-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Assessor-Scored Skills</h2>
          <p className="text-[10px] text-gray-400 mb-3">Scored by assessors during your competency cycles — these feed your passport directly.</p>
          {scored.map((r, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
              <span className={`w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 ${r.score >= 3 ? "bg-teal-500" : "bg-orange-400"}`}>{r.score}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{r.skill}</p>
                <p className="text-[10px] text-gray-400" suppressHydrationWarning>{r.competency} · {r.assessor}{r.date ? ` · ${fmt(r.date)}` : ""}</p>
              </div>
              <span className={`text-[9px] font-bold shrink-0 ${r.score >= 3 ? "text-green-600" : "text-amber-600"}`}>
                {r.score >= 3 ? "Independent" : "Needs practice"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Log a Skill modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-gray-900 mb-4">Log a Skill</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Skill *</label>
                {!form.custom ? (
                  <select value={form.skill_id} onChange={e => setForm(p => ({ ...p, skill_id: e.target.value }))} className={input}>
                    <option value="">Select from the skill library…</option>
                    {skills.map(s => (
                      <option key={s.id} value={s.id}>{s.name}{s.competencyName ? ` — ${s.competencyName}` : ""}</option>
                    ))}
                  </select>
                ) : (
                  <input value={form.skill_name} onChange={e => setForm(p => ({ ...p, skill_name: e.target.value }))}
                    placeholder="Name the skill you performed" className={input} autoFocus />
                )}
                <button onClick={() => setForm(p => ({ ...p, custom: !p.custom, skill_id: "", skill_name: "" }))}
                  className="text-[10px] text-teal-600 hover:underline mt-1">
                  {form.custom ? "← Choose from the library instead" : "Skill not in the list? Enter it manually"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Date performed</label>
                  <input type="date" value={form.performed_at} onChange={e => setForm(p => ({ ...p, performed_at: e.target.value }))} className={input} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Location / unit</label>
                  <input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Medical Ward" className={input} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Supervision level *</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(SUPERVISION_UI).map(([k, v]) => (
                    <button key={k} type="button" onClick={() => setForm(p => ({ ...p, supervision_level: k }))}
                      className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                        form.supervision_level === k ? "border-teal-500 bg-teal-50 text-teal-800" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                      <span className="font-semibold">{v.label}</span>
                      <span className="block text-[9px] text-gray-400">{v.miller}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Notes (optional)</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2} placeholder="Context, patient category, reflections…" className={`${input} resize-none`} />
              </div>
              {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setOpen(false)}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={submit} disabled={busy || !valid}
                className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                {busy ? "Saving…" : "Log Skill"}
              </button>
            </div>
            <p className="text-[9px] text-gray-400 mt-3">Logged skills await verification by an assessor or educator. <Link href="/dashboard/passport" className="text-teal-600 hover:underline">Verified entries appear on your record.</Link></p>
          </div>
        </div>
      )}
    </>
  );
}
