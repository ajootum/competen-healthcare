import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { RISK_CONFIG, type RiskCategory } from "@/lib/ckcm";
import { Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../../ui";
import GenerateRecs from "../curriculum/GenerateRecs";
import CpuDetail, { type CpuDetailData } from "./CpuDetail";
import { NewFrameworkButton, PublishControl, StructureEditor, PresenceBar } from "./Authoring";

// Competency Framework Builder Workspace (redesign spec) — a visual, AI-assisted
// framework construction environment: explorer tree, builder canvas showing the
// object hierarchy, CPU detail tabs, AI curriculum assistant, properties,
// health score and lifecycle. Every node and figure is live. For a hospital's
// OWN frameworks (scope != master) authoring is live: inline domain/competency
// creation, drag-to-reorder, autosave, one-click publish and realtime presence.
// The shared master library stays read-only here (governed centrally).

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ fw?: string; dom?: string; cpu?: string }>;

const PUB_CLS: Record<string, string> = {
  published: "bg-green-100 text-green-700", draft: "bg-gray-100 text-gray-600",
  in_review: "bg-amber-100 text-amber-700", archived: "bg-gray-100 text-gray-400", retired: "bg-gray-100 text-gray-400",
};
const LIFECYCLE = ["Draft", "Review", "Committee", "Approved", "Published", "Archived"];
const CHAIN = ["Programme", "Domain", "CPU", "Competency", "Indicators", "Evidence", "Assessment", "Simulation", "Passport"];

