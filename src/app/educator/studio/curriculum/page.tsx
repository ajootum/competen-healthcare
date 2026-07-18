import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../../ui";
import { SECTION_BY_ID } from "../sections";
import SectionGrid from "../SectionGrid";
import GenerateRecs from "./GenerateRecs";

// Curriculum & Framework Design — the Curriculum Intelligence Engine (redesign
// spec). Live KPIs, framework explorer, structural relationship map, rule-
// derived AI intelligence, competency coverage matrix, governance lifecycle,
// standards completeness, publishing sync and version history. Everything is
// computed from real records; unbacked items (drag-drop graph editor, external
// standards catalogues) are stated honestly.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ fw?: string }>;

const PUB_CLS: Record<string, string> = {
  published: "bg-green-100 text-green-700", draft: "bg-gray-100 text-gray-600",
  in_review: "bg-amber-100 text-amber-700", archived: "bg-gray-100 text-gray-400", retired: "bg-gray-100 text-gray-400",
};
const LIFECYCLE = ["Draft", "Peer Review", "Committee", "Quality", "Approved", "Published", "Archived"];

export default async function CurriculumEnginePage({ searchParams }: { searchParams: SearchParams }) {
  const { admin } = await requireEducatorAccess();
  const { fw } = await searchParams;
  const section = SECTION_BY_ID.get("curriculum")!;

  const [
    { data: frameworks }, { data: allComps }, { data: cpus }, { count: courses },
    { count: knowledge }, { data: resLinks }, { data: skills }, { data: scores },
    { data: decisions }, { data: simCases }, { data: activity }, { data: reviews },
  ] = await Promise.all([
    admin.from("frameworks").select("id, name, library, pub_status, version_num, review_date, framework_domains(id, name)").order("name").limit(60),
    admin.from("framework_competencies").select("id, name, domain_id, cpu_id").limit(2000),
    admin.from("clinical_practice_units").select("id, pub_status").limit(500),
    admin.from("courses").select("id", { count: "exact", head: true }),
    admin.from("knowledge_objects").select("id", { count: "exact", head: true }).neq("status", "retired"),
    admin.from("resource_competencies").select("competency_id"),
    admin.from("competency_skills").select("id, competency_id").eq("is_active", true).limit(3000),
    admin.from("assessments").select("competency_id").eq("status", "complete").not("score", "is", null).limit(3000),
    admin.from("competency_decisions").select("competency_id").limit(4000),
    admin.from("clinical_cases").select("cpu_id").neq("status", "retired"),
    admin.from("audit_log").select("actor_name, action, entity_name, created_at").in("action", ["finalize_decisions", "clone_cpu", "educator_validate", "conduct_audit", "save_report"]).order("created_at", { ascending: false }).limit(5),
    admin.from("frameworks").select("id, name, review_date, pub_status").not("review_date", "is", null).order("review_date").limit(6),
  ]);

  const fwList = (frameworks ?? []) as unknown as { id: string; name: string; library: string; pub_status: string | null; version_num: number | null; review_date: string | null; framework_domains: { id: string; name: string }[] }[];
  const selected = fw ? fwList.find(f => f.id === fw) ?? fwList[0] : fwList[0];

  // Coverage sets
  const skillIds = (skills ?? []).map(s => s.id);
  const { data: cls } = skillIds.length ? await admin.from("skill_checklists").select("skill_id").in("skill_id", skillIds).eq("is_active", true) : { data: [] };
  const checklistSkillIds = new Set((cls ?? []).map(c => c.skill_id));
  const compHasChecklist = new Set((skills ?? []).filter(s => checklistSkillIds.has(s.id)).map(s => s.competency_id));
  const hasResource = new Set((resLinks ?? []).map(r => r.competency_id));
  const hasAssessed = new Set((scores ?? []).map(s => s.competency_id));
  const hasPassport = new Set((decisions ?? []).map(d => d.competency_id));
  const cpuHasSim = new Set((simCases ?? []).map(c => c.cpu_id));
  const comps = (allComps ?? []) as { id: string; name: string; domain_id: string; cpu_id: string | null }[];

  // Global pipeline
  const pipe = { draft: 0, review: 0, published: 0, retired: 0 };
  for (const f of fwList) { const s = (f.pub_status ?? "draft"); if (s === "published") pipe.published++; else if (["archived", "retired"].includes(s)) pipe.retired++; else if (["in_review", "peer_review", "review"].includes(s)) pipe.review++; else pipe.draft++; }
  for (const c of cpus ?? []) { const s = (c.pub_status ?? "draft"); if (s === "published") pipe.published++; else if (s === "draft") pipe.draft++; }

  // AI intelligence — rule-derived
  const nameCount = new Map<string, number>();
  for (const c of comps) nameCount.set(c.name.trim().toLowerCase(), (nameCount.get(c.name.trim().toLowerCase()) ?? 0) + 1);
  const duplicates = [...nameCount.values()].filter(n => n > 1).length;
  const missingAssessment = comps.filter(c => !hasAssessed.has(c.id)).length;
  const missingChecklist = comps.filter(c => !compHasChecklist.has(c.id)).length;
  const missingLearning = comps.filter(c => !hasResource.has(c.id)).length;
  const missingSim = comps.filter(c => !c.cpu_id || !cpuHasSim.has(c.cpu_id)).length;
  const notInPassport = comps.filter(c => !hasPassport.has(c.id)).length;

  const intel = [
    { icon: "🔁", label: "Duplicate competency names", n: duplicates },
    { icon: "📝", label: "Competencies with no assessment", n: missingAssessment },
    { icon: "📋", label: "Competencies with no checklist", n: missingChecklist },
    { icon: "📚", label: "Competencies with no learning resource", n: missingLearning },
    { icon: "🧪", label: "Competencies with no simulation", n: missingSim },
    { icon: "🛂", label: "Competencies not yet in a passport", n: notInPassport },
  ].filter(x => x.n > 0);

  // Coverage matrix for selected framework's domains
  const domainRows = (selected?.framework_domains ?? []).map(d => {
    const dc = comps.filter(c => c.domain_id === d.id);
    const dim = (test: (id: string) => boolean) => dc.length ? dc.filter(c => test(c.id)).length / dc.length : 0;
    const cov = {
      content: dim(id => hasResource.has(id)),
      assessment: dim(id => hasAssessed.has(id)),
      simulation: dc.length ? dc.filter(c => c.cpu_id && cpuHasSim.has(c.cpu_id)).length / dc.length : 0,
      checklist: dim(id => compHasChecklist.has(id)),
      passport: dim(id => hasPassport.has(id)),
    };
    const full = Object.values(cov).every(v => v >= 1);
    const any = Object.values(cov).some(v => v > 0);
    return { name: d.name, n: dc.length, cov, status: dc.length === 0 ? "empty" : full ? "complete" : any ? "partial" : "gap" };
  });

  // Health score = mean coverage across all competencies (5 dims)
  const covScore = comps.length
    ? Math.round(([hasResource, hasAssessed, hasPassport].reduce((s, set) => s + comps.filter(c => set.has(c.id)).length, 0)
        + comps.filter(c => compHasChecklist.has(c.id)).length
        + comps.filter(c => c.cpu_id && cpuHasSim.has(c.cpu_id)).length) / (comps.length * 5) * 100)
    : 0;

  const Cell = ({ v }: { v: number }) => (
    <span className={v >= 1 ? "text-green-500" : v > 0 ? "text-amber-500" : "text-red-400"}>{v >= 1 ? "✓" : v > 0 ? "◐" : "✕"}</span>
  );
  const ACT: Record<string, string> = { finalize_decisions: "ran a decision process", clone_cpu: "cloned a CPU", educator_validate: "validated a score", conduct_audit: "conducted an audit", save_report: "saved a report" };

  return (
    <div className="max-w-[1150px]">
      <Link href="/educator/studio" className="text-xs text-gray-400 hover:text-gray-600">← Education Studio</Link>
      <div className="flex items-start justify-between gap-3 flex-wrap mt-1">
        <EduHeader icon="🏛️" title="Curriculum & Framework Design" sub="The Curriculum Intelligence Engine — programmes, frameworks, CPUs, coverage, governance and publishing, all live." />
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {[["＋ Framework", "/educator/studio/frameworks"], ["＋ CPU", "/educator/studio/cpus"], ["＋ Checklist", "/educator/studio/checklists"], ["Gap Analysis", "/educator/studio/gaps"], ["Versions", "/educator/studio/versions"], ["Validate", "/educator/validations"]].map(([l, h]) => (
          <Link key={l} href={h} className="text-[11px] font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-purple-300 transition-colors">{l}</Link>
        ))}
        {["New Programme", "Import", "Export", "Compare"].map(l => (
          <span key={l} className="text-[11px] text-gray-300 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 select-none">{l} <span className="text-[8px] font-bold uppercase">soon</span></span>
        ))}
      </div>

      {/* KPIs */}
      <StatTiles cols="grid-cols-3 md:grid-cols-5 xl:grid-cols-8" tiles={[
        { label: "Frameworks", value: String(fwList.length), sub: `${pipe.published} published` },
        { label: "Domains", value: String(fwList.reduce((s, f) => s + f.framework_domains.length, 0)) },
        { label: "Competencies", value: String(comps.length) },
        { label: "CPUs", value: String((cpus ?? []).length) },
        { label: "Knowledge Objects", value: String(knowledge ?? 0) },
        { label: "Courses", value: String(courses ?? 0) },
        { label: "Validation Issues", value: String(intel.reduce((s, x) => s + x.n, 0)), alert: intel.length > 0 },
        { label: "Coverage Score", value: `${covScore}%`, sub: "5-dim mean" },
      ]} />

      <div className="grid xl:grid-cols-[260px_minmax(0,1fr)_300px] gap-4 mb-4">
        {/* Framework Explorer */}
        <Card title="Framework Explorer">
          <div className="space-y-1 max-h-[420px] overflow-y-auto">
            {fwList.map(f => (
              <Link key={f.id} href={`/educator/studio/curriculum?fw=${f.id}`}
                className={`block rounded-lg px-2.5 py-1.5 text-[11px] ${selected?.id === f.id ? "bg-purple-50 border border-purple-200" : "hover:bg-gray-50"}`}>
                <span className="font-medium text-gray-800">{f.name}</span>
                <span className="block text-[9px] text-gray-400 capitalize">{f.library} · v{f.version_num ?? 0} · {f.framework_domains.length} domains</span>
              </Link>
            ))}
          </div>
        </Card>

        {/* Relationship map (structural) */}
        <Card title="Framework Structure Map" sub={selected ? `${selected.name} — click a competency's builder to edit` : undefined}>
          {selected ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                {["Programme", "Domain", "CPU", "Competency", "Assessment", "Passport"].map((n, i) => (
                  <span key={n} className="flex items-center gap-1.5">
                    <span className="bg-gray-100 rounded px-1.5 py-0.5 text-gray-600">{n}</span>
                    {i < 5 && <span className="text-gray-300">→</span>}
                  </span>
                ))}
              </div>
              <div className="border border-gray-100 rounded-lg p-2.5">
                <p className="text-xs font-semibold text-gray-800 mb-1.5">📦 {selected.name} <span className="text-[9px] text-gray-400">v{selected.version_num ?? 0}</span></p>
                <div className="space-y-1.5">
                  {domainRows.map((d, di) => (
                    <div key={di} className="flex items-center gap-2 text-[11px] border-l-2 border-purple-100 pl-2 py-0.5">
                      <span className="text-gray-700 flex-1">{di + 1}. {d.name} <span className="text-gray-300">({d.n})</span></span>
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${d.status === "complete" ? "bg-green-100 text-green-700" : d.status === "gap" ? "bg-red-100 text-red-600" : d.status === "empty" ? "bg-gray-100 text-gray-400" : "bg-amber-100 text-amber-700"}`}>{d.status}</span>
                    </div>
                  ))}
                  {!domainRows.length && <p className="text-[10px] text-gray-400">No domains.</p>}
                </div>
              </div>
              <p className="text-[9px] text-gray-400">A live structural map. The drag-and-drop graph editor from the mockup needs a graph store — not simulated.</p>
            </div>
          ) : <p className="text-xs text-gray-400">No frameworks.</p>}
        </Card>

        {/* AI Curriculum Intelligence */}
        <Card title="AI Curriculum Intelligence" sub="rule-derived from live records">
          {intel.length ? (
            <div className="space-y-1.5 mb-3">
              {intel.map((x, i) => (
                <Link key={i} href="/educator/studio/gaps" className="flex items-center gap-2 text-[11px] text-gray-700 hover:text-purple-700">
                  <span>{x.icon}</span><span className="flex-1">{x.label}</span>
                  <span className="text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">{x.n}</span>
                </Link>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 mb-3">No curriculum issues detected. ✅</p>}
          <GenerateRecs />
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Framework Health</p>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold text-gray-900">{covScore}%</span>
              <div className="flex-1 space-y-1">
                {[["Content", comps.length ? Math.round(comps.filter(c => hasResource.has(c.id)).length / comps.length * 100) : 0], ["Assessment", comps.length ? Math.round(comps.filter(c => hasAssessed.has(c.id)).length / comps.length * 100) : 0], ["Passport", comps.length ? Math.round(comps.filter(c => hasPassport.has(c.id)).length / comps.length * 100) : 0]].map(([l, v]) => (
                  <div key={l as string} className="flex items-center gap-1.5 text-[9px]">
                    <span className="text-gray-500 w-16">{l}</span>
                    <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-purple-400 rounded-full" style={{ width: `${v}%` }} /></div>
                    <span className="text-gray-700 font-bold">{v}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Coverage matrix */}
      <Card title="Competency Coverage Matrix" sub={selected ? `${selected.name} — by domain` : undefined}>
        {domainRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[8px] text-gray-400 uppercase tracking-wider">
                  <th className="pb-1.5">Domain</th><th className="pb-1.5 text-center">Content</th><th className="pb-1.5 text-center">Assessment</th>
                  <th className="pb-1.5 text-center">Simulation</th><th className="pb-1.5 text-center">Checklist</th><th className="pb-1.5 text-center">Passport</th><th className="pb-1.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {domainRows.map((d, i) => (
                  <tr key={i}>
                    <td className="py-1.5 text-gray-700">{d.name} <span className="text-gray-300">({d.n})</span></td>
                    <td className="py-1.5 text-center"><Cell v={d.cov.content} /></td>
                    <td className="py-1.5 text-center"><Cell v={d.cov.assessment} /></td>
                    <td className="py-1.5 text-center"><Cell v={d.cov.simulation} /></td>
                    <td className="py-1.5 text-center"><Cell v={d.cov.checklist} /></td>
                    <td className="py-1.5 text-center"><Cell v={d.cov.passport} /></td>
                    <td className="py-1.5 text-center"><span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${d.status === "complete" ? "bg-green-100 text-green-700" : d.status === "gap" ? "bg-red-100 text-red-600" : d.status === "empty" ? "bg-gray-100 text-gray-400" : "bg-amber-100 text-amber-700"}`}>{d.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-gray-400">Select a framework to see its coverage.</p>}
        <p className="text-[9px] text-gray-400 mt-2">✓ full · ◐ partial · ✕ none. Full per-competency matrix in <Link href="/educator/studio/gaps" className="text-purple-600 hover:underline">Gap Analysis</Link>.</p>
      </Card>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <Card title="Governance & Lifecycle" sub="workflow across content objects">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 mb-2">
            {LIFECYCLE.map((s, i) => (
              <span key={s} className="flex items-center gap-1 shrink-0">
                <span className="text-[9px] bg-gray-50 border border-gray-100 rounded px-1.5 py-1 text-gray-600">{s}</span>
                {i < LIFECYCLE.length - 1 && <span className="text-gray-300 text-[9px]">→</span>}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-center">
            {[["Draft", pipe.draft], ["In Review", pipe.review], ["Published", pipe.published], ["Archived", pipe.retired]].map(([l, n]) => (
              <div key={l as string} className="bg-gray-50 rounded-lg p-2">
                <p className="text-base font-bold text-gray-900">{n as number}</p>
                <p className="text-[8px] font-bold text-gray-400 uppercase">{l}</p>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-400 mt-2">Committee/Quality/Approval stages run in the platform governance Studio. Peer-review of scores is the Validation Centre.</p>
        </Card>

        <Card title="Standards & Compliance" sub="mapping completeness — external catalogues not stored">
          <div className="space-y-2">
            {[["Assessment coverage", comps.length ? Math.round(comps.filter(c => hasAssessed.has(c.id)).length / comps.length * 100) : 0], ["Learning coverage", comps.length ? Math.round(comps.filter(c => hasResource.has(c.id)).length / comps.length * 100) : 0], ["Passport coverage", comps.length ? Math.round(comps.filter(c => hasPassport.has(c.id)).length / comps.length * 100) : 0]].map(([l, v]) => (
              <div key={l as string}>
                <div className="flex items-center justify-between text-[11px] mb-0.5"><span className="text-gray-600">{l}</span><span className="font-bold text-gray-900">{v as number}%</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${(v as number) >= 80 ? "bg-green-500" : "bg-amber-400"}`} style={{ width: `${v}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-400 mt-2">SafeCare / JCI / WHO / ICN / national-council catalogues need a standards store — not simulated. These are real internal-coverage percentages.</p>
        </Card>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mt-4">
        <Card title="Recent Activity">
          {(activity ?? []).length ? (
            <ul className="space-y-1.5">
              {(activity ?? []).map((a, i) => (
                <li key={i} className="text-[11px] text-gray-600"><span className="font-medium text-gray-800">{a.actor_name ?? "—"}</span> {ACT[a.action] ?? a.action.replace(/_/g, " ")}{a.entity_name ? <span className="text-gray-400"> · {a.entity_name}</span> : null}</li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No activity yet.</p>}
        </Card>
        <Card title="Due for Review">
          {(reviews ?? []).length ? (
            <ul className="space-y-1">
              {(reviews ?? []).map((r, i) => (
                <li key={i} className="flex items-center gap-2 text-[11px]"><span className="text-gray-700 flex-1 truncate">{r.name}</span><span className="text-gray-400" suppressHydrationWarning>{r.review_date}</span></li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">Nothing scheduled for review.</p>}
        </Card>
        <Card title="Version History" sub="framework versions">
          <ul className="space-y-1">
            {fwList.slice(0, 6).map(f => (
              <li key={f.id} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono font-bold text-gray-700">v{f.version_num ?? 0}</span>
                <span className="text-gray-700 flex-1 truncate">{f.name}</span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${PUB_CLS[f.pub_status ?? "draft"] ?? "bg-gray-100"}`}>{(f.pub_status ?? "draft").replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Publishing sync + modules */}
      <div className="mt-4">
        <Card title="Publishing & Downstream Sync" sub="published content is read directly by these modules — no separate sync layer">
          <div className="flex items-center gap-1.5 flex-wrap">
            {[["Learning Content", "/educator/studio/content"], ["Assessment Design", "/educator/studio/assessment"], ["Blueprint & Mapping", "/educator/studio/mapping"], ["CKO & CPU", "/educator/studio/cko"], ["AI Studio", "/educator/studio/ai"], ["Passports", "/educator/students"]].map(([l, h]) => (
              <Link key={l} href={h} className="text-[10px] font-semibold text-green-700 bg-green-50 border border-green-100 rounded-lg px-2.5 py-1.5 hover:bg-green-100">✓ {l}</Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Curriculum & Framework Modules">
          <SectionGrid modules={section.modules} />
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: every KPI, coverage cell and health figure is computed from live records. Learning-outcome objects, external standards catalogues,
        and a drag-and-drop relationship-graph editor have no store yet and are stated as such. Structural framework authoring at scale stays under governance.
      </p>
    </div>
  );
}
