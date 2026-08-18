/**
 * CPR-CORE-MOS-001 PHASE 4 ACCEPTANCE — the Practice-native incident model.
 *
 *   I  the model exists with §8's fields, and refuses what it must refuse
 *   A  the lifecycle trail is APPEND ONLY, proved by an UPDATE and a DELETE that fail
 *   S  an incident's scope is a canonical subject and its journey one of the eight — by foreign key
 *   D  impact is DERIVED at read time, not stored, and the subject label follows a rename
 *
 * ⚠ A IS THE ONE WORTH THE MOST. A trigger that exists and does not fire is indistinguishable from no
 * trigger until the day somebody writes a repair script. It is proved by trying both verbs.
 *
 *   npx --yes tsx scripts/mos-phase4-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { FIXTURE_OWNER_PREFIX, cleanupOnKill } from "./_cleanup";
import {
  loadOpenIncidents, incidentImpact, incidentHistory, severityTally,
  INCIDENT_SEVERITIES, INCIDENT_STATUSES,
} from "../src/lib/hq/mos-incident";
import { emitEvent, newCorrelationId } from "../src/lib/mos/event";

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

const FIXTURE_OWNER = `${FIXTURE_OWNER_PREFIX}0000-4000-8000-000000000315`;
let fixtureId: string | null = null;
let incidentId: string | null = null;

/**
 * ⚠ THE DELETE'S ERROR IS READ, AND IT DID NOT USED TO BE.
 *
 * This function issued the delete and moved on. Migration 315's append-only trigger refused every
 * incident that had a lifecycle row, the refusal was discarded, and five acceptance runs left five
 * incidents behind while the harness reported clean. They were only noticed because the Product Health
 * screen showed five identical incidents against a practice that no longer exists.
 *
 * A cleanup that cannot fail loudly is not a cleanup. Migration 316 makes the cascade work; this makes
 * the next failure visible instead of silent.
 */
let cleanupError: string | null = null;

async function cleanup() {
  if (incidentId) {
    const del = await admin.from("mos_incident").delete().eq("incident_id", incidentId);
    if (del.error) cleanupError = String(del.error.message).slice(0, 90);
    else incidentId = null;
  }
  if (fixtureId) {
    const del = await admin.from("practice_workspace").delete().eq("id", fixtureId);
    if (del.error) cleanupError = String(del.error.message).slice(0, 90);
    else fixtureId = null;
  }
}
cleanupOnKill(cleanup);

/** A write that MUST fail. */
async function mustReject(table: string, row: Record<string, unknown>): Promise<{ rejected: boolean; message: string }> {
  const res = await admin.from(table).insert(row).select().limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 68) };
  const id = res.data?.[0]?.incident_id ?? res.data?.[0]?.id;
  if (id) await admin.from(table).delete().eq(table === "mos_incident" ? "incident_id" : "id", id);
  return { rejected: false, message: "the write was ACCEPTED" };
}

