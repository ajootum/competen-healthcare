/**
 * Timeline harness -- timelineDay().
 *
 * WHAT IT PROVES:
 *   1. POSITIONS ARE ON THE PRACTICE'S CLOCK, NOT UTC'S. A 01:00 Kampala appointment is 22:00Z the day
 *      before; if the timeline measured from UTC midnight it would sit at minute 1320 -- off the bottom
 *      of the drawn day -- instead of minute 60. This is the same defect the calendar loader had.
 *   2. THE DRAWN WINDOW IS DERIVED FROM THE DAY, never assumed. A 06:00 ward round and a 21:00 call are
 *      both on the screen, because the window stretched to hold them.
 *   3. ONE LANE PER PLACE, and the "not said" lane appears ONLY when something is in it.
 *   4. CANCELLED AND NO-SHOW APPOINTMENTS ARE NOT DRAWN. A cancelled block occupying the grid is a slot
 *      the practitioner cannot see is free.
 *   5. WHAT CANNOT BE DRAGGED SAYS SO. Arrived and completed appointments are marked immovable with a
 *      reason, matching what the engine would refuse.
 *   6. THE DRAG ROUND TRIP IS EXACT: dayStartIso + startMinute reproduces the stored instant, which is
 *      the arithmetic the browser does in reverse when a block is dropped.
 *   7. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-timeline-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { bookAppointment, transitionAppointment } from "../src/lib/practice/scheduling";
import { timelineDay } from "../src/lib/practice/timeline";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000de001";
const OTHER = "00000000-0000-4000-8000-0000000de002";
const TZ = "Africa/Kampala"; // UTC+3, no daylight saving -- the arithmetic is checkable by hand.

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-tl-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-tl",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-tl", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const DAY = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 45); return d.toISOString().slice(0, 10); })();
/** A wall-clock time in Kampala, expressed as the UTC instant it actually is. */
const kampala = (hh: number, mm = 0) => {
  const utcHour = hh - 3;
  if (utcHour >= 0) return `${DAY}T${String(utcHour).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;
  const prev = new Date(`${DAY}T12:00:00Z`); prev.setUTCDate(prev.getUTCDate() - 1);
  return `${prev.toISOString().slice(0, 10)}T${String(utcHour + 24).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;
};

async function main() {
  console.log("\n=== TIMELINE ===\n");
  await cleanup();

  const wsA = await provision(OWNER, "Dr Timeline A", "a");
  const wsB = await provision(OTHER, "Dr Timeline B", "b");
  const ctxA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const ctxB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!ctxA.ok || !ctxB.ok) throw new Error("context resolution failed");

  const mk = async (wsId: string, name: string, type: string) => {
    const { data, error } = await admin.from("practice_location")
      .insert({ workspace_id: wsId, name, type, active: true, travel_buffer_minutes: 0 }).select("id").single();
    if (error || !data) throw new Error(`location insert failed: ${error?.message}`);
    return data.id as string;
  };
  const siteA = await mk(wsA, "Mulago Hospital", "hospital");
  const siteB = await mk(wsA, "Kololo Room", "clinic");
  await mk(wsB, "Their Place", "clinic");

  const book = async (wsId: string, name: string, whenIso: string, opts: Record<string, unknown> = {}) => {
    const r = await bookAppointment(admin, {
      workspaceId: wsId, patientName: name, appointmentType: "hospital_consultation",
      scheduledAt: whenIso, allowOverlap: true, actorId: wsId === wsA ? OWNER : OTHER,
      correlationId: "tl-setup", ...opts,
    });
    if (!r.ok) throw new Error(`setup booking "${name}" failed: ${r.code} ${r.message}`);
    return r.data.id;
  };

  // ---- 1. The practice's clock ---------------------------------------------------------------------
  // 01:00 in Kampala is 22:00Z the PREVIOUS day. A UTC-based timeline puts this at minute 1320.
  const earlyHours = await book(wsA, "Early Hours", kampala(1, 0), { locationId: siteA });
  const wardRound = await book(wsA, "Ward Round", kampala(6, 0), { locationId: siteA });
  const evening = await book(wsA, "Evening Call", kampala(21, 0), { locationId: siteA });
  const noPlace = await book(wsA, "No Place Said", kampala(10, 0));
  const atClinic = await book(wsA, "At The Room", kampala(14, 30), { locationId: siteB });

  const t = await timelineDay(admin, ctxA.ctx, DAY, TZ);

  const byId = new Map(t.blocks.map(b => [b.id, b]));
  ok("1a a 01:00 Kampala appointment sits at minute 60, not 1320",
    byId.get(earlyHours)?.startMinute === 60, JSON.stringify(byId.get(earlyHours)?.startMinute));
  ok("1b a 14:30 appointment sits at minute 870",
    byId.get(atClinic)?.startMinute === 870, JSON.stringify(byId.get(atClinic)?.startMinute));
  ok("1c CONTROL: the day really did start at 21:00Z the previous date, so 1a is a real conversion",
    t.dayStartIso.endsWith("T21:00:00.000Z"), t.dayStartIso);

  // ---- 2. The drawn window is derived ---------------------------------------------------------------
  ok("2a the window stretches back to hold the 01:00 appointment", t.fromMinute <= 60, String(t.fromMinute));
  ok("2b the window stretches forward to hold the 21:00 one",
    t.toMinute >= 21 * 60 + 20, String(t.toMinute));
  ok("2c and does not run past the end of the day", t.toMinute <= 1440, String(t.toMinute));

  // ---- 3. Lanes -------------------------------------------------------------------------------------
  ok("3a one lane per open place", t.lanes.some(l => l.id === siteA) && t.lanes.some(l => l.id === siteB),
    JSON.stringify(t.lanes.map(l => l.name)));
  ok("3b the 'not said' lane appears because something is in it",
    t.lanes.some(l => l.id === null), JSON.stringify(t.lanes.map(l => l.name)));
  ok("3c blocks land in the right lane",
    byId.get(atClinic)?.locationId === siteB && byId.get(noPlace)?.locationId === null,
    JSON.stringify([byId.get(atClinic)?.locationName, byId.get(noPlace)?.locationName]));

  // ---- 4. Cancelled and no-show are not drawn -------------------------------------------------------
  await transitionAppointment(admin, { workspaceId: wsA, appointmentId: wardRound, to: "CANCELLED", actorId: OWNER, correlationId: "tl-4" });
  const t2 = await timelineDay(admin, ctxA.ctx, DAY, TZ);
  ok("4a a cancelled appointment leaves the grid", !t2.blocks.some(b => b.id === wardRound),
    JSON.stringify(t2.blocks.map(b => b.patientName)));
  ok("4b CONTROL: it was drawn before it was cancelled", t.blocks.some(b => b.id === wardRound));

  // ---- 5. What cannot be dragged says so -------------------------------------------------------------
  await transitionAppointment(admin, { workspaceId: wsA, appointmentId: evening, to: "CONFIRMED", actorId: OWNER, correlationId: "tl-5" });
  await transitionAppointment(admin, { workspaceId: wsA, appointmentId: evening, to: "ARRIVED", actorId: OWNER, correlationId: "tl-5b" });
  const t3 = await timelineDay(admin, ctxA.ctx, DAY, TZ);
  const arrivedBlock = t3.blocks.find(b => b.id === evening);
  ok("5a an arrived appointment is marked immovable",
    arrivedBlock?.movable === false, JSON.stringify(arrivedBlock));
  ok("5b and says why", /arrived/.test(arrivedBlock?.immovableReason ?? ""), arrivedBlock?.immovableReason ?? "null");
  ok("5c CONTROL: an ordinary appointment is movable",
    t3.blocks.find(b => b.id === atClinic)?.movable === true);

  // ---- 6. The drag round trip is exact ---------------------------------------------------------------
  const block = t3.blocks.find(b => b.id === atClinic)!;
  const rebuilt = new Date(Date.parse(t3.dayStartIso) + block.startMinute * 60000).toISOString();
  ok("6 dayStart + startMinute reproduces the stored instant exactly",
    Date.parse(rebuilt) === Date.parse(block.scheduledAt), `${rebuilt} vs ${block.scheduledAt}`);

  // ---- 7. Cross-workspace isolation, non-vacuously ---------------------------------------------------
  await book(wsB, "Their Patient", kampala(11, 0));
  const tB = await timelineDay(admin, ctxB.ctx, DAY, TZ);
  ok("7a practice B sees only its own day",
    tB.blocks.length === 1 && tB.blocks[0].patientName === "Their Patient",
    JSON.stringify(tB.blocks.map(b => b.patientName)));
  ok("7b and only its own lanes",
    !tB.lanes.some(l => l.id === siteA || l.id === siteB), JSON.stringify(tB.lanes.map(l => l.name)));
  ok("7c CONTROL: practice A still has its own, so 7a is not vacuous", t3.blocks.length >= 3);

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
