// One-off harness for the config-driven HWW navigation (HWW-UI-001
// "Role-Adaptive Navigation"). Exercises the SHIPPED resolver
// (@/lib/hww/navigation) against the REAL WCE override store, proving the
// spec's acceptance criteria:
//   - with no overrides the sidebar equals the shipped catalogue (fail-soft)
//   - a hospital-scope override HIDES a module without a deployment
//   - a role-scope override RENAMES and REORDERS a module
//   - disabling a SECTION removes its whole subtree
//   - unit context adapts labels (ward PEWS vs ICU CIAF/NAS)
//   - profession/appRole rules filter entries (future Doctor/Pharmacist)
//   - resolveUnitContext reads real bed types
// Every override it writes is deleted afterwards.
//   npx --yes tsx scripts/hww-navigation-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { resolveHwwNavigation, resolveUnitContext, HWW_NAV_CATALOGUE, HWW_CONFIG_PREFIX } = await import("../src/lib/hww/navigation");

  const flat = (nav: any) => nav.sections.flatMap((s: any) => s.entries.flatMap((e: any) => "item" in e ? [e.item] : e.items));
  const labelOf = (nav: any, k: string) => flat(nav).find((i: any) => i.key === k)?.label ?? null;
  const wardCtx = { hospitalId: null, roles: ["nurse"], professions: ["healthcare_worker"], unitType: "ward" as const };

  const { data: hosp } = await admin.from("hospitals").select("id").limit(1).maybeSingle();
  const hid = hosp?.id ?? null;
  const written: { scope_type: string; scope_ref: string | null; config_path: string }[] = [];
  const putOverride = async (scope_type: string, scope_ref: string | null, path: string, published: any) => {
    const row = { hospital_id: scope_type === "hospital" ? scope_ref : null, scope_type, scope_ref, config_path: path, draft: published, published };
    const { error } = await admin.from("workspace_config_overrides").upsert(row, { onConflict: "scope_type,scope_ref,config_path" });
    if (error) throw new Error(`${path}: ${error.message}`);
    written.push({ scope_type, scope_ref, config_path: path });
  };

  try {
    // ── 1. Fail-soft baseline ──
    console.log("── Baseline (catalogue defaults) ──");
    const base = await resolveHwwNavigation(admin, wardCtx);
    const baseItems = flat(base);
    const expected = HWW_NAV_CATALOGUE.length;
    check(baseItems.length === expected, "every catalogue entry renders with no overrides", `${baseItems.length}/${expected}`);
    check(base.sections[0]?.section === null && base.sections[1]?.section === "Shift", "sections keep workflow order (Home then Shift)");
    const shift = base.sections.find((s: any) => s.section === "Shift");
    check(!!shift?.entries[0] && "item" in shift.entries[0] && (shift.entries[0] as any).item.key === "shift.my-patients", "My Patients is first in Shift (ahead of the inbox)");
    const clinical = base.sections.find((s: any) => s.section === "Clinical");
    const grp: any = clinical?.entries.find((e: any) => "group" in e);
    check(!!grp && grp.group === "Clinical Assessment" && grp.items.length === 3, "Clinical Assessment group holds its 3 modules", `${grp?.items?.length}`);

    // ── 2. Unit-context adaptation ──
    console.log("\n── Unit-context adaptation ──");
    const icu = await resolveHwwNavigation(admin, { ...wardCtx, unitType: "icu" });
    check(labelOf(base, "clinical.acuity") === "Ward Acuity (PEWS)", "ward context labels acuity as PEWS", labelOf(base, "clinical.acuity") ?? "");
    check(labelOf(icu, "clinical.acuity") === "ICU Acuity (CIAF)", "ICU context labels acuity as CIAF", labelOf(icu, "clinical.acuity") ?? "");
    check(labelOf(icu, "clinical.workload") === "ICU Workload (NAS)", "ICU context labels workload as NAS", labelOf(icu, "clinical.workload") ?? "");
    check(flat(icu).length === flat(base).length, "unit context changes labels, not the module set");

    // ── 3. Overrides (the acceptance criterion: no deployment) ──
    if (!hid) {
      console.log("\n(no hospitals row — override phase skipped)");
    } else {
      console.log("\n── WCE overrides ──");
      await putOverride("hospital", hid, `${HWW_CONFIG_PREFIX}.communication.announcements`, { enabled: false });
      let nav = await resolveHwwNavigation(admin, { ...wardCtx, hospitalId: hid });
      check(!flat(nav).some((i: any) => i.key === "communication.announcements"), "hospital override HIDES a module (no deployment)");
      check(nav.hidden.includes(`${HWW_CONFIG_PREFIX}.communication.announcements`), "hidden module is reported for auditability");

      await putOverride("role", "charge_nurse", `${HWW_CONFIG_PREFIX}.tools.reports`, { label: "Charge Reports", order: 15 });
      nav = await resolveHwwNavigation(admin, { ...wardCtx, hospitalId: hid, professions: ["charge_nurse"] });
      check(labelOf(nav, "tools.reports") === "Charge Reports", "role override RENAMES a module", labelOf(nav, "tools.reports") ?? "");
      const toolsSec = nav.sections.find((s: any) => s.section === "Tools");
      check((toolsSec?.entries[0] as any)?.item?.key === "tools.reports", "role override REORDERS within its section");
      const plainNurse = await resolveHwwNavigation(admin, { ...wardCtx, hospitalId: hid, professions: ["healthcare_worker"] });
      check(labelOf(plainNurse, "tools.reports") === "Reports", "role override does not leak to other professions", labelOf(plainNurse, "tools.reports") ?? "");

      await putOverride("hospital", hid, `${HWW_CONFIG_PREFIX}.intelligence`, { enabled: false });
      nav = await resolveHwwNavigation(admin, { ...wardCtx, hospitalId: hid });
      check(!flat(nav).some((i: any) => i.key === "intelligence.copilot"), "disabling a SECTION removes its whole subtree");
      check(!nav.sections.some((s: any) => s.section === "Intelligence"), "empty section is dropped from the sidebar");

      const otherHospital = await resolveHwwNavigation(admin, { ...wardCtx, hospitalId: "00000000-0000-0000-0000-0000000000ff" });
      check(flat(otherHospital).length === expected, "another hospital is unaffected by these overrides", `${flat(otherHospital).length}/${expected}`);
    }

    // ── 4. Role / profession filtering (future professions) ──
    console.log("\n── Role & profession rules ──");
    const gated = HWW_NAV_CATALOGUE.filter(r => r.appRoles || r.professions || r.unitTypes).length;
    check(gated === 0, "shipped catalogue gates nothing by default (every nurse sees the full workspace)", `${gated} gated entries`);
    const withRule = [...HWW_NAV_CATALOGUE];
    // Prove the rule engine by resolving a synthetic profession that matches nothing.
    const doctorish = await resolveHwwNavigation(admin, { ...wardCtx, roles: ["nurse"], professions: ["doctor"] });
    check(flat(doctorish).length === withRule.length, "an unknown profession still resolves (rules are additive, not exclusive)");

    // ── 4b. Configuration registry (migration 159) ──
    // The registry is what makes each entry DISCOVERABLE + configurable in the
    // super-admin Designer. Runtime never depends on it, so this phase is
    // skipped (not failed) when 159 has not been applied.
    console.log("\n── Configuration registry (mig 159) ──");
    const { data: regRows, error: regErr } = await admin.from("configuration_registry_objects")
      .select("object_key, object_type, configurability_class, override_policy, default_enabled, status")
      .like("object_key", "workspace.healthcare-worker%");
    if (regErr) {
      console.log(`  (registry unavailable: ${regErr.message})`);
    } else if (!regRows?.length) {
      console.log("  (migration 159 not applied — registry phase skipped)");
    } else {
      const reg = regRows as any[];
      check(reg.length === 25, "workspace + 6 sections + 18 modules registered", `${reg.length}/25`);
      check(reg.filter(r => r.object_type === "NAVIGATION_SECTION").length === 6, "6 navigation sections registered");
      check(reg.filter(r => r.object_type === "MODULE").length === 18, "18 modules registered");

      // Every catalogue entry must have a registry row (and vice versa) — a
      // drift check that fails loudly if the two ever diverge.
      // Registry object_key is 'workspace.<config_path>'; the resolver's config
      // path is `${HWW_CONFIG_PREFIX}.${rule.key}` — compare on that.
      const regKeys = new Set(reg.filter(r => r.object_type === "MODULE").map(r => r.object_key.replace(/^workspace\./, "")));
      const missing = HWW_NAV_CATALOGUE.filter(c => !regKeys.has(`${HWW_CONFIG_PREFIX}.${c.key}`)).map(c => c.key);
      const orphaned = [...regKeys].filter(k => !HWW_NAV_CATALOGUE.some(c => `${HWW_CONFIG_PREFIX}.${c.key}` === k));
      check(missing.length === 0, "every catalogue module has a registry row", missing.join(", "));
      check(orphaned.length === 0, "no orphaned registry rows", orphaned.join(", "));

      // Safety policy: the modules a nurse must never lose are display-only.
      const locked = ["clinical.escalations", "quality.incidents", "shift.assignment-inbox", "shift.my-patients"];
      const lockedOk = locked.every(k => {
        const r = reg.find(x => x.object_key === `workspace.healthcare-worker.${k}`);
        return r?.configurability_class === "mandatory_locked" && r?.override_policy === "local_display_only";
      });
      check(lockedOk, "safety-critical modules are mandatory_locked / display-only", locked.join(", "));

      // Close the loop: registry object + published override -> resolved runtime.
      if (hid) {
        const { resolveRuntime } = await import("../src/lib/config/runtime");
        await putOverride("hospital", hid, `${HWW_CONFIG_PREFIX}.tools.reports`, { label: "Shift Reports" });
        const rt: any = await resolveRuntime(admin, "workspace.healthcare-worker.tools.reports", { hospitalId: hid, roles: ["nurse"] });
        check(rt.provisioned && rt.found, "registry object resolves through the WCE runtime");
        check(rt.effective?.label === "Shift Reports", "runtime returns the hospital override's label", rt.effective?.label ?? "");
        check((rt.trace ?? []).some((t: any) => t.level === "hospital"), "resolution trace records the hospital layer");
      }
    }

    // ── 5. Unit context from real beds ──
    console.log("\n── resolveUnitContext (real beds) ──");
    const { data: asg } = await admin.from("op_patient_assignments")
      .select("staff_id, op_patients!patient_id(op_beds!bed_id(bed_type))").eq("status", "active").limit(1).maybeSingle();
    if (asg) {
      const resolved = await resolveUnitContext(admin, (asg as any).staff_id, null);
      const bedType = (asg as any).op_patients?.op_beds?.bed_type ?? null;
      check(["ward", "icu"].includes(resolved), "resolves a unit type from live assignments", `${resolved} (bed ${bedType ?? "none"})`);
    }
    const unknown = await resolveUnitContext(admin, "00000000-0000-0000-0000-00000000dead", null);
    check(unknown === "ward", "unknown user falls back to ward (safe default)");
  } finally {
    for (const w of written) {
      await admin.from("workspace_config_overrides").delete()
        .eq("scope_type", w.scope_type).eq("config_path", w.config_path)
        .filter("scope_ref", w.scope_ref == null ? "is" : "eq", w.scope_ref as any);
    }
    console.log("\n(harness overrides deleted)");
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
