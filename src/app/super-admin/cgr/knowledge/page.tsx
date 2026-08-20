import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadKnowledgeEvidence } from "@/lib/cgr/knowledge";
import { Kpi } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

// CGR-012 — Competency Governance Knowledge Repository & Evidence Intelligence. The governance evidence lens:
// knowledge inventory, the evidence-to-competency COVERAGE metric (via CPU), and the governed knowledge graph.
// Repository authoring + browser cross-link to CKP; assessment-evidence integrity to CAPA. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const scoreTone = (v: number) => (v >= 75 ? "text-[var(--cmp-text-success)]" : v >= 45 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");

export default async function KnowledgeEvidencePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.quality.regulation.view");

  const d = await loadKnowledgeEvidence(admin) as any;
  const k = d.kpis;
  const invMax = Math.max(1, ...d.inventory.map((x: any) => x.count));
  const relMax = Math.max(1, ...d.relationships.map((x: any) => x.count));
  const cpuMax = Math.max(1, ...d.topCpus.map((x: any) => x.count));

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-012 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Knowledge Repository &amp; Evidence Intelligence</h1>
          <p className="text-gray-500 text-sm mt-0.5">What evidence supports each competency, how reliable it is, and when it should be reviewed — the governance evidence lens: inventory, competency evidence coverage, and the knowledge graph.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/ckp/repository" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Knowledge browser →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-500">No knowledge objects or evidence links recorded yet. Authoring knowledge objects happens in the <Link href="/super-admin/ckp/repository" className="text-[var(--cmp-text-success)] hover:underline">Clinical Knowledge Repository</Link>; once they link to CPUs, competency evidence coverage computes here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Knowledge objects" value={k.objects} sub="in the repository" />
            <Kpi label="Evidence objects" value={k.evidenceObjs} sub="typed 'evidence'" />
            <Kpi label="Evidence coverage" value={`${k.coveragePct}%`} sub="competencies evidence-linked" tone={scoreTone(k.coveragePct)} />
            <Kpi label="Linked competencies" value={k.linkedComps} sub={`of ${k.totalComps}`} />
            <Kpi label="Knowledge edges" value={k.edges} sub="governed graph" />
            <Kpi label="Traceability" value={`${k.sourcePct}%`} sub="have a source ref" tone={k.sourcePct >= 75 ? "text-[var(--cmp-text-success)]" : "text-gray-900"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Competency evidence coverage hero */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Competency evidence coverage</p>
              <div className="flex items-center gap-4">
                <div className="shrink-0 relative w-20 h-20">
                  <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f3f4f6" strokeWidth="3.5" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeDasharray={`${(k.coveragePct / 100) * 97.4} 97.4`} className={scoreTone(k.coveragePct)} strokeLinecap="round" />
                  </svg>
                  <div className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${scoreTone(k.coveragePct)}`}>{k.coveragePct}%</div>
                </div>
                <div className="text-[11px] text-gray-500 space-y-1">
                  <p><span className="font-bold text-gray-700 tabular-nums">{k.linkedComps}</span> of {k.totalComps} competencies are backed by a knowledge object (via their CPU).</p>
                  <p className="text-gray-500">{k.coverageOfGrouped}% of the {k.groupedComps} CPU-grouped competencies. Ungrouped competencies can&apos;t yet carry evidence links.</p>
                </div>
              </div>
            </div>

            {/* Knowledge inventory by type */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Knowledge inventory by type</p>
              {d.inventory.length === 0 ? (
                <p className="text-[12px] text-gray-500">No knowledge objects yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                  {d.inventory.map((x: any) => (
                    <div key={x.type} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600 w-32 shrink-0 truncate">{x.label}</span>
                      <div className="flex-1 h-2 rounded bg-gray-50 overflow-hidden"><div className={`h-full rounded ${x.type === "evidence" ? "bg-[var(--cmp-color-success)]" : "bg-gray-300"}`} style={{ width: `${(x.count / invMax) * 100}%` }} /></div>
                      <span className="text-[11px] font-bold text-gray-600 tabular-nums w-7 text-right">{x.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top knowledge CPUs */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Best-evidenced practice units</p>
              {d.topCpus.length === 0 ? (
                <p className="text-[12px] text-gray-500">No knowledge objects linked to practice units yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {d.topCpus.map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600 flex-1 min-w-0 truncate">{c.name}</span>
                      <div className="w-28 h-2 rounded bg-gray-50 overflow-hidden"><div className="h-full bg-[var(--cmp-color-success)] rounded" style={{ width: `${(c.count / cpuMax) * 100}%` }} /></div>
                      <span className="text-[11px] font-bold text-gray-600 tabular-nums w-6 text-right">{c.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Knowledge graph relationships */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Governed knowledge graph <span className="font-normal normal-case text-gray-500">— {k.edges} edges</span></p>
              {d.relationships.length === 0 ? (
                <p className="text-[12px] text-gray-500">No knowledge-graph edges recorded. The <Link href="/super-admin/studio/dependencies" className="text-[var(--cmp-text-success)] hover:underline">dependency graph</Link> builds these links.</p>
              ) : (
                <div className="space-y-1.5">
                  {d.relationships.map((r: any) => (
                    <div key={r.rel} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600 w-28 shrink-0 capitalize">{r.rel.replace(/_/g, " ")}</span>
                      <div className="flex-1 h-2 rounded bg-gray-50 overflow-hidden"><div className="h-full bg-indigo-400 rounded" style={{ width: `${(r.count / relMax) * 100}%` }} /></div>
                      <span className="text-[11px] font-bold text-gray-600 tabular-nums w-7 text-right">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="text-[11px] text-gray-500 leading-relaxed">Every figure is real: the inventory and traceability come from the knowledge-object repository, competency evidence coverage is computed by joining knowledge objects to competencies through their practice units, and the graph is the governed knowledge edges. This is the governance evidence lens — authoring knowledge objects and the full knowledge browser live in the <Link href="/super-admin/ckp/repository" className="text-[var(--cmp-text-success)] hover:underline">Clinical Knowledge Repository</Link>, and assessment-evidence integrity in the <Link href="/super-admin/assurance/evidence" className="text-[var(--cmp-text-success)] hover:underline">CAPA Evidence Centre</Link>. Per the CGR mandate, AI may search, summarise and flag outdated evidence but never approves evidence validity or determines clinical appropriateness.</p>
        </div>
      )}
    </div>
  );
}
