import { fetchCmoSuite, STATUS_TONE } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Pill, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-014 Competency Standards Library — the authoritative repository of competency standards, frameworks and
// reference models. Lens over cycle_frameworks + the published framework/standard artifacts (cmo_publications).
/* eslint-disable @typescript-eslint/no-explicit-any */
const fmtD = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }); } catch { return "—"; } };

export default async function StandardsPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-014 · Competency Office" title="Competency Standards Library" sub="The centralized enterprise repository for competency standards, frameworks, proficiency levels and reference models — the authoritative source for competency management." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="the Standards Library" /></div>;

  const frameworks = d.frameworks;
  const standards = d.publications.filter((p: any) => ["framework", "standard"].includes(p.artifact_type));
  const publishedStd = standards.filter((s: any) => s.status === "published");
  const avgScore = frameworks.filter((f: any) => f.framework_score != null).length ? Math.round(frameworks.reduce((a: number, f: any) => a + Number(f.framework_score || 0), 0) / frameworks.filter((f: any) => f.framework_score != null).length) : null;
  const byStatus = ["published", "in_review", "approved", "draft", "scheduled"].map(s => ({ label: s.replace(/_/g, " "), n: standards.filter((x: any) => x.status === s).length })).filter(x => x.n > 0);

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Standards & Frameworks" value={standards.length} sub="in library" />
        <Kpi label="Published" value={publishedStd.length} sub="authoritative" tone="text-[var(--cmp-text-success)]" />
        <Kpi label="Frameworks in Cycle" value={frameworks.length} sub="applied" />
        <Kpi label="Avg Framework Score" value={avgScore != null ? `${avgScore}%` : "—"} sub="attainment" />
        <Kpi label="In Review" value={standards.filter((s: any) => s.status === "in_review").length} sub="workflow" tone="text-[var(--cmp-text-warning)]" />
        <Kpi label="Versions" value={new Set(standards.map((s: any) => s.version)).size} sub="tracked" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Library by Status">
          <div className="space-y-2 text-[12px]">{byStatus.map((s) => (
            <div key={s.label} className="flex items-center gap-2"><Pill text={s.label} tone={STATUS_TONE[s.label.replace(/ /g, "_")] ?? "slate"} /><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-teal-500" style={{ width: `${(s.n / Math.max(1, standards.length)) * 100}%` }} /></div><span className="font-semibold text-gray-900 tabular-nums w-6 text-right">{s.n}</span></div>
          ))}</div>
        </Card>

        <Card title="Standards & Frameworks" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">{standards.length}</span>}>
          {standards.length ? <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Standard / Framework</span><span className="w-24">Type</span><span className="w-16">Version</span><span className="w-24">Target</span><span className="w-16">Published</span><span className="w-24 text-right">Status</span></div>
            {standards.map((s: any) => (
              <div key={s.id} className="flex items-center px-1 py-1 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{s.name}</span><span className="w-24 text-gray-500 capitalize text-[11px]">{s.artifact_type}</span><span className="w-16 text-gray-400 tabular-nums">v{s.version}</span><span className="w-24 text-gray-500 capitalize text-[11px]">{s.target}</span><span className="w-16 text-gray-400 text-[11px]">{fmtD(s.published_at)}</span><span className="w-24 text-right"><Pill text={s.status} tone={STATUS_TONE[s.status]} /></span></div>
            ))}
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No standards published yet — publish frameworks/standards from CMO-015.</p>}
        </Card>
      </div>

      <Foot>CMO-014 — standards library over the published framework/standard artifacts (cmo_publications) + the applied cycle_frameworks (real framework scores). Repository, versions and status are real; the taxonomy manager, standards-mapping engine and semantic search are the next phase. Publishing runs through CMO-015; external mapping through CMO-016.</Foot>
    </div>
  );
}
