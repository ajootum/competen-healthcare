// Runtime context derivation (NCP-015) — builds the ScopeCtx for the CURRENT signed-in user from their profile,
// so a metadata-driven surface resolves and composes exactly what that user should see. Maps the app's real
// scoping columns onto the inheritance hierarchy: organisation → tenant, hospital → hospital, department → unit.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ScopeCtx } from "@/lib/config/workspace-config";
import { estateRolesOf } from "@/lib/roles";

export async function callerContext(admin: any, userId: string): Promise<ScopeCtx> {
  const { data: p } = await admin.from("profiles").select("role, roles, hospital_id, department_id, organisation_id").eq("id", userId).single();
  const roles: string[] = estateRolesOf(p);
  return {
    tenantId: p?.organisation_id ?? null,
    hospitalId: p?.hospital_id ?? null,
    unitId: p?.department_id ?? null,
    roles,
    userId,
  };
}
