/**
 * PHASE TWO, THE TRANSACTION OUTBOX — COMP-SYNC-001 s5/s9 and CP-OFFLINE-SURVEY-001 s5.
 *
 * WHAT IT PROVES:
 *   - ⚠ THE EXEMPTION: nothing not yet delivered can be removed, by any route, for any reason. The
 *     outbox lives in its own IndexedDB database so the cache purges cannot structurally reach it.
 *   - precondition 2: `failed` is a state of its own and NEVER renders as `sending`.
 *   - precondition 4: bounded failure -- escalation on attempts OR on age, and a refusal escalates at
 *     once rather than accruing retries quietly.
 *   - precondition 6: the undeliverable is exportable, and export takes everything not delivered.
 *   - s9 ordered processing: send order is by sequence, and a blocked entity blocks only itself.
 *   - the sentences a practitioner reads never say "saved" without "on this device".
 *
 * ⚠ WHAT THIS CANNOT PROVE. `outbox-store.ts` needs `indexedDB`; node has none. So durability across
 * crash and restart -- precondition 1's "proven by test" -- is NOT proven here, and the store's rules are
 * asserted against source text. That gap is real, it is the same one the guidance harness carries, and
 * it is why precondition 1 cannot be signed off on this evidence alone.
 *
 *   npx --yes tsx scripts/practice-outbox-harness.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import {
  OUTBOX_ESCALATE_AFTER_MS, OUTBOX_MAX_ATTEMPTS, OUTBOX_NEEDS_A_HUMAN, OUTBOX_SAFE_TO_REMOVE,
  OUTBOX_UNRESOLVED, outboxBackoffMs, outboxBlocked, outboxDueAt, outboxEnqueue, outboxMarkDelivered,
  outboxMarkFailed, outboxMarkRefused, outboxMarkSending, outboxMarkUndeliverable, outboxNeedingAttention,
  outboxRecordLabel, outboxRemovable, outboxRetryByHand, outboxSendOrder, outboxSendable, outboxSummary,
  outboxWouldLoseWork, type OutboxRecord, type OutboxState,
} from "../src/lib/practice/outbox-model";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const T0 = new Date("2026-08-10T08:00:00.000Z");
let seq = 0;
const make = (over: Partial<Parameters<typeof outboxEnqueue>[0]> = {}): OutboxRecord => outboxEnqueue({
  id: over.id ?? `t${++seq}`, workspaceId: "w1", deviceId: "d1", userId: "u1",
  entityType: over.entityType ?? "encounter", entityId: over.entityId ?? "e1",
  operation: over.operation ?? "create", payload: over.payload ?? { note: "clinical text" },
  baseVersion: over.baseVersion ?? null, sequence: over.sequence ?? seq, at: over.at ?? T0,
});

const ALL_STATES: OutboxState[] = ["pending", "sending", "delivered", "failed", "refused", "undeliverable"];

function main() {
  console.log("\n=== PHASE TWO: THE TRANSACTION OUTBOX ===\n");

  // ── 1. ⚠ THE EXEMPTION FROM EXPIRY ───────────────────────────────────────────────────────────────
  const everyState = ALL_STATES.map((s, i) => ({ ...make({ id: `s${i}`, sequence: i + 1 }), state: s }));
  ok("1a. ⚠ only DELIVERED records may be removed",
    outboxRemovable(everyState).every(r => r.state === "delivered")
    && outboxRemovable(everyState).length === 1,
    outboxRemovable(everyState).map(r => r.state).join(", "));
  ok("1b-control. there ARE five non-delivered states, so 1a is not vacuous",
    everyState.filter(r => r.state !== "delivered").length === 5);
  ok("1c. ⚠ removing anything undelivered is reported as LOSING WORK",
    outboxWouldLoseWork(everyState, everyState.map(r => r.id)).length === 5);
  ok("1d-control. removing only the delivered one loses nothing",
    outboxWouldLoseWork(everyState, ["s2"]).length === 0);
  ok("1e. the removable list is the constant, not a second opinion",
    OUTBOX_SAFE_TO_REMOVE.length === 1 && OUTBOX_SAFE_TO_REMOVE[0] === "delivered");

  // ⚠ The structural half of the exemption, at source level. See the header for why it is not behavioural.
  const store = readFileSync("src/lib/practice/outbox-store.ts", "utf8");
  const caches = readFileSync("src/lib/practice/offline-store.ts", "utf8");
  const outboxDb = /const DB_NAME = "([^"]+)"/.exec(store)?.[1] ?? "";
  const cacheDb = /const DB_NAME = "([^"]+)"/.exec(caches)?.[1] ?? "";
  ok("1f. ⚠ the outbox is a SEPARATE IndexedDB database from the caches",
    !!outboxDb && !!cacheDb && outboxDb !== cacheDb, `${outboxDb} vs ${cacheDb}`);
  // ⚠ COMMENTS STRIPPED. The property is that no CODE in the cache file names the outbox database --
  // the comment at purgeAllOffline names it deliberately, to warn the next reader, and that documentation
  // is the opposite of the hazard. Third time today a needle has matched its own explanation.
  const cacheCode = caches.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok("1g. ⚠ no CODE in the cache file names the outbox database, so deleteDatabase cannot reach it",
    !cacheCode.includes(outboxDb), "purgeAllOffline would destroy captured clinical work");
  ok("1g2-control. stripping comments did not empty the cache file",
    cacheCode.includes("deleteDatabase(") && cacheCode.includes(cacheDb));
  ok("1h. the only deletion in the outbox takes no clock argument",
    /export async function outboxRemoveDelivered\(\): Promise/.test(store));
  ok("1i-control. the cache file DOES call deleteDatabase -- so 1g is a real hazard, not a hypothetical",
    caches.includes("deleteDatabase("));

  // ── 2. PRECONDITION 2: `failed` IS ITS OWN STATE ─────────────────────────────────────────────────
  const failed = outboxMarkFailed(outboxMarkSending(make(), T0), "no connection", T0);
  ok("2a. a failure lands in `failed`, not back in `sending`", failed.state === "failed");
  ok("2b. ⚠ and reads as not sent, never as in progress",
    !/sending|in progress/i.test(outboxRecordLabel(failed).label), outboxRecordLabel(failed).label);
  ok("2c. every state has a label and no label is empty",
    ALL_STATES.every(s => outboxRecordLabel({ ...make(), state: s }).label.trim().length > 0));
  ok("2d. ⚠ nothing says 'Saved' without saying where",
    ALL_STATES.map(s => outboxRecordLabel({ ...make(), state: s }).label)
      .every(l => !/saved/i.test(l) || /on this device/i.test(l)));
  ok("2e. the unresolved set is the three a person still has work in",
    OUTBOX_UNRESOLVED.join(",") === "pending,sending,failed");

  // ── 3. PRECONDITION 4: BOUNDED FAILURE THAT ESCALATES ────────────────────────────────────────────
  let attempted = make();
  for (let i = 0; i < OUTBOX_MAX_ATTEMPTS - 1; i++) attempted = outboxMarkFailed(attempted, "timeout", T0);
  ok("3a-control. just under the attempt limit it has NOT escalated",
    attempted.escalatedAt === null, `attempts=${attempted.attempts}`);
  attempted = outboxMarkFailed(attempted, "timeout", T0);
  ok("3b. ⚠ at the attempt limit it escalates -- the queue shouts",
    attempted.escalatedAt !== null && attempted.attempts === OUTBOX_MAX_ATTEMPTS);
  ok("3c. ⚠ and it stays `failed`, so a returning connection still sends it",
    attempted.state === "failed");

  // The age rule catches what attempts cannot: a device simply never online.
  const oneAttempt = outboxMarkFailed(make(), "offline", T0);
  const muchLater = new Date(T0.getTime() + OUTBOX_ESCALATE_AFTER_MS + 1000);
  ok("3d-control. one attempt, shortly after: not escalated", oneAttempt.escalatedAt === null);
  ok("3e. ⚠ one attempt, a day later: ESCALATED on age alone",
    outboxMarkFailed(oneAttempt, "offline", muchLater).escalatedAt !== null);

  const refused = outboxMarkRefused(make(), "that patient has been merged", T0);
  ok("3f. ⚠ a refusal escalates AT ONCE rather than accruing retries quietly",
    refused.state === "refused" && refused.escalatedAt !== null);
  ok("3g. and says retrying will not help",
    /will not change this/i.test(outboxRecordLabel(refused).detail ?? ""));
  ok("3h. a refusal is never sendable again on its own",
    outboxSendable([refused]).length === 0);
  ok("3i-control. but a person can put it back by hand",
    outboxRetryByHand(refused).state === "pending" && outboxRetryByHand(refused).attempts === 0);
  ok("3j. ⚠ a hand retry does not erase why it failed",
    outboxRetryByHand(refused).lastError === refused.lastError);
  ok("3k. a delivered record cannot be dragged back into the queue",
    outboxRetryByHand(outboxMarkDelivered(make())).state === "delivered");

  // ── 4. BACKOFF ───────────────────────────────────────────────────────────────────────────────────
  ok("4a. backoff grows with attempts", outboxBackoffMs(1) < outboxBackoffMs(3));
  ok("4b. and is capped, so a long queue keeps moving",
    outboxBackoffMs(50) === outboxBackoffMs(40) && outboxBackoffMs(50) > 0);
  ok("4c. a record never attempted is due immediately", outboxDueAt(make()) === 0);
  ok("4d. a just-failed record is not due immediately",
    outboxDueAt(outboxMarkFailed(make(), "x", T0)) > T0.getTime());

  // ── 5. ORDER (COMP-SYNC-001 s9) ──────────────────────────────────────────────────────────────────
  const shuffled = [make({ sequence: 3 }), make({ sequence: 1 }), make({ sequence: 2 })];
  ok("5a. the send order is by sequence, whatever order they were stored in",
    outboxSendOrder(shuffled).map(r => r.sequence).join(",") === "1,2,3");

  // A refused create on patient P blocks P's later update -- and nothing else.
  const pCreate = { ...make({ entityType: "patient", entityId: "p1", sequence: 1 }), state: "refused" as const };
  const pUpdate = make({ entityType: "patient", entityId: "p1", operation: "update", sequence: 2 });
  const otherEnc = make({ entityType: "encounter", entityId: "e9", sequence: 3 });
  const queue = [pCreate, pUpdate, otherEnc];
  ok("5b. ⚠ a later change to a BLOCKED entity is held back",
    outboxSendable(queue).every(r => r.entityId !== "p1"));
  ok("5c. ⚠ and an unrelated entity still sends -- one bad row does not stop the day",
    outboxSendable(queue).some(r => r.entityId === "e9"));
  ok("5d. what was held back is listed, never silently dropped",
    outboxBlocked(queue).length === 1 && outboxBlocked(queue)[0].id === pUpdate.id);
  ok("5e-control. with the create delivered instead, the update flows",
    outboxSendable([{ ...pCreate, state: "delivered" }, pUpdate, otherEnc]).some(r => r.entityId === "p1"));

  // ── 6. PRECONDITION 6: THE UNDELIVERABLE ─────────────────────────────────────────────────────────
  const dead = outboxMarkUndeliverable(make(), "the encounter was signed before this arrived", T0);
  ok("6a. it is kept, not discarded", dead.state === "undeliverable");
  ok("6b. it can never be removed by the removal path", outboxRemovable([dead]).length === 0);
  ok("6c. it tells a person it can be exported",
    /export/i.test(outboxRecordLabel(dead).detail ?? ""));
  ok("6d. the payload survives -- an export with no content would be useless",
    JSON.stringify(dead.payload).includes("clinical text"));
  ok("6e. both terminal states are on the needs-a-human list",
    OUTBOX_NEEDS_A_HUMAN.includes("refused") && OUTBOX_NEEDS_A_HUMAN.includes("undeliverable"));
  const exportSrc = readFileSync("src/lib/practice/outbox-store.ts", "utf8");
  ok("6f. ⚠ the export takes everything NOT DELIVERED, not only the terminal states",
    /state !== "delivered"/.test(exportSrc));

  // ── 7. WHAT A PERSON IS TOLD ─────────────────────────────────────────────────────────────────────
  const quiet = outboxSummary([outboxMarkDelivered(make())], T0);
  ok("7a. with nothing outstanding it says so plainly",
    quiet.unresolved === 0 && /reached the practice/i.test(quiet.sentence));
  const waiting = outboxSummary([make(), make()], T0);
  ok("7b. waiting work is counted and located -- on this device",
    waiting.unresolved === 2 && /on this device/i.test(waiting.sentence));
  const loud = outboxSummary([refused, make()], T0);
  ok("7c. ⚠ when something needs a person, THAT is the sentence, not the pending count",
    /needs your attention/i.test(loud.sentence), loud.sentence);
  ok("7d. ⚠ and it promises nothing was deleted",
    /nothing has been deleted/i.test(loud.sentence));
  ok("7e. attention is counted separately from failed",
    loud.needsAttention === 1 && loud.failed === 0);
  ok("7f. ⚠ never-delivered reports null, not a fabricated timestamp",
    outboxSummary([make()], T0).lastDeliveredAt === null);
  ok("7g. an escalated record counts as needing attention even while still `failed`",
    outboxNeedingAttention([attempted], T0).length === 1);
  ok("7h-control. an ordinary failure does not",
    outboxNeedingAttention([outboxMarkFailed(make(), "x", T0)], T0).length === 0);

  // ── 8. ⚠ THE QUEUE IS WIRED, AND THIS IS THE ASSERTION THAT CHANGED WHEN IT WAS ─────────────────
  //
  // This said "nothing calls outboxAccept yet" and was written to GO RED the day capture shipped -- "the
  // moment somebody must re-read the seven". It went red on 2026-08-11 and the seven were re-read: all
  // hold, precondition 1 last, proven in a real browser by practice-outbox-durability-harness.ts.
  //
  // ⚠ THE REPLACEMENT IS NOT A RELAXATION. Deleting it would leave `outboxAccept` -- the one function in
  // this product that accepts a clinical record it cannot deliver -- callable from anywhere, and a second
  // caller added in six months would pass silently. The rule now is that there is exactly ONE sanctioned
  // producer, `offline-capture.ts`, which is where the seven preconditions are written down and where the
  // bedside refusals live. Anything else calling it is a write path that has not been reasoned about.
  const callers = ["src/app", "src/lib"].flatMap(dir => {
    const out: string[] = [];
    const walk = (p: string) => {
      for (const e of readdirSync(p, { withFileTypes: true })) {
        const full = `${p}/${e.name}`;
        if (e.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e.name) && !full.includes("outbox-store") && !full.includes("outbox-model")
          && readFileSync(full, "utf8").includes("outboxAccept(")) out.push(full);
      }
    };
    walk(dir);
    return out;
  });
  // ⚠ TWO sanctioned callers since 2026-08-28: the one PRODUCT write path, and the executable test
  // suite CPR-PILOT-READINESS-001 s4 demanded ("text assertions alone are insufficient for pilot
  // authorization"). A test calling outboxAccept is not an unreasoned write path -- it is the reasoned
  // proof the write path works. Each is named; anything else is still a finding.
  const SANCTIONED = [
    "src/lib/practice/offline-capture.ts",
    "src/lib/practice/outbox-sync.test.ts",
  ];
  const unsanctioned = callers.filter(c => !SANCTIONED.some(s => c.replace(/\\/g, "/").endsWith(s)));
  ok("8a. ⚠ outboxAccept has exactly the SANCTIONED callers -- no unreasoned write path",
    unsanctioned.length === 0, `also called from: ${unsanctioned.join(", ")}`);
  ok("8a-control. and that caller EXISTS, so 8a is not passing over a list of none",
    callers.some(c => c.replace(/\\/g, "/").endsWith(SANCTIONED[0])),
    "capture is unwired -- if that is intended, this assertion is the record of it");

  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main();
