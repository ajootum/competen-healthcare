/* eslint-disable @typescript-eslint/no-explicit-any */

// ── HQ USER DIRECTORY: WHAT EACH PERSON CAN REACH ── HQ-USERS-C, owner GO 2026-10-23 ──────────────────
//
// For /super-admin/users (hq.platform.users.view): every person's product memberships, HQ positions,
// Competen Individual access and Auth facts, composed from the tables that already decide them. Nothing
// here is a second copy of an access rule -- it reads the rows the gates read.
//
//   platform     platform_membership.status                      (279, gate 1)
//   enterprise   enterprise_membership.status + tenant name      (286)
//   practice     practice_membership status/role + workspace name (plane-boundary allowlisted columns only)
//   individual   individual_membership.status + individual_live_entitlement.experience_code (370, DB clock)
//   HQ           ogs_office_appointments on hq_* offices + hq_position names
//
// ⚠ NO PATIENT, CLINICAL OR PERSONAL-RECORD CONTENT. Ids, statuses, role codes and names of the
// organisations a person belongs to. No practice_* column outside src/lib/access/plane-boundary.ts, no
// Individual record table (needs, CPD, evidence, Scholar material), no consent text.
//
// ⚠ "COULD NOT BE READ" IS NOT "NONE". Each source reports whether it answered. The screen says
// "not readable" for a source that failed, never an empty list that reads as "has no access".

export type PracticeSeat = { workspace: string | null; role: string | null; status: string };
export type EnterpriseSeat = { tenant: string | null; status: string };
export type HqSeat = { position: string; name: string | null; status: string };
export type Access = {
  platform: string | null;
  enterprise: EnterpriseSeat[];
  practice: PracticeSeat[];
  individual: { membership: string | null; live: string[] };
  hq: HqSeat[];
};
export type Readable = { platform: boolean; enterprise: boolean; practice: boolean; individual: boolean; hq: boolean };
export const EMPTY_ACCESS = (): Access => ({ platform: null, enterprise: [], practice: [], individual: { membership: null, live: [] }, hq: [] });

type Rows = {
  platform: { user_id: string; status: string }[] | null;
  enterprise: { user_id: string; tenant_id: string; status: string }[] | null;
  tenants: { id: string; name: string }[] | null;
  practice: { user_id: string; workspace_id: string; role_code: string | null; status: string }[] | null;
  workspaces: { id: string; name: string | null }[] | null;
  individual: { user_id: string; status: string }[] | null;
  live: { user_id: string; experience_code: string }[] | null;
  appointments: { person_id: string | null; role: string | null; status: string | null; office_id: string }[] | null;
  hqOffices: { id: string }[] | null;
  positions: { code: string; name: string | null }[] | null;
};

/** Pure: per-person access from the rows. A null source means it could not be read. */
export function assembleAccess(r: Rows): { readable: Readable; byUser: Map<string, Access> } {
  const byUser = new Map<string, Access>();
  const at = (id: string) => { let a = byUser.get(id); if (!a) { a = EMPTY_ACCESS(); byUser.set(id, a); } return a; };
  const tenantName = new Map((r.tenants ?? []).map(t => [t.id, t.name]));
  const wsName = new Map((r.workspaces ?? []).map(w => [w.id, w.name]));
  const hqOffice = new Set((r.hqOffices ?? []).map(o => o.id));
  const posName = new Map((r.positions ?? []).map(p => [p.code, p.name]));

  for (const m of r.platform ?? []) at(m.user_id).platform = m.status;
  for (const m of r.enterprise ?? []) at(m.user_id).enterprise.push({ tenant: tenantName.get(m.tenant_id) ?? null, status: m.status });
  for (const m of r.practice ?? []) at(m.user_id).practice.push({ workspace: wsName.get(m.workspace_id) ?? null, role: m.role_code, status: m.status });
  for (const m of r.individual ?? []) at(m.user_id).individual.membership = m.status;
  for (const e of r.live ?? []) { const l = at(e.user_id).individual.live; if (!l.includes(e.experience_code)) l.push(e.experience_code); }
  for (const a of r.appointments ?? []) {
    if (!a.person_id || !a.role || !hqOffice.has(a.office_id)) continue;
    at(a.person_id).hq.push({ position: a.role, name: posName.get(a.role) ?? null, status: a.status ?? "unknown" });
  }
  return {
    readable: {
      platform: r.platform !== null, enterprise: r.enterprise !== null, practice: r.practice !== null,
      individual: r.individual !== null && r.live !== null, hq: r.appointments !== null && r.hqOffices !== null,
    },
    byUser,
  };
}

/** Pure: the product codes a person holds an ACTIVE seat in, for the filter. */
export function activeProducts(a: Access): ("platform" | "enterprise" | "practice" | "individual")[] {
  const out: ("platform" | "enterprise" | "practice" | "individual")[] = [];
  if (a.platform === "active") out.push("platform");
  if (a.enterprise.some(e => e.status === "active")) out.push("enterprise");
  if (a.practice.some(p => p.status === "active")) out.push("practice");
  if (a.individual.membership === "active" && a.individual.live.length > 0) out.push("individual");
  return out;
}
export const holdsHqPosition = (a: Access) => a.hq.some(h => h.status === "active");

const rows = async (p: Promise<any>) => { try { const { data, error } = await p; return error ? null : (data ?? []); } catch { return null; } };
const CAP = 20000;

/** Every source, read once. */
export async function loadDirectoryAccess(admin: any) {
  const [platform, enterprise, tenants, practice, workspaces, individual, live, appointments, hqOffices, positions] = await Promise.all([
    rows(admin.from("platform_membership").select("user_id, status").limit(CAP)),
    rows(admin.from("enterprise_membership").select("user_id, tenant_id, status").limit(CAP)),
    rows(admin.from("tenants").select("id, name").limit(CAP)),
    rows(admin.from("practice_membership").select("workspace_id, user_id, role_code, status").limit(CAP)),
    rows(admin.from("practice_workspace").select("id, name").limit(CAP)),
    rows(admin.from("individual_membership").select("user_id, status").limit(CAP)),
    rows(admin.from("individual_live_entitlement").select("user_id, experience_code").limit(CAP)),
    rows(admin.from("ogs_office_appointments").select("person_id, role, status, office_id").limit(CAP)),
    rows(admin.from("ogs_offices").select("id").like("office_type", "hq_%").limit(500)),
    rows(admin.from("hq_position").select("code, name").limit(500)),
  ]);
  return assembleAccess({ platform, enterprise, tenants, practice, workspaces, individual, live, appointments, hqOffices, positions });
}

/** Every Auth user, page by page: the old single page of 1000 silently dropped everyone after it. */
export async function listAllAuthUsers(admin: any, maxPages = 50): Promise<{ users: any[]; complete: boolean }> {
  const users: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return { users, complete: false };
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < 1000) return { users, complete: true };
  }
  return { users, complete: false };
}
