import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { resolveDashboardControls, DASHBOARD_CONFIG_PREFIX } from "@/lib/orchestration/dashboard-manifest";
import { DEFAULT_DASHBOARD_MANIFEST } from "@/app/dashboard/dashboard-registry";

// Ch.11 WS8 / PXP-AC-02, PXP-AC-08 — the user's own dashboard personalization, persisted as user-scope overrides
// the manifest resolver already reads. POST { key, hidden } hides/shows an OPTIONAL widget; POST { updates:[{key,
// order}] } reorders widgets within a zone; POST { reset:true } clears everything → org default. Policy is enforced
// SERVER-SIDE (required/locked/org-disabled can't be hidden — 403). Writes MERGE into any existing pref so hiding
// doesn't wipe a reorder and vice-versa.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id, tenant_id, unit_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const ctx = { tenantId: profile?.tenant_id ?? null, hospitalId: profile?.hospital_id ?? null, unitId: profile?.unit_id ?? null, roles, userId: user.id };
  const b = await req.json().catch(() => ({}));

  // Reset — drop the caller's user-scope personal-dashboard overrides.
  if (b.reset === true) {
    const { error } = await admin.from("workspace_config_overrides").delete().eq("scope_type", "user").eq("scope_ref", user.id).like("config_path", `${DASHBOARD_CONFIG_PREFIX}.%`);
    if (error) return NextResponse.json({ error: /does not exist|schema cache/i.test(error.message) ? "Config store not provisioned" : error.message }, { status: 409 });
    return NextResponse.json({ ok: true, reset: true });
  }

  const controls = await resolveDashboardControls(admin, ctx, DEFAULT_DASHBOARD_MANIFEST);
  const known = new Set(controls.map(c => c.key));

  // Merge a patch into the caller's existing user-scope override for a widget (preserves other prefs).
  const setPref = async (key: string, patch: any) => {
    const path = `${DASHBOARD_CONFIG_PREFIX}.${key}`;
    const { data: existing } = await admin.from("workspace_config_overrides").select("published").eq("scope_type", "user").eq("scope_ref", user.id).eq("config_path", path).maybeSingle();
    const published = { ...(existing?.published ?? {}), ...patch };
    return admin.from("workspace_config_overrides").upsert({ scope_type: "user", scope_ref: user.id, hospital_id: profile?.hospital_id ?? null, config_path: path, published, updated_by: user.id }, { onConflict: "scope_type,scope_ref,config_path" });
  };

  // Reorder — set order for each widget (position is a presentation pref; allowed regardless of state).
  if (Array.isArray(b.updates)) {
    for (const u of b.updates) {
      if (!known.has(u.key) || typeof u.order !== "number") continue;
      const { error } = await setPref(u.key, { order: u.order });
      if (error) return NextResponse.json({ error: /does not exist|schema cache/i.test(error.message) ? "Config store not provisioned" : error.message }, { status: 409 });
    }
    return NextResponse.json({ ok: true, reordered: b.updates.length });
  }

  // Hide/show — only OPTIONAL, org-enabled widgets (policy before preference, §11.4.2).
  const key = typeof b.key === "string" ? b.key : null;
  if (!key || typeof b.hidden !== "boolean") return NextResponse.json({ error: "key + hidden, or updates[], or reset required" }, { status: 400 });
  const control = controls.find(c => c.key === key);
  if (!control) return NextResponse.json({ error: "Unknown widget" }, { status: 404 });
  if (!control.canToggle) return NextResponse.json({ error: `"${control.label}" is ${control.state} by policy and can't be changed.`, state: control.state }, { status: 403 });
  const { error } = await setPref(key, { enabled: !b.hidden });
  if (error) return NextResponse.json({ error: /does not exist|schema cache/i.test(error.message) ? "Config store not provisioned" : error.message }, { status: 409 });
  return NextResponse.json({ ok: true, key, hidden: b.hidden });
}
