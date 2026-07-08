"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Taxonomy = { id: string; kind: string; label: string };
type Term = { id: string; taxonomy_id: string; value: string; code: string | null; sort_order: number };
type Tag = { id: string; name: string; category: string };

const TAG_CAT_CLS: Record<string, string> = {
  clinical:   "bg-blue-100 text-blue-700",
  safety:     "bg-red-100 text-red-700",
  education:  "bg-teal-100 text-teal-700",
  governance: "bg-violet-100 text-violet-700",
  general:    "bg-gray-100 text-gray-600",
};

export default function MetadataManager({ taxonomies, terms, tags }: { taxonomies: Taxonomy[]; terms: Term[]; tags: Tag[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"taxonomy" | "tags">("taxonomy");

  async function post(body: object) {
    setBusy(true);
    const res = await fetch("/api/metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) router.refresh(); else alert((await res.json().catch(() => ({}))).error ?? "Failed");
  }
  async function del(kind: string, id: string) {
    setBusy(true);
    await fetch(`/api/metadata?kind=${kind}&id=${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  const tagsByCat = tags.reduce((acc, t) => { (acc[t.category] ??= []).push(t); return acc; }, {} as Record<string, Tag[]>);

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {([["taxonomy", "Controlled Vocabularies"], ["tags", "Tags"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${tab === k ? "bg-rose-600 text-white" : "text-gray-500 hover:bg-gray-100"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "taxonomy" && (
        <div className="flex flex-col gap-4">
          {taxonomies.map(tax => {
            const items = terms.filter(t => t.taxonomy_id === tax.id).sort((a, b) => a.sort_order - b.sort_order);
            return (
              <div key={tax.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50/60 border-b border-gray-100 flex items-center justify-between">
                  <p className="font-semibold text-gray-900 text-sm">{tax.label}</p>
                  <span className="text-[10px] text-gray-400 font-mono">{tax.kind}</span>
                </div>
                <div className="px-5 py-3">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {items.map(t => (
                      <span key={t.id} className="group inline-flex items-center gap-1 text-xs bg-gray-50 border border-gray-100 text-gray-700 pl-2.5 pr-1.5 py-0.5 rounded-full">
                        {t.value}
                        <button onClick={() => del("term", t.id)} disabled={busy}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity leading-none px-0.5">×</button>
                      </span>
                    ))}
                    {!items.length && <p className="text-[11px] text-gray-300 italic">No terms</p>}
                  </div>
                  <button onClick={() => { const v = prompt(`Add term to "${tax.label}":`); if (v?.trim()) post({ type: "term", taxonomy_id: tax.id, value: v.trim() }); }}
                    className="text-[11px] text-rose-600 font-semibold hover:underline">+ Add term</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "tags" && (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex flex-col gap-4">
            {["clinical", "safety", "education", "governance", "general"].map(cat => (
              <div key={cat}>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{cat}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(tagsByCat[cat] ?? []).map(t => (
                    <span key={t.id} className={`group inline-flex items-center gap-1 text-xs pl-2.5 pr-1.5 py-0.5 rounded-full ${TAG_CAT_CLS[cat]}`}>
                      {t.name}
                      <button onClick={() => del("tag", t.id)} disabled={busy}
                        className="opacity-0 group-hover:opacity-100 hover:opacity-100 opacity-60 leading-none px-0.5">×</button>
                    </span>
                  ))}
                  {!(tagsByCat[cat] ?? []).length && <p className="text-[11px] text-gray-300 italic">No tags</p>}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => { const n = prompt("New tag name:"); if (!n?.trim()) return; const c = prompt("Category (clinical/safety/education/governance/general):", "general"); post({ type: "tag", name: n.trim(), category: c?.trim() || "general" }); }}
            className="mt-4 px-3 py-1.5 text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-100 rounded-lg hover:bg-rose-100">
            + New Tag
          </button>
        </div>
      )}
    </div>
  );
}
