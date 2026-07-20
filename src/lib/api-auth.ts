import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// ── API authorization & tenant-scoping helpers ───────────────────────────────
// Route handlers that use the service-role admin client BYPASS Supabase RLS, so
// they MUST enforce role + tenant scope in code. `getCaller()` authenticates and
// loads the caller's role/tenant; the `assert*` helpers verify that a
// client-supplied id belongs to the caller's hospital (super_admin is unscoped).
// Every assert returns a NextResponse (deny) or null (allow).

export type Caller = {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  role: string;
  roles: string[];
  hospitalId: string | null;
  organisationId: string | null;
};

export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse;
export const unauthorized = (msg = "Unauthorized") => NextResponse.json({ error: msg }, { status: 401 });
export const forbidden = (msg = "Forbidden") => NextResponse.json({ error: msg }, { status: 403 });
export const badRequest = (msg = "Bad request") => NextResponse.json({ error: msg }, { status: 400 });

// Role groups.
export const STAFF_ROLES = ["assessor", "educator", "senior_educator", "clinical_educator", "curriculum_lead", "assessment_lead", "simulation_lead", "quality_reviewer", "education_administrator", "program_director", "hospital_admin", "super_admin"];
export const EDUCATOR_ROLES = ["educator", "senior_educator", "clinical_educator", "curriculum_lead", "assessment_lead", "simulation_lead", "education_administrator", "program_director", "hospital_admin", "super_admin"];
export const ADMIN_ROLES = ["hospital_admin", "super_admin"];

export const hasRole = (c: Caller, ...roles: string[]) => c.roles.some(r => roles.includes(r));
export const isSuper = (c: Caller) => hasRole(c, "super_admin");
export const isStaff = (c: Caller) => hasRole(c, ...STAFF_ROLES);
export const isEducator = (c: Caller) => hasRole(c, ...EDUCATOR_ROLES);
export const isAdmin = (c: Caller) => hasRole(c, ...ADMIN_ROLES);

// Authenticate and load the caller's role + tenant. Returns a NextResponse on
// failure (caller does `if (isResponse(c)) return c`).
export async function getCaller(): Promise<Caller | NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return unauthorized();
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id, organisation_id").eq("id", user.id).single();
  const roles = ((me?.roles?.length ? me.roles : [me?.role]) as (string | null)[]).filter(Boolean) as string[];
  return { admin, userId: user.id, role: (me?.role as string) ?? "", roles, hospitalId: (me?.hospital_id as string) ?? null, organisationId: (me?.organisation_id as string) ?? null };
}

// Require the caller to hold at least one of `roles`; null = allowed.
export function requireRole(c: Caller, roles: string[]): NextResponse | null {
  return hasRole(c, ...roles) ? null : forbidden();
}

// True when the caller may act on data owned by `hospitalId` (super = any).
export function inScope(c: Caller, hospitalId: string | null | undefined): boolean {
  if (isSuper(c)) return true;
  return !!hospitalId && !!c.hospitalId && hospitalId === c.hospitalId;
}

// Resolve a row's hospital via a column and assert the caller may act on it.
export async function assertRowScope(c: Caller, table: string, id: string, hospitalCol = "hospital_id"): Promise<NextResponse | null> {
  if (isSuper(c)) return null;
  if (!id) return badRequest("Missing id");
  const { data } = await c.admin.from(table).select(hospitalCol).eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return inScope(c, (data as unknown as Record<string, string | null>)[hospitalCol]) ? null : forbidden("Out of scope");
}

// Assert a target profile (e.g. a nurse) is in the caller's hospital.
export async function assertProfileScope(c: Caller, profileId: string): Promise<NextResponse | null> {
  if (isSuper(c)) return null;
  if (!profileId) return badRequest("Missing user id");
  const { data } = await c.admin.from("profiles").select("hospital_id").eq("id", profileId).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return inScope(c, data.hospital_id as string | null) ? null : forbidden("Out of scope");
}

// Assert a competency cycle belongs to the caller's hospital.
export async function assertCycleScope(c: Caller, cycleId: string): Promise<NextResponse | null> {
  if (isSuper(c)) return null;
  if (!cycleId) return badRequest("Missing cycle id");
  const { data } = await c.admin.from("competency_cycles").select("hospital_id").eq("id", cycleId).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return inScope(c, data.hospital_id as string | null) ? null : forbidden("Out of scope");
}

// Assert a framework belongs to the caller's hospital. Global/master frameworks
// (hospital_id null) are writable only by super_admin.
export async function assertFrameworkScope(c: Caller, frameworkId: string, opts: { write?: boolean } = {}): Promise<NextResponse | null> {
  if (isSuper(c)) return null;
  if (!frameworkId) return badRequest("Missing framework id");
  const { data } = await c.admin.from("frameworks").select("hospital_id").eq("id", frameworkId).maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const hid = data.hospital_id as string | null;
  if (hid === null) return opts.write ? forbidden("Master library is read-only") : null; // shared library: readable, not writable
  return inScope(c, hid) ? null : forbidden("Out of scope");
}

// Resolve the framework that owns a competency (competency → domain → framework).
export async function assertCompetencyScope(c: Caller, competencyId: string, opts: { write?: boolean } = {}): Promise<NextResponse | null> {
  if (isSuper(c)) return null;
  if (!competencyId) return badRequest("Missing competency id");
  const { data } = await c.admin.from("framework_competencies").select("domain_id, framework_domains!domain_id(framework_id)").eq("id", competencyId).maybeSingle();
  const fwId = (data as { framework_domains?: { framework_id?: string } } | null)?.framework_domains?.framework_id;
  if (!fwId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return assertFrameworkScope(c, fwId, opts);
}

// The set of hospital ids the caller may see (null = unrestricted, for super).
export function scopeHospitalIds(c: Caller): string[] | null {
  return isSuper(c) ? null : (c.hospitalId ? [c.hospitalId] : ["__none__"]);
}
