/**
 * CPR-PD-010 §17 — CROSS-MODULE GOVERNANCE TRIGGERS, ACCEPTANCE.
 *
 *   T  §17's eight events exist as rules, all disabled, no thresholds
 *   E  a rule needing a threshold cannot be enabled without one
 *   A  an actioned trigger names the governance record that answered it
 *   D  declining is allowed, and carries a reason
 *   Z  the estate is left exactly as found — every rule disabled again
 *
 * ⚠ T2 IS THE ASSERTION THIS PHASE EXISTS FOR. §17 says "qualifying" SEV-2, "material" release,
 * "repeated" control failure, "approaching" expiry — five thresholds, none stated anywhere in the
 * specification. A number chosen here would become the policy this module enforces, hidden inside a
 * trigger where it reads as plumbing rather than governance.
 *
 * ⚠ Z2 IS THIS HARNESS'S BLAST RADIUS. To test firing it must ENABLE a rule, and an enabled rule is
 * live governance configuration. Leaving one on would not fail a test — it would switch on a trigger
 * against a threshold a test invented.
 *
 *   npx --yes tsx scripts/gov-triggers-harness.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

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

const FIXTURE = "PD010-TRG";
const madeEvents: string[] = [];
const madeRisks: string[] = [];
const enabledKinds: string[] = [];
let cleanupError: string | null = null;

async function cleanup() {
  for (const id of madeEvents) {
    const d = await admin.from("gov_trigger_event").delete().eq("event_id", id);
    if (d.error) cleanupError = `event: ${String(d.error.message).slice(0, 60)}`;
  }
  for (const id of madeRisks) {
    const d = await admin.from("gov_product_risk").delete().eq("risk_id", id);
    if (d.error) cleanupError = `risk: ${String(d.error.message).slice(0, 60)}`;
  }
  // ⚠ PUT THE RULES BACK. An enabled rule is live governance configuration, not a fixture row.
  for (const kind of enabledKinds) {
    const d = await admin.from("gov_trigger_rule").update({
      is_enabled: false, threshold_value: null, threshold_unit: null,
      configured_by: null, configured_at: null,
    }).eq("trigger_kind", kind);
    if (d.error) cleanupError = `rule ${kind}: ${String(d.error.message).slice(0, 50)}`;
  }
  madeEvents.length = 0; madeRisks.length = 0; enabledKinds.length = 0;
}

async function mustReject(table: string, row: Record<string, unknown>, pk: string) {
  const res = await admin.from(table).insert(row).select(pk).limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 70) };
  if (res.data?.[0]?.[pk]) await admin.from(table).delete().eq(pk, res.data[0][pk]);
  return { rejected: false, message: "the write was ACCEPTED" };
}

async function main() {
  console.log("\nCPR-PD-010 §17 — CROSS-MODULE GOVERNANCE TRIGGERS\n");

  const probe = await admin.from("gov_trigger_rule").select("trigger_kind").limit(1);
  if (probe.error) {
    console.log(`  ---- MIGRATION 329 IS NOT APPLIED ---- (${String(probe.error.message).slice(0, 60)})\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  // ── T · the rules, as §17 states them ────────────────────────────────────
  const rules = (await admin.from("gov_trigger_rule").select("*")).data as Record<string, unknown>[];
  ok("T1", rules.length === 9,
    `§17's event table is seeded as rules — ${rules.length} of them, which is its eight rows plus the SEV-2 split it names separately`);

  ok("T2", rules.every(r => r.threshold_value === null && r.threshold_unit === null),
    `⚠⚠ NOT ONE RULE CARRIES A THRESHOLD — "qualifying", "material", "repeated" and "approaching" are policy numbers §17 never states, and one chosen here would become the policy while reading as plumbing`);

  ok("T3", rules.every(r => r.is_enabled === false),
    "⚠ and every rule ships DISABLED — nothing fires until somebody configures it");

  //
  // ⚠ THE SET, NOT THE COUNT — and the first version of this asserted `=== 5` from memory while the
  // migration correctly marks SIX. A bare count is unfalsifiable by reading: it fails when the schema
  // is right and I miscounted, and passes when the schema is wrong in a way that preserves the total.
  // The claim worth making is WHICH rules need a number, because each one is checkable against §17's
  // own adjectives: "qualifying", "material", "high-risk", "repeated", "approaching".
  const NEEDS_A_NUMBER = [
    "clinical_safety_event",     // "HIGH-RISK clinical safety event"
    "exception_expiry",          // "exception APPROACHING expiry"
    "material_release",          // "MATERIAL feature/release according to configured thresholds"
    "qualifying_sev2",           // "QUALIFYING SEV-2"
    "repeated_control_failure",  // "REPEATED control failure"
    "security_or_privacy_event", // "MATERIAL security/privacy event"
  ];
  const needsThreshold = rules.filter(r => r.requires_threshold === true)
    .map(r => String(r.trigger_kind)).sort();
  ok("T4", JSON.stringify(needsThreshold) === JSON.stringify(NEEDS_A_NUMBER),
    `⚠ exactly the rules whose §17 wording contains an unstated adjective require a threshold — ${needsThreshold.join(", ")}`);

  const noNumberNeeded = rules.filter(r => r.requires_threshold !== true)
    .map(r => String(r.trigger_kind)).sort();
  ok("T4c", JSON.stringify(noNumberNeeded) === JSON.stringify(["new_market", "provider_change", "sev1_incident"]),
    `control: the other three need NO number — a SEV-1 is definitionally qualifying, a new market is a new market — ${noNumberNeeded.join(", ")}`);

  const posture = (await admin.from("gov_trigger_posture").select("*")).data as Record<string, unknown>[];
  const awaiting = posture.filter(p => p.awaiting_threshold === true).map(p => String(p.trigger_kind)).sort();
  ok("T5", JSON.stringify(awaiting) === JSON.stringify(NEEDS_A_NUMBER),
    `⚠ the posture view names each rule AWAITING A THRESHOLD, so a quiet trigger list reads as unconfigured rather than as an untroubled estate — ${awaiting.length} awaiting`);

  try {
    // ── E · enabling ───────────────────────────────────────────────────────
    const enableBare = await admin.from("gov_trigger_rule").update({
      is_enabled: true, configured_by: "harness", configured_at: new Date().toISOString(),
    }).eq("trigger_kind", "repeated_control_failure");
    ok("E1", !!enableBare.error,
      `⚠⚠ §17: a rule that needs a threshold CANNOT be enabled without one — this is the whole of "do not invent the number" — ${String(enableBare.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    const enableNoAuthor = await admin.from("gov_trigger_rule").update({
      is_enabled: true, threshold_value: 3, threshold_unit: "count",
    }).eq("trigger_kind", "repeated_control_failure");
    ok("E2", !!enableNoAuthor.error,
      `and enabling without naming who configured it is refused — enabling is a governance act — ${String(enableNoAuthor.error?.message ?? "ACCEPTED").slice(0, 50)}`);

    const enableProper = await admin.from("gov_trigger_rule").update({
      is_enabled: true, threshold_value: 3, threshold_unit: "count", threshold_window_days: 90,
      configured_by: "harness", configured_at: new Date().toISOString(),
    }).eq("trigger_kind", "repeated_control_failure");
    if (!enableProper.error) enabledKinds.push("repeated_control_failure");
    ok("E3", !enableProper.error,
      `⚠ CONTROL — with a threshold AND an author it enables, so E1 is about the missing number rather than a ban on enabling — ${String(enableProper.error?.message ?? "enabled").slice(0, 45)}`);

    // a rule with no threshold requirement enables without one
    const enableSimple = await admin.from("gov_trigger_rule").update({
      is_enabled: true, configured_by: "harness", configured_at: new Date().toISOString(),
    }).eq("trigger_kind", "sev1_incident");
    if (!enableSimple.error) enabledKinds.push("sev1_incident");
    ok("E4", !enableSimple.error,
      "control: SEV-1 needs no threshold and enables plainly — a SEV-1 is definitionally qualifying, so there is no number to state");

    // ── firing ─────────────────────────────────────────────────────────────
    const fireDisabled = await mustReject("gov_trigger_event", {
      trigger_kind: "new_market", source_module: "manual", source_summary: "x",
    }, "event_id");
    ok("F1", fireDisabled.rejected,
      `⚠ an event cannot be recorded against a rule nobody has switched on — ${fireDisabled.message}`);

    const fired = await admin.from("gov_trigger_event").insert({
      trigger_kind: "sev1_incident", source_module: "support",
      source_ref: `${FIXTURE}-INC-1`,
      source_summary: "SEV-1 booking outage affecting three practices.",
      raised_by: "Support",
    }).select("event_id, response_state").limit(1);
    const eventId = fired.data?.[0]?.event_id ?? null;
    if (eventId) madeEvents.push(eventId);
    ok("F2", !!eventId && fired.data[0].response_state === "pending",
      `⚠ a fired trigger lands PENDING — governance has been asked and has not yet answered, which is a state somebody can be held to`);

    // ── A · actioning ──────────────────────────────────────────────────────
    const actionBare = await admin.from("gov_trigger_event").update({
      response_state: "actioned", responded_by: "Product Director", responded_at: new Date().toISOString(),
    }).eq("event_id", eventId);
    ok("A1", !!actionBare.error,
      `⚠⚠ §17: marking a trigger ACTIONED without naming what answered it is refused — otherwise "actioned" is a word rather than a link — ${String(actionBare.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    const risk = await admin.from("gov_product_risk").insert({
      reference: `${FIXTURE}-RSK`, title: "Risk reassessed after the outage", category_code: "operational",
    }).select("risk_id").limit(1);
    const riskId = risk.data?.[0]?.risk_id ?? null;
    if (riskId) madeRisks.push(riskId);

    const actionLinked = await admin.from("gov_trigger_event").update({
      response_state: "actioned", responded_by: "Product Director",
      responded_at: new Date().toISOString(), risk_id: riskId,
    }).eq("event_id", eventId);
    ok("A2", !actionLinked.error,
      `⚠ CONTROL — naming the risk that answered it DOES action the trigger — ${String(actionLinked.error?.message ?? "actioned").slice(0, 45)}`);

    // ── D · declining ──────────────────────────────────────────────────────
    const second = await admin.from("gov_trigger_event").insert({
      trigger_kind: "sev1_incident", source_module: "support",
      source_ref: `${FIXTURE}-INC-2`, source_summary: "SEV-1 duplicate of the above.",
    }).select("event_id").limit(1);
    const secondId = second.data?.[0]?.event_id ?? null;
    if (secondId) madeEvents.push(secondId);

    const declineBare = await admin.from("gov_trigger_event").update({
      response_state: "declined", responded_by: "Product Director", responded_at: new Date().toISOString(),
    }).eq("event_id", secondId);
    ok("D1", !!declineBare.error,
      `§17: declining to act on a governance trigger without a reason is refused — declining IS a decision — ${String(declineBare.error?.message ?? "ACCEPTED").slice(0, 50)}`);

    const declineReasoned = await admin.from("gov_trigger_event").update({
      response_state: "declined", responded_by: "Product Director",
      responded_at: new Date().toISOString(),
      decline_reason: "Duplicate of the preceding incident, already reassessed.",
    }).eq("event_id", secondId);
    ok("D2", !declineReasoned.error,
      "⚠ CONTROL — a reasoned decline IS accepted. Governance may decide a trigger needs no action; it may not decide that silently");
  } finally {
    await cleanup();
  }

  // ── Z ────────────────────────────────────────────────────────────────────
  const leftEvents = await admin.from("gov_trigger_event").select("event_id", { count: "exact", head: true });
  ok("Z1", !leftEvents.error && (leftEvents.count ?? 0) === 0, `no trigger event is left — ${leftEvents.count ?? "?"} found`);

  const stillEnabled = await admin.from("gov_trigger_rule").select("trigger_kind", { count: "exact", head: true })
    .eq("is_enabled", true);
  ok("Z2", !stillEnabled.error && (stillEnabled.count ?? 0) === 0,
    `⚠⚠ EVERY rule is disabled again — an enabled rule is live governance configuration, and one left on would fire against a threshold a TEST invented — ${stillEnabled.count ?? "?"} still on`);

  const anyThreshold = await admin.from("gov_trigger_rule").select("trigger_kind", { count: "exact", head: true })
    .not("threshold_value", "is", null);
  ok("Z3", !anyThreshold.error && (anyThreshold.count ?? 0) === 0,
    `and no threshold this run wrote survives — ${anyThreshold.count ?? "?"} found`);

  ok("Z4", cleanupError === null, `control: cleanup reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => { await cleanup(); console.error("\nHARNESS CRASHED (fixtures removed):", e); process.exit(1); });
