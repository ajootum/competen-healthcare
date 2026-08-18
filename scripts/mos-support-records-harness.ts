/**
 * CPR-PD-009 — THE FIVE SUPPORT RECORD TYPES, ACCEPTANCE.
 *
 *   R  each record exists and accepts what the specification describes
 *   C  each constraint that encodes a RULE is proved by a write that fails
 *   A  the shared lifecycle trail is append only, and its cascade still works
 *   P  no record type can name a patient
 *
 * ⚠ C IS THE POINT. Every constraint here was written to stop a specific wrong thing: a P1 action with
 * no due date, an accepted risk with no authority, a confirmed cause on a problem nobody has confirmed.
 * A constraint that exists and never fires is indistinguishable from a comment.
 *
 *   npx --yes tsx scripts/mos-support-records-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { FIXTURE_OWNER_PREFIX, cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
/* eslint-disable @typescript-eslint/no-explicit-any */
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

const FIXTURE_OWNER = `${FIXTURE_OWNER_PREFIX}0000-4000-8000-000000000318`;
const made: { table: string; pk: string; id: string }[] = [];
/**
 * ⚠ WHAT Z2 SWEEPS, AND WHY IT IS A SEPARATE LEDGER.
 *
 * The first version of this harness reported ALL GREEN while leaving a row in the estate. `made` is the
 * deletion queue and cleanup() empties it, so a control reading `made` afterwards always sees nothing —
 * and the control that did exist looked up ONE table by ONE title, so the shared trail was outside what
 * it could see. This ledger is never cleared, and it holds every row the run created INCLUDING the ones
 * cleanup deletes by cascade rather than directly. Z2 then sweeps by id.
 *
 * This is the fourth time a control has described something narrower than it owned. The rule from the
 * phase 2 commit stands: a control must describe the thing it owns, not a name it happened to be alone
 * in using.
 */
const createdEver: { table: string; pk: string; id: string }[] = [];
const remember = (table: string, pk: string, id: string) => {
  if (!createdEver.some(c => c.table === table && c.id === id)) createdEver.push({ table, pk, id });
};
let fixtureId: string | null = null;
let cleanupError: string | null = null;

async function cleanup() {
  for (const m of made) remember(m.table, m.pk, m.id);
  // children before parents, so a cascade never has to be relied on for the fixture itself
  for (const m of [...made].reverse()) {
    const del = await admin.from(m.table).delete().eq(m.pk, m.id);
    if (del.error) cleanupError = `${m.table}: ${String(del.error.message).slice(0, 70)}`;
  }
  made.length = 0;
  if (fixtureId) {
    const del = await admin.from("practice_workspace").delete().eq("id", fixtureId);
    if (del.error) cleanupError = String(del.error.message).slice(0, 80);
    else fixtureId = null;
  }
}
cleanupOnKill(cleanup);

/** A write that MUST fail. */
async function mustReject(table: string, row: Record<string, unknown>, pk: string): Promise<{ rejected: boolean; message: string }> {
  const res = await admin.from(table).insert(row).select(pk).limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 62) };
  if (res.data?.[0]?.[pk]) await admin.from(table).delete().eq(pk, res.data[0][pk]);
  return { rejected: false, message: "the write was ACCEPTED" };
}

