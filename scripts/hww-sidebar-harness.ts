/**
 * HWW sidebar harness (HWW-UI-005B, the rollback amendment).
 *
 * 005B reverses the architectural changes of 005 and permits ONLY sidebar refinements. That makes this
 * harness a guard against re-drift as much as a check of the current state: the renames, merges and new
 * controls it forbids are all things that were in the tree hours ago and could return by a careless revert.
 *
 * WHAT IT ASSERTS:
 *   1. Procedures is active -- the one functional change the amendment approves, and one word from
 *      regressing (`soon: true`).
 *   2. The navigation matches s5 EXACTLY: every label, every section, in order. Not "looks similar" -- the
 *      amendment's whole point is that names and architecture are frozen, so the assertion compares the
 *      resolved list against the spec's list literally.
 *   3. The prohibited controls (s4) are absent from the tree: no Command Palette, Favourites, Quick
 *      Actions, or search API. Checked as FILES, because a component that still exists is one import from
 *      being back.
 *   4. Badge severities use the amendment's own vocabulary (critical/high/normal), so the key on the design
 *      and the values in the code cannot drift apart.
 *   5. Every entry still resolves to a page that exists.
 *   6. The procedures record works end to end, since s3 requires the module be selectable.
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

function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  const dir = join(process.cwd(), "src", "app", ...path.split("/").filter(Boolean));
  return existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "page.ts"));
}
const repo = (...p: string[]) => join(process.cwd(), ...p);

// HWW-UI-005B s5, transcribed from the amendment. The order here IS the assertion.
const SPEC_NAV: { section: string | null; labels: string[] }[] = [
  { section: null, labels: ["Home"] },
  { section: "Shift", labels: ["My Patients", "My Tasks", "Medication Schedule", "Assignment Inbox", "Handover"] },
  { section: "Clinical", labels: ["Observations & PEWS", "Acuity Assessment", "Workload Assessment", "Escalations", "Procedures"] },
  { section: "Communication", labels: ["Messages", "Unit Announcements"] },
  { section: "Quality Events", labels: ["Incidents", "Nurse Concerns"] },
  { section: "Intelligence", labels: ["AI Copilot"] },
  { section: "Tools", labels: ["Reports", "Settings"] },
];

async function main() {
  // ---- 1. the one approved functional change --------------------------------------------------------
  const procedures = HWW_NAV_CATALOGUE.find(r => r.key === "clinical.procedures");
  ok("1. Procedures is NOT greyed out", !!procedures && procedures.soon !== true, `soon=${procedures?.soon}`);
  ok("1b. Procedures is selectable (has a destination that exists)",
    !!procedures?.href && routeExists(procedures.href!), procedures?.href ?? "no href");
  ok("1c. Procedures is still in the Clinical section, in its original position",
    procedures?.section === "Clinical" && procedures?.order === 240, `${procedures?.section} @${procedures?.order}`);

  // ---- 2. the architecture is frozen: compare against s5 literally ----------------------------------
  for (const want of SPEC_NAV) {
    const got = HWW_NAV_CATALOGUE
      .filter(r => r.section === want.section)
      .sort((a, b) => a.order - b.order)
      .map(r => r.label);
    ok(`2. ${want.section ?? "(root)"} matches the amendment exactly`,
      JSON.stringify(got) === JSON.stringify(want.labels),
      `got [${got.join(", ")}]`);
  }
  ok("2b. section order matches the amendment",
    JSON.stringify(HWW_SECTIONS.slice().sort((a, b) => a.order - b.order).map(s => s.label))
      === JSON.stringify(["Shift", "Clinical", "Communication", "Quality Events", "Intelligence", "Tools"]),
    HWW_SECTIONS.map(s => s.label).join(" -> "));
  ok("2c. AI Copilot is still its own Intelligence entry, not moved or merged",
    HWW_NAV_CATALOGUE.some(r => r.key === "intelligence.copilot" && r.section === "Intelligence"));
  ok("2d. Messages and Unit Announcements remain SEPARATE modules",
    HWW_NAV_CATALOGUE.filter(r => r.section === "Communication").length === 2);

  // ---- 3. the prohibited controls are gone from the tree, not just unmounted ------------------------
  const banned: [string, string][] = [
    ["Command Palette", "src/app/healthcare-worker/CommandPalette.tsx"],
    ["Favourites", "src/app/healthcare-worker/Favourites.tsx"],
    ["command search engine", "src/lib/hww/command-search.ts"],
    ["search API", "src/app/api/hww/search/route.ts"],
    ["pins API", "src/app/api/hww/pins/route.ts"],
  ];
  for (const [name, path] of banned) {
    ok(`3. ${name} is removed (s4 prohibits it)`, !existsSync(repo(path)), path);
  }
  // The AI copilot API is NOT one of the prohibited items -- s4 says do NOT move AI Copilot.
  ok("3b. the AI Copilot API still exists (s4: do not move it)", existsSync(repo("src/app/api/hww/copilot/route.ts")));

  // ---- 4. badge vocabulary matches the amendment's key ----------------------------------------------
  const allowed = new Set(["critical", "high", "normal"]);
  const badged = HWW_NAV_CATALOGUE.filter(r => r.badge);
  const wrong = badged.filter(r => !r.severity || !allowed.has(r.severity)).map(r => `${r.key}=${r.severity}`);
  ok("4. every badged entry uses the amendment's severity vocabulary", wrong.length === 0, wrong.join(", "));

  // ---- 5. nothing points at a 404 ------------------------------------------------------------------
  const broken = HWW_NAV_CATALOGUE.filter(r => r.href && !routeExists(r.href!)).map(r => `${r.key} -> ${r.href}`);
  ok("5. every nav entry resolves to a page that exists", broken.length === 0, broken.join(", "));

  // ---- 6. procedures record, end to end ------------------------------------------------------------
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
      outcome: "Successful first attempt",   // consent deliberately unset
    }).select("id, consent_obtained").single();
    if (error) throw new Error(`insert: ${error.message}`);
    id = row.id;
    ok("6. consent left unset stays NULL, not false", row.consent_obtained === null, JSON.stringify(row.consent_obtained));

    const v = await loadMyProcedures(admin, [patient.id]);
    ok("6b. the recorded procedure is read back", v.ready && (v.recent.some(p => p.id === id) || v.due.some(p => p.id === id)));

    const sabotaged = new Proxy(admin, {
      get(t: any, prop: string, recv: any) {
        if (prop === "from") return (table: string) => table === "op_procedures"
          ? { select: () => ({ limit: async () => ({ data: null, error: { message: "relation does not exist", code: "PGRST205" } }) }) }
          : t.from(table);
        return Reflect.get(t, prop, recv);
      },
    });
    const gone = await loadMyProcedures(sabotaged, [patient.id]);
    ok("6c. a missing table reports NOT ready with a reason, not an empty list",
      gone.ready === false && !!gone.reason && gone.due.length === 0);
  } finally {
    if (id) {
      await admin.from("op_procedures").delete().eq("id", id);
      console.log("\n  cleanup: harness procedure removed");
    }
  }

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(e => { console.error("\nHARNESS ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