export default async function FrameworkBuilderPage({ searchParams }: { searchParams: SearchParams }) {
  const { admin, hospitalId, name: myName, roles } = await requireEducatorAccess();
  const { fw, dom, cpu } = await searchParams;
  const isSuper = roles.includes("super_admin");

  let fwQuery = admin.from("frameworks")
    .select("id, name, library, pub_status, version_num, review_date, scope, hospital_id, framework_domains(id, name, sort_order)")
    .order("name").limit(80);
  // Educators/hospital-admins see the shared master library (read-only) plus
  // their own hospital's frameworks. Super-admins see everything.
  if (!isSuper) fwQuery = hospitalId ? fwQuery.or(`scope.eq.master,hospital_id.eq.${hospitalId}`) : fwQuery.eq("scope", "master");
  const { data: frameworks } = await fwQuery;
  const fwList = (frameworks ?? []) as unknown as { id: string; name: string; library: string; pub_status: string | null; version_num: number | null; review_date: string | null; scope: string | null; hospital_id: string | null; framework_domains: { id: string; name: string; sort_order: number }[] }[];
  const selected = fw ? fwList.find(f => f.id === fw) ?? fwList[0] : fwList[0];
  const canEdit = !!selected && (isSuper || ((selected.scope ?? "") !== "master" && !!hospitalId && selected.hospital_id === hospitalId));
  const domains = [...(selected?.framework_domains ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const selDomain = dom ? domains.find(d => d.id === dom) ?? domains[0] : domains[0];

  const domainIds = domains.map(d => d.id);
  const { data: comps } = domainIds.length
    ? await admin.from("framework_competencies").select("id, name, code, domain_id, cpu_id").in("domain_id", domainIds).order("sort_order")
    : { data: [] };
  const compList = (comps ?? []) as { id: string; name: string; code: string | null; domain_id: string; cpu_id: string | null }[];
  const compIds = compList.map(c => c.id);
  const cpuIds = [...new Set(compList.map(c => c.cpu_id).filter(Boolean))] as string[];

  // Coverage sets across the framework's competencies
  const [{ data: resLinks }, { data: skills }, { data: scores }, { data: decisions }, { data: simCases }, { data: cpuRows }, { data: knowledge }] = await Promise.all([
    compIds.length ? admin.from("resource_competencies").select("competency_id, learning_resources(title)").in("competency_id", compIds) : Promise.resolve({ data: [] }),
    compIds.length ? admin.from("competency_skills").select("id, competency_id").in("competency_id", compIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    compIds.length ? admin.from("assessments").select("competency_id").eq("status", "complete").not("score", "is", null).in("competency_id", compIds) : Promise.resolve({ data: [] }),
    compIds.length ? admin.from("competency_decisions").select("competency_id").in("competency_id", compIds) : Promise.resolve({ data: [] }),
    cpuIds.length ? admin.from("clinical_cases").select("cpu_id, title").in("cpu_id", cpuIds).neq("status", "retired") : Promise.resolve({ data: [] }),
    cpuIds.length ? admin.from("clinical_practice_units").select("id, code, name, description, risk_category, complexity, reassessment_months, pub_status").in("id", cpuIds) : Promise.resolve({ data: [] }),
    cpuIds.length ? admin.from("knowledge_objects").select("cpu_id, title, code").in("cpu_id", cpuIds).neq("status", "retired") : Promise.resolve({ data: [] }),
  ]);
  const skillIds = (skills ?? []).map(s => s.id);
  const { data: cls } = skillIds.length ? await admin.from("skill_checklists").select("skill_id").in("skill_id", skillIds).eq("is_active", true) : { data: [] };
  const checklistSkillIds = new Set((cls ?? []).map(c => c.skill_id));
  const compHasChecklist = new Set((skills ?? []).filter(s => checklistSkillIds.has(s.id)).map(s => s.competency_id));
  const hasResource = new Set((resLinks ?? []).map(r => r.competency_id));
  const hasAssessed = new Set((scores ?? []).map(s => s.competency_id));
  const hasPassport = new Set((decisions ?? []).map(d => d.competency_id));
  const cpuHasSim = new Set((simCases ?? []).map(c => c.cpu_id));

  const covScore = compList.length
    ? Math.round(([hasResource, hasAssessed, hasPassport].reduce((s, set) => s + compList.filter(c => set.has(c.id)).length, 0)
        + compList.filter(c => compHasChecklist.has(c.id)).length
        + compList.filter(c => c.cpu_id && cpuHasSim.has(c.cpu_id)).length) / (compList.length * 5) * 100)
    : 0;
  const pct = (set: Set<string>) => compList.length ? Math.round(compList.filter(c => set.has(c.id)).length / compList.length * 100) : 0;
  const simPct = compList.length ? Math.round(compList.filter(c => c.cpu_id && cpuHasSim.has(c.cpu_id)).length / compList.length * 100) : 0;

  // AI assistant signals (framework-scoped)
  const nameCount = new Map<string, number>();
  for (const c of compList) nameCount.set(c.name.trim().toLowerCase(), (nameCount.get(c.name.trim().toLowerCase()) ?? 0) + 1);
  const intel = [
    { icon: "📝", label: "Missing assessment methods", n: compList.filter(c => !hasAssessed.has(c.id)).length },
    { icon: "🔁", label: "Duplicate competency names", n: [...nameCount.values()].filter(n => n > 1).length },
    { icon: "🧱", label: "Competencies not mapped to a CPU", n: compList.filter(c => !c.cpu_id).length },
    { icon: "📋", label: "Missing checklists", n: compList.filter(c => !compHasChecklist.has(c.id)).length },
    { icon: "🧪", label: "Missing simulations", n: compList.filter(c => !c.cpu_id || !cpuHasSim.has(c.cpu_id)).length },
    { icon: "🛂", label: "Not yet in a passport", n: compList.filter(c => !hasPassport.has(c.id)).length },
  ].filter(x => x.n > 0);

  // Domain coverage status for the canvas
  const domainStatus = (dId: string) => {
    const dc = compList.filter(c => c.domain_id === dId);
    if (!dc.length) return "empty";
    const dims = [
      dc.every(c => hasResource.has(c.id)), dc.every(c => hasAssessed.has(c.id)),
      dc.every(c => compHasChecklist.has(c.id)), dc.every(c => hasPassport.has(c.id)),
    ];
    return dims.every(Boolean) ? "complete" : dims.some(Boolean) ? "partial" : "gap";
  };

  // Selected CPU detail
  const selCpuId = cpu ?? (selDomain ? (compList.find(c => c.domain_id === selDomain.id && c.cpu_id)?.cpu_id ?? cpuIds[0]) : cpuIds[0]) ?? null;
  const cpuRow = (cpuRows ?? []).find(c => c.id === selCpuId);
  let cpuDetail: CpuDetailData | null = null;
  if (cpuRow) {
    const cpuComps = compList.filter(c => c.cpu_id === selCpuId);
    const cpuCompIds = new Set(cpuComps.map(c => c.id));
    cpuDetail = {
      code: cpuRow.code, name: cpuRow.name, description: cpuRow.description,
      risk: RISK_CONFIG[cpuRow.risk_category as RiskCategory]?.label ?? null,
      complexity: cpuRow.complexity, reassessMonths: cpuRow.reassessment_months, pubStatus: cpuRow.pub_status ?? "draft",
      competencies: cpuComps.map(c => ({ name: c.name, code: c.code })),
      knowledge: (knowledge ?? []).filter(k => k.cpu_id === selCpuId).map(k => ({ title: k.title, code: k.code })),
      cases: (simCases ?? []).filter(c => c.cpu_id === selCpuId).map(c => ({ title: c.title })),
      resources: [...new Set((resLinks ?? []).filter(r => cpuCompIds.has(r.competency_id)).map(r => (r.learning_resources as unknown as { title: string } | null)?.title ?? "").filter(Boolean))],
      assessments: (scores ?? []).filter(s => cpuCompIds.has(s.competency_id)).length,
    };
  }
  const lcIndex = (() => { const s = selected?.pub_status ?? "draft"; if (s === "published") return 4; if (["archived", "retired"].includes(s)) return 5; if (["in_review", "peer_review", "review"].includes(s)) return 1; return 0; })();

  // Editable structure for the Structure Editor (own-hospital frameworks only)
  const structure = domains.map(d => ({
    id: d.id, name: d.name,
    competencies: compList.filter(c => c.domain_id === d.id).map(c => ({ id: c.id, name: c.name, code: c.code })),
  }));

  return (
    <div className="max-w-[1200px]">
      <Link href="/educator/studio/curriculum" className="text-xs text-gray-400 hover:text-gray-600">← Curriculum & Framework Design</Link>
      <div className="mt-1 flex items-start justify-between gap-3 flex-wrap">
        <EduHeader icon="🗂️" title="Framework Builder" sub="Design and build competency frameworks that power assessment, learning and performance." />
        {selected && <PresenceBar frameworkId={selected.id} me={myName} />}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {[["View Graph", "/educator/studio/curriculum"], ["Gap Analysis", "/educator/studio/gaps"], ["Compare Versions", "/educator/studio/versions"], ["Validate", "/educator/validations"], ["Checklists", "/educator/studio/checklists"]].map(([l, h]) => (
          <Link key={l} href={h} className="text-[11px] font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-purple-300 transition-colors">{l}</Link>
        ))}
        <NewFrameworkButton />
        {canEdit && selected && <PublishControl frameworkId={selected.id} status={selected.pub_status ?? "draft"} />}
        {["Import", "Export"].map(l => (
          <span key={l} className="text-[11px] text-gray-300 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 select-none">{l} <span className="text-[8px] font-bold uppercase">soon</span></span>
        ))}
      </div>

      <div className="grid xl:grid-cols-[240px_minmax(0,1fr)_290px] gap-4">
        {/* Explorer */}
        <Card title="Framework Explorer">
          <div className="space-y-1 max-h-[560px] overflow-y-auto">
            {fwList.map(f => (
              <div key={f.id}>
                <Link href={`/educator/studio/frameworks?fw=${f.id}`}
                  className={`block rounded-lg px-2.5 py-1.5 text-[11px] ${selected?.id === f.id ? "bg-purple-50 border border-purple-200" : "hover:bg-gray-50"}`}>
                  <span className="font-medium text-gray-800">{f.name}</span>
                  <span className="block text-[9px] text-gray-400 capitalize">{f.library} · v{f.version_num ?? 0}</span>
                </Link>
                {selected?.id === f.id && domains.map((d, di) => (
                  <Link key={d.id} href={`/educator/studio/frameworks?fw=${f.id}&dom=${d.id}`}
                    className={`block rounded px-2 py-1 ml-3 text-[10px] ${selDomain?.id === d.id ? "text-purple-700 font-semibold" : "text-gray-500 hover:text-gray-700"}`}>
                    {di + 1}. {d.name}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </Card>

        {/* Builder canvas */}
        <div className="space-y-3 min-w-0">
          <Card title="Framework Builder Canvas" sub={selected?.name}>
            <div className="flex items-center gap-1 text-[9px] mb-3 flex-wrap">
              {CHAIN.map((n, i) => (
                <span key={n} className="flex items-center gap-1">
                  <span className="bg-gray-100 rounded px-1.5 py-0.5 text-gray-500">{n}</span>
                  {i < CHAIN.length - 1 && <span className="text-gray-300">→</span>}
                </span>
              ))}
            </div>
            {selected ? (
              <div className="space-y-2">
                <div className="border border-purple-200 bg-purple-50/40 rounded-lg px-3 py-2 text-center">
                  <p className="text-[9px] font-bold text-purple-400 uppercase">Programme</p>
                  <p className="text-xs font-bold text-gray-800">{selected.name}</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {domains.map((d, di) => {
                    const st = domainStatus(d.id);
                    const dc = compList.filter(c => c.domain_id === d.id);
                    return (
                      <Link key={d.id} href={`/educator/studio/frameworks?fw=${selected.id}&dom=${d.id}`}
                        className={`border rounded-lg px-2.5 py-1.5 text-left transition-colors ${selDomain?.id === d.id ? "border-purple-300 bg-purple-50/40" : "border-gray-100 hover:border-purple-200"}`}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-gray-800 flex-1">{di + 1}. {d.name}</span>
                          <span className={`w-2 h-2 rounded-full ${st === "complete" ? "bg-green-500" : st === "gap" ? "bg-red-400" : st === "empty" ? "bg-gray-200" : "bg-amber-400"}`} />
                        </div>
                        <p className="text-[9px] text-gray-400">{dc.length} competencies</p>
                      </Link>
                    );
                  })}
                </div>

                {selDomain && (
                  <div className="border border-gray-100 rounded-lg p-2.5">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{selDomain.name} — competencies</p>
                    <div className="grid sm:grid-cols-2 gap-1.5">
                      {compList.filter(c => c.domain_id === selDomain.id).map(c => (
                        <div key={c.id} className="border border-gray-100 rounded px-2 py-1.5">
                          <p className="text-[11px] text-gray-700">{c.code ? <span className="text-gray-400 mr-1">{c.code}</span> : null}{c.name}</p>
                          <div className="flex items-center gap-1 mt-1 text-[8px]">
                            {[["📚", hasResource.has(c.id)], ["📝", hasAssessed.has(c.id)], ["📋", compHasChecklist.has(c.id)], ["🧪", !!c.cpu_id && cpuHasSim.has(c.cpu_id)], ["🛂", hasPassport.has(c.id)]].map(([ic, ok], i) => (
                              <span key={i} className={ok ? "" : "opacity-25 grayscale"} title={ok ? "covered" : "missing"}>{ic as string}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                      {!compList.filter(c => c.domain_id === selDomain.id).length && <p className="text-[10px] text-gray-400">No competencies in this domain.</p>}
                    </div>
                  </div>
                )}
                <p className="text-[9px] text-gray-400">Coverage icons: 📚 learning · 📝 assessment · 📋 checklist · 🧪 simulation · 🛂 passport. This canvas is the live coverage view; edit structure in the Structure Editor below.</p>
              </div>
            ) : <p className="text-xs text-gray-400">No frameworks.</p>}
          </Card>

          {selected && (canEdit ? (
            <Card title="Structure Editor" sub={`${selected.name} · your hospital`}>
              <StructureEditor key={selected.id} frameworkId={selected.id} initial={structure} />
              <p className="text-[9px] text-gray-400 mt-3">Inline create, drag-to-reorder, autosave and publish write directly to the live framework — every change is hospital-scoped and audit-logged. Downstream assessment, learning and passport views read the same tables, so they update automatically.</p>
            </Card>
          ) : (
            <Card title="Structure Editor">
              <p className="text-[11px] text-gray-500">This is a <span className="font-semibold">master-library</span> framework, governed centrally — read-only here. Use <span className="font-semibold">＋ New Framework</span> to build one for your hospital, with inline authoring, drag-to-reorder, autosave and one-click publishing.</p>
            </Card>
          ))}

          {cpuDetail && (
            <Card title="CPU Detail">
              <CpuDetail cpu={cpuDetail} />
            </Card>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-3">
          <Card title="AI Curriculum Assistant" sub="rule-derived signals">
            {intel.length ? (
              <div className="space-y-1.5 mb-3">
                {intel.map((x, i) => (
                  <Link key={i} href="/educator/studio/gaps" className="flex items-center gap-2 text-[11px] text-gray-700 hover:text-purple-700">
                    <span>{x.icon}</span><span className="flex-1">{x.label}</span>
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">{x.n}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400 mb-3">No issues detected in this framework. ✅</p>}
            <GenerateRecs />
          </Card>

          <Card title="Properties" sub={selDomain ? `Domain: ${selDomain.name}` : "Framework"}>
            {selected && (
              <div className="text-[11px] text-gray-600 space-y-1">
                <p><span className="text-gray-400">Framework:</span> {selected.name}</p>
                <p><span className="text-gray-400">Library:</span> <span className="capitalize">{selected.library}</span></p>
                <p><span className="text-gray-400">Version:</span> v{selected.version_num ?? 0}</p>
                <p><span className="text-gray-400">Status:</span> <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${PUB_CLS[selected.pub_status ?? "draft"] ?? "bg-gray-100"}`}>{(selected.pub_status ?? "draft").replace("_", " ")}</span></p>
                {selected.review_date && <p><span className="text-gray-400">Review due:</span> {selected.review_date}</p>}
                <p className="pt-1 border-t border-gray-50"><span className="text-gray-400">Domains:</span> {domains.length} · <span className="text-gray-400">Competencies:</span> {compList.length} · <span className="text-gray-400">CPUs:</span> {cpuIds.length}</p>
              </div>
            )}
          </Card>

          <Card title="Version History">
            <ul className="space-y-1">
              {fwList.slice(0, 5).map(f => (
                <li key={f.id} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono font-bold text-gray-700">v{f.version_num ?? 0}</span>
                  <span className="text-gray-700 flex-1 truncate">{f.name}</span>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${PUB_CLS[f.pub_status ?? "draft"] ?? "bg-gray-100"}`}>{(f.pub_status ?? "draft").replace("_", " ")}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {/* Health + lifecycle */}
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <Card title="Framework Health Score">
          <div className="flex items-center gap-4">
            <span className={`text-3xl font-bold ${covScore >= 80 ? "text-green-600" : covScore >= 60 ? "text-amber-600" : "text-red-600"}`}>{covScore}%</span>
            <div className="flex-1 space-y-1">
              {[["Learning coverage", pct(hasResource)], ["Assessment mapping", pct(hasAssessed)], ["Simulation coverage", simPct], ["Passport coverage", pct(hasPassport)], ["Checklist coverage", pct(compHasChecklist)]].map(([l, v]) => (
                <div key={l as string} className="flex items-center gap-2 text-[10px]">
                  <span className="text-gray-500 w-28">{l}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${(v as number) >= 80 ? "bg-green-500" : "bg-amber-400"}`} style={{ width: `${v}%` }} /></div>
                  <span className="text-gray-700 font-bold w-8 text-right">{v as number}%</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[9px] text-gray-400 mt-2">Live coverage of this framework&apos;s competencies across five dimensions.</p>
        </Card>

        <Card title="Lifecycle Status" sub="selected framework">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {LIFECYCLE.map((s, i) => (
              <span key={s} className="flex items-center gap-1 shrink-0">
                <span className={`flex items-center gap-1 text-[9px] rounded px-1.5 py-1 ${i < lcIndex ? "bg-green-50 text-green-700" : i === lcIndex ? "bg-purple-100 text-purple-700 font-bold" : "bg-gray-50 text-gray-400"}`}>
                  {i < lcIndex ? "✓" : i === lcIndex ? "●" : "○"} {s}
                </span>
                {i < LIFECYCLE.length - 1 && <span className="text-gray-300 text-[9px]">→</span>}
              </span>
            ))}
          </div>
          <p className="text-[9px] text-gray-400 mt-2">Draft → Review → Published transitions run one-click from the toolbar for your hospital&apos;s frameworks (version-snapshotted, audit-logged). Committee approval of master content and peer review of scores stay in the governance Studio and Validation Centre.</p>
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: every node, coverage icon, health figure and lifecycle stage is live. For your hospital&apos;s own frameworks the Structure Editor gives
        inline domain/competency creation, drag-to-reorder, autosave, one-click publish and realtime presence — all hospital-scoped and audit-logged. The
        shared master library is read-only here and governed centrally; assessment and knowledge authoring still run through the{" "}
        <Link href="/educator/studio/checklists" className="text-purple-600 hover:underline">Checklist</Link> and{" "}
        <Link href="/educator/questions" className="text-purple-600 hover:underline">Question</Link> builders. Realtime presence shows who else is viewing, not live co-editing of the same field.
      </p>
    </div>
  );
}
