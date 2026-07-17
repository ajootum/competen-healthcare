"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KNOWLEDGE_TYPE_UI } from "@/lib/ckcm";

type KO = {
  id: string; code: string | null; title: string; summary: string | null;
  type: string; status: string; source: string | null; cpuName: string | null;
};
type Cpu = { id: string; name: string };

const STATUS_CLS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-green-100 text-green-700",
  retired: "bg-gray-100 text-gray-400",
};

export default function KnowledgeLibrary({ objects, cpus }: { objects: KO[]; cpus: Cpu[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: "", knowledge_type: "anatomy", cpu_id: "", summary: "", content: "" });

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => objects.filter(k =>
    (typeFilter === "all" || k.type === typeFilter) &&
    (!q || k.title.toLowerCase().includes(q) || (k.summary ?? "").toLowerCase().includes(q))
  ), [objects, typeFilter, q]);

  const byType = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of objects) m.set(k.type, (m.get(k.type) ?? 0) + 1);
    return m;
  }, [objects]);

  async function api(method: string, body?: unknown, id?: string) {
    setBusy(true); setError(null);
    const url = id ? `/api/knowledge-objects?id=${id}` : "/api/knowledge-objects";
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return false; }
    router.refresh();
    return true;
  }

  const input = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30";

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5">{error}</div>}

      {/* Type summary */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTypeFilter("all")}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${typeFilter === "all" ? "bg-teal-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
          All ({objects.length})
        </button>
        {[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => {
          const ui = KNOWLEDGE_TYPE_UI[t] ?? KNOWLEDGE_TYPE_UI.other;
          return (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${typeFilter === t ? "bg-teal-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              {ui.icon} {ui.label} ({n})
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search knowledge…"
          className="flex-1 border border-gray-200 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
        <button onClick={() => setShowNew(v => !v)}
          className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">
          {showNew ? "Cancel" : "+ New"}
        </button>
      </div>

      {showNew && (
        <div className="bg-white rounded-xl border border-teal-100 p-5 flex flex-col gap-3">
          <input className={input} placeholder="Title — e.g. Functional Anatomy of Human Gait"
            value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <div className="grid grid-cols-2 gap-2">
            <select className={input} value={form.knowledge_type} onChange={e => setForm(f => ({ ...f, knowledge_type: e.target.value }))}>
              {Object.entries(KNOWLEDGE_TYPE_UI).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
            <select className={input} value={form.cpu_id} onChange={e => setForm(f => ({ ...f, cpu_id: e.target.value }))}>
              <option value="">Linked CPU (optional)…</option>
              {cpus.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <input className={input} placeholder="One-line summary" value={form.summary}
            onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} />
          <textarea className={input} rows={6} placeholder="The knowledge content…" value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
          <button disabled={busy || !form.title.trim()}
            onClick={async () => { if (await api("POST", form)) { setShowNew(false); setForm({ title: "", knowledge_type: "anatomy", cpu_id: "", summary: "", content: "" }); } }}
            className="self-start bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
            Create knowledge object
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-3xl mb-2">📚</p>
          <p className="text-sm font-semibold text-gray-700">
            {objects.length === 0 ? "No knowledge objects yet" : "No matches"}
          </p>
          {objects.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Import a CPU document — its anatomy, physiology and reasoning sections become knowledge objects automatically.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {visible.map(k => {
            const ui = KNOWLEDGE_TYPE_UI[k.type] ?? KNOWLEDGE_TYPE_UI.other;
            const isOpen = open === k.id;
            return (
              <div key={k.id}>
                <button onClick={() => setOpen(isOpen ? null : k.id)}
                  className="w-full text-left px-5 py-3.5 hover:bg-gray-50/60 transition-colors flex items-center gap-3">
                  <span className="text-lg">{ui.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{k.title}
                      {k.code && <span className="ml-2 text-[10px] font-mono text-gray-300">{k.code}</span>}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate">
                      {ui.label}{k.cpuName ? ` · ${k.cpuName}` : ""}{k.source ? ` · ${k.source}` : ""}
                    </p>
                  </div>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded capitalize ${STATUS_CLS[k.status] ?? STATUS_CLS.draft}`}>{k.status}</span>
                  <span className="text-gray-300 text-xs">{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 bg-gray-50/40">
                    {k.summary && <p className="text-xs text-gray-600 italic mb-2">{k.summary}</p>}
                    <div className="flex gap-2">
                      {k.status !== "active" && (
                        <button disabled={busy} onClick={() => api("PATCH", { status: "active" }, k.id)}
                          className="text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg">
                          Publish
                        </button>
                      )}
                      {k.status === "active" && (
                        <button disabled={busy} onClick={() => api("PATCH", { status: "draft" }, k.id)}
                          className="text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg">
                          Unpublish
                        </button>
                      )}
                      <button disabled={busy} onClick={() => api("PATCH", { status: "retired" }, k.id)}
                        className="text-xs text-gray-400 hover:text-red-500 px-3 py-1.5 rounded-lg">Retire</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-gray-400">
        Published knowledge objects are searchable in the Clinical Library and citable by the AI assistant.
      </p>
    </div>
  );
}
