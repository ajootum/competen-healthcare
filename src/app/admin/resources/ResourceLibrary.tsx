"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Resource = { id: string; title: string; resource_type: string; url: string | null; is_active: boolean };
type Link = { resource_id: string; competency_id: string; framework_competencies: { name: string } | null };
type Comp = { id: string; name: string; framework: string; domain: string };

const TYPES = ["course", "policy", "video", "guideline", "simulation", "question_bank", "article", "reflection"];

export default function ResourceLibrary({ resources, links, competencies }: { resources: Resource[]; links: Link[]; competencies: Comp[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", resource_type: "course", url: "" });
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function api(method: string, body: object) {
    setBusy(true);
    const res = await fetch("/api/learning/resources", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) router.refresh(); else alert((await res.json().catch(() => ({}))).error ?? "Failed");
    return res.ok;
  }
  async function create() {
    if (!form.title.trim()) return;
    if (await api("POST", { ...form, title: form.title.trim() })) { setForm({ title: "", resource_type: "course", url: "" }); setAdding(false); }
  }
  async function del(r: Resource) {
    if (!confirm(`Delete resource "${r.title}"?`)) return;
    setBusy(true);
    await fetch(`/api/learning/resources?id=${r.id}`, { method: "DELETE" });
    setBusy(false); router.refresh();
  }

  const linksByResource = (rid: string) => links.filter(l => l.resource_id === rid);
  const filteredComps = search.trim()
    ? competencies.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 20)
    : competencies.slice(0, 20);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={() => setAdding(a => !a)} className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
          {adding ? "Cancel" : "+ New Resource"}
        </button>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3">
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Resource title *"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.resource_type} onChange={e => setForm(p => ({ ...p, resource_type: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
            <input value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))} placeholder="URL (optional)"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onClick={create} disabled={busy} className="self-end px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50">
            {busy ? "Saving…" : "Create"}
          </button>
        </div>
      )}

      {resources.map(r => {
        const rlinks = linksByResource(r.id);
        return (
          <div key={r.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-gray-50/60 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900 text-sm">{r.title}</p>
                <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded capitalize">{r.resource_type.replace("_", " ")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setLinkFor(linkFor === r.id ? null : r.id)} className="px-2.5 py-1 text-xs text-teal-600 border border-teal-200 rounded-lg hover:bg-teal-50 font-semibold">Link competencies</button>
                <button onClick={() => del(r)} className="px-2.5 py-1 text-xs text-red-500 border border-red-100 rounded-lg hover:bg-red-50">Delete</button>
              </div>
            </div>
            <div className="px-5 py-3">
              <div className="flex flex-wrap gap-1.5 mb-1">
                {rlinks.map(l => (
                  <span key={l.competency_id} className="group inline-flex items-center gap-1 text-xs bg-teal-50 border border-teal-100 text-teal-700 pl-2.5 pr-1.5 py-0.5 rounded-full">
                    {l.framework_competencies?.name ?? "—"}
                    <button onClick={() => api("PATCH", { id: r.id, action: "unlink", competency_id: l.competency_id })}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity leading-none px-0.5">×</button>
                  </span>
                ))}
                {!rlinks.length && <p className="text-[11px] text-gray-300 italic">Not linked to any competency yet</p>}
              </div>
              {linkFor === r.id && (
                <div className="mt-2 border-t border-gray-50 pt-2">
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search competencies…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs mb-2" />
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                    {filteredComps.map(c => (
                      <button key={c.id} onClick={() => api("PATCH", { id: r.id, action: "link", competency_id: c.id })}
                        className="text-[11px] bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full hover:bg-teal-50 hover:border-teal-200">
                        + {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {!resources.length && !adding && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-2xl mb-2">📚</p>
          <p className="text-gray-400 text-sm">No resources yet — add one and link it to the competencies it develops.</p>
        </div>
      )}
    </div>
  );
}