async function main() {
  console.log("\nCPR-PD-009 — SUPPORT RECORD TYPES\n");

  const probe = await admin.from("mos_support_case").select("case_id").limit(1);
  if (probe.error) {
    console.log("  ---- MIGRATION 318 IS NOT APPLIED ----");
    console.log(`  mos_support_case could not be read (${String(probe.error.message).slice(0, 60)}).\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  const ws = await admin.from("practice_workspace").insert({
    name: "PD-009 records acceptance fixture", owner_person_id: FIXTURE_OWNER,
    country: "ZZ", timezone: "UTC",
  }).select("id").limit(1);
  if (ws.error || !ws.data?.[0]?.id) {
    ok("R", false, `could not create the fixture — ${String(ws.error?.message).slice(0, 80)}`);
    console.log(`\nRED  ${pass} passed, ${failures.length} failed\n`); process.exit(1);
  }
  fixtureId = ws.data[0].id as string;

  try {
    // ── R · each record accepts what the specification describes ─────────────
    const inc = await admin.from("mos_incident").insert({
      subject_type: "practice", subject_id: fixtureId,
      title: "Acceptance incident for the support records", severity: "sev2", status: "investigating",
      journey_key: "patient_booking", owner_name: "Product Director",
    }).select("incident_id").limit(1);
    const incidentId = inc.data?.[0]?.incident_id ?? null;
    if (incidentId) made.push({ table: "mos_incident", pk: "incident_id", id: incidentId });
    ok("R0", !!incidentId, "an incident exists to hang the five record types from");

    const kase = await admin.from("mos_support_case").insert({
      practice_id: fixtureId, reporter_name: "A practitioner", source: "practitioner",
      title: "Booking screen rejects a valid slot", description: "Reported by phone.",
      category: "booking", product_area: "scheduling", priority: "p2", status: "triage",
      incident_id: incidentId, journey_key: "patient_booking",
    }).select("case_id").limit(1);
    const caseId = kase.data?.[0]?.case_id ?? null;
    if (caseId) made.push({ table: "mos_support_case", pk: "case_id", id: caseId });
    ok("R1", !!caseId, `a support case is accepted with §4's fields — ${kase.error ? String(kase.error.message).slice(0, 60) : "created"}`);

    const prob = await admin.from("mos_problem").insert({
      title: "Slot validation rejects boundary times", owner_name: "Product Director",
      status: "investigating", priority: "p2", pattern_evidence: "Three incidents in a fortnight",
      suspected_cause: "Boundary handling in the availability rule", journey_key: "patient_booking",
      subject_type: "product",
    }).select("problem_id").limit(1);
    const problemId = prob.data?.[0]?.problem_id ?? null;
    if (problemId) made.push({ table: "mos_problem", pk: "problem_id", id: problemId });
    ok("R2", !!problemId, `a problem is accepted with §12's fields — ${prob.error ? String(prob.error.message).slice(0, 60) : "created"}`);

    if (problemId && incidentId) {
      const link = await admin.from("mos_problem_incident").insert({ problem_id: problemId, incident_id: incidentId });
      ok("R3", !link.error, "§12: an incident links to a problem without either owning the other");
    }

    const esc = await admin.from("mos_escalation").insert({
      trigger: "unresolved_blocker", incident_id: incidentId, target_team: "Engineering",
      reason: "Availability rule owner unavailable and the workaround is manual",
      requested_action: "Confirm the boundary behaviour", status: "open",
    }).select("escalation_id").limit(1);
    const escId = esc.data?.[0]?.escalation_id ?? null;
    if (escId) made.push({ table: "mos_escalation", pk: "escalation_id", id: escId });
    ok("R4", !!escId, `an escalation is accepted with §9's fields — ${esc.error ? String(esc.error.message).slice(0, 60) : "created"}`);

    const pm = await admin.from("mos_postmortem").insert({
      incident_id: incidentId, status: "draft",
      executive_summary: "Bookings at the hour boundary were refused for two hours.",
      root_cause: null, contributing_factors: "A rule change shipped without a boundary test",
      open_hypotheses: "Whether the same rule affects walk-ins is unverified",
    }).select("postmortem_id").limit(1);
    const pmId = pm.data?.[0]?.postmortem_id ?? null;
    if (pmId) made.push({ table: "mos_postmortem", pk: "postmortem_id", id: pmId });
    ok("R5", !!pmId, `a postmortem is accepted with §13's sections — ${pm.error ? String(pm.error.message).slice(0, 60) : "created"}`);

    const act = await admin.from("mos_corrective_action").insert({
      action: "Add a boundary case to the availability rule tests", source: "postmortem",
      postmortem_id: pmId, owner_name: "Engineering", priority: "p2",
      due_on: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), state: "open",
    }).select("action_id").limit(1);
    const actId = act.data?.[0]?.action_id ?? null;
    if (actId) made.push({ table: "mos_corrective_action", pk: "action_id", id: actId });
    ok("R6", !!actId, `a corrective action is accepted with §14's fields — ${act.error ? String(act.error.message).slice(0, 60) : "created"}`);

    // ── C · every constraint that encodes a rule ─────────────────────────────
    const p1NoDue = await mustReject("mos_corrective_action", {
      action: "high priority with no due date", source: "incident", owner_name: "Someone", priority: "p1",
    }, "action_id");
    ok("C1", p1NoDue.rejected,
      `⚠ §14: a P1 action without a due date is refused — nothing can be overdue without one — ${p1NoDue.message}`);

    const riskNoAuthority = await mustReject("mos_corrective_action", {
      action: "quietly accepted", source: "incident", owner_name: "Someone",
      priority: "p3", state: "accepted_risk",
    }, "action_id");
    ok("C2", riskNoAuthority.rejected,
      `⚠ §14: accepted risk without a named authority and rationale is refused — it cannot be a quiet close — ${riskNoAuthority.message}`);

    const doneNoTime = await mustReject("mos_corrective_action", {
      action: "done, apparently", source: "incident", owner_name: "Someone", priority: "p3", state: "done",
    }, "action_id");
    ok("C3", doneNoTime.rejected, `a completed action must say when — ${doneNoTime.message}`);

    const causeTooEarly = await mustReject("mos_problem", {
      title: "confirmed before confirming", status: "investigating", confirmed_cause: "it was the thing",
    }, "problem_id");
    ok("C4", causeTooEarly.rejected,
      `⚠ §12: a confirmed cause on a problem still under investigation is refused — the two cannot disagree — ${causeTooEarly.message}`);

    const pmApproved = await mustReject("mos_postmortem", {
      incident_id: incidentId, status: "approved", executive_summary: "approved by nobody",
    }, "postmortem_id");
    ok("C5", pmApproved.rejected,
      `⚠ §13: an approved postmortem with no approver or time is refused — approval is auditable — ${pmApproved.message}`);

    const escNoSubject = await mustReject("mos_escalation", {
      trigger: "severity", target_team: "Engineering", reason: "about nothing in particular",
    }, "escalation_id");
    ok("C6", escNoSubject.rejected, `an escalation must escalate SOMETHING — ${escNoSubject.message}`);

    const caseResolvedNoTime = await mustReject("mos_support_case", {
      practice_id: fixtureId, title: "resolved with no resolution time", status: "resolved",
    }, "case_id");
    ok("C7", caseResolvedNoTime.rejected, `a resolved case must carry its resolution time — ${caseResolvedNoTime.message}`);

    const badTrigger = await mustReject("mos_escalation", {
      trigger: "somebody_shouted", incident_id: incidentId, target_team: "Engineering", reason: "x",
    }, "escalation_id");
    ok("C8", badTrigger.rejected,
      `§9's triggers are a vocabulary rather than free text, so they can be counted — ${badTrigger.message}`);

    const okAction = await admin.from("mos_corrective_action").insert({
      action: "a low-priority action with no due date is fine", source: "problem", problem_id: problemId,
      owner_name: "Someone", priority: "p4", state: "open",
    }).select("action_id").limit(1);
    if (okAction.data?.[0]?.action_id) made.push({ table: "mos_corrective_action", pk: "action_id", id: okAction.data[0].action_id });
    ok("C9", !okAction.error,
      "control: a P4 action WITHOUT a due date is accepted — C1 constrains the priorities §14 names, not every action");

    // ── A · the shared trail is append only, and its cascade works ───────────
    const ev = await admin.from("mos_support_event").insert({
      record_type: "case", case_id: caseId, from_state: "new", to_state: "triage",
      actor_name: "Support", reason: "picked up", note: "phoned back",
    }).select("id").limit(1);
    const evId = ev.data?.[0]?.id ?? null;
    ok("A1", !!evId, `a lifecycle row appends for any of the five — ${ev.error ? String(ev.error.message).slice(0, 60) : "appended"}`);
    // ⚠ REMEMBERED, NOT QUEUED. A direct delete is refused by A3 below, so this row leaves only when its
    // case does. It still has to be swept for, which is exactly what the first version failed to do.
    if (evId) remember("mos_support_event", "id", evId);

    const upd = await admin.from("mos_support_event").update({ note: "rewritten" }).eq("id", evId);
    ok("A2", !!upd.error, `⚠ an UPDATE on the shared trail is REFUSED — ${String(upd.error?.message ?? "ACCEPTED").slice(0, 60)}`);

    const del = await admin.from("mos_support_event").delete().eq("id", evId);
    ok("A3", !!del.error, `⚠ and a direct DELETE is refused — ${String(del.error?.message ?? "ACCEPTED").slice(0, 60)}`);

    const badType = await mustReject("mos_support_event", {
      record_type: "invoice", case_id: caseId, to_state: "x",
    }, "id");
    ok("A4", badType.rejected, `the trail only accepts the five record types — ${badType.message}`);

    // ⚠ A5-A7 ARE MIGRATION 319, AND 319 EXISTS BECAUSE OF A DEFECT THIS HARNESS CAUSED.
    // The trail was polymorphic — a record_type word and a bare uuid, no foreign key. Nothing cascaded
    // to it, and its append-only trigger refuses a direct DELETE, so a trail row could not be removed by
    // anybody, ever. Typed parents fix the removal path AND make a mislabelled row impossible.
    const noParent = await mustReject("mos_support_event", { record_type: "case", to_state: "triage" }, "id");
    ok("A5", noParent.rejected, `a trail row with NO parent is refused — ${noParent.message}`);

    const twoParents = await mustReject("mos_support_event", {
      record_type: "case", case_id: caseId, problem_id: problemId, to_state: "triage",
    }, "id");
    ok("A6", twoParents.rejected, `and one naming TWO parents is refused — exactly one — ${twoParents.message}`);

    const mislabelled = await mustReject("mos_support_event", {
      record_type: "problem", case_id: caseId, to_state: "triage",
    }, "id");
    ok("A7", mislabelled.rejected,
      `a row cannot say "problem" while pointing at a case — the type and the parent must agree — ${mislabelled.message}`);

    // ── P · no record type can name a patient ────────────────────────────────
    const sql = readdirSync("supabase/migrations")
      .filter(f => f.startsWith("318-"))
      .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
    const patientCols = [...sql.matchAll(/^\s+(patient[a-z_]*)\s+/gm)].map(m => m[1]);
    ok("P1", patientCols.length === 0,
      `⚠ §1 and §10: not one of the five record types has a patient column — ${patientCols.join(", ") || "none"}`);

    ok("P2", /practice_id\s+uuid references practice_workspace/.test(sql),
      "control: they DO name a practice — P1 is about patients, not about scoping");
  } finally {
    await cleanup();
  }

  const leftoverWs = await admin.from("practice_workspace").select("id").eq("owner_person_id", FIXTURE_OWNER);
  ok("Z1", !leftoverWs.error && (leftoverWs.data ?? []).length === 0, "control: the fixture practice is gone");

  // ⚠ BY ID, ACROSS EVERY TABLE THIS RUN WROTE TO — not one table by one title, and not a row count on
  // the estate. A count would pin a number this build is actively trying to change; an id sweep says
  // only "what I made is gone", which is the whole of what a cleanup control owns.
  const residue: string[] = [];
  for (const c of createdEver) {
    const r = await admin.from(c.table).select(c.pk, { count: "exact", head: true }).eq(c.pk, c.id);
    if (r.error) residue.push(`${c.table}: unreadable (${String(r.error.message).slice(0, 40)})`);
    else if ((r.count ?? 0) > 0) residue.push(`${c.table}: ${c.id.slice(0, 8)} still there`);
  }
  ok("Z2", residue.length === 0,
    `control: every row this run created is gone, all ${createdEver.length} of them — ${residue.join("; ") || "clean"}`);

  ok("Z3", cleanupError === null, `control: the cleanup itself reported no error — ${cleanupError ?? "clean"}`);

  // ⚠ Z4 IS THE ONE THAT WOULD HAVE CAUGHT IT. Z2 can only sweep what this run remembered, so it is
  // blind to a row left by an EARLIER run — and an earlier run is precisely what left the orphan that
  // migration 319 had to delete. The trail now has foreign keys, so a parentless row is unrepresentable;
  // this asserts the schema makes it so rather than trusting that it does.
  const orphans = await admin.from("mos_support_event")
    .select("id", { count: "exact", head: true })
    .is("case_id", null).is("problem_id", null).is("escalation_id", null)
    .is("postmortem_id", null).is("action_id", null);
  ok("Z4", !orphans.error && (orphans.count ?? 0) === 0,
    `control: no trail row anywhere has lost its parent — ${orphans.error ? "UNREADABLE" : orphans.count} found`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => {
  await cleanup();
  console.error("\nHARNESS CRASHED (fixtures removed):", e);
  process.exit(1);
});
