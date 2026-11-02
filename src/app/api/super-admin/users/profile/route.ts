import { NextResponse } from "next/server";
import { hqOwnerApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { isNotProvisioned } from "@/lib/individual/access";
import { planProfileEdit, recomposedFullName, type EditableField } from "@/lib/hq/user-profile-edit";

// Request-time only: it reads the session.
export const dynamic = "force-dynamic";

// PATCH /api/super-admin/users/profile -- HQ edits a person details. Body: { userId, fields, expected }.
// Owner gate, the same as POST /api/super-admin/users (hqOwnerApiGate on hq.platform.users.view).
//
// ⚠ ALLOWLIST: given_name, middle_names, family_name, full_name, phone, country. NEVER email, a role or a tenancy
// column (src/lib/hq/user-profile-edit.ts). preferred_name is the person own: HQ may set it only while they have no
// individual_identity_profile row (409 LEARNER_OWNED otherwise).
//
// ⚠ COMPARE-AND-SET. Every changed field is written WHERE it still equals the value the editor saw. Zero rows
// updated is 409 CHANGED: nothing is overwritten.
//
// ⚠ AUDITED. One audit_log row, action hq_user_profile_update: the field names, and the values before and after.

const NAME_OPT = new Set<EditableField>(["given_name", "middle_names"]);

export async function PATCH(req: Request) {
  const ctx = await hqOwnerApiGate(["hq.platform.users.view"]);
  if (isHqRefusal(ctx)) return ctx;
  const { admin, userId: actorId, fullName: actorName } = ctx;

  const planned = planProfileEdit(await req.json().catch(() => ({})));
  if (!planned.ok) return NextResponse.json({ error: { code: planned.code, message: planned.error } }, { status: planned.status });
  const { plan } = planned;
  const refuse = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

  // The row as it stands. Middle names (850) are read apart so their absence is "not set up", not a failure.
  const base = await admin.from("profiles").select("id, full_name, phone, country").eq("id", plan.userId).maybeSingle();
  if (base.error) return refuse(503, "UNAVAILABLE", "This person could not be read.");
  if (!base.data) return refuse(404, "NOT_FOUND", "No such person.");
  const parts = await admin.from("profiles").select("given_name, family_name").eq("id", plan.userId).maybeSingle();
  const mid = parts.error ? null : await admin.from("profiles").select("middle_names").eq("id", plan.userId).maybeSingle();
  const hasParts = !parts.error;
  const hasMiddle = !!mid && !mid.error;
  if (parts.error && !isNotProvisioned(parts.error)) return refuse(503, "UNAVAILABLE", "This person could not be read.");
  if (mid?.error && !isNotProvisioned(mid.error)) return refuse(503, "UNAVAILABLE", "This person could not be read.");
  if (!hasParts && ("given_name" in plan.changes || "family_name" in plan.changes))
    return refuse(409, "NOT_SET_UP", "Given and family names are not available in this environment yet. Nothing was changed.");
  if (!hasMiddle && "middle_names" in plan.changes)
    return refuse(409, "NOT_SET_UP", "Middle names are not available in this environment yet. Nothing was changed.");

  const current = {
    full_name: base.data.full_name ?? null, phone: base.data.phone ?? null, country: base.data.country ?? null,
    given_name: hasParts ? parts.data?.given_name ?? null : null,
    family_name: hasParts ? parts.data?.family_name ?? null : null,
    middle_names: hasMiddle ? mid!.data?.middle_names ?? null : null,
  };

  // preferred_name: only while the person has no identity profile row. Checked before anything is written.
  if (plan.preferredName !== undefined) {
    if (plan.preferredName === null) return refuse(409, "LEARNER_OWNED", "A preferred name can be set here, not cleared. It belongs to the person.");
    const row = await admin.from("individual_identity_profile").select("user_id").eq("user_id", plan.userId).maybeSingle();
    if (row.error) return isNotProvisioned(row.error)
      ? refuse(409, "NOT_SET_UP", "Preferred names are not available in this environment yet. Nothing was changed.")
      : refuse(503, "UNAVAILABLE", "This person could not be read.");
    if (row.data) return refuse(409, "LEARNER_OWNED", "This person has already set their own profile, so their preferred name is theirs to change. Nothing was changed.");
  }

  // The write: every changed field compared with what the editor saw.
  const set: Record<string, string | null> = { ...plan.changes };
  const expected: Record<string, string | null> = { ...plan.expected };
  const recomposed = recomposedFullName(current, plan.changes);
  if (recomposed) { set.full_name = recomposed; expected.full_name = current.full_name; }

  if (Object.keys(set).length) {
    let q = admin.from("profiles").update(set).eq("id", plan.userId);
    for (const col of Object.keys(set)) {
      const exp = expected[col];
      q = exp === null || exp === undefined ? q.is(col, null) : q.eq(col, exp);
    }
    const upd = await q.select("id");
    if (upd.error) {
      if (isNotProvisioned(upd.error) && [...NAME_OPT].some(k => k in set))
        return refuse(409, "NOT_SET_UP", "Some of these fields are not available in this environment yet. Nothing was changed.");
      return refuse(503, "WRITE_FAILED", "The details could not be saved. Nothing was changed.");
    }
    if (!(upd.data ?? []).length)
      return refuse(409, "CHANGED", "This person's details changed since you opened them. Reload to see the current values.");
  }

  if (typeof plan.preferredName === "string") {
    await admin.from("individual_identity_profile")
      .upsert({ user_id: plan.userId, preferred_name: plan.preferredName }, { onConflict: "user_id", ignoreDuplicates: true })
      .then((r: unknown) => r, () => null);
  }

  const before: Record<string, string | null> = {};
  const after: Record<string, string | null> = {};
  for (const col of Object.keys(set)) { before[col] = (current as Record<string, string | null>)[col] ?? null; after[col] = set[col]; }
  if (typeof plan.preferredName === "string") { before.preferred_name = null; after.preferred_name = plan.preferredName; }
  await admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: actorId, actor_name: actorName ?? null,
    action: "hq_user_profile_update", entity_type: "profile", entity_id: plan.userId,
    entity_name: after.full_name ?? current.full_name,
    new_value: { fields: Object.keys(after), before, after },
  }).then((r: unknown) => r, () => null);

  return NextResponse.json({ ok: true, updated: Object.keys(after), values: after });
}
