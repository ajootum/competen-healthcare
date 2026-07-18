"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ── Framework Builder authoring islands ─────────────────────────────────────
// Interactive editing for a hospital's OWN frameworks (scope != master). Every
// mutation posts to /api/studio/authoring, which re-checks the hospital scope
// and audit-logs. Master-library frameworks never render these controls.

async function post(action: string, payload: Record<string, unknown>) {
  const res = await fetch("/api/studio/authoring", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}

const LIBRARIES = [["specialty", "Specialty"], ["core", "Core"], ["role", "Role"]] as const;

// ── New framework ───────────────────────────────────────────────────────────
export function NewFrameworkButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [library, setLibrary] = useState("specialty");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const d = await post("create_framework", { name: name.trim(), library });
      setOpen(false); setName("");
      router.push(`/educator/studio/frameworks?fw=${d.id}`);
      router.refresh();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="text-[11px] font-semibold text-white bg-purple-600 rounded-lg px-3 py-1.5 hover:bg-purple-700 transition-colors">
      ＋ New Framework
    </button>
  );
  return (
    <div className="flex items-center gap-1.5 flex-wrap bg-purple-50/60 border border-purple-200 rounded-lg px-2 py-1.5">
      <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()}
        placeholder="Framework name" className="text-[11px] border border-gray-200 rounded px-2 py-1 w-44 focus:outline-none focus:border-purple-400" />
      <select value={library} onChange={e => setLibrary(e.target.value)} className="text-[11px] border border-gray-200 rounded px-1.5 py-1 focus:outline-none">
        {LIBRARIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button onClick={create} disabled={busy || !name.trim()} className="text-[11px] font-bold text-white bg-purple-600 rounded px-2.5 py-1 disabled:opacity-40">{busy ? "…" : "Create"}</button>
      <button onClick={() => { setOpen(false); setErr(null); }} className="text-[11px] text-gray-500 px-1.5">Cancel</button>
      {err && <span className="text-[10px] text-red-600 w-full">{err}</span>}
    </div>
  );
}

