import Link from "next/link";
import { requireAnalyticsAccess } from "@/lib/analytics";
import ChecklistBuilder from "@/app/super-admin/studio/checklists/ChecklistBuilder";

// Checklist Builder (Assessment Studio) — assessor-shell wrapper around the
// governed checklist builder. One master checklist per skill, reused by
// direct observation, OSCE, simulation, audits and evidence validation.
// Writes go through /api/studio (authoring roles).

export const dynamic = "force-dynamic";

export default async function StudioChecklistsPage() {
  const { admin } = await requireAnalyticsAccess();

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
      <Link href="/assessor/studio" className="text-xs text-gray-400 hover:text-gray-600">← Assessment Studio</Link>
      <div className="mb-6 mt-1">
        <h1 className="text-xl font-bold text-gray-900">📚 Checklist Builder</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Author the master checklists — sections, scoring rules, critical-fail items. Every assessment method, audit and AI grounding reads these.
        </p>
      </div>
      {skillRows.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 mb-4">
          No competency skills exist yet — add a skill to a competency first (the builder below includes skill creation via the library).
        </div>
      )}
      <ChecklistBuilder skills={skillRows as never} checklists={(checklists ?? []) as never} items={(items ?? []) as never} />
    </div>
  );
}
