/**
 * CROSS-WORKSPACE SWEEP, THE COMPETENCY AXIS: does competency actually change what happens on a shift?
 *
 * The other two sweeps prove operational facts travel: nurse <-> supervisor (xw-sweep-harness) and bedside
 * -> supervisor -> manager -> executive (xw-uplift-harness). Both are about op_* rows moving upward. The
 * standing note on this codebase says the op_* and competency layers are "largely disconnected", and that
 * is the claim this checks -- because it is the platform's actual proposition. Competency data that never
 * reaches a staffing decision is a filing cabinet.
 *
 * TWO DIRECTIONS, AND A DISTINCTION THAT MATTERS MORE THAN EITHER:
 *
 *   COMPETENCY -> OPERATIONS   COMP-027. checkDeploymentReadiness() reads competency_decisions and blocks
 *                              deployment on an unresolved critical failure.
 *   OPERATIONS -> COMPETENCY   The HWW evidence bridge. A completed procedural task becomes a skill log
 *                              entry awaiting verification.
 *
 * IMPLEMENTED IS NOT WIRED. A gate function that nothing calls passes every unit test and blocks nobody,
 * and that is precisely what "the layers are disconnected" means -- not that the code is missing, but that
 * it sits beside the write path instead of in it. So each direction is asserted TWICE: the logic against
 * real rows, and the CALL SITE in the route that performs the real action. The second assertion is the one
 * that would have caught the disconnection.
 *
 * Every row it writes is deleted afterwards, including on failure.
 *
 *   npx --yes tsx scripts/xw-competency-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDeploymentReadiness } from "../src/lib/operations/deployment-readiness";
import { evidenceFromTask, EVIDENCE_TASK_TYPES } from "../src/lib/hww/evidence";
loadEnvConfig(process.cwd());

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const head = (s: string) => console.log(`\n-- ${s} ${"-".repeat(Math.max(0, 58 - s.length))}`);
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? ` -- ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

const written: { table: string; id: string }[] = [];
async function cleanup() {
  head("cleanup");
  let n = 0;
  for (const w of written.reverse()) {
    const { error } = await admin.from(w.table).delete().eq("id", w.id);
    if (!error) n++;
  }
  check(n === written.length, `every row the sweep wrote is removed -- ${n}/${written.length}`);
}

async function main() {
  console.log("\nCross-workspace sweep: the competency axis\n");

  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name, hospital_id").eq("role", "nurse").not("hospital_id", "is", null).limit(1);
  const nurse = (nurses ?? [])[0] as any;
  if (!nurse) { console.log("  no nurse with a hospital on this platform -- nothing to sweep\n"); return; }
  console.log(`  subject: ${nurse.full_name}\n`);

  // ── 1. COMPETENCY -> OPERATIONS ──────────────────────────────────────────
  head("1. COMPETENCY -> OPERATIONS  (COMP-027 readiness gate)");

  const base = await checkDeploymentReadiness(admin, nurse.id);
  console.log(`        baseline: blocked=${base.blocked}, critical=${base.criticalFailures}, expired=${base.expiredCount}`);

  // An unresolved CRITICAL failure must block deployment.
  const crit = await admin.from("competency_decisions").insert({
    nurse_id: nurse.id, hospital_id: nurse.hospital_id,
    outcome: "requires_remediation", critical_failure: true,
    effective_date: new Date().toISOString().slice(0, 10),
    evidence_summary: "[xw-competency-harness] synthetic critical failure",
  }).select("id").single();
  if (crit.error) check(false, "insert a critical-failure decision", crit.error.message);
  else {
    written.push({ table: "competency_decisions", id: crit.data.id });
    const after = await checkDeploymentReadiness(admin, nurse.id);
    check(after.blocked, "an unresolved critical failure BLOCKS deployment");
    check(after.criticalFailures === base.criticalFailures + 1,
      `the critical count moves by exactly one (${base.criticalFailures} -> ${after.criticalFailures})`);
    check(!!after.reason && /override/i.test(after.reason), "the block states that a governed override is required");
  }

  // An EXPIRED competency is advisory, not a block -- the distinction the gate exists to make.
  const exp = await admin.from("competency_decisions").insert({
    nurse_id: nurse.id, hospital_id: nurse.hospital_id,
    outcome: "competent", critical_failure: false,
    effective_date: "2020-01-01", expiry_date: "2020-12-31",
    evidence_summary: "[xw-competency-harness] synthetic expired competency",
  }).select("id").single();
  if (exp.error) check(false, "insert an expired decision", exp.error.message);
  else {
    written.push({ table: "competency_decisions", id: exp.data.id });
    const after = await checkDeploymentReadiness(admin, nurse.id);
    check(after.expiredCount === base.expiredCount + 1,
      `an expired competency raises the expired count (${base.expiredCount} -> ${after.expiredCount})`);
    check(!!after.warning, "it produces a WARNING, not silence");
  }

  // Removing the critical failure must clear the block -- a gate that never reopens is a wall.
  const critId = written.find(w => w.table === "competency_decisions")?.id;
  if (critId) {
    await admin.from("competency_decisions").delete().eq("id", critId);
    const after = await checkDeploymentReadiness(admin, nurse.id);
    check(after.blocked === base.blocked, "resolving the critical failure CLEARS the block");
    written.splice(written.findIndex(w => w.id === critId), 1);
  }

  // WIRED, not merely implemented.
  const route = readFileSync(join(process.cwd(), "src/app/api/operations/shift-staff/route.ts"), "utf8");
  check(/checkDeploymentReadiness\s*\(/.test(route), "the deployment route CALLS the gate");
  check(/readiness\.blocked/.test(route) && /409/.test(route), "a blocked deployment is refused with 409, not logged and allowed");
  check(/override/i.test(route), "an override path exists, so the gate is a control rather than a dead end");

  // ── 2. OPERATIONS -> COMPETENCY ──────────────────────────────────────────
  head("2. OPERATIONS -> COMPETENCY  (HWW evidence bridge)");

  const fakeTaskId = `xwtest-${Date.now()}`;
  const task = {
    id: fakeTaskId, assigned_to: nurse.id, patient_id: "synthetic",
    task_type: EVIDENCE_TASK_TYPES[0], unit_id: null,
    description: "[xw-competency-harness] synthetic procedural task",
    completed_at: new Date().toISOString(),
  };

  const made = await evidenceFromTask(admin, task);
  check(made.created, "a completed procedural task becomes competency evidence", made.reason ?? "");
  if (made.id) written.push({ table: "skill_log_entries", id: made.id });

  if (made.created) {
    const { data: entry } = await admin.from("skill_log_entries").select("nurse_id, status, notes").eq("id", made.id!).single();
    check((entry as any)?.nurse_id === nurse.id, "the evidence is attributed to the performer");
    check((entry as any)?.status === "pending", "it lands as PENDING -- generated evidence is claimed, not verified");
    check(String((entry as any)?.notes ?? "").includes(fakeTaskId), "it carries a traceable marker back to the operational record");
  }

  // Idempotency: the same task must not produce a second claim.
  const again = await evidenceFromTask(admin, task);
  check(!again.created && /already/i.test(again.reason ?? ""), "re-running the bridge does NOT duplicate the evidence", again.reason ?? "");

  // A non-procedural task must not manufacture evidence.
  const nonProc = await evidenceFromTask(admin, { ...task, id: `${fakeTaskId}-np`, task_type: "administrative" });
  check(!nonProc.created, "a non-procedural task produces NO evidence", nonProc.reason ?? "");
  if (nonProc.id) written.push({ table: "skill_log_entries", id: nonProc.id });

  // WIRED, not merely implemented.
  const bridgeCallers = ["src/app/api/operations/tasks/route.ts", "src/app/api/hww/tasks/route.ts"]
    .map(p => { try { return readFileSync(join(process.cwd(), p), "utf8"); } catch { return ""; } })
    .join("\n");
  check(/evidenceFromTask\s*\(/.test(bridgeCallers),
    "a real task-completion route CALLS the bridge",
    "the bridge exists but nothing invokes it -- evidence would only ever appear if called by hand");

  await cleanup();

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
