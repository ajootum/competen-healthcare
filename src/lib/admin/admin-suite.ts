import { estateRolesOf } from "@/lib/roles";
// UMW Administration & Configuration shared data layer (UMW-ADM-001..009). One fail-soft read of the adm_* stores
// (unit profile / rooms / services / operational rules / documents / assets / forms / config items / delegations /
// change register / AI recommendations / automations) PLUS reused structure counts from op_beds / departments /
// positions / break_glass. Every ADM module is a lens over this. Read model; no-code authoring is the next phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const NONE = "00000000-0000-0000-0000-000000000000";
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: null }));

export async function fetchAdmin(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [profRes, roomRes, svcRes, ruleRes, docRes, assetRes, formRes, cfgRes, delegRes, chgRes, aiRes, autoRes,
    bedRes, deptRes, posRes, bgRes, rolesRes] = await Promise.all([
    soft(scope(admin.from("adm_unit_profile").select("*")).limit(1)),
    soft(scope(admin.from("adm_rooms").select("*"))),
    soft(scope(admin.from("adm_services").select("*"))),
    soft(scope(admin.from("adm_operational_rules").select("*"))),
    soft(scope(admin.from("adm_documents").select("*")).order("review_date")),
    soft(scope(admin.from("adm_assets").select("*"))),
    soft(scope(admin.from("adm_forms").select("*"))),
    soft(scope(admin.from("adm_config_items").select("*"))),
    soft(scope(admin.from("adm_delegations").select("*"))),
    soft(scope(admin.from("adm_changes").select("*")).order("created_at", { ascending: false })),
    soft(scope(admin.from("adm_ai_recommendations").select("*")).order("created_at", { ascending: false })),
    soft(scope(admin.from("adm_automations").select("*"))),
    soft(scope(admin.from("op_beds").select("status")).limit(500)),
    soft(scope(admin.from("departments").select("id, name"))),
    soft(scope(admin.from("positions").select("id, status")).limit(500)),
    soft(scope(admin.from("break_glass_grant").select("id, status, created_at")).limit(50)),
    soft(scope(admin.from("profiles").select("role, roles")).limit(500)),
  ]);
  // Provisioned = the adm stores exist (documents is the anchor, from migration 109).
  if (docRes.error && missing(docRes.error) && (profRes.error && missing(profRes.error))) return { provisioned: false as const };

  const owners = new Set<string>();
  [profRes, docRes, assetRes, delegRes, chgRes].forEach((r: any) => (r.data ?? []).forEach((row: any) => { [row.owner_id, row.custodian_id, row.manager_id, row.delegate_id, row.delegated_by, row.author_id].forEach((id) => id && owners.add(id)); }));
  const profListRes = owners.size ? await soft(admin.from("profiles").select("id, full_name").in("id", [...owners])) : { data: [] };
  const nameById = new Map<string, string>((profListRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  const beds = (bedRes.data ?? []) as any[];
  const positionsRows = (posRes.data ?? []) as any[];
  const profileRows = (rolesRes.data ?? []) as any[];
  const roleDist: Record<string, number> = {};
  profileRows.forEach((p) => { const rs = estateRolesOf(p); (rs.length ? rs : ["unassigned"]).forEach((r: string) => { roleDist[r] = (roleDist[r] ?? 0) + 1; }); });

  return {
    provisioned: true as const,
    profile: (profRes.data ?? [])[0] ?? null,
    rooms: (roomRes.data ?? []) as any[],
    services: (svcRes.data ?? []) as any[],
    rules: (ruleRes.data ?? []) as any[],
    documents: (docRes.data ?? []) as any[],
    assets: (assetRes.data ?? []) as any[],
    forms: (formRes.data ?? []) as any[],
    config: (cfgRes.data ?? []) as any[],
    delegations: (delegRes.data ?? []) as any[],
    changes: (chgRes.data ?? []) as any[],
    aiRecs: (aiRes.data ?? []) as any[],
    automations: (autoRes.data ?? []) as any[],
    reused: {
      beds, bedTotal: beds.length, bedOccupied: beds.filter((b) => b.status === "occupied").length,
      departments: (deptRes.data ?? []) as any[],
      positionTotal: positionsRows.length,
      positionFilled: positionsRows.filter((p) => ["filled", "active", "assigned"].includes(String(p.status))).length,
      emergencyAccess: ((bgRes.data ?? []) as any[]),
      totalUsers: profileRows.length, roleDist,
    },
    nameById,
    hasData: (docRes.data ?? []).length + (assetRes.data ?? []).length + ((profRes.data ?? []).length) > 0,
  };
}

export const STATUS_TONE: Record<string, string> = { draft: "slate", in_review: "blue", pending_approval: "amber", published: "emerald", approved: "emerald", archived: "slate", active: "emerald", inactive: "slate", rolled_back: "rose", cancelled: "slate", scheduled: "blue", expired: "slate", revoked: "rose", paused: "amber", open: "amber", accepted: "emerald", dismissed: "slate" };
export const RISK_TONE: Record<string, string> = { low: "slate", medium: "amber", high: "rose" };
export const daysLeft = (d: string | null) => (d ? Math.round((new Date(d).getTime() - Date.now()) / 86400000) : null);
