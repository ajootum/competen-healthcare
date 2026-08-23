/**
 * CPR-CC-MOB-001 s4/s6 -- THE ATTENTION SUMMARY CONTRACT, AND THE STATE IT WAS BUILT TO EXPRESS.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM practice-operations-harness.ts. That harness runs against a real
 * practice, which is right for "the counts equal real rows" and useless for this: the one state s6 cares
 * most about is a category whose read FAILED, and a healthy database will not produce one to order.
 *
 * THE DEFECT THE CONTRACT CLOSES. Every read in operations-home destructured its rows and dropped the
 * error. A failed query returned no rows, no rows ran no builder, and no builder emitted no item -- so a
 * database hiccup and a clear day rendered identically. s6 states the rule plainly: "unavailable/error --
 * do not show zero". A `status` field alone would not have fixed that; it would have been a column that
 * only ever said "ready". These tests exist to prove the non-ready path actually fires, because an
 * enum whose second value never occurs is decoration.
 *
 * ⚠ THE STUB ERRORS ONE TABLE AND ANSWERS THE REST NORMALLY. Failing everything would prove far less:
 * an "everything is broken" list is easy to get right by accident, and the case that matters on a
 * practitioner's phone is nine categories working and one dark.
 */
import { operationsHome, type AttentionItem } from "../src/lib/practice/operations-home";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/**
 * A PostgREST builder that answers every chain, erroring only for the named table.
 *
 * ⚠ EACH from() RETURNS ITS OWN CHAIN, AND THE FIRST VERSION OF THIS STUB DID NOT. It kept one `table`
 * variable on a single shared object, which is fine for sequential awaits and silently wrong for the
 * Promise.all this module actually uses: every query is CONSTRUCTED first -- each from() overwriting
 * the last -- and only then awaited, so all twelve resolved as whichever table was named last.
 *
 * The symptom was a stub that answered every read with rows nobody asked for and no error anywhere,
 * so a healthy fixture produced zero attention items and a deliberately broken table produced zero
 * failures. Both readings looked like the production code being wrong. Shared mutable state in a test
 * double does not usually announce itself; it just makes the test agree with whatever you feared.
 */
function stub(brokenTable: string | null, rows: Record<string, any[]> = {}) {
  const chain = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, neq: () => q,
      gte: () => q, lte: () => q, lt: () => q, gt: () => q,
      in: () => q, is: () => q, not: () => q,
      order: () => q, limit: () => q, range: () => q,
      maybeSingle: () => q, single: () => q,
      then(resolve: (v: any) => void) {
        if (table === brokenTable) return resolve({ data: null, error: { message: "read failed", code: "57014" } });
        return resolve({ data: rows[table] ?? [], error: null });
      },
    };
    return q;
  };
  return { from: (t: string) => chain(t) } as any;
}

const ctx: any = {
  userId: "u1", workspaceId: "w1", workspaceName: "Test", workspaceType: "individual_practice",
  workspaceStatus: "ACTIVE", workspaceTimezone: "Africa/Kampala",
  // Everything visible, so nothing lands in blindSpots and the only reason a category can go missing
  // is the failed read this harness is about.
  capabilities: [
    "followup.view", "encounter.list", "document.view", "practice.calendar.view", "task.view",
    "notification.view", "message.view", "practice.settings.manage",
  ],
};