// ── Lifecycle / one-click publish ───────────────────────────────────────────
export function PublishControl({ frameworkId, status }: { frameworkId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function step(s: string, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(s); setErr(null);
    try { await post("lifecycle", { framework_id: frameworkId, step: s }); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(null);
  }

  const btn = "text-[11px] font-semibold rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40";
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {status === "draft" && (
        <button onClick={() => step("submit_review")} disabled={!!busy} className={`${btn} text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100`}>Submit for review</button>
      )}
      {(status === "draft" || status === "in_review") && (
        <button onClick={() => step("publish", "Publish this framework? A version snapshot will be recorded.")} disabled={!!busy} className={`${btn} text-white bg-green-600 hover:bg-green-700`}>{busy === "publish" ? "Publishing…" : "⬆ Publish"}</button>
      )}
      {status === "in_review" && (
        <button onClick={() => step("revert")} disabled={!!busy} className={`${btn} text-gray-600 bg-white border border-gray-200 hover:border-gray-300`}>Back to draft</button>
      )}
      {status === "published" && (
        <button onClick={() => step("archive", "Archive this published framework?")} disabled={!!busy} className={`${btn} text-gray-600 bg-white border border-gray-200 hover:border-gray-300`}>Archive</button>
      )}
      {status === "archived" && (
        <button onClick={() => step("revert")} disabled={!!busy} className={`${btn} text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100`}>Restore to draft</button>
      )}
      {err && <span className="text-[10px] text-red-600">{err}</span>}
    </div>
  );
}

// ── Structure editor (domains + competencies) ───────────────────────────────
type Comp = { id: string; name: string; code: string | null };
type Dom = { id: string; name: string; competencies: Comp[] };

export function StructureEditor({ frameworkId, initial }: { frameworkId: string; initial: Dom[] }) {
  const router = useRouter();
  const [doms, setDoms] = useState<Dom[]>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newDom, setNewDom] = useState("");
  const [addingComp, setAddingComp] = useState<string | null>(null);
  const [compName, setCompName] = useState("");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const drag = useRef<{ kind: "dom" | "comp"; domId?: string; index: number } | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setSaving(true); setErr(null);
    try { await fn(); setSavedAt(new Date().getTime()); }
    catch (e) { setErr((e as Error).message); }
    setSaving(false);
  }, []);

  // Renames autosave (debounced) and refresh the coverage canvas.
  function renameDom(id: string, name: string) {
    setDoms(ds => ds.map(d => d.id === id ? { ...d, name } : d));
    clearTimeout(timers.current["d:" + id]);
    timers.current["d:" + id] = setTimeout(() => run(async () => { await post("rename_domain", { domain_id: id, name }); router.refresh(); }), 700);
  }
  function renameComp(domId: string, id: string, name: string) {
    setDoms(ds => ds.map(d => d.id === domId ? { ...d, competencies: d.competencies.map(c => c.id === id ? { ...c, name } : c) } : d));
    clearTimeout(timers.current["c:" + id]);
    timers.current["c:" + id] = setTimeout(() => run(async () => { await post("update_competency", { competency_id: id, name }); router.refresh(); }), 700);
  }

  function addDomain() {
    const name = newDom.trim(); if (!name) return;
    run(async () => {
      const d = await post("create_domain", { framework_id: frameworkId, name });
      setDoms(ds => [...ds, { id: d.id, name: d.name, competencies: [] }]);
      setNewDom(""); router.refresh();
    });
  }
  function deleteDomain(id: string) {
    if (!window.confirm("Delete this domain and all its competencies?")) return;
    run(async () => { await post("delete_domain", { domain_id: id }); setDoms(ds => ds.filter(d => d.id !== id)); router.refresh(); });
  }
  function addComp(domId: string) {
    const name = compName.trim(); if (!name) return;
    run(async () => {
      const c = await post("create_competency", { domain_id: domId, name });
      setDoms(ds => ds.map(d => d.id === domId ? { ...d, competencies: [...d.competencies, { id: c.id, name: c.name, code: c.code }] } : d));
      setCompName(""); setAddingComp(null); router.refresh();
    });
  }
  function deleteComp(domId: string, id: string) {
    if (!window.confirm("Delete this competency?")) return;
    run(async () => { await post("delete_competency", { competency_id: id }); setDoms(ds => ds.map(d => d.id === domId ? { ...d, competencies: d.competencies.filter(c => c.id !== id) } : d)); router.refresh(); });
  }

  function dropDomain(index: number) {
    const from = drag.current; drag.current = null;
    if (!from || from.kind !== "dom" || from.index === index) return;
    const a = [...doms]; const [m] = a.splice(from.index, 1); a.splice(index, 0, m);
    setDoms(a);
    run(async () => { await post("reorder_domains", { framework_id: frameworkId, order: a.map(d => d.id) }); router.refresh(); });
  }
  function dropComp(domId: string, index: number) {
    const from = drag.current; drag.current = null;
    if (!from || from.kind !== "comp" || from.domId !== domId || from.index === index) return;
    const dom = doms.find(d => d.id === domId); if (!dom) return;
    const a = [...dom.competencies]; const [m] = a.splice(from.index, 1); a.splice(index, 0, m);
    setDoms(doms.map(d => d.id === domId ? { ...d, competencies: a } : d));
    run(async () => { await post("reorder_competencies", { domain_id: domId, order: a.map(c => c.id) }); router.refresh(); });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex-1">Structure Editor · drag to reorder</span>
        {saving && <span className="text-[10px] text-gray-400">Saving…</span>}
        {!saving && savedAt && <span className="text-[10px] text-green-600">Saved ✓</span>}
      </div>
      {err && <p className="text-[10px] text-red-600 mb-2">{err}</p>}

      <div className="space-y-1.5">
        {doms.map((d, di) => (
          <div key={d.id} draggable onDragStart={() => (drag.current = { kind: "dom", index: di })}
            onDragOver={e => e.preventDefault()} onDrop={() => dropDomain(di)}
            className="border border-gray-100 rounded-lg p-2">
            <div className="flex items-center gap-1.5">
              <span className="cursor-grab text-gray-300 text-xs select-none" title="Drag to reorder">⠿</span>
              <span className="text-[10px] text-gray-400 w-4">{di + 1}.</span>
              <input value={d.name} onChange={e => renameDom(d.id, e.target.value)}
                className="text-[11px] font-semibold text-gray-800 flex-1 border border-transparent hover:border-gray-200 focus:border-purple-300 rounded px-1.5 py-0.5 focus:outline-none" />
              <button onClick={() => { setAddingComp(addingComp === d.id ? null : d.id); setCompName(""); }} className="text-[10px] text-purple-600 hover:text-purple-800 px-1" title="Add competency">＋ Comp</button>
              <button onClick={() => deleteDomain(d.id)} className="text-[10px] text-gray-300 hover:text-red-500 px-1" title="Delete domain">✕</button>
            </div>

            <div className="ml-6 mt-1 space-y-0.5">
              {d.competencies.map((c, ci) => (
                <div key={c.id} draggable onDragStart={e => { e.stopPropagation(); drag.current = { kind: "comp", domId: d.id, index: ci }; }}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => { e.stopPropagation(); dropComp(d.id, ci); }}
                  className="flex items-center gap-1.5 group">
                  <span className="cursor-grab text-gray-200 text-[10px] select-none">⠿</span>
                  {c.code && <span className="text-[9px] font-mono text-gray-400">{c.code}</span>}
                  <input value={c.name} onChange={e => renameComp(d.id, c.id, e.target.value)}
                    className="text-[11px] text-gray-600 flex-1 border border-transparent hover:border-gray-200 focus:border-purple-300 rounded px-1.5 py-0.5 focus:outline-none" />
                  <button onClick={() => deleteComp(d.id, c.id)} className="text-[10px] text-gray-200 group-hover:text-red-400 px-1" title="Delete competency">✕</button>
                </div>
              ))}
              {addingComp === d.id && (
                <div className="flex items-center gap-1.5 mt-1">
                  <input autoFocus value={compName} onChange={e => setCompName(e.target.value)} onKeyDown={e => e.key === "Enter" && addComp(d.id)}
                    placeholder="New competency" className="text-[11px] border border-purple-200 rounded px-2 py-0.5 flex-1 focus:outline-none focus:border-purple-400" />
                  <button onClick={() => addComp(d.id)} disabled={!compName.trim()} className="text-[10px] font-bold text-white bg-purple-600 rounded px-2 py-0.5 disabled:opacity-40">Add</button>
                </div>
              )}
              {!d.competencies.length && addingComp !== d.id && <p className="text-[10px] text-gray-300">No competencies — use ＋ Comp.</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 mt-2">
        <input value={newDom} onChange={e => setNewDom(e.target.value)} onKeyDown={e => e.key === "Enter" && addDomain()}
          placeholder="New domain name" className="text-[11px] border border-gray-200 rounded px-2 py-1 flex-1 focus:outline-none focus:border-purple-400" />
        <button onClick={addDomain} disabled={!newDom.trim()} className="text-[11px] font-bold text-white bg-purple-600 rounded-lg px-3 py-1 disabled:opacity-40">＋ Domain</button>
      </div>
    </div>
  );
}

// ── Realtime presence ───────────────────────────────────────────────────────
export function PresenceBar({ frameworkId, me }: { frameworkId: string; me: string }) {
  const [others, setOthers] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`framework:${frameworkId}`, { config: { presence: { key: `${me}:${Math.random().toString(36).slice(2)}` } } });
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string }>();
        const names: string[] = [];
        for (const key of Object.keys(state)) for (const m of state[key]) if (m.name && m.name !== me) names.push(m.name);
        setOthers([...new Set(names)]);
      })
      .subscribe(async (s) => { if (s === "SUBSCRIBED") await channel.track({ name: me }); });
    return () => { supabase.removeChannel(channel); };
  }, [frameworkId, me]);

  if (!others.length) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
      {others.length === 1 ? `${others[0]} is also viewing` : `${others.length} others viewing`}
    </span>
  );
}