async function main() {
  console.log("\nCPR-CORE-MOS-001 PHASE 4 ACCEPTANCE — INCIDENTS\n");

  const probe = await admin.from("mos_incident").select("incident_id").limit(1);
  if (probe.error) {
    console.log("  ---- MIGRATION 315 IS NOT APPLIED ----");
    console.log(`  mos_incident could not be read (${String(probe.error.message).slice(0, 60)}).\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  // ── the fixture practice, so an incident can name a real subject ──────────
  const created = await admin.from("practice_workspace").insert({
    name: "MOS phase 4 acceptance fixture", owner_person_id: FIXTURE_OWNER,
    country: "ZZ", timezone: "UTC",
  }).select("id").limit(1);
  if (created.error || !created.data?.[0]?.id) {
    ok("I", false, `could not create the fixture — ${String(created.error?.message).slice(0, 80)}`);
    console.log(`\nRED  ${pass} passed, ${failures.length} failed\n`); process.exit(1);
  }
  fixtureId = created.data[0].id as string;

  try {
    // ── S · scope is a canonical subject, journey is one of the eight ───────
    const badSubject = await mustReject("mos_incident", {
      subject_type: "definitely_not_a_subject", subject_id: fixtureId,
      title: "bad subject", severity: "sev2",
    });
    ok("S1", badSubject.rejected,
      `an incident cannot name a scope outside the §3 vocabulary — ${badSubject.message}`);

    const badJourney = await mustReject("mos_incident", {
      subject_type: "practice", subject_id: fixtureId, journey_key: "not_a_journey",
      title: "bad journey", severity: "sev2",
    });
    ok("S2", badJourney.rejected,
      `an incident cannot blame a journey outside the §7 eight — ${badJourney.message}`);

    const noSubjectId = await mustReject("mos_incident", {
      subject_type: "practice", title: "practice-scoped with no practice", severity: "sev2",
    });
    ok("S3", noSubjectId.rejected,
      `a practice-scoped incident must say WHICH practice — ${noSubjectId.message}`);

    const resolvedNoTime = await mustReject("mos_incident", {
      subject_type: "product", title: "resolved with no resolution time", severity: "sev3", status: "resolved",
    });
    ok("S4", resolvedNoTime.rejected,
      `a resolved incident must carry its resolution time — ${resolvedNoTime.message}`);

    const endsBeforeStart = await mustReject("mos_incident", {
      subject_type: "product", title: "ends before it began", severity: "sev3", status: "resolved",
      started_at: new Date().toISOString(), resolved_at: new Date(Date.now() - 60_000).toISOString(),
    });
    ok("S5", endsBeforeStart.rejected,
      `an incident cannot end before it began — ${endsBeforeStart.message}`);

    // ── I · a real incident, with evidence threaded to the event store ──────
    const corr = newCorrelationId();
    await emitEvent(admin, {
      eventName: "practice.booking.started", practiceId: fixtureId, correlationId: corr,
      component: "scheduling", outcome: "started",
    });
    await emitEvent(admin, {
      eventName: "practice.booking.failed", practiceId: fixtureId, correlationId: corr,
      component: "scheduling", outcome: "failure", failureCode: "SLOT_TAKEN", durationMs: 90,
    });

    const ins = await admin.from("mos_incident").insert({
      subject_type: "practice", subject_id: fixtureId,
      title: "Bookings failing for one practice", severity: "sev2", status: "investigating",
      journey_key: "patient_booking", component: "scheduling",
      affected_scope: "One practice, booking only",
      impact_note: "Counted from the event thread rather than frozen here",
      owner_name: "Product Director", evidence_correlation_id: corr,
      change_ref: "v1.42.3", detection: "health_rule",
    }).select("incident_id").limit(1);
    ok("I1", !ins.error && !!ins.data?.[0]?.incident_id,
      `an incident with §8's fields is accepted — ${ins.error ? String(ins.error.message).slice(0, 70) : "created"}`);
    incidentId = ins.data?.[0]?.incident_id ?? null;

    const open = await loadOpenIncidents(admin);
    const mine = (open ?? []).find(i => i.incidentId === incidentId);
    ok("I2", !!mine && mine.status === "investigating" && mine.severity === "sev2",
      "it reads back through the open-incident view, unresolved and ranked");

    ok("I3", mine?.journeyName === "Patient Booking",
      `⚠ the journey NAME comes from the phase 2 list, not from a string on the incident — "${mine?.journeyName}"`);

    // ── D · the subject label follows a rename, and impact is derived ───────
    ok("D1", mine?.subjectLabel === "MOS phase 4 acceptance fixture",
      `the subject label resolves through the phase 1 registry — "${mine?.subjectLabel}"`);

    const RENAMED = "MOS phase 4 acceptance fixture (renamed)";
    await admin.from("practice_workspace").update({ name: RENAMED }).eq("id", fixtureId);
    const afterRename = (await loadOpenIncidents(admin))?.find(i => i.incidentId === incidentId);
    ok("D2", afterRename?.subjectLabel === RENAMED,
      "⚠ renaming the Practice renames it on the incident, with nothing to refresh — the label was never copied");

    const impact = mine ? await incidentImpact(admin, mine) : null;
    ok("D3", impact !== null && impact.events === 2 && impact.failures === 1 && impact.practices === 1,
      `⚠ impact is COUNTED FROM THE EVENT STORE at read time — ${impact?.events} events, ${impact?.failures} failed, ${impact?.practices} practice`);

    const noThread = await incidentImpact(admin, { ...(mine!), evidenceCorrelationId: null });
    ok("D4", noThread === null,
      "an incident with no correlation id reports impact UNKNOWN rather than zero — a zero would say the opposite");

    // ── A · the lifecycle trail is append only ─────────────────────────────
    const ev = await admin.from("mos_incident_event").insert({
      incident_id: incidentId, from_status: "open", to_status: "investigating",
      actor_name: "Product Director", note: "picked up",
    }).select("id").limit(1);
    ok("A1", !ev.error && !!ev.data?.[0]?.id,
      `a lifecycle row can be appended — ${ev.error ? String(ev.error.message).slice(0, 60) : "appended"}`);
    const evId = ev.data?.[0]?.id;

    const upd = await admin.from("mos_incident_event").update({ note: "rewritten" }).eq("id", evId);
    ok("A2", !!upd.error,
      `⚠ an UPDATE on the lifecycle trail is REFUSED BY THE DATABASE — ${String(upd.error?.message ?? "the update was ACCEPTED").slice(0, 66)}`);

    const del = await admin.from("mos_incident_event").delete().eq("id", evId);
    ok("A3", !!del.error,
      `⚠ and a DELETE is refused too — ${String(del.error?.message ?? "the delete was ACCEPTED").slice(0, 66)}`);

    const hist = await incidentHistory(admin, incidentId!);
    ok("A4", (hist ?? []).length === 1 && hist![0].toStatus === "investigating",
      `control: the row is still there and readable after both refusals — ${(hist ?? []).length} entry`);

    // ── vocabularies ────────────────────────────────────────────────────────
    const badSeverity = await mustReject("mos_incident", {
      subject_type: "product", title: "bad severity", severity: "catastrophic",
    });
    ok("V1", badSeverity.rejected, `a severity outside §9's four is refused — ${badSeverity.message}`);

    ok("V2", INCIDENT_SEVERITIES.length === 5 && INCIDENT_STATUSES.length === 8,
      "control: the TypeScript vocabularies are §6's five severities and §5's eight lifecycle states");

    const tally = severityTally(open ?? []);
    ok("V3", tally.sev2 >= 1,
      `the severity tally counts what is open — ${JSON.stringify(tally)}`);
  } finally {
    await cleanup();
  }

  const leftover = await admin.from("practice_workspace").select("id").eq("owner_person_id", FIXTURE_OWNER);
  ok("Z1", !leftover.error && (leftover.data ?? []).length === 0,
    "control: the fixture practice is gone");

  // ⚠ AND THE INCIDENT IS CHECKED SEPARATELY, BECAUSE IT DOES NOT CASCADE WITH THE PRACTICE.
  // subject_id is TEXT, not a foreign key - deliberately, because a subject may be a market or a service
  // rather than a practice. So removing the workspace leaves the incident standing, and a control that
  // only looked at workspaces reported clean while five incidents accumulated.
  const orphanTitle = await admin.from("mos_incident").select("incident_id")
    .eq("title", "Bookings failing for one practice");
  ok("Z2", !orphanTitle.error && (orphanTitle.data ?? []).length === 0,
    `control: no acceptance incident is left in the estate — ${(orphanTitle.data ?? []).length} found`);

  ok("Z3", cleanupError === null,
    `control: the cleanup itself reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => {
  await cleanup();
  console.error("\nHARNESS CRASHED (the fixture was removed):", e);
  process.exit(1);
});