async function main() {
  console.log("\nATTENTION CONTRACT HARNESS (CPR-CC-MOB-001 s4/s6)\n");

  // ── 1. THE HEALTHY CASE ──────────────────────────────────────────────────────────────────────
  // Real rows, so the healthy case has work in it. The control at the bottom exists because the
  // first version of this file supplied none: five assertions passed over an empty list, proving
  // nothing, and only the control noticed.
  const ROWS: Record<string, any[]> = {
    practice_queue_entry: [
      { id: "q1", patient_name: "A", status: "WAITING", entered_at: new Date(Date.now() - 40 * 60000).toISOString() },
      { id: "q2", patient_name: "B", status: "READY", entered_at: new Date(Date.now() - 12 * 60000).toISOString() },
    ],
  };

  const healthy = await operationsHome(stub(null, ROWS), ctx);
  const items: AttentionItem[] = healthy.attention;

  ok("1. a healthy read produces no unavailable items",
    items.every(i => i.status === "ready"),
    JSON.stringify(items.map(i => ({ k: i.kind, s: i.status }))));

  ok("1b. and no ready item is sizeless",
    items.every(i => i.status !== "ready" || typeof i.count === "number"));

  // s4: every item carries the instant and the zone it was read in.
  ok("1c. every item carries asOf and the practice timezone",
    items.every(i => typeof i.asOf === "string" && !Number.isNaN(Date.parse(i.asOf))
      && i.timezone === "Africa/Kampala"),
    JSON.stringify(items.slice(0, 2).map(i => ({ asOf: i.asOf, tz: i.timezone }))));

  // ── 2. THE CASE THE CONTRACT EXISTS FOR ──────────────────────────────────────────────────────
  //
  // practice_encounter feeds TWO categories, unsigned and in-progress, so one broken table must
  // darken both -- a mapping that returned only the first would leave a card confidently reading zero.
  //
  // ⚠ NOT follow-ups, and the reason is worth recording: follow-ups reach this module through
  // followUpBoard(), a helper that returns its rows rather than a PostgREST result, so the READS
  // check for `.error` cannot see a failure there at all. That is a pre-existing gap in the
  // container's own honesty, not one this contract introduced, and it is named in the report rather
  // than quietly worked around here.
  const broken = await operationsHome(stub("practice_encounter", ROWS), ctx);
  const bad: AttentionItem[] = broken.attention;
  const unavailable = bad.filter(i => i.status === "unavailable");

  ok("2. a failed read produces unavailable items rather than silence",
    unavailable.length > 0,
    `attention=${JSON.stringify(bad.map(i => ({ k: i.kind, s: i.status })))} unreadable=${JSON.stringify(broken.unreadable)}`);

  ok("2b. both categories the failed table feeds are darkened, not just the first",
    unavailable.some(i => i.kind === "encounter_unsigned")
    && unavailable.some(i => i.kind === "encounter_live"),
    JSON.stringify(unavailable.map(i => i.kind)));

  // ⚠ THE WHOLE POINT, IN ONE LINE. s6: "unavailable/error -- do not show zero."
  ok("2c. an unavailable item carries NO count -- never nought",
    unavailable.every(i => i.count === null),
    JSON.stringify(unavailable.map(i => ({ k: i.kind, c: i.count }))));

  ok("2d. and it names the category, so the practitioner knows which part is dark",
    unavailable.every(i => /could not be read/i.test(i.title) && i.title.length > "could not be read".length),
    JSON.stringify(unavailable.map(i => i.title)));

  // The container's own honesty, unchanged by the new field and asserted so it stays that way.
  ok("2e. the failed read is still named on `unreadable`",
    broken.unreadable.includes("encounters"), JSON.stringify(broken.unreadable));

  ok("2f. allClear is false when something could not be read",
    broken.allClear === false);

  // ── 3. THE INVARIANT THAT TIES THEM TOGETHER ─────────────────────────────────────────────────
  //
  // Both directions. Sizeless implies unavailable, AND unavailable implies sizeless -- either alone
  // would permit the exact bug this closes.
  ok("3. sizeless and not-ready are the same set, in both directions",
    [...items, ...bad].every(i => (i.count === null) === (i.status !== "ready")),
    JSON.stringify([...items, ...bad].map(i => ({ k: i.kind, s: i.status, c: i.count }))));

  // ── CONTROL ──────────────────────────────────────────────────────────────────────────────────
  //
  // If the stub answered nothing at all, section 1 would pass by producing no items and section 2
  // would pass by producing no ready ones. This proves the fixture has real work in it.
  ok("control. the healthy fixture actually produced attention items",
    items.length > 0, `${items.length} items`);

  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
