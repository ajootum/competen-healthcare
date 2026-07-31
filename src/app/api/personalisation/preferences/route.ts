import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { loadPersonalisation, validateWrite, PREF_KEYS } from "@/lib/personalisation/preferences";

// UMW-TLS-005 preference writes. A person writes their OWN preferences and nobody else's — user_id comes from
// the session, never from the body, so there is no subject-vs-caller scoping hole to get wrong here.
//
// A write that a policy forbids is REJECTED with the reason, not silently dropped. Silently ignoring a change
// someone just made is the worse failure: they would believe the setting took effect.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const ctx = { hospitalId: profile?.hospital_id ?? null, roles };

  const body = await req.json().catch(() => ({}));
  const patch = (body?.preferences ?? {}) as Record<string, any>;
  const keys = Object.keys(patch).filter(k => PREF_KEYS.includes(k as any));
  if (!keys.length) return NextResponse.json({ error: "No recognised preferences in request." }, { status: 400 });

  const state = await loadPersonalisation(admin, user.id, ctx);
  if (!state.provisioned) return NextResponse.json({ error: "Preference storage is not provisioned (migration 164)." }, { status: 503 });

  const accepted: Record<string, string | null> = {};
  const rejected: { key: string; reason: string }[] = [];
  for (const k of keys) {
    const v = validateWrite(k, patch[k], state.resolved);
    if (v.ok) accepted[k] = v.stored; else rejected.push({ key: k, reason: v.reason });
  }
  if (!Object.keys(accepted).length) return NextResponse.json({ error: rejected[0]?.reason ?? "Nothing to save.", rejected }, { status: 403 });

  // Audit BEFORE overwriting, so the old value is still readable. Booleans are stored as text in the audit so
  // one column can carry every preference type without a second table.
  const prior = state.resolved;
  const { error } = await admin.from("user_preferences")
    .upsert({ user_id: user.id, ...accepted, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const trail = Object.entries(accepted).map(([k, v]) => ({
    user_id: user.id, pref_key: k,
    old_value: prior.find(p => p.key === k)?.value == null ? null : String(prior.find(p => p.key === k)!.value),
    new_value: v, source: "user",
  }));
  if (trail.length) await admin.from("user_preference_audit").insert(trail);

  const next = await loadPersonalisation(admin, user.id, ctx);
  return NextResponse.json({ ok: true, saved: Object.keys(accepted), rejected, counts: next.counts });
}

// Clearing a preference returns it to the inherited default rather than to a hard-coded value — the whole
// point of the three-layer resolver.
export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;

  const body = await req.json().catch(() => ({}));
  const key = String(body?.key ?? "");
  if (!PREF_KEYS.includes(key as any)) return NextResponse.json({ error: "Unknown preference." }, { status: 400 });

  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const ctx = { hospitalId: profile?.hospital_id ?? null, roles };
  const state = await loadPersonalisation(admin, user.id, ctx);
  if (!state.provisioned) return NextResponse.json({ error: "Preference storage is not provisioned (migration 164)." }, { status: 503 });

  const before = state.resolved.find(r => r.key === (key as any));
  const { error } = await admin.from("user_preferences")
    .upsert({ user_id: user.id, [key]: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("user_preference_audit").insert([{
    user_id: user.id, pref_key: key,
    old_value: before?.value == null ? null : String(before.value), new_value: null, source: "reset",
  }]);

  const next = await loadPersonalisation(admin, user.id, ctx);
  return NextResponse.json({ ok: true, cleared: key, value: next.resolved.find(r => r.key === (key as any))?.value ?? null });
}
