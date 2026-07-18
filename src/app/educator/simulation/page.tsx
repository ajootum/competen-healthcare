import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { BRIEFS } from "@/lib/simulation-briefs";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import AskAi from "@/app/assessor/ai/AskAi";
import { EduHeader } from "../ui";

// Simulation Scenarios — the educator's scenario workspace: curated briefs,
// governed clinical cases, and the AI scenario designer (Claude, grounded in
// competency content, educator-reviewed). Sessions run in the Simulation
// Centre; results flow back through validation.

export const dynamic = "force-dynamic";

const DIFF_CLS: Record<string, string> = {
  Easy: "bg-green-100 text-green-700", Medium: "bg-amber-100 text-amber-700", Hard: "bg-red-100 text-red-600",
  beginner: "bg-green-100 text-green-700", intermediate: "bg-amber-100 text-amber-700", advanced: "bg-red-100 text-red-600",
};

export default async function EducatorSimulationPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d30 = new Date(new Date().getTime() - 30 * 86400000).toISOString();

  const [{ data: cases }, { data: simAssess }, { data: comps }] = await Promise.all([
    admin.from("clinical_cases")
      .select("id, title, difficulty, status, clinical_practice_units(name)")
      .neq("status", "retired").order("created_at", { ascending: false }).limit(20),
    admin.from("assessments")
      .select("score, competency_cycles!cycle_id(hospital_id)")
      .eq("method", "simulation").eq("status", "complete").not("score", "is", null).gte("assessed_at", d30).limit(500),
    admin.from("framework_competencies").select("id, name").order("name").limit(400),
  ]);

  const hosSims = (simAssess ?? []).filter(a =>
    !hospitalId || (a.competency_cycles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId);
  const passRate = hosSims.length ? Math.round(hosSims.filter(a => (a.score as number) >= 3).length / hosSims.length * 100) : null;

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🧪" title="Simulation Scenarios" sub="Create and manage simulation scenarios — curated briefs, governed cases and the AI designer." />
      <StatTiles tiles={[
        { label: "Curated Briefs", value: String(BRIEFS.length), sub: "run by the AI Clinical Coach" },
        { label: "Governed Cases", value: String((cases ?? []).length), sub: "authored case studies" },
        { label: "Sims Scored (30d)", value: String(hosSims.length) },
        { label: "Sim Pass Rate (30d)", value: passRate != null ? `${passRate}%` : "—" },
      ]} />

      <Card title="Curated Scenario Briefs" sub="shared with the learner practice lab and the Simulation Centre">
        <div className="grid sm:grid-cols-2 gap-2">
          {BRIEFS.map(b => (
            <div key={b.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-800 flex-1">{b.title}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${DIFF_CLS[b.difficulty] ?? "bg-gray-100 text-gray-600"}`}>{b.difficulty}</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">{b.category} · {b.duration} · {b.skills.length} skills</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4">
        <Card title="Governed Case Studies" sub="authored in Studio, used for case-based learning and simulation">
          {(cases ?? []).length ? (
            <div className="flex flex-wrap gap-1.5">
              {(cases ?? []).map(c => (
                <span key={c.id} className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                  {c.title}
                  {(c.clinical_practice_units as unknown as { name: string } | null)?.name ? ` · ${(c.clinical_practice_units as unknown as { name: string }).name}` : ""}
                  {c.difficulty ? ` · ${c.difficulty}` : ""}
                </span>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No governed cases authored yet.</p>}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="✨ AI Scenario Designer" sub="Claude drafts a runnable scenario grounded in governed competency content — you review and edit">
          <ScenarioDesigner competencies={(comps ?? []).map(c => ({ id: c.id, name: c.name }))} />
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Sessions are scheduled and scored in the <Link href="/assessor/simulation" className="text-purple-600 hover:underline">Simulation Centre</Link>;
        results flow back through <Link href="/educator/validations" className="text-purple-600 hover:underline">Pending Validation</Link>.
        A persistent scenario store (versioned custom scenarios) would need its own spec — drafts are generated for immediate use.
      </p>
    </div>
  );
}

function ScenarioDesigner({ competencies }: { competencies: { id: string; name: string }[] }) {
  // Server wrapper renders the shared AskAi client with a default scenario; a
  // competency-linked variant is available in the Simulation Centre designer.
  void competencies;
  return <AskAi endpoint="/api/ai/simulation" body={{ scenario_name: "Deteriorating post-operative patient" }} label="Draft a sample scenario" doneLabel="Draft another" />;
}
