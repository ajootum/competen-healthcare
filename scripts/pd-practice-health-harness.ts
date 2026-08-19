/**
 * The practice health derivation, proven — CPR-PD-014 §5.4, §8.4, §12.
 *
 * §12: "Unit/integration tests cover derivations, capability denial, idempotency, audit creation and
 * plane-boundary enforcement." This is the derivations half.
 *
 * !! PURE, SO IT NEEDS NO DATABASE AND CAN LIVE IN THE BLOCKING CI SUBSET. derivePracticeHealth takes
 * every input as an argument including `now`, which is what makes a boundary testable at all: a rule
 * that reads the clock itself can only be tested by waiting.
 *
 * !! IT TESTS THE BOUNDARIES, NOT JUST THE MIDDLE. A derivation is wrong at its edges or nowhere —
 * "72 hours old" and "73 hours old" are the cases that decide whether every new practice lands on the
 * exception list, and one of them is off-by-one from the other.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { derivePracticeHealth, REASON_LABEL, type HealthInput } from "../src/lib/hq/pd-practice-health";

const NOW = Date.parse("2026-08-19T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

let failures = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };

const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  status: "ACTIVE",
  createdAt: hoursAgo(200),
  ownerPersonId: "owner-1",
  hasFailedProvisioning: false,
  onboarding: { stalledReasonCode: null, completedAt: hoursAgo(100), stepsCompleted: 6, stepsTotal: 6 },
  activationWindowHours: 72,
  now: NOW,
  ...over,
});

function expect(label: string, input: HealthInput, state: string, reason?: string) {
  const v = derivePracticeHealth(input);
  const stateOk = v.state === state;
  const reasonOk = reason === undefined || v.reasons.includes(reason as never);
  if (stateOk && reasonOk) ok(`${label} -> ${v.state} [${v.reasons.join(", ") || "no reasons"}]`);
  else bad(`${label} -> expected ${state}${reason ? ` with ${reason}` : ""}, got ${v.state} [${v.reasons.join(", ")}]`);
}

console.log("\n=== practice health derivation (CPR-PD-014 §5.4) ===\n");

console.log("THE SIX STATES");
expect("a settled active practice", base(), "HEALTHY");
expect("a failed provisioning run", base({ hasFailedProvisioning: true }), "FAILED", "PROVISIONING_FAILED");
expect("stranded at PROVISIONING", base({ status: "PROVISIONING", createdAt: hoursAgo(5) }), "FAILED", "STRANDED_AT_PROVISIONING");
expect("a suspended workspace", base({ status: "SUSPENDED" }), "DEGRADED", "WORKSPACE_SUSPENDED");
expect("provisioned an hour ago, nothing done yet",
  base({ createdAt: hoursAgo(1), onboarding: { stalledReasonCode: null, completedAt: null, stepsCompleted: 0, stepsTotal: 6 } }),
  "NEW", "WITHIN_ACTIVATION_WINDOW");
expect("onboarding with no progress past the threshold",
  base({ createdAt: hoursAgo(200), onboarding: { stalledReasonCode: "NO_PROGRESS", completedAt: null, stepsCompleted: 0, stepsTotal: 6 } }),
  "STALLED", "ONBOARDING_NO_PROGRESS");
expect("no owner recorded", base({ ownerPersonId: null }), "ATTENTION", "NO_OWNER_RECORDED");

console.log("\nPRECEDENCE — the orders that matter");
// FAILED must outrank NEW: the activation window is patience with a practitioner, not with the saga.
expect("a brand-new practice whose run FAILED",
  base({ createdAt: hoursAgo(1), hasFailedProvisioning: true, onboarding: null }),
  "FAILED", "PROVISIONING_FAILED");
// NEW must outrank STALLED, or every new practice lands on the exception list on day one.
expect("inside the window AND flagged stalled by the projection",
  base({ createdAt: hoursAgo(10), onboarding: { stalledReasonCode: "NO_PROGRESS", completedAt: null, stepsCompleted: 0, stepsTotal: 6 } }),
  "NEW", "WITHIN_ACTIVATION_WINDOW");
// A completed onboarding is never NEW, however recent.
expect("completed onboarding one hour after creation",
  base({ createdAt: hoursAgo(1), onboarding: { stalledReasonCode: null, completedAt: hoursAgo(0.5), stepsCompleted: 6, stepsTotal: 6 } }),
  "HEALTHY");

console.log("\nTHE ACTIVATION WINDOW BOUNDARY");
const incomplete = { stalledReasonCode: null, completedAt: null, stepsCompleted: 2, stepsTotal: 6 };
expect("exactly at the window (72h)", base({ createdAt: hoursAgo(72), onboarding: incomplete }), "NEW");
expect("one hour past the window (73h)", base({ createdAt: hoursAgo(73), onboarding: incomplete }), "ATTENTION", "ONBOARDING_INCOMPLETE");

console.log("\nTHRESHOLDS ARE CONFIGURATION");
expect("a 168h window keeps a 100h-old practice NEW",
  base({ createdAt: hoursAgo(100), activationWindowHours: 168, onboarding: incomplete }), "NEW");
expect("a null window falls back to the documented 72h default",
  base({ createdAt: hoursAgo(100), activationWindowHours: null, onboarding: incomplete }), "ATTENTION", "ONBOARDING_INCOMPLETE");

console.log("\nCONTROLS — the harness would notice if the rule stopped working");
// A control that cannot fail proves nothing, so these assert the NEGATIVE cases explicitly.
const healthy = derivePracticeHealth(base());
if (healthy.reasons.length === 0) ok("HEALTHY carries no reason codes, rather than an invented all-clear");
else bad(`HEALTHY invented reasons: ${healthy.reasons.join(", ")}`);

const stranded = derivePracticeHealth(base({ status: "PROVISIONING", createdAt: hoursAgo(0.2) }));
if (stranded.state !== "FAILED") ok("a workspace at PROVISIONING for 12 minutes is NOT called stranded");
else bad("a workspace minutes old was called stranded, which would flag every run in flight");

const everyReason = Object.keys(REASON_LABEL);
const unlabelled = everyReason.filter(r => !REASON_LABEL[r as keyof typeof REASON_LABEL]?.trim());
if (unlabelled.length === 0) ok(`all ${everyReason.length} reason codes carry a human sentence for the badge`);
else bad(`reason codes with no label: ${unlabelled.join(", ")}`);

/**
 * ── CPR-PD-014 §5.5 / §5.6 — the Practice 360 boundary ────────────────────────────────────────────
 *
 * §5.5: "There must be no route from Practice 360 into a patient's record." §5.6 makes it an acceptance
 * test, which is why it is asserted here rather than confirmed once by hand: such a link is one line,
 * and whoever adds it will be trying to be helpful.
 *
 * ⚠ IT SCANS FOR NAVIGATION, NOT FOR THE WORD. The detail surface legitimately discusses patients in
 * prose and in banded counts, so forbidding the noun would fail the page on its own honest
 * explanations. What must not exist is an href that lands on one.
 */
console.log("\nPRACTICE 360 BOUNDARY (§5.5)");
const P360 = join(import.meta.dirname, "..", "src", "app", "super-admin", "pd", "practices", "[practiceId]", "page.tsx");
try {
  const src = readFileSync(P360, "utf8");
  // Comments stripped first: this repo has had assertions pass on their own prose more than once.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const PATIENT_ROUTE = /\/(patients?|encounters?|records?)\b/i;
  const routes = [...code.matchAll(/href=\{?["'`]([^"'`]+)["'`]/g)].map(m => m[1]);
  const intoPatient = routes.filter(r => PATIENT_ROUTE.test(r));
  if (intoPatient.length === 0) ok(`no route into a patient record (${routes.length} link(s) checked)`);
  else bad(`Practice 360 links into a patient record: ${intoPatient.join(", ")}`);

  // The control. A detector that matches nothing would report clean on a page full of them.
  if (PATIENT_ROUTE.test("/practice/patients/abc")) ok("control - the detector recognises a patient route");
  else bad("control FAILED: the detector would not notice a patient route");
} catch {
  bad(`Practice 360 page not found at ${P360}, so this assertion is not running`);
}

console.log(`\n${failures === 0 ? "ALL GREEN" : `RED  ${failures} failure(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
