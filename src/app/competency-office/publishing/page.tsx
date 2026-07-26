import { fetchCmoSuite, STATUS_TONE } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Donut, Pill, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-015 Competency Publishing Centre — governed release of frameworks, standards, blueprints, pathways and packages.
/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_COLORS: Record<string, string> = { draft: "#94a3b8", in_review: "#f59e0b", approved: "#3b82f6", published: "#22c55e", scheduled: "#a855f7", rolled_back: "#ef4444" };
const fmtD = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return "—"; } };

export default async function PublishingPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-015 · Competency Office" title="Competency Publishing Centre" sub="Govern the release of competency frameworks, standards, assessment blueprints, learning pathways and packages to tenants, roles and workspaces." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="the Publishing Centre" part="part 2" /></div>;

  const pubs = d.publications;
  const STATUSES = ["draft", "in_review", "approved", "scheduled", "published", "rolled_back"];
  const byStatus = STATUSES.map(s => ({ status: s, n: pubs.filter((p: any) => p.status === s).length })).filter(x => x.n > 0);
  const byType = Object.entries(pubs.reduce((acc: Record<string, number>, p: any) => { acc[p.artifact_type] = (acc[p.artifact_type] ?? 0) + 1; return acc; }, {})).map(([label, n]) => ({ label, n: n as number })).sort((a, b) => b.n - a.n);

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Artifacts" value={pubs.length} sub="in pipeline" />
        <Kpi label="Published" value={pubs.filter((p: any) => p.status === "published").length} sub="live" tone="text-emerald-600" />
        <Kpi label="In Review" value={pubs.filter((p: any) => p.status === "in_review").length} sub="workflow" tone="text-amber-600" />
        <Kpi label="Approved" value={pubs.filter((p: any) => p.status === "approved").length} sub="ready" tone="text-blue-600" />
        <Kpi label="Scheduled" value={pubs.filter((p: any) => p.status === "scheduled").length} sub="release" />
        <Kpi label="Artifact Types" value={byType.length} sub="package kinds" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Release Pipeline">
          <div className="flex items-center gap-3">
            <Donut segs={byStatus.map(s => ({ n: s.n, color: STATUS_COLORS[s.status] }))} total={pubs.length} centre={pubs.length} sub="artifacts" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">{byStatus.map(s => <div key={s.status} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[s.status] }} /><span className="text-gray-600 flex-1 capitalize">{s.status.replace(/_/g, " ")}</span><span className="font-semibold text-gray-900">{s.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Publications" className="xl:col-span-2">
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Artifact</span><span className="w-24">Type</span><span className="w-16">Version</span><span className="w-24">Target</span><span className="w-16">Published</span><span className="w-24 text-right">Status</span></div>
            {pubs.map((p: any) => (
              <div key={p.id} className="flex items-center px-1 py-1 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{p.name}</span><span className="w-24 text-gray-500 capitalize text-[11px]">{p.artifact_type}</span><span className="w-16 text-gray-400 tabular-nums">v{p.version}</span><span className="w-24 text-gray-500 capitalize text-[11px]">{p.target}</span><span className="w-16 text-gray-400 text-[11px]">{fmtD(p.published_at)}</span><span className="w-24 text-right"><Pill text={p.status} tone={STATUS_TONE[p.status]} /></span></div>
            ))}
          </div>
        </Card>
      </div>

      <Foot>CMO-015 — publishing over cmo_publications. Release pipeline, versions and targets are real; the Draft→Review→Approve→Publish→Rollback workflow engine, dependency validation and downstream auto-distribution are the next phase.</Foot>
    </div>
  );
}
