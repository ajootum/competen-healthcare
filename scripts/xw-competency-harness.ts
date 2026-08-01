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
import { assessCompetencyCurrency } from "../src/lib/operations/competency-currency";
import { outstandingForShift } from "../src/lib/operations/shift-closeout";
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

  // ── 1b. A REVOCATION MUST BE VISIBLE TO THE ASSIGNMENT GATE (XWI P2-2) ───
  head("1b. SUPERSEDED DECISIONS  (patient-assignment competency gate)");

  // Pure, so the cases that matter can be stated exactly rather than arranged in the database.
  const COMP = "11111111-1111-1111-1111-111111111111";
  const passV1 = { id: "a", competency_id: COMP, outcome: "competent", version_num: 1, effective_date: "2025-01-01" };
  const revokeV2 = { id: "b", competency_id: COMP, outcome: "suspended", version_num: 2, effective_date: "2025-06-01" };

  const onlyPass = assessCompetencyCurrency([passV1]);
  check(onlyPass.validated, "a current passing decision validates the clinician");

  const revoked = assessCompetencyCurrency([passV1, revokeV2]);
  check(!revoked.validated, "a LATER revocation invalidates an earlier pass -- the gate sees the withdrawal");
  check(revoked.supersededPassing === 1, "the superseded pass is counted as superseded, not as currency");

  const outOfOrder = assessCompetencyCurrency([revokeV2, passV1]);
  check(!outOfOrder.validated, "row order does not decide the outcome -- version does");

  const expiredOnly = assessCompetencyCurrency([{ id: "c", competency_id: COMP, outcome: "competent", version_num: 1, expiry_date: "2020-01-01" }]);
  check(!expiredOnly.validated && expiredOnly.expired === 1, "an expired pass does not validate");

  const critical = assessCompetencyCurrency([
    { id: "d", competency_id: COMP, outcome: "competent", version_num: 1 },
    { id: "e", competency_id: "22222222-2222-2222-2222-222222222222", outcome: "not_yet_competent", critical_failure: true, version_num: 1 },
  ]);
  check(!critical.validated, "an unresolved critical failure invalidates, as it does for deployment");

  const noId = assessCompetencyCurrency([
    { id: "f", competency_id: null, outcome: "competent", version_num: 1 },
    { id: "g", competency_id: null, outcome: "suspended", version_num: 2 },
  ]);
  check(noId.currentPassing === 1, "decisions with no competency_id cannot supersede each other");

  const assignRoute = readFileSync(join(process.cwd(), "src/app/api/operations/assignments/route.ts"), "utf8");
  check(/assessCompetencyCurrency\s*\(/.test(assignRoute), "the assignment route uses the shared reduction");
  check(!/\.in\(\s*["']outcome["']\s*,/.test(assignRoute),
    "it no longer asks the database for passing rows only",
    "filtering to passing outcomes in SQL is what made revocations invisible");
  check(/requires_override|requires_override/.test(assignRoute) && /422/.test(assignRoute),
    "an unvalidated clinician still requires an explicit override");

  // BOTH governed overrides must reach the Competency Office, not just the louder one.
  const deployRoute = readFileSync(join(process.cwd(), "src/app/api/operations/shift-staff/route.ts"), "utf8");
  check(/emitShiftAssignmentChanged\s*\(/.test(deployRoute), "a deployment override reaches the Competency Office");
  check(/emitPatientAssignmentOverride\s*\(/.test(assignRoute),
    "a patient-assignment override reaches it too",
    "the more consequential override was the silent one -- it notified only the nurse");
  const consumer = readFileSync(join(process.cwd(), "src/lib/delivery/consumer.ts"), "utf8");
  check(/payload/.test(consumer) && /override/.test(consumer) && /remediation/i.test(consumer),
    "the consumer turns an override event into remediation for the worker");

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

  // ── 3. SHIFT CLOSE-OUT (XWI P2-14) ───────────────────────────────────────
  head("3. SHIFT CLOSE-OUT  (outstanding work is not closed over silently)");

  const { data: shifts } = await admin.from("op_shifts").select("id, hospital_id, status").limit(1);
  const shift = (shifts ?? [])[0] as any;
  if (!shift) check(false, "a shift exists to test close-out against");
  else {
    const before = await outstandingForShift(admin, shift.id);
    check(typeof before.total === "number", "outstanding work can be counted for a shift");

    // Add one open task to that shift and prove it is seen.
    const t = await admin.from("op_tasks").insert({
      hospital_id: shift.hospital_id, shift_id: shift.id, task_type: "administrative",
      description: "[xw-competency-harness] synthetic open task", status: "assigned",
    }).select("id").single();
    if (t.error) check(false, "insert an open task on the shift", t.error.message);
    else {
      written.push({ table: "op_tasks", id: t.data.id });
      const after = await outstandingForShift(admin, shift.id);
      check(after.tasks === before.tasks + 1, `an open task is counted (${before.tasks} -> ${after.tasks})`);
      check(after.total === before.total + 1, "it raises the outstanding total");
      check(/open task/.test(after.summary), `the summary NAMES what is outstanding -- "${after.summary}"`);

      // Completing it must clear it: the gate has to reopen, or supervisors learn to always acknowledge.
      await admin.from("op_tasks").update({ status: "completed" }).eq("id", t.data.id);
      const done = await outstandingForShift(admin, shift.id);
      check(done.tasks === before.tasks, "completing the task clears it from the outstanding count");
    }
  }

  // A missing table must NOT read as "nothing outstanding".
  let threw = false;
  try { await outstandingForShift(admin, "00000000-0000-0000-0000-000000000000"); } catch { threw = true; }
  check(!threw, "a shift with no children counts zero rather than erroring");

  const shiftRoute = readFileSync(join(process.cwd(), "src/app/api/operations/shifts/route.ts"), "utf8");
  check(/outstandingForShift\s*\(/.test(shiftRoute), "the shift route CALLS the close-out check");
  check(/409/.test(shiftRoute) && /requiresAcknowledgement/.test(shiftRoute),
    "closing over outstanding work is refused with 409 until acknowledged");
  check(/shift_closed_with_outstanding_work/.test(shiftRoute),
    "an acknowledged close-out is written to the audit trail");
  check(!/op_tasks[\s\S]{0,200}update\([\s\S]{0,80}cancelled/.test(shiftRoute),
    "the route does NOT silently cancel the orphaned work",
    "auto-cascading destroys the record of what was left undone");

  await cleanup();

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail) process.exit(1);
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
