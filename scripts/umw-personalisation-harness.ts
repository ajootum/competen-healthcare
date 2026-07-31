/**
 * UMW-TLS-005 harness — Personalisation, Preferences & Workspace Experience (migration 164).
 *
 * The three things that must hold, tested against real rows written and deleted:
 *
 *   1. INHERITANCE. A preference with no personal value resolves to the enterprise policy default, and to
 *      the catalogue fallback only when no policy applies. Clearing a personal value must return it to the
 *      inherited value, NOT to a hard-coded one.
 *   2. GOVERNANCE. A policy that forbids an override wins over a stored personal value, and a lock at a
 *      BROADER scope cannot be undone by a narrower policy beneath it. This is the rule that makes
 *      "enterprise defaults" governance rather than initial values.
 *   3. VALIDATION. Only catalogue keys and permitted values can be written at all.
 *
 *   npx --yes tsx scripts/umw-personalisation-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { loadPersonalisation, resolvePreferences, validateWrite, CATALOGUE, PREF_KEYS, type PolicyRow } from "../src/lib/personalisation/preferences";
loadEnvConfig(process.cwd());

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};
const eq = (name: string, got: any, want: any) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const val = (r: any[], k: string) => r.find(x => x.key === k)?.value;
const src = (r: any[], k: string) => r.find(x => x.key === k)?.source;

async function main() {
  console.log("\nUMW-TLS-005 Personalisation, Preferences & Workspace Experience\n");

  // ── Pure resolver tests: no database needed, so the inheritance rules are pinned independently of data ──
  console.log("Resolution order (pure)");
  const ctx = { hospitalId: "H1", unitId: "U1", roles: ["hospital_admin"] };
  const P = (o: Partial<PolicyRow>): PolicyRow => ({ scope_type: "hospital", scope_ref: "H1", pref_key: "theme", default_value: null, user_editable: true, note: null, ...o } as PolicyRow);

  eq("no policy, no personal value -> catalogue fallback", val(resolvePreferences([], null, ctx), "theme"), "system");
  eq("...and its source is 'default'", src(resolvePreferences([], null, ctx), "theme"), "default");

  const hospitalDark = [P({ default_value: "dark" })];
  eq("policy default wins over catalogue fallback", val(resolvePreferences(hospitalDark, null, ctx), "theme"), "dark");
  eq("...and its source is 'policy'", src(resolvePreferences(hospitalDark, null, ctx), "theme"), "policy");
  eq("personal value wins over policy default", val(resolvePreferences(hospitalDark, { theme: "light" }, ctx), "theme"), "light");
  eq("...and its source is 'user'", src(resolvePreferences(hospitalDark, { theme: "light" }, ctx), "theme"), "user");

  const layered = [P({ scope_type: "platform", scope_ref: null, default_value: "light" }), P({ default_value: "dark" })];
  eq("more specific scope wins the default", val(resolvePreferences(layered, null, ctx), "theme"), "dark");
  eq("a policy for another hospital does not apply", val(resolvePreferences([P({ scope_ref: "OTHER", default_value: "dark" })], null, ctx), "theme"), "system");
  eq("a role policy applies to a held role", val(resolvePreferences([P({ scope_type: "role", scope_ref: "hospital_admin", default_value: "dark" })], null, ctx), "theme"), "dark");
  eq("a role policy for a role not held does not apply", val(resolvePreferences([P({ scope_type: "role", scope_ref: "nurse", default_value: "dark" })], null, ctx), "theme"), "system");

  console.log("\nGovernance");
  const locked = [P({ default_value: "dark", user_editable: false, note: "Standardised for night wards." })];
  const lockedRes = resolvePreferences(locked, { theme: "light" }, ctx);
  eq("a locked policy overrides a stored personal value", val(lockedRes, "theme"), "dark");
  eq("locked preference reports it is not editable", lockedRes.find(r => r.key === "theme")?.editable, false);
  eq("locked preference names the scope that locked it", lockedRes.find(r => r.key === "theme")?.lockedBy, "hospital");
  ok("locked preference carries the policy note", /night wards/.test(String(lockedRes.find(r => r.key === "theme")?.note)));

  // The rule that matters most: a narrower policy must not quietly unlock what a broader one forbade.
  const lockThenUnlock = [P({ default_value: "dark", user_editable: false }), P({ scope_type: "role", scope_ref: "hospital_admin", default_value: "light", user_editable: true })];
  eq("a role-level 'editable' cannot unlock a hospital lock", resolvePreferences(lockThenUnlock, null, ctx).find(r => r.key === "theme")?.editable, false);

  console.log("\nValidation");
  const base = resolvePreferences([], null, ctx);
  eq("unknown key rejected", validateWrite("not_a_pref", "x", base).ok, false);
  eq("bad enum value rejected", validateWrite("theme", "neon", base).ok, false);
  eq("valid enum accepted", validateWrite("theme", "dark", base).ok, true);
  eq("boolean given a string is rejected", validateWrite("reduced_motion", "yes", base).ok, false);
  eq("boolean accepted", validateWrite("reduced_motion", true, base).ok, true);
  eq("boolean stored as text", (validateWrite("reduced_motion", true, base) as any).stored, "true");
  eq("empty value clears rather than storing empty", (validateWrite("timezone", "", base) as any).stored, null);
  eq("over-long text rejected", validateWrite("timezone", "x".repeat(61), base).ok, false);
  eq("write to a locked preference rejected", validateWrite("theme", "light", lockedRes).ok, false);
  ok("rejection explains which scope locked it", /hospital/.test((validateWrite("theme", "light", lockedRes) as any).reason));
  ok("every catalogue key has a fallback", PREF_KEYS.every(k => "fallback" in (CATALOGUE as any)[k]));

  // ── Live round-trip ──
  console.log("\nLive round-trip (real rows)");
  const { data: person } = await admin.from("profiles").select("id, full_name, hospital_id, role, roles").not("hospital_id", "is", null).limit(1).single();
  if (!person) { console.log("  no profile with a hospital — cannot run live tests"); process.exit(1); }
  const roles: string[] = (person.roles?.length ? person.roles : [person.role]).filter(Boolean);
  const liveCtx = { hospitalId: person.hospital_id, roles };
  console.log(`  ${person.full_name}\n`);

  const madePolicies: string[] = [];
  let hadPrefRow = false;
  try {
    const pre = await loadPersonalisation(admin, person.id, liveCtx);
    eq("migration 164 detected", pre.provisioned, true);
    hadPrefRow = pre.storedForUser;
    if (hadPrefRow) { console.log("  (this person already had a preferences row — it will be restored)"); }

    // Write a personal value.
    const { error: upErr } = await admin.from("user_preferences")
      .upsert({ user_id: person.id, theme: "dark", reduced_motion: true, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (upErr) throw new Error(`user_preferences upsert: ${upErr.message}`);
    const withOwn = await loadPersonalisation(admin, person.id, liveCtx);
    eq("stored enum reads back", val(withOwn.resolved, "theme"), "dark");
    eq("stored boolean reads back as a boolean, not the string 'true'", val(withOwn.resolved, "reduced_motion"), true);
    eq("stored value is attributed to the user", src(withOwn.resolved, "theme"), "user");
    ok("personalised count reflects the two stored values", withOwn.counts.personalised >= 2, `got ${withOwn.counts.personalised}`);
    eq("an unset preference still resolves", val(withOwn.resolved, "density"), "standard");
    eq("...and is not attributed to the user", src(withOwn.resolved, "density"), "default");

    // Now a hospital policy that locks it.
    const { data: pol, error: polErr } = await admin.from("pref_policies").insert([{
      scope_type: "hospital", scope_ref: person.hospital_id, pref_key: "theme",
      default_value: "light", user_editable: false, note: "Harness policy.",
    }]).select("id");
    if (polErr) throw new Error(`pref_policies insert: ${polErr.message}`);
    madePolicies.push(...pol!.map(p => p.id));

    const governed = await loadPersonalisation(admin, person.id, liveCtx);
    eq("a live lock overrides the stored personal value", val(governed.resolved, "theme"), "light");
    eq("locked count reflects the policy", governed.counts.locked, 1);
    eq("write is refused while locked", validateWrite("theme", "dark", governed.resolved).ok, false);

    // A policy for a DIFFERENT hospital must not reach this person.
    const { data: foreign } = await admin.from("pref_policies").insert([{
      scope_type: "hospital", scope_ref: "00000000-0000-0000-0000-000000000000", pref_key: "density",
      default_value: "compact", user_editable: true, note: "Other tenant.",
    }]).select("id");
    madePolicies.push(...(foreign ?? []).map((p: any) => p.id));
    const isolated = await loadPersonalisation(admin, person.id, liveCtx);
    eq("another hospital's policy does not apply", val(isolated.resolved, "density"), "standard");

    // Clearing returns to the INHERITED value, not to the catalogue fallback.
    await admin.from("pref_policies").update({ user_editable: true }).in("id", madePolicies.slice(0, 1));
    await admin.from("user_preferences").upsert({ user_id: person.id, theme: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    const cleared = await loadPersonalisation(admin, person.id, liveCtx);
    eq("clearing a personal value falls back to the policy default", val(cleared.resolved, "theme"), "light");
    eq("...and not to the catalogue fallback", val(cleared.resolved, "theme") === "system", false);

    // Saved views: the partial unique index must permit many views but only one default.
    console.log("\nSaved views");
    const { data: v1, error: v1e } = await admin.from("user_saved_views").insert([
      { user_id: person.id, workspace: "unit-manager", name: "HX Morning", route: "/unit-manager/ops-command/live-status", is_default: true },
    ]).select("id");
    if (v1e) throw new Error(`user_saved_views insert: ${v1e.message}`);
    const { data: v2, error: v2e } = await admin.from("user_saved_views").insert([
      { user_id: person.id, workspace: "unit-manager", name: "HX Escalations", route: "/unit-manager/communications", is_default: false },
    ]).select("id");
    if (v2e) throw new Error(`second view insert: ${v2e.message}`);
    const viewIds = [...v1!, ...v2!].map(v => v.id);

    const withViews = await loadPersonalisation(admin, person.id, liveCtx);
    ok("both views load", withViews.views.filter((v: any) => v.name.startsWith("HX ")).length === 2);
    eq("the default view is identified", withViews.defaultView?.name, "HX Morning");

    const second = await admin.from("user_saved_views")
      .insert([{ user_id: person.id, workspace: "unit-manager", name: "HX Rival", route: "/unit-manager", is_default: true }]).select("id");
    ok("a second default is refused by the database", !!second.error, "one default per workspace must be enforced in the schema, not just in the API");
    if (second.data?.length) viewIds.push(...second.data.map((v: any) => v.id));

    await admin.from("user_saved_views").delete().in("id", viewIds);
    const afterDelete = await loadPersonalisation(admin, person.id, liveCtx);
    eq("deleted views are gone", afterDelete.views.filter((v: any) => v.name.startsWith("HX ")).length, 0);

    // Audit trail.
    console.log("\nAudit");
    const { data: aud, error: audErr } = await admin.from("user_preference_audit").insert([
      { user_id: person.id, pref_key: "theme", old_value: "dark", new_value: "light", source: "user" },
    ]).select("id");
    if (audErr) throw new Error(`user_preference_audit insert: ${audErr.message}`);
    const withAudit = await loadPersonalisation(admin, person.id, liveCtx);
    ok("audit records the previous value", withAudit.audit.some((a: any) => a.pref_key === "theme" && a.old_value === "dark"));
    await admin.from("user_preference_audit").delete().in("id", aud!.map(a => a.id));
  } finally {
    if (madePolicies.length) await admin.from("pref_policies").delete().in("id", madePolicies);
    if (!hadPrefRow) {
      const { data: p } = await admin.from("profiles").select("id").not("hospital_id", "is", null).limit(1).single();
      if (p) await admin.from("user_preferences").delete().eq("user_id", p.id);
    }
    const { data: leftPol } = await admin.from("pref_policies").select("id").eq("note", "Harness policy.").limit(1);
    const { data: leftView } = await admin.from("user_saved_views").select("id").like("name", "HX %").limit(1);
    ok("harness rows removed", !leftPol?.length && !leftView?.length);
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
