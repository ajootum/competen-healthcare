import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import ChecklistBuilder from "@/app/super-admin/studio/checklists/ChecklistBuilder";
import { EduHeader } from "../../ui";

// Clinical Skills Checklist Builder (Education Studio) — the governed checklist
// builder in the educator shell: one master checklist per skill, reused by
// direct observation, OSCE, simulation, audits and evidence validation. Writes
// go through /api/studio (authoring roles).

export const dynamic = "force-dynamic";

export default async function StudioChecklistsPage() {
  const { admin } = await requireEducatorAccess();

  const [{ data: skills }, { data: checklists }, { data: items }] = await Promise.all([
    admin.from("competency_skills")
      .select("id, name, framework_competencies!competency_id(name, framework_domains(frameworks(name)))")
      .eq("is_active", true).order("name"),
    admin.from("skill_checklists")
      .select("id, skill_id, name, description, assessor_instructions")
      .eq("is_active", true).order("name"),
    admin.from("checklist_items")
      .select("id, checklist_id, item, section, is_critical, is_required, scoring_method, evidence_required, assessor_note, sort_order")
      .order("sort_order"),
  ]);

  const skillRows = (skills ?? []).map(s => {
    const c = s.framework_competencies as unknown as { name: string; framework_domains: { frameworks: { name: string } | null } | null } | null;
    return { id: s.id, name: s.name, competency: c?.name ?? "—", framework: c?.framework_domains?.frameworks?.name ?? "—" };
  });

  return (
    <div className="max-w-6xl">
      <Link href="/educator/studio/assessment" className="text-xs text-gray-400 hover:text-gray-600">← Assessment Design Studio</Link>
      <div className="mt-1"><EduHeader icon="📋" title="Clinical Skills Checklist Builder" sub="Author the master checklists — sections, scoring rules, critical-fail items. Every assessment method, audit and AI grounding reads these." /></div>
      {(checklists ?? []).length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 mb-4">
          No checklists exist yet — this is the content gap that keeps audit templates, cockpit criteria and OSCE/AI grounding empty. Author the first here.
        </div>
      )}
      <ChecklistBuilder skills={skillRows as never} checklists={(checklists ?? []) as never} items={(items ?? []) as never} />
    </div>
  );
}
