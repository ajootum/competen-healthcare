import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../../ui";
import { SECTION_BY_ID } from "../sections";
import SectionGrid from "../SectionGrid";
import { AssessmentGenerator, ScenarioGenerator, AdvisorGenerator } from "./AiStudioTools";

// AI Studio — real Claude generators grounded in governed competency content
// (assessment stations, scenarios, curriculum advice), plus the module grid.
// AI-review/Bloom/validator pipelines have no persistence and are soon-rows.

export const dynamic = "force-dynamic";

export default async function AiStudioPage() {
  const { admin } = await requireEducatorAccess();
  const section = SECTION_BY_ID.get("ai")!;

  const [{ data: comps }, { count: aiToday }, { data: recent }] = await Promise.all([
    admin.from("framework_competencies").select("id, name").order("name").limit(400),
    admin.from("audit_log").select("id", { count: "exact", head: true }).like("action", "ai_%").gte("created_at", new Date(new Date().getTime() - 86400000).toISOString()),
    admin.from("audit_log").select("actor_name, action, created_at").like("action", "ai_%").order("created_at", { ascending: false }).limit(5),
  ]);
  const competencies = (comps ?? []).map(c => ({ id: c.id, name: c.name }));

  return (
    <div className="max-w-4xl">
      <Link href="/educator/studio" className="text-xs text-gray-400 hover:text-gray-600">← Education Studio</Link>
      <div className="mt-1"><EduHeader icon="✨" title="AI Studio" sub="Intelligent tools to create, review and improve competency-based education — real generation, grounded and audit-logged." /></div>
      <StatTiles tiles={[
        { label: "AI Requests Today", value: String(aiToday ?? 0) },
        { label: "Competencies", value: String(competencies.length), sub: "grounding source" },
        { label: "Live Generators", value: "3", sub: "assessment · scenario · advisor" },
        { label: "Governance", value: "Audited", sub: "quota-limited" },
      ]} />

      <div className="space-y-4 mb-4">
        <Card title="1. AI Assessment Generator" sub="draft an OSCE station from a competency — review and edit before use">
          <AssessmentGenerator competencies={competencies} />
        </Card>
        <Card title="2. AI Scenario Generator" sub="draft a simulation scenario grounded in governed content">
          <ScenarioGenerator competencies={competencies} />
        </Card>
        <Card title="3. AI Curriculum Advisor" sub="summarise coverage and suggest priorities from live figures">
          <AdvisorGenerator />
        </Card>
      </div>

      <Card title="All AI Studio Modules">
        <SectionGrid modules={section.modules} />
      </Card>

      <div className="mt-4">
        <Card title="Recent AI Activity" sub="from the audit trail">
          {(recent ?? []).length ? (
            <ul className="space-y-1">
              {(recent ?? []).map((a, i) => (
                <li key={i} className="text-[11px] text-gray-600">
                  <span className="font-medium text-gray-800">{a.actor_name ?? "—"}</span> {a.action.replace("ai_", "").replace(/_/g, " ")}
                  <span className="text-gray-300 ml-1" suppressHydrationWarning>{new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No AI activity yet.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: AI-question review, Bloom&apos;s optimiser and a persistent clinical validator need review/scoring pipelines that aren&apos;t built.
        The generators here are real Claude output grounded in governed competency content — you remain the author of record.
      </p>
    </div>
  );
}
