import { requireHqContext } from "@/lib/hq/context";
import { loadAiKnowledge } from "@/lib/ai/services";
import { Head, Tabs, Card, Stat, Pill, Bars, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// AIS-003 Knowledge & Semantic Search Platform — the RAG knowledge-source registry that grounds every AI response.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fmtT = (t: string | null) => { if (!t) return "not indexed"; try { const h = Math.round((Date.now() - new Date(t).getTime()) / 3600000); return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; } catch { return "—"; } };

export default async function KnowledgePage() {
  const { admin } = await requireHqContext("hq.platform.ai.view");
  const d = await loadAiKnowledge(admin) as any;
  const head = <Head code="AIS-003 · AI Services Platform" title="Knowledge & Semantic Search Platform" sub="The enterprise knowledge sources that power Retrieval-Augmented Generation — governed, indexed and permission-filtered so every AI answer is grounded and citable." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="003" /><Provision /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="003" />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Stat label="Knowledge Sources" value={k.total} sub={`${k.indexed} indexed`} />
        <Stat label="Documents" value={k.documents.toLocaleString()} sub="retrievable" tone="text-violet-700" />
        <Stat label="Index Coverage" value={`${k.coverage}%`} sub="sources indexed" tone={k.coverage >= 80 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
        <Stat label="Indexing" value={k.indexing} sub="in progress" tone={k.indexing ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Stat label="Domains" value={d.byDomain.length} sub="knowledge types" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Knowledge Sources" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">by document count</span>}>
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Source</span><span className="w-28">Domain</span><span className="w-40">System</span><span className="w-20 text-right">Docs</span><span className="w-24 text-right">Indexed</span></div>
            {d.sources.map((s: any) => (
              <div key={s.id} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{s.name}</span><span className="w-28"><Pill text={s.domain} tone={s.domain === "structured" ? "blue" : s.domain === "configuration" ? "violet" : "teal"} /></span><span className="w-40 text-gray-400 text-[10px] font-mono truncate">{s.source_type}</span><span className="w-20 text-right text-gray-900 tabular-nums font-semibold">{Number(s.doc_count).toLocaleString()}</span><span className="w-24 text-right text-[11px]">{s.indexed ? <span className="text-[var(--cmp-text-success)]">{fmtT(s.last_indexed)}</span> : <span className="text-[var(--cmp-text-warning)]">indexing…</span>}</span></div>
            ))}
          </div>
        </Card>

        <Card title="By Domain">
          <Bars rows={d.byDomain.map((x: any) => ({ label: x.label, n: x.n }))} />
          <p className="text-[10px] text-gray-400 mt-3">structured = queryable stores · unstructured = documents/policies (embedded) · configuration = config registry. All retrieval is tenant-isolated and permission-filtered.</p>
        </Card>
      </div>

      <Foot>AIS-003 — the knowledge-source registry over ais_knowledge_sources (RAG). Source inventory, document counts and index status are real config pointing at the platform&apos;s actual stores; the embedding pipeline, vector index and semantic retrieval are backend engineering in src/lib/ai/* (epic).</Foot>
    </div>
  );
}
