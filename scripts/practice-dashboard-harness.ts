/**
 * CPR-CORE-001 CORE-08 dashboard assembler harness.
 *
 * WHAT IT PROVES, taken from the spec's own acceptance criteria (s16) rather than from what the code
 * happens to do:
 *   - "The page changes from whole-day scope to active-session scope after session start."
 *   - "Every dashboard response must include an as_of timestamp and timezone." (s12)
 *   - "No widget independently calculates a conflicting version of a shared metric."
 *   - "A failure in one feeder does not make the entire dashboard unusable."
 *
 * The last one is the interesting assertion, and it needs BOTH directions: that one failure is survived,
 * and that total failure is still reported. A dashboard that never says "unavailable" passes the first
 * half trivially while lying about the second.
 *
 *   npx --yes tsx scripts/practice-dashboard-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { dashboardReadModel } from "../src/lib/practice/dashboard";
import { planActivity, startActivity, endActivity, todaysPlan } from "../src/lib/practice/activity";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const USER = "00000000-0000-4000-8000-0000000db001";
const ALL = ["practice.home.view", "appointment.manage", "task.view", "followup.view",
  "queue.manage", "practice.calendar.view", "inbox.record", "encounter.list"];

const ctxFor = (workspaceId: string, caps: string[] = ALL): WorkspaceContext => ({
  // ⚠ THE SAME SYMBOL THE WORKSPACE WAS PROVISIONED WITH, never a fresh literal -- a fixture
  // whose ctx claims one zone while its row holds another tests a state that cannot exist.
  workspaceTimezone: "Africa/Kampala",
  userId: USER, workspaceId, workspaceName: "H", workspaceType: "individual_practice",
  workspaceStatus: "active", roleCodes: ["owner"], capabilities: caps, entitled: true,
  entitlementStatus: "trial", onboardingComplete: true, onboardingStep: null,
  // A fixture stands in for a resolved context; nothing here exercises invalidation.
  contextVersion: "harness",
});

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", USER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_activity").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", USER);
  await admin.from("provisioning_request").delete().eq("target_user_id", USER);
  await admin.from("practice_audit_event").delete().eq("actor_id", USER);
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [USER]);
}

async function main() {
  console.log("\n=== DASHBOARD ASSEMBLER (CPR-CORE-001 CORE-08) ===\n");
  await cleanup();

  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-dash-${Date.now()}`, request_type: "pilot",
    actor_user_id: USER, target_user_id: USER, payload_hash: "harness", correlation_id: "harness-dash",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "Harness Dashboard", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req!.id, target_user_id: USER, correlation_id: "harness-dash", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { console.error("provisioning failed:", run.errorCode); process.exitCode = 1; return; }
  const ctx = ctxFor(run.workspaceId);

  // ── 1. s12: as_of and timezone on every response ────────────────────────────────────────────────
  const before = await dashboardReadModel(admin, ctx);
  ok("1a. the payload carries an as_of instant", !Number.isNaN(Date.parse(before.asOf)), before.asOf);
  ok("1b. and the PRACTICE's timezone, not the server's", before.timezone === "Africa/Kampala", before.timezone);
  // The instant is injected, so every feeder sees the same "now". Two cards disagreeing about the time
  // is how a dashboard starts contradicting itself.
  const fixed = new Date("2026-08-05T09:00:00.000Z");
  ok("1c. as_of is the instant the caller passed, not a second clock read",
    (await dashboardReadModel(admin, ctx, { at: fixed })).asOf === fixed.toISOString());

  // ── 2. s16: "the page changes from whole-day scope to active-session scope after session start" ──
  ok("2a. before any session the scope is the whole day", before.scope.kind === "day", before.scope.kind);
  ok("2b. and carries no session id", before.scope.sessionId === null);
  ok("2c. the day window spans 24 hours",
    Date.parse(before.scope.toIso) - Date.parse(before.scope.fromIso) === 86400000,
    `${before.scope.fromIso} -> ${before.scope.toIso}`);

  const today = (await todaysPlan(admin, ctx)).date;
  const act = await planActivity(admin, ctx, {
    activityType: "outpatient_clinic", title: "Assembler clinic", planDate: today,
    plannedStartMinute: 9 * 60, plannedEndMinute: 13 * 60,
  });
  ok("2d-control. an activity can be planned", act.ok, act.ok ? "" : act.message);
  if (!act.ok) { await cleanup(); report(); return; }
  const started = await startActivity(admin, ctx, act.value.id);
  ok("2e-control. and started", started.ok, started.ok ? "" : started.message);

  const during = await dashboardReadModel(admin, ctx);
  ok("2f. AFTER session start the scope is the session", during.scope.kind === "session", during.scope.kind);
  ok("2g. and names which session it is", during.scope.sessionId === act.value.id);
  ok("2h. the window is the session's four hours, not the day's twenty-four",
    Date.parse(during.scope.toIso) - Date.parse(during.scope.fromIso) === 4 * 3600 * 1000,
    `${during.scope.fromIso} -> ${during.scope.toIso}`);

  // ── 3. s16: "no widget independently calculates a conflicting version of a shared metric" ────────
  //
  // The scope is decided ONCE and handed down. If the glance ever disagreed with the payload's own
  // scope, two cards on one screen would be counting different windows while looking identical.
  ok("3a. the glance counts the scope the payload declares", during.glance.scope === during.scope.kind);
  ok("3b. and did so before the session too", before.glance.scope === before.scope.kind);
  ok("3c. the session block is present exactly when the scope is session-scoped",
    (during.session !== null) === (during.scope.kind === "session")
    && (before.session !== null) === (before.scope.kind === "session"));

  // ── 4. s16: "a failure in one feeder does not make the entire dashboard unusable" ────────────────
  //
  // BOTH DIRECTIONS. Total failure must still be reported, or "never unavailable" passes half of this
  // trivially while lying about the other half.
  ok("4a. with everything readable, no feeder is marked unavailable",
    Object.values(during.feeders).every(s => s === "ok"), JSON.stringify(during.feeders));
  ok("4b. and the dashboard as a whole is available", !during.unavailable);

  const broken = await dashboardReadModel(admin, ctxFor("not-a-uuid"));
  ok("4c. when EVERY feeder fails the dashboard says so",
    broken.unavailable && Object.values(broken.feeders).every(s => s === "unavailable"),
    JSON.stringify(broken.feeders));
  ok("4d. and still returns a well-formed payload rather than throwing",
    !!broken.asOf && !!broken.scope && Array.isArray(broken.glance.tiles));
  // ⚠ THE ONE THAT MATTERS: a failed feeder must not be reported as an empty one.
  ok("4e. a failed glance reports no counts, never eight noughts",
    broken.glance.tiles.every(t => t.count === null) || broken.glance.tiles.length === 0);

  // ⚠ WITHOUT THIS THE HEADLINE ASSERTION WAS UNTESTED. 4a-4e only ever exercise ALL-ok and ALL-failed,
  // and s16's actual claim is about the case in between. Changing `every` to `some` in the assembler --
  // making one failed feeder blank the entire dashboard, the exact defect s16 forbids -- left every
  // assertion above green, because neither fixture has a PARTIAL failure in it.
  //
  // Withholding practice.home.view fails the plan feeder while the others still read, which is that case
  // without mocking anything: todaysPlan reports unavailable, and the glance and queue do not gate on it.
  const partial = await dashboardReadModel(admin, ctxFor(run.workspaceId,
    ALL.filter(c => c !== "practice.home.view")));
  const failed = Object.entries(partial.feeders).filter(([, s]) => s === "unavailable").map(([k]) => k);
  ok("4f-control. the fixture really does fail SOME feeders and not all",
    failed.length > 0 && failed.length < Object.keys(partial.feeders).length,
    `${failed.length}/${Object.keys(partial.feeders).length} failed: ${failed.join(",")}`);
  ok("4f. one failed feeder does NOT make the whole dashboard unusable",
    !partial.unavailable, JSON.stringify(partial.feeders));
  ok("4g. and the feeders that did read still carry their figures",
    partial.glance.tiles.length === 8 && partial.glance.tiles.some(t => t.count !== null),
    JSON.stringify(partial.glance.tiles.map(t => t.count)));

  // ── 5. The assembler owns no business logic (the spec's core rule) ───────────────────────────────
  //
  // Asserted on the SOURCE, because it is a rule about where code lives and no runtime check can see it.
  // Crude on purpose: it looks for the shape of a calculation, and a false positive is cheap to explain
  // while a miss lets the exact drift the rule forbids back in.
  const src = await import("node:fs").then(fs =>
    fs.readFileSync("src/lib/practice/dashboard.ts", "utf8"));
  const body = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
  ok("5a. the assembler runs no database query of its own",
    !/\.from\(["']/.test(body), "it calls .from() -- that belongs in an engine");
  ok("5b. and does no arithmetic on figures it assembles",
    !/\breduce\(|Math\.round\(|\/ 60000\b/.test(body),
    "it computes something -- every metric must come from its owning engine");

  await endActivity(admin, ctx, act.value.id);
  await cleanup();
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
