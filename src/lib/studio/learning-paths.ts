/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-005 — Learning Path Studio (consolidation lens). The authored, reusable learning structures already
// exist: curricula (programmes) with competency links and sequenced modules (migration 016), the governed
// learning-resource library (migration 014) and per-learner generated pathways. This surfaces them as one
// Studio view — programmes with their competency/module counts, the resource library by type, and
// competency→learning coverage. Read on demand; the visual drag-drop path sequencer is next-phase
// (module sequencing is authored today in the curriculum builder).

const NONE = "00000000-0000-0000-0000-000000000000";

export const PROGRAMME_LABEL: Record<string, string> = { orientation: "Orientation", specialty: "Specialty", cpd: "CPD", remediation: "Remediation", leadership: "Leadership", certification: "Certification" };
export const RESOURCE_LABEL: Record<string, string> = { course: "Course", policy: "Policy", video: "Video", guideline: "Guideline", simulation: "Simulation", question_bank: "Question bank", article: "Article", reflection: "Reflection" };
const RESOURCE_COLOR: Record<string, string> = { course: "#3b82f6", policy: "#8b5cf6", video: "#f59e0b", guideline: "#14b8a6", simulation: "#ec4899", question_bank: "#0ea5e9", article: "#64748b", reflection: "#10b981" };

export type Programme = { id: string; title: string; type: string; typeLabel: string; targetRole: string | null; durationWeeks: number | null; competencies: number; modules: number };

export async function loadLearningPaths(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));

  const curRes = await scope(admin.from("curricula").select("id, title, target_role, programme_type, duration_weeks").eq("is_active", true).order("created_at", { ascending: false }).limit(500));
  if (curRes.error) return { provisioned: false as const };
  const curricula = (curRes.data ?? []) as any[];
  const curIds = curricula.map(c => c.id);

  const compByCur = new Map<string, number>();
  const modByCur = new Map<string, number>();
  if (curIds.length) {
    const { data: cc } = await admin.from("curriculum_competencies").select("curriculum_id").in("curriculum_id", curIds).limit(20000);
    for (const r of (cc ?? []) as any[]) compByCur.set(r.curriculum_id, (compByCur.get(r.curriculum_id) ?? 0) + 1);
    const { data: cm } = await admin.from("curriculum_modules").select("curriculum_id").in("curriculum_id", curIds).limit(20000);
    for (const r of (cm ?? []) as any[]) modByCur.set(r.curriculum_id, (modByCur.get(r.curriculum_id) ?? 0) + 1);
  }

  const { data: resData } = await scope(admin.from("learning_resources").select("id, resource_type").eq("is_active", true).limit(8000));
  const resources = (resData ?? []) as any[];

  const { data: rc } = await admin.from("resource_competencies").select("competency_id").limit(50000);
  const covered = new Set(((rc ?? []) as any[]).map(r => r.competency_id).filter(Boolean));
  let totalComp = 0; try { const t = await admin.from("framework_competencies").select("id", { count: "exact", head: true }); totalComp = t.count ?? 0; } catch { totalComp = 0; }
  let activePathways = 0; try { const p = await admin.from("learning_pathways").select("id", { count: "exact", head: true }).eq("status", "active"); activePathways = p.count ?? 0; } catch { activePathways = 0; }

  const programmes: Programme[] = curricula.map(c => ({
    id: c.id, title: c.title, type: c.programme_type ?? "orientation", typeLabel: PROGRAMME_LABEL[c.programme_type] ?? (c.programme_type ?? "—"),
    targetRole: c.target_role ?? null, durationWeeks: c.duration_weeks ?? null,
    competencies: compByCur.get(c.id) ?? 0, modules: modByCur.get(c.id) ?? 0,
  }));

  const typeKeys = [...new Set(resources.map(r => r.resource_type).filter(Boolean))] as string[];
  const resourceTypes = typeKeys.map(k => ({ key: k, label: RESOURCE_LABEL[k] ?? k, color: RESOURCE_COLOR[k] ?? "#9ca3af", n: resources.filter(r => r.resource_type === k).length })).sort((a, b) => b.n - a.n);

  const totalModules = [...modByCur.values()].reduce((a, b) => a + b, 0);
  return {
    provisioned: true as const,
    empty: curricula.length === 0 && resources.length === 0,
    kpis: {
      curricula: curricula.length,
      resources: resources.length,
      coverage: totalComp ? Math.round((covered.size / totalComp) * 100) : 0,
      modules: totalModules,
      activePathways,
    },
    coverageDetail: { covered: covered.size, total: totalComp },
    programmes,
    resourceTypes,
  };
}
