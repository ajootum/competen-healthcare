import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRepository } from "@/lib/super-admin/ckp-repository";
import RepositoryBuilder from "./RepositoryBuilder";

export const dynamic = "force-dynamic";

// Clinical Knowledge Repository (CKP-001.3) — the knowledge warehouse. CKOs, CPUs,
// evidence, guidelines, policies, cases; the knowledge graph and terminology.
// Live counts; "most accessed" needs usage telemetry → honest state. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };
const STATUS_BADGE: Record<string, string> = { draft: "bg-gray-100 text-gray-600", active: "bg-green-50 text-green-700", retired: "bg-gray-100 text-gray-400" };

export default async function ClinicalKnowledgeRepository() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const r = await loadRepository(admin);
  const k = r.kpis;

  const kpiCards = [
    { label: "Knowledge Objects", value: fmt(k.knowledgeObjects), icon: "🧠", iconBg: "bg-teal-50" },
    { label: "CPUs", value: fmt(k.cpus), icon: "🧩", iconBg: "bg-blue-50", sub: `${k.cpusPublished} published` },
    { label: "Evidence", value: fmt(k.evidence), icon: "🔬", iconBg: "bg-violet-50" },
    { label: "Guidelines", value: fmt(k.guidelines), icon: "📖", iconBg: "bg-amber-50" },
    { label: "Policies", value: fmt(k.policies), icon: "📋", iconBg: "bg-rose-50" },
    { label: "Clinical Cases", value: fmt(k.cases), icon: "🩹", iconBg: "bg-orange-50" },
    { label: "Taxonomy Terms", value: fmt(k.terms), icon: "🏷️", iconBg: "bg-sky-50" },
    { label: "Tags", value: fmt(k.tags), icon: "🔖", iconBg: "bg-gray-50" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ckp" className="hover:text-teal-700">Clinical Knowledge Platform</Link><span>/</span><span className="text-gray-600">Clinical Knowledge Repository</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Clinical Knowledge Repository</h1>
        <p className="text-sm text-gray-500">The central warehouse for all clinical knowledge — searchable, linked and versioned.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className="text-2xl font-bold mt-1.5 tabular-nums text-gray-900">{c.value}</p>
            {(c as any).sub && <p className="text-[10px] text-gray-400 mt-0.5">{(c as any).sub}</p>}
          </div>
        ))}
      </div>

      {/* Search bar (honest — routes to the AI assistant which does RAG search) */}
      <Link href="/super-admin/assistant" className={`${card} px-4 py-3 flex items-center gap-3 hover:border-teal-300 transition-colors`}>
        <span className="text-gray-400">🔍</span>
        <span className="text-sm text-gray-400 flex-1">Search knowledge — natural language, semantic and AI search over {fmt(k.knowledgeObjects + k.cpus)} objects…</span>
        <span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">AI Assistant →</span>
      </Link>

      {/* Real in-place repository builder — creates warehouse assets via the content APIs */}
      <RepositoryBuilder />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Repository categories */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Repository Categories</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {r.categories.map((c: any) => (
              <Link key={c.label} href={c.href} className="rounded-lg border border-gray-100 p-3 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                <div className="flex items-center justify-between"><span className="text-lg">{c.icon}</span><span className="text-lg font-bold text-gray-900 tabular-nums">{fmt(c.n)}</span></div>
                <p className="text-[10px] text-gray-500 mt-1 leading-tight">{c.label}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Knowledge graph insights */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Knowledge Graph</h2>
            <Link href="/super-admin/knowledge-graph" className="text-xs text-teal-700 hover:underline">View graph →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[["Nodes", r.graph.nodes], ["Relationships", r.graph.relationships], ["Rel. Types", r.graph.relationshipTypes], ["Semantic Index", r.graph.embeddings]].map(([l, n]) => (
              <div key={l as string} className="rounded-lg border border-gray-100 p-3 text-center"><p className="text-xl font-bold text-gray-900 tabular-nums">{fmt(n as number)}</p><p className="text-[10px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Nodes and relationships are live from the knowledge graph; the semantic index powers AI search. Cluster detection activates with the graph analytics job.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* CKO by type */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Knowledge Objects by Type</h2>
          {r.koByType.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No knowledge objects yet.</p> : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {r.koByType.map((t: any) => (
                <div key={t.type} className="flex items-center justify-between text-sm py-0.5">
                  <span className="text-gray-600 capitalize truncate">{t.type}</span>
                  <span className="text-gray-500 tabular-nums shrink-0">{fmt(t.n)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent knowledge */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Recent Knowledge</h2>
            <span className="text-[10px] text-gray-400">Most-accessed activates with usage telemetry</span>
          </div>
          {r.recent.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No knowledge objects yet.</p> : (
            <div className="divide-y divide-gray-50">
              {r.recent.map((o: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <span className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center text-sm shrink-0">🧠</span>
                  <div className="min-w-0 flex-1"><p className="text-sm text-gray-800 truncate">{o.title}</p><p className="text-[10px] text-gray-400 capitalize">{o.type}</p></div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded shrink-0 ${STATUS_BADGE[o.status] ?? "bg-gray-100 text-gray-600"}`}>{o.status}</span>
                  <span className="text-[10px] text-gray-400 shrink-0 tabular-nums w-16 text-right">{relTime(o.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The repository is Competen&apos;s clinical knowledge warehouse — GitHub meets UpToDate meets Confluence. The Repository Builder adds real knowledge objects, guidelines and policies in-place via the content APIs; every object is searchable, linked in the knowledge graph and versioned. Counts, graph shape and recent knowledge are live; access-based &quot;most accessed&quot; ranking arrives with usage telemetry.</p>
    </div>
  );
}
