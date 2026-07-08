"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CURRICULUM_TYPE_LABELS } from "@/lib/ckcm";

type Module = { id: string; title: string; sort_order: number };
type CurrComp = { id: string; relation: string; framework_competencies: { name: string } | null };
type Curriculum = {
  id: string; title: string; programme_type: string; target_role: string | null; duration_weeks: number | null;
  is_active: boolean; curriculum_modules: Module[]; curriculum_competencies: CurrComp[];
};
type Comp = { id: string; name: string };

export default function CurriculaManager({ curricula, competencies }: { curricula: Curriculum[]; competencies: Comp[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", programme_type: "orientation", target_role: "", duration_weeks: "" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [compSearch, setCompSearch] = useState("");

  async function api(method: string, body: object) {
    setBusy(true);
    const res = await fetch("/api/curricula", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) router.refresh(); else alert((await res.json().catch(() => ({}))).error ?? "Failed");
    return res.ok;
  }
  async function del(kind: string, id: string) {
    setBusy(true); await fetch(`/api/curricula?kind=${kind}&id=${id}`, { method: "DELETE" }); setBusy(false); router.refresh();
  }
  async function create() {
    if (!form.title.trim()) return;
    const ok = await api("POST", { type: "curriculum", ...form, title: form.title.trim(), duration_weeks: form.duration_weeks ? parseInt(form.duration_weeks) : null });
    if (ok) { setCreating(false); setForm({ title: "", programme_type: "orientation", target_role: "", duration_weeks: "" }); }
  }

  const filteredComps = compSearch.trim() ? competencies.filter(c => c.name.toLowerCase().includes(compSearch.toLowerCase())).slice(0, 20) : competencies.slice(0, 15);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={() => setCreating(c => !c)} className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
          {creating ? "Cancel" : "+ New Curriculum"}
        </button>
      </div>

      {creating && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3">
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Curriculum title *"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" autoFocus />
          <div className="grid grid-cols-3 gap-3">
            <select value={form.programme_type} onChange={e => setForm(p => ({ ...p, programme_type: e.target.value }))} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {Object.entries(CURRICULUM_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input value={form.target_role} onChange={e => setForm(p => ({ ...p, target_role: e.target.value }))} placeholder="Target role" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <input type="number" value={form.duration_weeks} onChange={e => setForm(p => ({ ...p, duration_weeks: e.target.value }))} placeholder="Weeks" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={create} disabled={busy} className="self-end px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50">
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      )}

      {curricula.map(c => {
        const open = expanded === c.id;
        const outcomes = c.curriculum_competencies.filter(x => x.relation === "outcome");
        return (
          <div key={c.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 bg-gray-50/60 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 text-sm">{c.title}</p>
                  <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded">{CURRICULUM_TYPE_LABELS[c.programme_type] ?? c.programme_type}</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {c.target_role && `${c.target_role} · `}{c.duration_weeks ? `${c.duration_weeks} weeks · ` : ""}
                  {c.curriculum_modules.length} module{c.curriculum_modules.length !== 1 ? "s" : ""} · {outcomes.length} competencies
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setExpanded(open ? null : c.id)} className="px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100">{open ? "Close" : "Edit"}</button>
                <button onClick={() => del("curriculum", c.id)} className="px-2.5 py-1 text-xs text-red-500 border border-red-100 rounded-lg hover:bg-red-50">Delete</button>
              </div>
            </div>
            {open && (
              <div className="px-5 py-4 flex flex-col gap-4">
                {/* Modules */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Modules</p>
                  <div className="flex flex-col gap-1.5 mb-2">
                    {c.curriculum_modules.sort((a, b) => a.sort_order - b.sort_order).map((m, i) => (
                      <div key={m.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-1.5">
                        <span className="text-gray-700">{i + 1}. {m.title}</span>
                        <button onClick={() => del("module", m.id)} className="text-red-400 hover:text-red-600 leading-none">×</button>
                      </div>
                    ))}
                    {!c.curriculum_modules.length && <p className="text-[11px] text-gray-300 italic">No modules yet</p>}
                  </div>
                  <button onClick={() => { const t = prompt("Module title:"); if (t?.trim()) api("POST", { type: "module", curriculum_id: c.id, title: t.trim() }); }}
                    className="text-[11px] text-teal-600 font-semibold hover:underline">+ Add module</button>
                </div>
                {/* Competencies */}
                <div className="border-t border-gray-50 pt-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Outcome Competencies</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {outcomes.map(x => (
                      <span key={x.id} className="group inline-flex items-center gap-1 text-xs bg-teal-50 border border-teal-100 text-teal-700 pl-2.5 pr-1.5 py-0.5 rounded-full">
                        {x.framework_competencies?.name ?? "—"}
                        <button onClick={() => del("competency", x.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity leading-none px-0.5">×</button>
                      </span>
                    ))}
                    {!outcomes.length && <p className="text-[11px] text-gray-300 italic">None mapped</p>}
                  </div>
                  <input value={compSearch} onChange={e => setCompSearch(e.target.value)} placeholder="Search competencies to add…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs mb-2" />
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                    {filteredComps.map(comp => (
                      <button key={comp.id} onClick={() => api("POST", { type: "competency", curriculum_id: c.id, competency_id: comp.id, relation: "outcome" })}
                        className="text-[11px] bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full hover:bg-teal-50 hover:border-teal-200">+ {comp.name}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {!curricula.length && !creating && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-2xl mb-2">📖</p>
          <p className="text-gray-400 text-sm">No curricula yet — create competency-driven educational programmes.</p>
        </div>
      )}
    </div>
  );
}
