/**
 * CPR-CORE-MOS-001 PHASE 2 ACCEPTANCE — the operational event envelope.
 *
 * Phase 1 was accepted on four conditions the owner set. Phase 2's are the same shape, one level up:
 *
 *   B1  the catalogue and the journey list match the specification, and the TypeScript mirrors match
 *       the database rather than a memory of it
 *   B2  an event can be emitted, read back, and joined to its journey THROUGH THE CATALOGUE
 *   B3  the envelope's integrity constraints actually BITE - each is proved by a rejected write, not
 *       by its presence in a schema dump
 *   B4  attempts and successes are countable, which is the denominator Product Health has never had
 *   G   the envelope stores no journey name and no market, so neither can drift from its source
 *
 * ⚠ B3 IS THE ONE WORTH THE MOST HERE. A CHECK constraint that exists and does not fire is
 * indistinguishable from no constraint at all until the day it matters. Every one of the four is
 * exercised with a write that must fail.
 *
 *   npx --yes tsx scripts/mos-phase2-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { FIXTURE_OWNER_PREFIX, cleanupOnKill } from "./_cleanup";
import {
  EVENT_NAMES, JOURNEY_KEYS, OUTCOMES, FORBIDDEN_METADATA_KEYS,
  emitEvent, newCorrelationId, journeyOutcomes,
} from "../src/lib/mos/event";

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

const FIXTURE_OWNER = `${FIXTURE_OWNER_PREFIX}0000-4000-8000-000000000313`;
let fixtureId: string | null = null;
// remembered separately, because dropFixture clears fixtureId and Z2 still needs to ask about that practice
let fixturePracticeId: string | null = null;

async function dropFixture() {
  if (!fixtureId) return;
  // events cascade with the workspace, so one delete removes both
  await admin.from("practice_workspace").delete().eq("id", fixtureId);
  fixtureId = null;
}
cleanupOnKill(dropFixture);

/** A write that MUST fail. Returns true when the database refused it. */
async function mustReject(row: Record<string, unknown>): Promise<{ rejected: boolean; message: string }> {
  const res = await admin.from("mos_event").insert(row).select("event_id").limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 70) };
  // it was accepted - remove it so a failing pin does not also leave litter
  if (res.data?.[0]?.event_id) await admin.from("mos_event").delete().eq("event_id", res.data[0].event_id);
  return { rejected: false, message: "the write was ACCEPTED" };
}

