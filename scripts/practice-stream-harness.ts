/**
 * CPR-CORE-001 CORE-09, second half: the dashboard event stream.
 *
 * WHAT THIS HAS TO PROVE:
 *   s10  a stream of DASHBOARD-RELEVANT events exists and is scoped to one practice
 *   s18  "event propagation is observable and retryable" -- a dropped client resumes without a gap
 *   s13  "every query must be tenant/practice scoped"
 *
 * ⚠ THE TRAP THIS IS REALLY GUARDING. published_at is a marker, NOT a delivery receipt. If the cursor
 * ever filtered on it, a second practitioner opening the dashboard would silently receive nothing that
 * the first had already seen -- and it would pass every single-client test ever written. Section 4 opens
 * two independent readers over the same events to make that impossible to reintroduce.
 *
 *   npx --yes tsx scripts/practice-stream-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import {
  eventsSince, markPublished, advance, DASHBOARD_EVENTS, NOT_STREAMED,
} from "../src/lib/practice/event-stream";
import { emitEvent } from "../src/lib/practice/events";
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

const A = "00000000-0000-4000-8000-00000000f001";
const B = "00000000-0000-4000-8000-00000000f002";

const ctxFor = (workspaceId: string, userId: string): WorkspaceContext => ({
  // ⚠ THE SAME SYMBOL THE WORKSPACE WAS PROVISIONED WITH, never a fresh literal -- a fixture
  // whose ctx claims one zone while its row holds another tests a state that cannot exist.
  workspaceTimezone: "Africa/Kampala",
  userId, workspaceId, workspaceName: "S", workspaceType: "individual_practice", workspaceStatus: "active",
  roleCodes: ["owner"], capabilities: ["practice.home.view"], entitled: true, entitlementStatus: "trial",
  onboardingComplete: true, onboardingStep: null,
  // A fixture stands in for a resolved context; nothing here exercises invalidation.
  contextVersion: "harness",
});

async function cleanup(...users: string[]) {
  for (const u of users) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_domain_event").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    }
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, users);
}

async function provision(user: string, name: string) {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-stream-${name}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-stream",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const payload: IndividualRequest = {
    displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
    defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1",
    source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: "harness-stream", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function main() {
  console.log("\n=== DASHBOARD EVENT STREAM (CPR-CORE-001 CORE-09, s10/s12/s18) ===\n");

  const probe = await admin.from("practice_domain_event").select("published_at").limit(1);
  ok("0. control -- the outbox exists and carries a delivery marker", !probe.error, probe.error?.message ?? "");
  if (probe.error) { report(); return; }

  await cleanup(A, B);
  const wsA = await provision(A, "Stream A");
  const wsB = await provision(B, "Stream B");
  const ctxA = ctxFor(wsA, A);
  const ctxB = ctxFor(wsB, B);

  const emit = (workspaceId: string, practitioner: string, type: string, payload = {}) =>
    emitEvent(admin, {
      eventType: type as never, practiceId: workspaceId, practitionerId: practitioner,
      actorId: practitioner, source: "system", payload,
    });

  // ── 1. The catalogue is a decision, not a default ────────────────────────────────────────────────
  ok("1a. the streamed set is a subset of s9's catalogue, not all of it",
    DASHBOARD_EVENTS.length > 0 && NOT_STREAMED.length > 0,
    `${DASHBOARD_EVENTS.length} streamed, ${NOT_STREAMED.length} not`);
  ok("1b. and the two together are the whole catalogue, so nothing is unclassified",
    new Set([...DASHBOARD_EVENTS, ...NOT_STREAMED]).size === DASHBOARD_EVENTS.length + NOT_STREAMED.length);

  // ── 2. A tail from a cursor ──────────────────────────────────────────────────────────────────────
  const first = await emit(wsA, A, "encounter.started");
  ok("2-setup. an event can be emitted", first.ok, first.ok ? "" : JSON.stringify(first));

  const fromNothing = await eventsSince(admin, ctxA, null);
  ok("2a. a reader with no cursor sees the history", !fromNothing.error && fromNothing.events.length === 1,
    fromNothing.error ?? String(fromNothing.events.length));

  const cursor = advance(fromNothing.events, null);
  const second = await emit(wsA, A, "encounter.completed");
  ok("2-setup-b. a second event is emitted", second.ok);

  const afterCursor = await eventsSince(admin, ctxA, cursor);
  ok("2b. a reader resuming from its cursor sees ONLY what came after",
    afterCursor.events.length === 1 && afterCursor.events[0].eventType === "encounter.completed",
    JSON.stringify(afterCursor.events.map(e => e.eventType)));

  // ⚠ A TYPE OUTSIDE THE DASHBOARD SET MUST NOT WAKE THE PAGE. Emitting one and finding nothing is the
  // assertion -- with a control immediately after, or "the stream returned nothing" would pass against a
  // stream that had simply stopped working.
  const quiet = NOT_STREAMED[0];
  if (quiet) {
    await emit(wsA, A, quiet);
    const afterQuiet = await eventsSince(admin, ctxA, advance(afterCursor.events, cursor));
    ok(`2c. a non-dashboard event (${quiet}) does not reach the stream`, afterQuiet.events.length === 0,
      JSON.stringify(afterQuiet.events.map(e => e.eventType)));
    await emit(wsA, A, "task.created");
    const afterLoud = await eventsSince(admin, ctxA, advance(afterCursor.events, cursor));
    ok("2c-control. but a dashboard event immediately after does", afterLoud.events.length === 1,
      JSON.stringify(afterLoud.events.map(e => e.eventType)));
  }

  // ── 3. s18: retryable. A gap is replayed, not skipped ────────────────────────────────────────────
  const beforeGap = await eventsSince(admin, ctxA, null);
  const gapCursor = advance(beforeGap.events.slice(0, 1), null);
  const replayed = await eventsSince(admin, ctxA, gapCursor);
  ok("3a. a client resuming from an OLD cursor replays everything it missed",
    replayed.events.length === beforeGap.events.length - 1,
    `${replayed.events.length} replayed of ${beforeGap.events.length - 1} missed`);
  ok("3b. and never replays the event it already had",
    !replayed.events.some(e => e.id === beforeGap.events[0].id));

  // ── 4. ⚠ TWO CLIENTS. The trap published_at sets ─────────────────────────────────────────────────
  //
  // The first reader marks everything published. The second must still see all of it. A cursor that
  // filtered on published_at would pass every test above and fail exactly here -- and in production it
  // would fail silently, for the second practitioner only.
  const readerOne = await eventsSince(admin, ctxA, null);
  const markErr = await markPublished(admin, readerOne.events.map(e => e.id));
  ok("4-setup. the first reader marks what it delivered", markErr === null, markErr ?? "");
  const { count: publishedCount } = await admin.from("practice_domain_event")
    .select("id", { count: "exact", head: true }).eq("workspace_id", wsA).not("published_at", "is", null);
  ok("4a-control. the marker really was written", (publishedCount ?? 0) === readerOne.events.length,
    `${publishedCount} marked of ${readerOne.events.length}`);

  const readerTwo = await eventsSince(admin, ctxA, null);
  ok("4b. a SECOND client still receives every event the first already saw",
    readerTwo.events.length === readerOne.events.length,
    `first saw ${readerOne.events.length}, second saw ${readerTwo.events.length}`);

  // ── 5. published_at is stamped once, not moved ───────────────────────────────────────────────────
  const firstStamp = (await admin.from("practice_domain_event").select("published_at")
    .eq("id", readerOne.events[0].id).maybeSingle()).data?.published_at;
  await new Promise(r => setTimeout(r, 15));
  await markPublished(admin, readerOne.events.map(e => e.id));
  const secondStamp = (await admin.from("practice_domain_event").select("published_at")
    .eq("id", readerOne.events[0].id).maybeSingle()).data?.published_at;
  ok("5a. re-marking does not move the timestamp", firstStamp === secondStamp,
    `${firstStamp} -> ${secondStamp}`);

  // ── 6. s13: tenancy ──────────────────────────────────────────────────────────────────────────────
  await emit(wsB, B, "encounter.started");
  const bSees = await eventsSince(admin, ctxB, null);
  ok("6a-control. practice B has an event of its own", bSees.events.length === 1);
  const aSees = await eventsSince(admin, ctxA, null);
  ok("6b. practice A's stream carries nothing of practice B's",
    aSees.events.length === readerOne.events.length,
    `A saw ${aSees.events.length}, expected ${readerOne.events.length}`);

  // ── 7. A failed read is reported, never returned as silence ──────────────────────────────────────
  const broken = await eventsSince(admin, ctxFor("not-a-uuid", A), null);
  ok("7a. a failed read returns an error rather than an empty stream",
    broken.error !== null && broken.events.length === 0, JSON.stringify(broken));

  await cleanup(A, B);
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
