// Platform Priority & Execution Framework (PPE) core engine. One fail-soft fetch of the strategic stores
// (ppe_strategic_themes / ppe_objectives / ppe_key_results / ppe_priorities / ppe_campaigns / ppe_actions /
// ppe_approvals / ppe_audit + scope/owner name maps) shared by every PPE module, plus the cascade resolver that
// compiles an effective, ranked priority set for a given context (platform < enterprise < hospital < department <
// team < user) with lineage — the runtime that lets each workspace adapt to resolved priorities. Read model here;
// writes go through the service-role API layer with in-code role enforcement.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const NONE = "00000000-0000-0000-0000-000000000000";
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: null }));

// Hierarchy depth — lower number = broader scope (platform is the root of the cascade).
export const SCOPE_ORDER: Record<string, number> = { platform: 0, enterprise: 1, hospital: 2, department: 3, team: 4, user: 5 };
export const SCOPE_LABEL: Record<string, string> = { platform: "Platform", enterprise: "Enterprise", hospital: "Hospital", department: "Department", team: "Team", user: "Individual" };
const URGENCY_MULT: Record<string, number> = { low: 1, medium: 1.25, high: 1.6, critical: 2 };
export const URGENCY_TONE: Record<string, string> = { low: "slate", medium: "blue", high: "amber", critical: "rose" };

export type PriorityCtx = { hospitalId?: string | null; departmentId?: string | null; userId?: string | null; roles?: string[] };

export async function fetchFramework(admin: any) {
  const [themeRes, objRes, krRes, prioRes, campRes, actRes, apprRes, auditRes] = await Promise.all([
    soft(admin.from("ppe_strategic_themes").select("*").order("sort_order")),
    soft(admin.from("ppe_objectives").select("*").order("created_at", { ascending: false })),
    soft(admin.from("ppe_key_results").select("*")),
    soft(admin.from("ppe_priorities").select("*").order("base_weight", { ascending: false })),
    soft(admin.from("ppe_campaigns").select("*").order("start_date", { ascending: false })),
    soft(admin.from("ppe_actions").select("*")),
    soft(admin.from("ppe_approvals").select("*").order("requested_at", { ascending: false })),
    soft(admin.from("ppe_audit").select("*").order("created_at", { ascending: false }).limit(60)),
  ]);
  if (themeRes.error && missing(themeRes.error)) return { provisioned: false as const };

  const themes = (themeRes.data ?? []) as any[];
  const objectives = (objRes.data ?? []) as any[];
  const keyResults = (krRes.data ?? []) as any[];
  const priorities = (prioRes.data ?? []) as any[];
  const campaigns = (campRes.data ?? []) as any[];
  const actions = (actRes.data ?? []) as any[];
  const approvals = (apprRes.data ?? []) as any[];
  const audit = (auditRes.data ?? []) as any[];

  // Scope + owner name maps (label hospital/department scope_refs + owners).
  const scopeRefs = [...new Set([...themes, ...objectives, ...priorities, ...campaigns].map(r => r.scope_ref).filter(Boolean))];
  const ownerIds = [...new Set([...objectives.map(o => o.owner_id), ...campaigns.map(c => c.sponsor_id)].filter(Boolean))];
  const [hosRes, depRes, profRes] = await Promise.all([
    scopeRefs.length ? soft(admin.from("hospitals").select("id, name").in("id", scopeRefs)) : Promise.resolve({ data: [] }),
    scopeRefs.length ? soft(admin.from("departments").select("id, name").in("id", scopeRefs)) : Promise.resolve({ data: [] }),
    ownerIds.length ? soft(admin.from("profiles").select("id, full_name").in("id", ownerIds)) : Promise.resolve({ data: [] }),
  ]);
  const nameByRef = new Map<string, string>([...(hosRes.data ?? []), ...(depRes.data ?? [])].map((r: any) => [r.id, r.name]));
  const ownerById = new Map<string, string>((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  return { provisioned: true as const, themes, objectives, keyResults, priorities, campaigns, actions, approvals, audit, nameByRef, ownerById };
}

// Human-readable scope label (e.g. "Hospital · Al Mahmoud" / "Platform").
export function scopeName(scopeType: string, scopeRef: string | null, nameByRef: Map<string, string>): string {
  const base = SCOPE_LABEL[scopeType] ?? scopeType;
  if (!scopeRef) return base;
  const n = nameByRef.get(scopeRef);
  return n ? `${base} · ${n}` : base;
}

// Effective weight = base × urgency multiplier × mandatory boost (rounded).
export function effectiveWeight(p: any): number {
  return Math.round((p.base_weight ?? 50) * (URGENCY_MULT[p.urgency] ?? 1) * (p.mandatory ? 1.4 : 1));
}

const withinValidity = (p: any, today: string) => (!p.valid_from || p.valid_from <= today) && (!p.valid_to || p.valid_to >= today);

// Does a scoped row apply to the resolution context? platform/enterprise → always (single enterprise);
// hospital → scope_ref matches; department → matches; user → matches; team → treated as applicable when unset.
export function appliesToScope(row: any, ctx: PriorityCtx): boolean {
  switch (row.scope_type) {
    case "platform":
    case "enterprise": return true;
    case "hospital": return !ctx.hospitalId || row.scope_ref === ctx.hospitalId;
    case "department": return !ctx.departmentId || row.scope_ref === ctx.departmentId;
    case "user": return !ctx.userId || row.scope_ref === ctx.userId;
    case "team": return true;
    default: return true;
  }
}

// Compile the effective, ranked priority set for a context, with lineage. Published + in-validity + in-scope
// candidates are ranked by effective weight; a more-specific 'block' priority suppresses broader priorities of the
// same theme (local override). Returns rank, weight and originating scope for full traceability.
export function resolveEffectivePriorities(priorities: any[], ctx: PriorityCtx, nameByRef: Map<string, string>, today = new Date().toISOString().slice(0, 10)) {
  const candidates = priorities.filter(p => p.status === "published" && withinValidity(p, today) && appliesToScope(p, ctx));

  // Local 'block' suppression: a blocking priority hides broader-scope priorities sharing its theme.
  const blockers = candidates.filter(p => p.inheritance_mode === "block" && p.theme_id);
  const suppressed = new Set<string>();
  for (const b of blockers) {
    for (const p of candidates) {
      if (p.id !== b.id && p.theme_id === b.theme_id && (SCOPE_ORDER[p.scope_type] ?? 0) < (SCOPE_ORDER[b.scope_type] ?? 0)) suppressed.add(p.id);
    }
  }

  return candidates
    .filter(p => !suppressed.has(p.id))
    .map(p => ({ ...p, weight: effectiveWeight(p), sourceScope: scopeName(p.source_scope_type ?? p.scope_type, p.source_scope_ref ?? p.scope_ref, nameByRef) }))
    .sort((a, b) => b.weight - a.weight || (SCOPE_ORDER[b.scope_type] ?? 0) - (SCOPE_ORDER[a.scope_type] ?? 0))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}
