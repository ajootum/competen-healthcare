import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../../ui";

// Gap Analysis / Competency Mapping (Education Studio) — real coverage per
// competency across four dimensions: learning resources, skill checklists,
// linked knowledge (via CPU) and whether it has ever been assessed. A gap is a
// missing dimension. All from live joins — no invented risk scores.

export const dynamic = "force-dynamic";

export default async function GapAnalysisPage() {
  const { admin } = await requireEducatorAccess();

  const { data: comps } = await admin.from("framework_competencies")
    .select("id, name, code, cpu_id, framework_domains!domain_id(name, frameworks(name))")
    .order("name").limit(500);
  const compList = (comps ?? []) as unknown as { id: string; name: string; code: string | null; cpu_id: string | null; framework_domains: { name: string; frameworks: { name: string } | null } | null }[];
  const compIds = compList.map(c => c.id);
  const cpuIds = [...new Set(compList.map(c => c.cpu_id).filter(Boolean))] as string[];

  const [{ data: resLinks }, { data: skills }, { data: scores }, { data: knowledge }] = await Promise.all([
    compIds.length ? admin.from("resource_competencies").select("competency_id").in("competency_id", compIds) : Promise.resolve({ data: [] }),
    compIds.length ? admin.from("competency_skills").select("id, competency_id").in("competency_id", compIds).eq("is_active", true) : Promise.resolve({ data: [] }),
    compIds.length ? admin.from("competency_scores").select("competency_id").in("competency_id", compIds) : Promise.resolve({ data: [] }),
    cpuIds.length ? admin.from("knowledge_objects").select("cpu_id").in("cpu_id", cpuIds).neq("status", "retired") : Promise.resolve({ data: [] }),
  ]);

  // Which skills have a checklist?
  const skillIds = (skills ?? []).map(s => s.id);
  const { data: cls } = skillIds.length
    ? await admin.from("skill_checklists").select("skill_id").in("skill_id", skillIds).eq("is_active", true)
    : { data: [] };
  const checklistSkills = new Set((cls ?? []).map(c => c.skill_id));
  const compHasChecklist = new Set((skills ?? []).filter(s => checklistSkills.has(s.id)).map(s => s.competency_id));

  const hasResource = new Set((resLinks ?? []).map(r => r.competency_id));
  const hasAssessed = new Set((scores ?? []).map(s => s.competency_id));
  const cpuHasKnowledge = new Set((knowledge ?? []).map(k => k.cpu_id));

  const rows = compList.map(c => {
    const learning = hasResource.has(c.id);
    const checklist = compHasChecklist.has(c.id);
    const assessed = hasAssessed.has(c.id);
    const knowledgeOk = !!c.cpu_id && cpuHasKnowledge.has(c.cpu_id);
    const covered = [learning, checklist, assessed, knowledgeOk].filter(Boolean).length;
    return {
      id: c.id, name: c.name, code: c.code,
      framework: c.framework_domains?.frameworks?.name ?? "—",
      learning, checklist, assessed, knowledge: knowledgeOk, covered, gaps: 4 - covered,
    };
  }).sort((a, b) => b.gaps - a.gaps || a.name.localeCompare(b.name));

  const noChecklist = rows.filter(r => !r.checklist).length;
  const noLearning = rows.filter(r => !r.learning).length;
  const neverAssessed = rows.filter(r => !r.assessed).length;
  const fullyCovered = rows.filter(r => r.gaps === 0).length;

  const Dot = ({ ok }: { ok: boolean }) => <span className={`inline-block w-4 text-center ${ok ? "text-green-500" : "text-gray-200"}`}>{ok ? "●" : "○"}</span>;

  return (
    <div className="max-w-4xl">
      <Link href="/educator/studio/mapping" className="text-xs text-gray-400 hover:text-gray-600">← Blueprint & Mapping Centre</Link>
      <div className="mt-1"><EduHeader icon="🧩" title="Gap Analysis" sub="Coverage per competency across learning, checklists, knowledge and assessment — every flag is a real missing link." /></div>
      <StatTiles cols="grid-cols-2 md:grid-cols-5" tiles={[
        { label: "Competencies", value: String(rows.length) },
        { label: "Fully Covered", value: String(fullyCovered) },
        { label: "No Checklist", value: String(noChecklist), alert: noChecklist > 0 },
        { label: "No Learning", value: String(noLearning), alert: noLearning > 0 },
        { label: "Never Assessed", value: String(neverAssessed) },
      ]} />

      <Card title="Coverage Matrix" sub="most gaps first — ● covered · ○ missing">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[8px] text-gray-400 uppercase tracking-wider">
                <th className="pb-1.5">Competency</th><th className="pb-1.5">Framework</th>
                <th className="pb-1.5 text-center">Learning</th><th className="pb-1.5 text-center">Checklist</th>
                <th className="pb-1.5 text-center">Knowledge</th><th className="pb-1.5 text-center">Assessed</th>
                <th className="pb-1.5 text-center">Coverage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.slice(0, 60).map(r => (
                <tr key={r.id}>
                  <td className="py-1.5 text-gray-700">{r.code ? <span className="text-gray-400 mr-1">{r.code}</span> : null}{r.name}</td>
                  <td className="py-1.5 text-gray-400">{r.framework}</td>
                  <td className="py-1.5 text-center"><Dot ok={r.learning} /></td>
                  <td className="py-1.5 text-center"><Dot ok={r.checklist} /></td>
                  <td className="py-1.5 text-center"><Dot ok={r.knowledge} /></td>
                  <td className="py-1.5 text-center"><Dot ok={r.assessed} /></td>
                  <td className="py-1.5 text-center">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${r.gaps === 0 ? "bg-green-100 text-green-700" : r.gaps >= 3 ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"}`}>{r.covered}/4</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 60 && <p className="text-[10px] text-gray-400 mt-2">Showing 60 of {rows.length}.</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Close gaps in the builders: <Link href="/educator/studio/checklists" className="text-purple-600 hover:underline">Checklists</Link>,{" "}
        <Link href="/educator/library" className="text-purple-600 hover:underline">Learning Resources</Link>,{" "}
        <Link href="/educator/studio/knowledge" className="text-purple-600 hover:underline">Knowledge Library</Link>.
        Standards mapping (SafeCare / JCI / regulatory) needs a standards store — not simulated.
      </p>
    </div>
  );
}
