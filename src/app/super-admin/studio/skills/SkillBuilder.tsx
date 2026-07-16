"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SKILL_TYPE_LABELS } from "@/lib/ckcm";

type Skill = {
  id: string; name: string; description: string | null; skill_type: string;
  performance_criteria: string | null; required_knowledge: string | null;
};
type SkillLink = { id: string; library_skill_id: string; competency_id: string; competency_name: string; framework_name: string };
type CompOption = { id: string; label: string };

const EMPTY = { name: "", description: "", skill_type: "psychomotor", performance_criteria: "", required_knowledge: "" };

export default function SkillBuilder({ skills, links, competencies }: {
  skills: Skill[]; links: SkillLink[]; competencies: CompOption[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [attachComp, setAttachComp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = skills.find(s => s.id === selectedId) ?? null;
  const selectedLinks = useMemo(() => links.filter(l => l.library_skill_id === selectedId), [links, selectedId]);
  const linkCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) m.set(l.library_skill_id, (m.get(l.library_skill_id) ?? 0) + 1);
    return m;
  }, [links]);

  const visible = skills.filter(s =>
    (typeFilter === "all" || s.skill_type === typeFilter) &&
    (!search.trim() || s.name.toLowerCase().includes(search.toLowerCase())));

  function select(s: Skill | null) {
    setSelectedId(s?.id ?? null);
    setError(null);
    setForm(s ? {
      name: s.name, description: s.description ?? "", skill_type: s.skill_type,
      performance_criteria: s.performance_criteria ?? "", required_knowledge: s.required_knowledge ?? "",
    } : EMPTY);
  }

  async function api(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    const res = await fetch("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return null; }
    router.refresh();
    return res.json();
  }

  async function save() {
    const result = await api({ kind: "skill", id: selectedId ?? undefined, ...form });
    if (result && !selectedId) { setSelectedId(result.id); }
  }

  async function retire() {
    if (!selectedId) return;
    setBusy(true);
    await fetch(`/api/studio?kind=skill&id=${selectedId}`, { method: "DELETE" });
    setBusy(false); select(null); router.refresh();
  }

  const input = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30";
  const label = "text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_280px] gap-5">
      {/* LEFT — library */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 self-start">
        <button onClick={() => select(null)}
          className="w-full bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors mb-3">
          + New Skill
        </button>
        <input className={`${input} mb-2`} placeholder="Search skills…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className={`${input} mb-3`} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          {Object.entries(SKILL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <div className="flex flex-col gap-1 max-h-[26rem] overflow-y-auto">
          {visible.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">No skills yet — create the first one.</p>}
          {visible.map(s => {
            const t = SKILL_TYPE_LABELS[s.skill_type] ?? SKILL_TYPE_LABELS.psychomotor;
            return (
              <button key={s.id} onClick={() => select(s)}
                className={`text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                  s.id === selectedId ? "bg-teal-50 text-teal-800 border border-teal-200" : "hover:bg-gray-50 text-gray-700"}`}>
                <span>{t.icon}</span>
                <span className="flex-1 min-w-0 truncate">{s.name}</span>
                {(linkCount.get(s.id) ?? 0) > 0 && (
                  <span className="text-[9px] bg-teal-100 text-teal-700 rounded-full px-1.5 font-bold shrink-0">{linkCount.get(s.id)}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* MIDDLE — form */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 self-start">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
          {selected ? "Edit skill" : "New skill"}
        </p>
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
        <div className="flex flex-col gap-3">
          <div>
            <span className={label}>Skill name</span>
            <input className={input} placeholder="e.g. Verifies patient identity before medication administration"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <span className={label}>Skill type</span>
            <select className={input} value={form.skill_type} onChange={e => setForm(f => ({ ...f, skill_type: e.target.value }))}>
              {Object.entries(SKILL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
          <div>
            <span className={label}>Description</span>
            <textarea className={input} rows={2} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <span className={label}>Performance criteria</span>
            <textarea className={input} rows={3} placeholder="Observable criteria, one per line"
              value={form.performance_criteria} onChange={e => setForm(f => ({ ...f, performance_criteria: e.target.value }))} />
          </div>
          <div>
            <span className={label}>Required knowledge</span>
            <textarea className={input} rows={2} value={form.required_knowledge}
              onChange={e => setForm(f => ({ ...f, required_knowledge: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <button disabled={busy || !form.name.trim()} onClick={save}
              className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
              {busy ? "Saving…" : selected ? "Save changes" : "Create skill"}
            </button>
            {selected && (
              <button disabled={busy} onClick={retire}
                className="text-sm text-red-500 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors">Retire</button>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT — live relationships */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 self-start">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Linked competencies</p>
        {!selected ? (
          <p className="text-xs text-gray-400">Select or create a skill to see and manage where it&apos;s used.</p>
        ) : (
          <>
            {selectedLinks.length === 0 ? (
              <p className="text-xs text-gray-400 mb-3">Not attached anywhere yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5 mb-3">
                {selectedLinks.map(l => (
                  <div key={l.id} className="flex items-start gap-1.5 bg-gray-50 rounded-lg px-2.5 py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-800 leading-tight">{l.competency_name}</p>
                      <p className="text-[9px] text-gray-400">{l.framework_name}</p>
                    </div>
                    <button disabled={busy} title="Detach"
                      onClick={() => api({ kind: "detach_skill", competency_skill_id: l.id })}
                      className="text-gray-300 hover:text-red-500 text-xs shrink-0">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-gray-100 pt-3">
              <span className={label}>Attach to competency</span>
              <select className={input} value={attachComp} onChange={e => setAttachComp(e.target.value)}>
                <option value="">Choose competency…</option>
                {competencies.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button disabled={busy || !attachComp}
                onClick={async () => { await api({ kind: "attach_skill", skill_id: selectedId, competency_id: attachComp }); setAttachComp(""); }}
                className="mt-2 w-full bg-teal-50 hover:bg-teal-100 text-teal-700 text-sm font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
                Attach
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
