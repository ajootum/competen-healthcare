"use client";
import { useMemo, useState } from "react";

// Dependency Explorer (NCP-000 Dependency Graph Service) — pick a configuration object and trace, client-side,
// both directions of the graph: what it depends on (upstream) and its impact / blast radius if it changes
// (downstream, transitive). The adjacency is computed server-side by loadDependencyGraph over the registry.

type Node = { key: string; label: string; type: string; status: string; safety?: string; cls?: string };
type Graph = { nodes: Node[]; dependsOn: Record<string, string[]>; dependents: Record<string, string[]> };

function closure(adj: Record<string, string[]>, start: string): Set<string> {
  const out = new Set<string>(); const stack = [start];
  while (stack.length) { const n = stack.pop()!; for (const nb of adj[n] ?? []) { if (nb !== start && !out.has(nb)) { out.add(nb); stack.push(nb); } } }
  return out;
}

const TYPE_TONE: Record<string, string> = { PLATFORM: "bg-gray-900 text-white", PRODUCT_SUITE: "bg-violet-50 text-violet-700", WORKSPACE: "bg-indigo-50 text-indigo-700", NAVIGATION_SECTION: "bg-sky-50 text-sky-700", MODULE: "bg-teal-50 text-teal-700", WIDGET: "bg-amber-50 text-amber-700" };
const tone = (t: string) => TYPE_TONE[t] ?? "bg-gray-100 text-gray-600";

export default function DependencyExplorer({ nodes, dependsOn, dependents }: Graph) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(nodes.map(n => [n.key, n])), [nodes]);
  const label = (k: string) => byKey.get(k)?.label ?? k;

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? nodes.filter(n => n.label.toLowerCase().includes(t) || n.key.toLowerCase().includes(t)) : nodes).slice(0, 250);
  }, [q, nodes]);

  const detail = useMemo(() => {
    if (!sel) return null;
    return { upDirect: dependsOn[sel] ?? [], downDirect: dependents[sel] ?? [], upAll: closure(dependsOn, sel).size, downAll: closure(dependents, sel).size };
  }, [sel, dependsOn, dependents]);

  const card = "bg-white rounded-xl border border-gray-200";
  const selNode = sel ? byKey.get(sel) : null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className={`${card} p-4`}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search configuration objects…" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
        <div className="space-y-1 max-h-[440px] overflow-y-auto">
          {shown.map(n => (
            <button key={n.key} onClick={() => setSel(n.key)} className={`w-full text-left flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${sel === n.key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}>
              <span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${tone(n.type)}`}>{n.type.replace(/_/g, " ")}</span>
              <span className="truncate text-gray-700">{n.label}</span>
            </button>
          ))}
          {!shown.length && <p className="text-xs text-gray-400 py-4 text-center">No objects match.</p>}
        </div>
      </div>

      <div className={`${card} p-4 lg:col-span-2`}>
        {!detail || !selNode ? <p className="text-sm text-gray-400 py-16 text-center">Select an object to trace its dependencies and impact.</p> : (
          <>
            <div className="flex items-center gap-2 mb-1"><span className={`text-[9px] font-semibold rounded px-1.5 py-0.5 ${tone(selNode.type)}`}>{selNode.type.replace(/_/g, " ")}</span><h3 className="text-sm font-semibold text-gray-900">{selNode.label}</h3></div>
            <p className="text-[10px] text-gray-400 font-mono mb-4">{sel}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-0.5">⬆ Depends on <span className="text-gray-400 font-normal">— {detail.upDirect.length} direct · {detail.upAll} transitive</span></p>
                <p className="text-[10px] text-gray-400 mb-2">What this object needs to function.</p>
                <div className="space-y-1">{detail.upDirect.length ? detail.upDirect.map(k => <div key={k} className="text-xs text-gray-600 flex items-center gap-1.5"><span className="text-gray-300">└</span><span className="truncate">{label(k)}</span></div>) : <p className="text-[11px] text-gray-400">Root object — depends on nothing.</p>}</div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-0.5">⬇ Impact if changed <span className="text-gray-400 font-normal">— {detail.downDirect.length} direct · {detail.downAll} transitive</span></p>
                <p className="text-[10px] text-gray-400 mb-2">What is affected if this object changes or is disabled.</p>
                {detail.downAll > 0 && <span className={`text-[10px] font-semibold rounded px-2 py-1 mb-2 inline-block ${detail.downAll >= 10 ? "bg-rose-50 text-rose-700" : detail.downAll >= 3 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{detail.downAll} object(s) in the blast radius</span>}
                <div className="space-y-1">{detail.downDirect.length ? detail.downDirect.slice(0, 40).map(k => <div key={k} className="text-xs text-gray-600 flex items-center gap-1.5"><span className="text-gray-300">└</span><span className="truncate">{label(k)}</span></div>) : <p className="text-[11px] text-emerald-600">Leaf object — nothing depends on it; safe to change.</p>}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
