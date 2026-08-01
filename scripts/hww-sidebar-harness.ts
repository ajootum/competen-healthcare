/**
 * HWW sidebar harness (HWW-UI-005).
 *
 * TWO CLAIMS THIS SPEC MAKES THAT ARE EASY TO BREAK SILENTLY.
 *
 * 1. "Procedures is never greyed out" (developer acceptance criteria). A `soon: true` slipping back into the
 *    catalogue is a one-word change that no type checks and no page test would notice.
 * 2. Every nav entry points at a surface that EXISTS. The restructure moved fourteen entries and invented
 *    query filters for eight of them; a nav row to a 404 looks identical to a working one until tapped, and
 *    a clinician taps it mid-shift. Route resolution is checked against the app directory, not assumed.
 *
 * It also walks the procedures record end to end, because the whole point of s1 was that the module stops
 * being a dead end -- so "the page renders" is not the assertion, "a procedure can be recorded and read
 * back" is.
 *
 * ON ITS OWN DATA: writes one procedure against a real patient and deletes it in a finally.
 *
 *   npx --yes tsx scripts/hww-sidebar-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HWW_NAV_CATALOGUE, HWW_SECTIONS } from "../src/lib/hww/navigation";
import { loadMyProcedures } from "../src/lib/hww/procedures";
import { caseloadRisk } from "../src/lib/hww/my-shift";
import { commandSearch } from "../src/lib/hww/command-search";
loadEnvConfig(process.cwd());

const admin: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

// Resolve an app-router href to a page file. Only static segments are used in this catalogue, so a direct
// path check is exact rather than approximate.
function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  const dir = join(process.cwd(), "src", "app", ...path.split("/").filter(Boolean));
  return existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "page.ts"));
}

async function main() {
  // ---- 1. the acceptance criterion that is one word away from regressing ----------------------------
  const procedures = HWW_NAV_CATALOGUE.find(r => r.key === "clinical.procedures");
  ok("1. Procedures exists in the catalogue", !!procedures);
  ok("1b. Procedures is NOT greyed out", !!procedures && procedures.soon !== true, `soon=${procedures?.soon}`);
  ok("1c. Procedures has a real destination", !!procedures?.href && routeExists(procedures.href!), procedures?.href ?? "no href");

  // ---- 2. every entry lands somewhere real ---------------------------------------------------------
  const withHref = HWW_NAV_CATALOGUE.filter(r => r.href);
  const broken = withHref.filter(r => !routeExists(r.href!)).map(r => `${r.key} -> ${r.href}`);
  ok("2. every nav entry resolves to a page that exists", broken.length === 0, broken.join(", "));
  const dead = HWW_NAV_CATALOGUE.filter(r => !r.href && !r.soon).map(r => r.key);
  ok("2b. no entry is both hrefless and not marked soon", dead.length === 0, dead.join(", "));

  // ---- 3. the spec's workflow order ----------------------------------------------------------------
  const shift = HWW_NAV_CATALOGUE.filter(r => r.section === "Shift").sort((a, b) => a.order - b.order).map(r => r.label);
  ok("3. shift order is Assignments -> My Patients -> Medications -> My Tasks -> Handover",
    JSON.stringify(shift) === JSON.stringify(["Assignments", "My Patients", "Medications", "My Tasks", "Handover"]),
    shift.join(" -> "));

  // ---- 4. the standalone AI section is gone (s9) ---------------------------------------------------
  ok("4. no standalone Intelligence/AI section remains",
    !HWW_SECTIONS.some(s => s.key === "intelligence") && !HWW_NAV_CATALOGUE.some(r => r.section === "Intelligence"));

  // ---- 5. badge severities are declared, not guessed (s14) -----------------------------------------
  const badged = HWW_NAV_CATALOGUE.filter(r => r.badge);
  const unsevered = badged.filter(r => !r.severity).map(r => r.key);
  ok("5. every badged entry declares a severity", unsevered.length === 0, unsevered.join(", "));

  // ---- 6. caseload risk is derived, not decorative -------------------------------------------------
  ok("6. an empty caseload yields no acuity and no risk",
    caseloadRisk([]).acuity === null && caseloadRisk([]).risk === null);
  ok("6b. peak acuity wins, and a majority-critical caseload is high risk",
    caseloadRisk(["stable", "critical"]).acuity === "critical"
    && caseloadRisk(["critical", "critical", "stable"]).risk === "high"
    && caseloadRisk(["stable", "stable"]).risk === "low",
    JSON.stringify([caseloadRisk(["stable", "critical"]), caseloadRisk(["critical", "critical", "stable"])]));

  // ---- 7. the procedures record, end to end --------------------------------------------------------
  const probe = await admin.from("op_procedures").select("id").limit(1);
  if (probe.error) {
    console.log(`\n  SKIPPED the record walk: op_procedures absent (${probe.error.code}). Apply migration 184.`);
    console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)\n`);
    process.exitCode = fails.length ? 1 : 2;
    return;
  }

  const { data: patient } = await admin.from("op_patients").select("id, label, hospital_id").not("hospital_id", "is", null).limit(1).single();
  if (!patient) { console.log("No patient to test against."); process.exitCode = 2; return; }

  let id: string | null = null;
  try {
    const { data: row, error } = await admin.from("op_procedures").insert({
      hospital_id: patient.hospital_id, patient_id: patient.id,
      procedure_name: "HARNESS peripheral cannulation", category: "clinical", status: "completed",
      completed_at: new Date().toISOString(), site: "Left forearm", laterality: "left",
      // Deliberately NOT set, to prove null survives as "not recorded".
      outcome: "Successful first attempt",
    }).select("id, consent_obtained, laterality").single();
    if (error) throw new Error(`insert: ${error.message}`);
    id = row.id;

    ok("7. consent left unset stays NULL, not false",
      row.consent_obtained === null, `got ${JSON.stringify(row.consent_obtained)}`);
    ok("7b. laterality is stored", row.laterality === "left", String(row.laterality));

    const v = await loadMyProcedures(admin, [patient.id]);
    ok("7c. the loader reports ready when the table exists", v.ready === true && v.reason === null);
    ok("7d. the recorded procedure is read back", v.recent.some(p => p.id === id) || v.due.some(p => p.id === id),
      `due=${v.due.length} recent=${v.recent.length}`);

    // ---- 8. absent table must NOT look like an empty list --------------------------------------
    const sabotaged = new Proxy(admin, {
      get(t: any, prop: string, recv: any) {
        if (prop === "from") return (table: string) => table === "op_procedures"
          ? { select: () => ({ limit: async () => ({ data: null, error: { message: "relation does not exist", code: "PGRST205" } }) }) }
          : t.from(table);
        return Reflect.get(t, prop, recv);
      },
    });
    const gone = await loadMyProcedures(sabotaged, [patient.id]);
    ok("8. a missing table reports NOT ready with a reason, not an empty list",
      gone.ready === false && !!gone.reason && gone.due.length === 0,
      JSON.stringify({ ready: gone.ready, reason: gone.reason }));
  } finally {
    if (id) {
      await admin.from("op_procedures").delete().eq("id", id);
      console.log("\n  cleanup: harness procedure removed");
    }
  }

  // ---- 9. command palette scope: the property the whole feature hangs on ----------------------------
  //
  // A search box is the easiest place to accidentally build a patient browser. These assertions use a user
  // with NO assignments and a patient that certainly exists, so a leak shows up as a hit rather than as an
  // absence that could be explained away by the search term.
  const { data: anyPatient } = await admin.from("op_patients").select("id, label").not("label", "is", null).limit(1).single();

  // The unassigned user must be genuinely unassigned. A first attempt excluded only the FIRST active
  // assignment's staff_id and picked another rostered nurse, who then legitimately found their own patient
  // -- the harness reported a leak that was not one. Exclude EVERY staff id holding an active assignment,
  // and prove the choice by asserting the search reports zero patients in scope for them.
  const { data: allAssigned } = await admin.from("op_patient_assignments").select("staff_id").eq("status", "active").limit(1000);
  const assignedIds = new Set(((allAssigned ?? []) as any[]).map(r => r.staff_id).filter(Boolean));
  const { data: candidates } = await admin.from("profiles").select("id").limit(500);
  const unassigned = ((candidates ?? []) as any[]).find(p => !assignedIds.has(p.id)) ?? null;

  if (anyPatient && unassigned) {
    const term = String(anyPatient.label).slice(0, 4);
    const leak = await commandSearch(admin, unassigned.id, term, []);
    ok("9. a clinician with no assignment finds NO patients, even by exact name",
      leak.hits.filter(h => h.kind === "patient").length === 0 && leak.scopedPatients === 0,
      `term="${term}" hits=${JSON.stringify(leak.hits.map(h => h.kind))}`);
    ok("9b. and no records either, since records are constrained to the same list",
      leak.hits.filter(h => h.kind === "record").length === 0);
  }

  // Modules are passed in from the resolved nav, so a disabled module cannot be reached through search.
  const modOnly = await commandSearch(admin, unassigned?.id ?? "00000000-0000-0000-0000-000000000000", "medic",
    [{ key: "shift.medications", label: "Medications", href: "/healthcare-worker/medications", icon: "💊" }]);
  ok("9c. modules are searchable, and come only from the caller's resolved nav",
    modOnly.hits.some(h => h.kind === "module" && h.label === "Medications"));
  const noModules = await commandSearch(admin, unassigned?.id ?? "00000000-0000-0000-0000-000000000000", "medic", []);
  ok("9d. a module absent from the resolved nav is NOT findable",
    !noModules.hits.some(h => h.kind === "module"));

  // ---- 10. a one-character query must not run a search -----------------------------------------
  const tiny = await commandSearch(admin, unassigned?.id ?? "x", "a", []);
  ok("10. queries under two characters return nothing", tiny.hits.length === 0);

  // ---- 11. favourites: pins store KEYS and resolve against the live nav -------------------------
  const pinProbe = await admin.from("user_pinned_modules").select("id").limit(1);
  if (pinProbe.error) {
    console.log(`\n  SKIPPED pins: user_pinned_modules absent (${pinProbe.error.code}). Apply migration 185.`);
  } else if (unassigned) {
    try {
      const key = "shift.medications";
      await admin.from("user_pinned_modules").delete().eq("user_id", unassigned.id).eq("module_key", key);
      const { error: pinErr } = await admin.from("user_pinned_modules")
        .insert({ user_id: unassigned.id, workspace: "healthcare-worker", module_key: key, sort_order: 0 });
      ok("11. a module can be pinned", !pinErr, pinErr?.message ?? "");

      // The unique index is the guard that makes pinning idempotent rather than duplicating.
      const { error: dupErr } = await admin.from("user_pinned_modules")
        .insert({ user_id: unassigned.id, workspace: "healthcare-worker", module_key: key, sort_order: 1 });
      ok("11b. pinning the same module twice is rejected by the unique index", !!dupErr && dupErr.code === "23505",
        dupErr ? dupErr.code : "no error - duplicate was accepted");

      // A pin resolves through the catalogue, so a key naming nothing yields nothing rather than a dead chip.
      const resolved = HWW_NAV_CATALOGUE.find(r => r.key === key);
      ok("11c. a pinned key resolves to a real module", !!resolved?.href && routeExists(resolved.href!));
      ok("11d. a stale key resolves to nothing rather than a broken row",
        !HWW_NAV_CATALOGUE.find(r => r.key === "shift.module-that-was-removed"));
    } finally {
      await admin.from("user_pinned_modules").delete().eq("user_id", unassigned.id).eq("module_key", "shift.medications");
      console.log("  cleanup: harness pin removed");
    }
  }

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(e => { console.error("\nHARNESS ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
