/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-028 — service-profile creation engine (migration 151). Extracted from the route so the exact shipped
// logic — validation, insert, rollback — can be exercised directly by a harness; the route owns auth/audit.
//
// Rules enforced here (not just at the DB):
//   • a profile with no requirements gates nothing → rejected;
//   • every competency id is validated against framework_competencies BEFORE insert (clean 400, not an FK 500);
//   • no half-written profiles — if the requirements insert fails, the profile row is rolled back.

const LEVELS = new Set(["novice", "advanced_beginner", "competent", "proficient", "expert", "mentor", "authority"]);

export type CreateProfileInput = {
  name: string;
  code?: string | null;
  description?: string | null;
  requirements: { competency_id: string; min_staff?: number; min_level?: string | null; is_critical?: boolean; notes?: string | null }[];
  hospitalId?: string | null;     // null = shared template (frameworks master-library convention)
  createdBy?: string | null;
  createdByName?: string | null;
};

export type CreateProfileResult =
  | { ok: true; profile: { id: string; name: string } }
  | { ok: false; error: string; status: 400 | 500 | 503 };

export async function createServiceProfile(admin: any, input: CreateProfileInput): Promise<CreateProfileResult> {
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, error: "name required", status: 400 };
  const reqs = Array.isArray(input.requirements) ? input.requirements : [];
  if (!reqs.length) return { ok: false, error: "at least one required competency is needed — a profile with no requirements gates nothing", status: 400 };

  const ids = [...new Set(reqs.map((r) => r?.competency_id).filter(Boolean))];
  if (!ids.length || ids.length !== reqs.length) return { ok: false, error: "every requirement needs a distinct competency_id", status: 400 };
  const { data: comps } = await admin.from("framework_competencies").select("id").in("id", ids);
  const known = new Set((comps ?? []).map((x: any) => x.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) return { ok: false, error: `Unknown competency id(s): ${unknown.map((x) => String(x).slice(0, 8)).join(", ")}…`, status: 400 };
  for (const r of reqs) {
    if (r.min_level && !LEVELS.has(r.min_level)) return { ok: false, error: `Unknown min_level ${r.min_level}`, status: 400 };
    if (r.min_staff != null && (!Number.isInteger(r.min_staff) || r.min_staff < 1)) return { ok: false, error: "min_staff must be an integer >= 1", status: 400 };
  }

  const { data: profile, error } = await admin.from("service_profiles").insert({
    hospital_id: input.hospitalId ?? null,
    name, code: String(input.code ?? "").trim() || null, description: String(input.description ?? "").trim() || null,
    status: "draft", created_by: input.createdBy ?? null, created_by_name: input.createdByName ?? null,
  }).select("id, name").single();
  if (error) {
    const missing = /does not exist|schema cache/i.test(String(error.message ?? ""));
    return { ok: false, error: missing ? "Apply migration 151 to enable service profiles." : error.message, status: missing ? 503 : 500 };
  }

  const { error: rerr } = await admin.from("service_required_competencies").insert(reqs.map((r) => ({
    profile_id: profile.id, competency_id: r.competency_id,
    min_staff: r.min_staff ?? 1, min_level: r.min_level ?? null,
    is_critical: !!r.is_critical, notes: String(r.notes ?? "").trim() || null,
  })));
  if (rerr) {
    await admin.from("service_profiles").delete().eq("id", profile.id);   // no half-written profiles
    return { ok: false, error: rerr.message, status: 500 };
  }

  return { ok: true, profile };
}