async function main() {
  console.log("\nCPR-CORE-MOS-001 PHASE 2 ACCEPTANCE\n");

  const cat = await admin.from("mos_event_name").select("name, domain, journey_key");
  if (cat.error) {
    console.log("  ---- MIGRATION 313 IS NOT APPLIED ----");
    console.log(`  mos_event_name could not be read (${String(cat.error.message).slice(0, 60)}).\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }
  const catalogue = cat.data as { name: string; domain: string; journey_key: string | null }[];

  // ── B1 · the catalogue and journeys match, and the mirrors match the database ──
  const jr = await admin.from("mos_journey").select("key, name, outcome_req, sort_order");
  const journeys = (jr.error ? [] : jr.data) as { key: string; name: string; outcome_req: string; sort_order: number }[];

  ok("B1a", journeys.length === 8,
    `§7's eight critical journeys are seeded — ${journeys.length} rows`);

  ok("B1b", JSON.stringify(journeys.map(j => j.key).sort()) === JSON.stringify([...JOURNEY_KEYS].sort()),
    "⚠ the TypeScript journey list matches the DATABASE — the nine-versus-eight mistake cannot recur silently");

  ok("B1c", JSON.stringify(catalogue.map(c => c.name).sort()) === JSON.stringify([...EVENT_NAMES].sort()),
    `the TypeScript event catalogue matches the database exactly — ${catalogue.length} events`);

  const journeysCovered = new Set(catalogue.map(c => c.journey_key).filter(Boolean));
  ok("B1d", JOURNEY_KEYS.every(k => journeysCovered.has(k)),
    `every one of the eight journeys has at least one catalogued event — ${journeysCovered.size} covered`);

  ok("B1e", journeys.every(j => j.outcome_req.length > 15),
    "every journey carries §7's minimum measurable outcome, so an instrumentation gap is legible from the row");

  // the forbidden-key list in TypeScript must equal the one the constraint holds
  const sql = readFileSync("supabase/migrations/313-mos-operational-event-envelope.sql", "utf8");
  const constraintKeys = [...(/mos_event_metadata_is_not_phi[\s\S]*?array\[([\s\S]*?)\]/.exec(sql)?.[1] ?? "")
    .matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
  ok("B1f", constraintKeys.length > 0 && JSON.stringify(constraintKeys) === JSON.stringify([...FORBIDDEN_METADATA_KEYS].sort()),
    `⚠ the emitter's forbidden-key list and the database constraint's are IDENTICAL (${constraintKeys.length} keys) — two copies of a rule that could disagree is worse than one in the wrong place`);

  // ── the fixture ────────────────────────────────────────────────────────────
  const created = await admin.from("practice_workspace").insert({
    name: "MOS phase 2 acceptance fixture", owner_person_id: FIXTURE_OWNER,
    country: "ZZ", timezone: "UTC",
  }).select("id").limit(1);
  if (created.error || !created.data?.[0]?.id) {
    ok("B2", false, `could not create the fixture, so nothing below is proven — ${String(created.error?.message).slice(0, 80)}`);
    console.log(`\nRED  ${pass} passed, ${failures.length} failed\n`);
    process.exit(1);
  }
  fixtureId = created.data[0].id as string;
  fixturePracticeId = fixtureId;

  try {
    // ── B2 · emit, read back, and join through the catalogue ─────────────────
    const corr = newCorrelationId();
    const started = await emitEvent(admin, {
      eventName: "practice.encounter.save_attempted", practiceId: fixtureId, correlationId: corr,
      component: "encounter", outcome: "started", journeyStep: "open_form",
    });
    ok("B2a", started.ok, `an event emits and returns its id — ${started.ok ? started.eventId.slice(0, 8) : started.error}`);

    const saved = await emitEvent(admin, {
      eventName: "practice.encounter.saved", practiceId: fixtureId, correlationId: corr,
      component: "encounter", outcome: "success", durationMs: 412,
    });
    ok("B2b", saved.ok, "a second event in the same transaction shares its correlation id");

    const jv = await admin.from("mos_journey_event")
      .select("journey_key, journey_name, event_name, outcome, correlation_id")
      .eq("correlation_id", corr);
    const jrows = (jv.error ? [] : jv.data) as { journey_key: string; journey_name: string; outcome: string }[];
    ok("B2c", jrows.length === 2 && jrows.every(r => r.journey_key === "save_encounter"),
      `⚠ both events resolve to "Save Encounter" THROUGH THE CATALOGUE — the journey is derived, and no emitter ever named it`);

    ok("B2d", jrows.every(r => r.journey_name === "Save Encounter"),
      "the journey's display name comes from the one journey row, not from a string on the event");

    // ── B3 · the constraints bite ────────────────────────────────────────────
    const phi = await mustReject({
      event_name: "practice.booking.created", practice_id: fixtureId, correlation_id: corr,
      component: "booking", outcome: "success", metadata: { patient_id: "abc-123" },
    });
    ok("B3a", phi.rejected,
      `⚠ a PHI key in operational metadata is REFUSED BY THE DATABASE — ${phi.message}`);

    const okMeta = await emitEvent(admin, {
      eventName: "practice.booking.created", practiceId: fixtureId, correlationId: corr,
      component: "booking", outcome: "success", metadata: { slot_minutes: 30, channel: "self_booking" },
    });
    ok("B3b", okMeta.ok,
      "control: NON-patient operational metadata is accepted — B3a rejects PHI rather than rejecting metadata");

    const badCode = await mustReject({
      event_name: "practice.booking.created", practice_id: fixtureId, correlation_id: corr,
      component: "booking", outcome: "success", failure_code: "SLOT_TAKEN",
    });
    ok("B3c", badCode.rejected,
      `a failure code on a SUCCESS is refused — ${badCode.message}`);

    const badSubject = await mustReject({
      event_name: "practice.booking.created", practice_id: fixtureId, correlation_id: corr,
      component: "booking", outcome: "success",
      subject_type: "practice", subject_id: "00000000-0000-4000-8000-000000000999",
    });
    ok("B3d", badSubject.rejected,
      `a typed subject that disagrees with practice_id is refused — ${badSubject.message}`);

    const badName = await mustReject({
      event_name: "practice.encounter.definitely_not_catalogued", practice_id: fixtureId,
      correlation_id: corr, component: "encounter", outcome: "success",
    });
    ok("B3e", badName.rejected,
      `an uncatalogued event name is refused by the foreign key — ${badName.message}`);

    const badOutcome = await mustReject({
      event_name: "practice.booking.created", practice_id: fixtureId, correlation_id: corr,
      component: "booking", outcome: "probably_fine",
    });
    ok("B3f", badOutcome.rejected,
      `an outcome outside §5's vocabulary is refused — ${badOutcome.message}`);

    // the emitter refuses the same things ABOVE the database, with a better message
    const emitPhi = await emitEvent(admin, {
      eventName: "practice.booking.created", practiceId: fixtureId, correlationId: corr,
      component: "booking", outcome: "success", metadata: { mrn: "999" },
    });
    ok("B3g", !emitPhi.ok && /patient-identifying/.test(emitPhi.ok ? "" : emitPhi.error),
      "the emitter refuses PHI before the database does, naming the offending key rather than a constraint");

    // ── B4 · attempts and successes are countable ────────────────────────────
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const counts = await journeyOutcomes(admin, "save_encounter", since);
    ok("B4a", counts !== null && counts.attempts >= 1 && counts.successes >= 1,
      `⚠ Save Encounter now has ATTEMPTS AND SUCCESSES — ${counts?.attempts} started, ${counts?.successes} succeeded. This is the denominator Product Health has never had`);

    ok("B4b", counts !== null && counts.attempts > 0 && (counts.successes / counts.attempts) <= 1,
      "a success rate can be formed from a real base rather than inferred from a failure count");

    // ── G · nothing derivable is stored on the row ───────────────────────────
    const raw = await admin.from("mos_event").select("*").eq("correlation_id", corr).limit(1);
    const cols = raw.error || !raw.data?.[0] ? [] : Object.keys(raw.data[0]);
    ok("Ga", cols.length > 0 && !cols.includes("journey_name") && !cols.includes("journey"),
      `⚠ the envelope has NO journey_name column — it cannot drift from the catalogue because it does not exist (${cols.length} columns)`);

    ok("Gb", !cols.includes("market") && !cols.includes("market_code") && !cols.includes("plan_code"),
      "and no market or plan cohort — both derive from the phase 1 subject chain, and a copy would be wrong the moment a Practice changes country");

    ok("Gc", cols.includes("correlation_id") && cols.includes("outcome") && cols.includes("duration_ms")
        && cols.includes("failure_code") && cols.includes("component"),
      "control: the fields §5 DOES require are all present — Ga and Gb are about what is derived, not about a thin table");
  } finally {
    await dropFixture();
  }

  const leftoverWs = await admin.from("practice_workspace").select("id").eq("owner_person_id", FIXTURE_OWNER);
  ok("Z1", !leftoverWs.error && (leftoverWs.data ?? []).length === 0,
    "control: the fixture workspace left nothing behind");

  // ⚠ SCOPED TO THE FIXTURE'S PRACTICE, NOT TO A COMPONENT NAME — and this pin was wrong until the
  // product caught up with it. It originally asserted that NO event with component "encounter" existed
  // after the fixture was dropped, which held only while nothing real emitted. The moment the encounters
  // route was instrumented, the live estate produced encounter events legitimately and this control
  // failed while everything it was guarding was correct. A control must describe the thing it owns.
  const leftoverEv = fixturePracticeId
    ? await admin.from("mos_event").select("event_id").eq("practice_id", fixturePracticeId).limit(1000)
    : { error: null, data: [] as { event_id: string }[] };
  const orphaned = (leftoverEv.error ? [] : leftoverEv.data) as { event_id: string }[];
  ok("Z2", orphaned.length === 0,
    `control: the fixture's own events cascaded away with it — ${orphaned.length} remain for that practice`);

  ok("Z3", OUTCOMES.length === 5,
    `control: §5's outcome vocabulary is five values including "started" — without it no attempt is countable`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => {
  await dropFixture();
  console.error("\nHARNESS CRASHED (the fixture was removed):", e);
  process.exit(1);
});
