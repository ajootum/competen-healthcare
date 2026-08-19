/**
 * Practice Intelligence suite harness -- CPR-PI-001 / CPR-PI-002 / CPR-PI-003. NO MIGRATION.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY ASSERTION BELOW WAS PROVEN ABLE TO FAIL, and every refusal is paired with a control that shows
 * the same code path producing the opposite answer. The vacuous assertion is the specific failure this
 * file is written against: four assertions in this codebase have sat green through a deliberate break
 * because the fixture made the wrong answer and the right answer identical.
 *
 * The three traps avoided here, by name:
 *
 *   THE DETECTOR THAT NEVER FIRES. Asserting "no rate in the payload" proves nothing unless the
 *   detector is shown to fire on a payload that HAS one -- and shown NOT to fire on the engine's own
 *   sentences about percentages, which is what tells a filter apart from a word-blocklist.
 *
 *   THE COMPARISON THAT WOULD BE NULL ANYWAY. "A trend is refused when the prior window is short" passes
 *   trivially on a practice with no data. The control backdates the practice AND puts enough records in
 *   both windows, so the same call returns a real signed count.
 *
 *   THE UNION THAT IS ALSO A SUM. "Patients needing attention counts people, not group memberships" is
 *   vacuous when the three groups hold three different patients. The fixture puts THE SAME patient in
 *   all three, so a sum would say 3 and the union says 1.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   npx --yes tsx scripts/practice-intelligence-suite-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter, recordDiagnosis } from "../src/lib/practice/encounters";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import {
  intelligenceSuite, patientAttentionIntelligence, cohortIntelligence, priorityStrip,
  intelRange, suiteGroundingFigures, PRIORITY_KEYS,
  type IntelModule, type PatientAttentionData, type PathwayIntelligenceData,
} from "../src/lib/practice/intelligence";
import {
  findRates, INTELLIGENCE_TABS, INTELLIGENCE_TAB_STRIP, REFUSED_PATIENT_STATES, PRIORITY_SWATCH,
  INACTIVE_AFTER_DAYS, LOST_TO_FOLLOW_UP_AFTER_DAYS, isIntelligenceTab,
} from "../src/lib/practice/intelligence-constants";
import { assistantGrounding, CONTEXT_KINDS } from "../src/lib/practice/ai-assistant";
import { ASK_EXAMPLES, parseAskIntent } from "../src/lib/practice/ask-practice";
import { PRACTICE_NAV } from "../src/lib/practice/navigation";
import { practiceToday, dueDateFrom } from "../src/lib/practice/practice-time";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e29e1";
const OTHER = "00000000-0000-4000-8000-0000000e29e2";
const TZ = "Africa/Kampala";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/* eslint-disable @typescript-eslint/no-explicit-any */

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: TZ, professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-pi-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-pi",
  }).select("id").single();
  const run = await runProvisioning(admin,
    { id: req!.id, target_user_id: user, correlation_id: "harness-pi", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-pi" };

async function withoutCapability(workspaceId: string, userId: string, capabilities: string[]): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  const ids = ((mine ?? []) as any[]).map(m => m.id);
  for (const c of capabilities) {
    await admin.from("practice_role_assignment").update({ effective_to: new Date().toISOString() })
      .in("membership_id", ids).eq("capability_code", c).is("effective_to", null);
  }
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

/** An admin whose every read fails. The only way to prove "a failed read is never a zero". */
const brokenAdmin = () => {
  const q: any = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "then") return undefined;
      if (prop === "limit") return async () => ({ data: null, error: { message: "boom: table is gone" } });
      return () => q;
    },
  });
  return { from: () => q } as any;
};

/** Walk a payload and collect every object carrying a `formula`, with its path. */
function figuresWithFormula(value: unknown, path = "$", out: { path: string; o: any }[] = []) {
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) { value.forEach((x, i) => figuresWithFormula(x, `${path}[${i}]`, out)); return out; }
  const o = value as Record<string, unknown>;
  if (typeof o.formula === "string") out.push({ path, o });
  for (const [k, v] of Object.entries(o)) figuresWithFormula(v, `${path}.${k}`, out);
  return out;
}

async function main() {
  console.log("\nPractice Intelligence suite harness (CPR-PI-001/002/003, no migration)\n");
  await cleanup();

  // ══ A. THE RATE DETECTOR ITSELF, BEFORE ANY DATA EXISTS ═══════════════════════════════════════════
  //
  // ⚠ THE CONTROL COMES FIRST ON PURPOSE. An assertion that a 400-key payload contains no rate is worth
  // nothing until the thing doing the looking is shown to look.
  console.log("── The rate detector, proven to fire and proven to discriminate ──");
  const poisoned = findRates({
    tile: { complianceRate: null, label: "Follow-up compliance" },
    note: "up 12% vs last week",
    donut: [{ label: "Completed", value: "6 (33%)" }],
  });
  ok("CONTROL: the detector FIRES on a rate-shaped field name",
    poisoned.some(v => v.path === "$.tile.complianceRate" && /field name/.test(v.why)),
    JSON.stringify(poisoned.map(v => v.path)));
  ok("CONTROL: and on a percentage literal in a value",
    poisoned.some(v => v.path === "$.note" && /literal/.test(v.why)) &&
    poisoned.some(v => v.path === "$.donut[0].value"),
    JSON.stringify(poisoned.map(v => v.path)));
  ok("CONTROL: and it fires on a rate-shaped key even when the value is null (a commitment to render one)",
    poisoned.some(v => v.path === "$.tile.complianceRate"));
  // ⚠ THE DISCRIMINATING CONTROL. The engine's own refusals say "never as a percentage". A detector
  // that fired on the WORD would force the engine to stop explaining itself, and would then be
  // satisfied by an engine that said nothing while returning 82%.
  ok("CONTROL: it does NOT fire on the engine's own sentences about percentages -- it is a detector, not a word filter",
    findRates({ formula: "compared as a signed count, never as a percentage or a proportion of anything" }).length === 0,
    JSON.stringify(findRates({ formula: "never as a percentage" })));
  // ⚠ THE ONE EXEMPTION, PROVEN NOT TO BE A HOLE. `ratesComputed: false` is the doctrine's own negation
  // flag and is allowed through; the SAME KEY holding a figure is not.
  ok("the single exemption is value-checked: `ratesComputed: false` passes",
    findRates({ ratesComputed: false }).length === 0);
  ok("CONTROL: and the same key holding a figure does NOT pass, so the exemption cannot smuggle one through",
    findRates({ ratesComputed: 0.82 }).length === 1,
    JSON.stringify(findRates({ ratesComputed: 0.82 })));

  // ══ B. TABS ARE TABS ══════════════════════════════════════════════════════════════════════════════
  console.log("\n── v2 s3: the strip is v2's destinations, and NOT sidebar entries ──");
  // ⚠ THIS ASSERTED v1's NINE AND WENT STALE THE DAY v2 SHIPPED. It pinned INTELLIGENCE_TABS to
  // "overview,brief,patients,cohorts,clinical,pathways,performance,reports,assistant" -- and the v2
  // rebuild made that array a SUPERSET of twelve keys (followups, patterns and financial were added)
  // while moving the navigation to INTELLIGENCE_TAB_STRIP. It has been red-if-run ever since, unseen,
  // because every PI harness is privileged-live and none of them runs in CI.
  //
  // ⚠ AND THE WARNING WAS ALREADY WRITTEN ON THE NEXT LINE. "NAMING THE KEYS, NOT COUNTING THEM" sat
  // under an assertion that pinned both a count AND a whole-order string of the wrong constant. The
  // lesson survived as a comment while the assertion under it did the opposite.
  //
  // So: the STRIP is what v2 s3 governs, and it is asserted by name and order. INTELLIGENCE_TABS is a
  // superset by design -- v2 s3 removes brief/cohorts/pathways from the strip while keeping their keys
  // valid so old bookmarks still land -- so it is asserted for what it must CONTAIN, never for length.
  ok("v2 s3: the strip is v2's destinations, in v2's order, Overview first",
    INTELLIGENCE_TAB_STRIP.join(",") ===
      "overview,patients,clinical,followups,patterns,financial,performance,reports,assistant",
    INTELLIGENCE_TAB_STRIP.join(","));
  ok("v2 s3: brief, cohorts and pathways LEFT THE STRIP but their keys stay valid, so old links still land",
    !["brief", "cohorts", "pathways"].some(k => INTELLIGENCE_TAB_STRIP.includes(k as never)) &&
    ["brief", "cohorts", "pathways"].every(k => isIntelligenceTab(k)),
    INTELLIGENCE_TABS.map(t => t.key).join(","));
  ok("CONTROL: every strip key is a real tab, so the strip cannot name a destination that does not exist",
    INTELLIGENCE_TAB_STRIP.every(k => INTELLIGENCE_TABS.some(t => t.key === k)));
  const navHrefs = PRACTICE_NAV.map(n => n.href);
  ok("NO TAB HAS BECOME A SIDEBAR ENTRY: nothing in the nav is a child route or a tab query of the workspace",
    !navHrefs.some(h => h.startsWith("/practice/intelligence/")) &&
    !navHrefs.some(h => h.includes("tab=")),
    navHrefs.filter(h => h.includes("intelligence")).join(","));
  ok("CONTROL: the workspace itself IS in the nav, so the test above is not passing because the route is absent",
    navHrefs.includes("/practice/intelligence"));
  // ⚠ THIS ASSERTED ONE IMPLEMENTATION OF THE RULE AND THE RULE OUTLIVED IT. It required the four
  // routes to carry `parent: "/practice/intelligence"`. CPR-HFE-001 v1.1 then froze an eleven-item
  // sidebar and took them out of PRACTICE_NAV altogether -- a stronger form of the same requirement,
  // recorded in navigation.ts's own words at the /practice/assistant line. The assertion went red for
  // a change that satisfied it more completely than the shape it was pinned to.
  //
  // So it now asserts v1 s15's ACTUAL criterion ("the separate Practice Assistant sidebar item is
  // removed") and the half that keeps the removal honest: removed from the sidebar is not deleted.
  const REHOMED = ["/practice/assistant", "/practice/cases", "/practice/reflection", "/practice/portfolio"];
  ok("v1 s15: none of assistant, case memory, reflection or portfolio is a TOP-LEVEL sidebar item",
    REHOMED.every(h => {
      const n = PRACTICE_NAV.find(x => x.href === h);
      return !n || (!n.primary && !!n.parent);
    }),
    REHOMED.map(h => {
      const n = PRACTICE_NAV.find(x => x.href === h);
      return `${h}=${!n ? "absent" : n.primary ? "PRIMARY" : `child of ${n.parent}`}`;
    }).join(", "));
  ok("CONTROL: and every one of those routes still EXISTS, so this is removal from the nav rather than deletion",
    REHOMED.every(h => fs.existsSync(path.join(process.cwd(), "src/app/practice/(shell)", h.replace("/practice/", ""), "page.tsx"))),
    REHOMED.filter(h => !fs.existsSync(path.join(process.cwd(), "src/app/practice/(shell)", h.replace("/practice/", ""), "page.tsx"))).join(","));
  ok("every tab's swatch key resolves -- a mismatch here compiles and renders a real figure in dead grey",
    INTELLIGENCE_TABS.every(t => typeof t.swatch === "string" && t.swatch.length > 0) &&
    isIntelligenceTab("overview") && !isIntelligenceTab("dashboard"));
  ok("the priority strip's five keys and the colour map's five keys are the SAME five",
    PRIORITY_KEYS.length === 5 && PRIORITY_KEYS.every(k => !!PRIORITY_SWATCH[k]) &&
    Object.keys(PRIORITY_SWATCH).length === 5,
    `${PRIORITY_KEYS.join(",")} vs ${Object.keys(PRIORITY_SWATCH).join(",")}`);

  // ══ B2. ASK PRACTICE'S PUBLISHED QUESTION SHAPES ══════════════════════════════════════════════════
  //
  // v2 s13 stage 1. The shapes are now rendered on the Ask tab's empty state, which turns them from
  // documentation into a PROMISE: every one is a link that fires the question. So the assertion is not
  // that the list is non-empty -- it is that each entry actually reaches the intent it claims, and that
  // no intent is missing from the list.
  //
  // ⚠ THE FIRST HALF IS THE ONE THAT MATTERS. A regex tightened in parseAskIntent would otherwise leave
  // a chip on screen that routes to "unknown" and answers its own advertised question with a refusal.
  const askRouted = ASK_EXAMPLES.map(e => ({ ...e, got: parseAskIntent(e.question) }));
  const misrouted = askRouted.filter(e => e.got !== e.intent);
  ok("v2 s13: every published question shape actually parses to the intent it claims",
    misrouted.length === 0,
    misrouted.map(e => `"${e.question}" -> ${e.got}, not ${e.intent}`).join("; "));
  const INTENTS = ["financial", "overdue_followups", "top_conditions", "investigations", "patients_seen", "consultations"];
  const uncovered = INTENTS.filter(i => !ASK_EXAMPLES.some(e => e.intent === i));
  ok("v2 s13: every intent the parser grounds has a published example, so the list is the contract and not a sample",
    uncovered.length === 0, uncovered.join(","));
  ok("CONTROL: a question outside every shape routes to unknown, so the parser is not matching everything",
    parseAskIntent("what is the weather like in the waiting room") === "unknown");

  // ══ CPR-PD-013 §13: the other corrections from this arc, pinned ═══════════════════════════════════
  //
  // Two behaviours whose regression would be SILENT: a dropped filter looks like a legitimately wider
  // page, and a missing access-log row is invisible until somebody runs an access review.
  const rangeSrc = fs.readFileSync("src/app/practice/(shell)/intelligence/RangePicker.tsx", "utf8");
  // ⚠ SCOPED TO go()'s BODY. A whole-file test for `new URLSearchParams(params.toString())` passed a
  // break-test that had genuinely reverted go() to an allow-list -- because the localStorage effect
  // FURTHER DOWN builds a URLSearchParams the same way for an unrelated reason, and the needle found
  // that one. Third instance of this shape today; the fix is the same one every time.
  const goBody = (() => {
    const start = rangeSrc.indexOf("const go = (extra");
    if (start < 0) return "";
    const end = rangeSrc.indexOf("\n  };", start);
    return rangeSrc.slice(start, end < 0 ? start : end);
  })();
  ok("v2 s5/s19. CONTROL: go()'s own body was located, so the pin below is not scanning the file",
    goBody.length > 150 && goBody.includes("router.push"), `${goBody.length} chars`);
  ok("v2 s5/s19. changing the period preserves the whole query string, not an allow-list of keys",
    /new URLSearchParams\(params\.toString\(\)\)/.test(goBody)
    && /\["days", "from", "to"\]/.test(goBody),
    "an allow-list has to be updated by whoever adds the tenth parameter, and they will not know it exists");
  ok("v2 s5/s19. CONTROL: the range keys ARE still replaced, so the control still owns its own period",
    /next\.delete\(k\)/.test(goBody));

  const askSrc = fs.readFileSync("src/lib/practice/ask-practice.ts", "utf8");
  ok("v2 s13/s18. disclosing named patients writes an access-log row",
    /logAccess\(admin, \{/.test(askSrc) && /evidence\.identified/.test(askSrc),
    "ask-practice rendered named, linked patients and called logAccess zero times");
  ok("v2 s13/s18. ...and only when identification actually happened, so an unidentified read logs nothing",
    /if \(evidence && evidence\.identified && evidence\.rows\.length > 0\)/.test(askSrc),
    "a false positive in an access log is worse than a gap");
  const cohortSrc = fs.readFileSync("src/lib/practice/cohort-engine.ts", "utf8");
  ok("v2 s18. the cohort engine logs its own named-row disclosure too",
    /logAccess\(admin, \{/.test(cohortSrc) && /identified && rows\.length > 0/.test(cohortSrc));

  // ══ C. THE FIXTURE ════════════════════════════════════════════════════════════════════════════════
  const wsA = await provision(OWNER, "HARNESS PI A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS PI B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  const today = practiceToday(TZ);

  const patient = async (name: string) => {
    const r = await registerPatient(admin, {
      workspaceId: wsA, displayName: name, sex: "female", birthDate: "1985-05-05",
      phone: `0772 ${Math.floor(100000 + Math.random() * 899999)}`, ...base,
    });
    if (!r.ok) throw new Error(`register ${name}: ${r.message}`);
    return r.data.id;
  };

  // P1 overdue only. P2 overdue AND lost AND inactive -- the union trap. P3 clean.
  // P4 inactive only. P5 the DISCRIMINATOR: long overdue, but seen since, so NOT lost.
  const p1 = await patient("Overdue Only");
  const p2 = await patient("Overdue Lost Inactive");
  const p3 = await patient("Nothing Owed");
  const p4 = await patient("Registered Never Seen");
  const p5 = await patient("Overdue But Came Back");

  // The follow-ups. dueOn is accepted in the past by the engine (a commitment can be recorded late),
  // so no direct write is needed and the fixture stays on the engine's own path.
  const fuFor = async (pid: string, daysAgo: number) => {
    const r = await createFollowUp(admin, {
      workspaceId: wsA, patientId: pid, reason: `Review ${daysAgo} days ago`,
      dueOn: dueDateFrom(today, -daysAgo), ...base,
    });
    if (!r.ok) throw new Error(`follow-up: ${r.message}`);
    return r.data.id;
  };
  await fuFor(p1, 10);
  await fuFor(p2, 200);
  await fuFor(p5, 200);

  // Encounters. Only one may be live at a time (migration 194's partial unique index), so each is
  // closed before the next launches. p5's is what makes it NOT lost.
  const encounterFor = async (pid: string) => {
    const e = await launchEncounter(admin, {
      workspaceId: wsA, patientId: pid, pathway: "new_walk_in", reasonForVisit: "Harness", ...base,
    });
    if (!e.ok) throw new Error(`encounter: ${e.message}`);
    await transitionEncounter(admin, { workspaceId: wsA, encounterId: e.data.id, to: "ACTIVE", ...base });
    return e.data.id;
  };
  const e3 = await encounterFor(p3);
  await recordDiagnosis(admin, { workspaceId: wsA, encounterId: e3, label: "Malaria", certainty: "confirmed", ...base });
  await recordDiagnosis(admin, { workspaceId: wsA, encounterId: e3, label: "Anaemia", certainty: "suspected", ...base });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: e3, to: "COMPLETED", ...base });

  const e5 = await encounterFor(p5);
  await recordDiagnosis(admin, { workspaceId: wsA, encounterId: e5, label: "Malaria", certainty: "confirmed", ...base });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: e5, to: "COMPLETED", ...base });

  // p2 and p4 are made stale by moving their registration back. ⚠ ASSERTED, NOT ASSUMED: a refused
  // fixture write becomes a failure attributed to the code under test.
  const staleDay = dueDateFrom(today, -(INACTIVE_AFTER_DAYS + 120));
  await admin.from("practice_patient").update({ created_at: `${staleDay}T08:00:00.000Z` }).in("id", [p2, p4]);
  const { data: stale } = await admin.from("practice_patient").select("id, created_at").in("id", [p2, p4]);
  ok("FIXTURE: two patients really were backdated past the inactivity threshold",
    ((stale ?? []) as any[]).length === 2 &&
    ((stale ?? []) as any[]).every(r => String(r.created_at).startsWith(staleDay)),
    JSON.stringify((stale ?? []).map((r: any) => r.created_at)));

  // ══ D. PATIENT ATTENTION: DATE RULES, AND THE THREE JUDGEMENTS REFUSED ════════════════════════════
  console.log("\n── s5: three date rules built, three clinical judgements refused ──");
  const range = await intelRange(admin, wsA, { days: 30 });
  const attention = await patientAttentionIntelligence(admin, a.ctx, range);
  const g = Object.fromEntries((attention.data?.groups ?? []).map(x => [x.key, x]));

  // ⚠ NAMED IDS, NOT COUNTS. A count assertion here would pass under a rule that flagged everybody.
  const ids = (k: string) => new Set((g[k]?.sample ?? []).map(s => s.id));
  ok("OVERDUE names the three patients with a lapsed obligation, and nobody else",
    g.overdue?.count === 3 && ids("overdue").has(p1) && ids("overdue").has(p2) && ids("overdue").has(p5) &&
    !ids("overdue").has(p3) && !ids("overdue").has(p4),
    JSON.stringify({ count: g.overdue?.count, sample: [...ids("overdue")] }));

  ok("INACTIVE names the two backdated records and not the four recently active ones",
    g.inactive?.count === 2 && ids("inactive").has(p2) && ids("inactive").has(p4) &&
    !ids("inactive").has(p1) && !ids("inactive").has(p3) && !ids("inactive").has(p5),
    JSON.stringify({ count: g.inactive?.count, sample: [...ids("inactive")] }));

  // ⚠ THE DISCRIMINATING ASSERTION. p2 and p5 have IDENTICAL follow-ups, both 200 days overdue. The
  // only difference is that p5 came back. A rule that ignored the encounter side would report both.
  ok("LOST TO FOLLOW-UP names the one who never came back, and NOT the one with the identical overdue follow-up who did",
    g.lost_to_follow_up?.count === 1 && ids("lost_to_follow_up").has(p2) && !ids("lost_to_follow_up").has(p5),
    JSON.stringify({ count: g.lost_to_follow_up?.count, sample: [...ids("lost_to_follow_up")] }));

  ok("and the threshold that made that judgement travels in the formula, so it can be argued with",
    g.lost_to_follow_up?.formula.includes(String(LOST_TO_FOLLOW_UP_AFTER_DAYS)) &&
    g.inactive?.formula.includes(String(INACTIVE_AFTER_DAYS)),
    g.lost_to_follow_up?.formula);

  ok("EVERY GROUP IS THE LENGTH OF A LIST THAT OPENS: a route, and a row-level link per sample",
    (attention.data?.groups ?? []).every(x =>
      x.href.startsWith("/practice/") &&
      x.sample.every(s => s.href === null || s.href.startsWith("/practice/"))) &&
    (g.overdue?.sample ?? []).every(s => s.href?.startsWith("/practice/patients/")),
    JSON.stringify((g.overdue?.sample ?? []).map(s => s.href)));

  // ⚠ REFUSED IN THE POSITION THEY WOULD OCCUPY, not omitted.
  const refusedKeys = (attention.data?.refused ?? []).map(r => r.key).sort().join(",");
  ok("IMPROVING, DETERIORATING AND HIGH COMPLEXITY ARE PRESENT AS REFUSALS, each naming what would make it real",
    refusedKeys === "deteriorating,high_complexity,improving" &&
    (attention.data?.refused ?? []).every(r => r.why.length > 100 && r.wouldRequire.length > 60),
    refusedKeys);
  ok("and the refusal says WHY the obvious proxy is worse than nothing",
    /went elsewhere|deteriorated/.test(REFUSED_PATIENT_STATES.find(r => r.key === "improving")!.why),
    REFUSED_PATIENT_STATES.find(r => r.key === "improving")!.why.slice(0, 80));
  ok("no refused state has leaked into the computed groups",
    !(attention.data?.groups ?? []).some(x => ["improving", "deteriorating", "high_complexity"].includes(x.key)),
    (attention.data?.groups ?? []).map(x => x.key).join(","));

  // ══ E. A FAILED READ IS NEVER A ZERO ══════════════════════════════════════════════════════════════
  console.log("\n── s12: three states, and only one of them is a problem ──");
  const broken = await patientAttentionIntelligence(brokenAdmin(), a.ctx, range);
  const bg = Object.fromEntries((broken.data?.groups ?? []).map(x => [x.key, x]));
  ok("A DEAD TABLE PRODUCES `unreadable` AND A NULL, never a plausible nought",
    (broken.data?.groups ?? []).every(x => x.status === "unreadable" && x.count === null) &&
    /boom/.test(bg.overdue?.reason ?? ""),
    JSON.stringify((broken.data?.groups ?? []).map(x => [x.key, x.status, x.count])));
  ok("CONTROL: the same call over the real database returns counts, so the test above is not passing on an empty practice",
    g.overdue?.status === "ok" && g.overdue?.count === 3);

  const blindFollowUps = await withoutCapability(wsA, OWNER, ["followup.view"]);
  const noFu = await patientAttentionIntelligence(admin, blindFollowUps, range);
  const ng = Object.fromEntries((noFu.data?.groups ?? []).map(x => [x.key, x]));
  ok("WITHOUT followup.view the obligation groups say NOT PERMITTED with a null -- a permissions answer, not an empty practice",
    ng.overdue?.status === "not_permitted" && ng.overdue?.count === null &&
    ng.lost_to_follow_up?.status === "not_permitted",
    JSON.stringify([ng.overdue?.status, ng.overdue?.count]));
  ok("CONTROL: and the group that does NOT depend on follow-ups still stands, so it is a targeted refusal rather than a blanked module",
    ng.inactive?.status === "ok" && ng.inactive?.count === 2,
    JSON.stringify([ng.inactive?.status, ng.inactive?.count]));
  ok("`unreadable` and `not_permitted` are DIFFERENT answers -- the two calls above disagree about the same group",
    bg.overdue?.status !== ng.overdue?.status);

  // ══ F. THE PRIORITY STRIP: THE UNION IS NOT A SUM, AND ALL-CLEAR MEANS ALL THREE ═══════════════════
  console.log("\n── s7.2: five tiles, a union rather than a sum, and an honest all-clear ──");
  const groupsWithOneSharedPatient: IntelModule<PatientAttentionData> = {
    key: "patient_attention", label: "Patient Attention", available: true, unavailableReason: null,
    sources: [], problems: [],
    data: {
      today, identified: true, refused: REFUSED_PATIENT_STATES,
      // ⚠ THE SAME PATIENT IN ALL THREE GROUPS. With three different ids a sum and a union both give 3
      // and the assertion would be vacuous -- which is exactly how this class of bug survives review.
      groups: ["overdue", "inactive", "lost_to_follow_up"].map(k => ({
        key: k, label: k, definition: "d", count: 1, status: "ok" as const, reason: null,
        sample: [{ id: p2, label: "Shared", note: null, href: `/practice/patients/${p2}` }],
        sampleIsPartial: false, href: "/practice/patients",
        formula: "f", sources: ["s"], fromDay: null, toDay: null, asOf: new Date().toISOString(),
        provenance: "computed" as const,
      })),
    },
  };
  const noPathways: IntelModule<PathwayIntelligenceData> = {
    key: "pathways", label: "Care Pathways", available: true, unavailableReason: null,
    sources: [], problems: [],
    data: {
      cards: [], status: "ok", reason: null,
      milestonesPassed: { key: "milestones_passed", label: "p", definition: "d", count: 0, status: "ok", reason: null, sample: [], sampleIsPartial: false, href: "/practice/pathways", formula: "f", sources: ["s"], fromDay: null, toDay: null, asOf: new Date().toISOString(), provenance: "derived" },
      milestonesUpcoming: { key: "milestones_upcoming", label: "u", definition: "d", count: 0, status: "ok", reason: null, sample: [], sampleIsPartial: false, href: "/practice/pathways", formula: "f", sources: ["s"], fromDay: null, toDay: null, asOf: new Date().toISOString(), provenance: "derived" },
    },
  };

  const unionStrip = priorityStrip({ attention: [], blindSpots: [], unreadable: [] },
    groupsWithOneSharedPatient, noPathways);
  const patientsTile = unionStrip.tiles.find(t => t.key === "patients_attention")!;
  ok("PATIENTS NEEDING ATTENTION COUNTS PEOPLE, NOT GROUP MEMBERSHIPS: one patient in all three groups is 1, not 3",
    patientsTile.count === 1, String(patientsTile.count));
  ok("the strip always draws five tiles, whatever happened",
    unionStrip.tiles.length === 5 &&
    unionStrip.tiles.map(t => t.key).join(",") === PRIORITY_KEYS.join(","),
    unionStrip.tiles.map(t => t.key).join(","));

  // ⚠ ALL THREE, OR IT IS NOT ALL CLEAR.
  ok("ALL CLEAR is true only when nothing is waiting AND nothing is hidden AND nothing failed",
    unionStrip.allClear === false, "a tile holds 1, so it must not be clear");
  const quiet = priorityStrip({ attention: [], blindSpots: [], unreadable: [] },
    { ...groupsWithOneSharedPatient, data: { ...groupsWithOneSharedPatient.data!, groups: groupsWithOneSharedPatient.data!.groups.map(x => ({ ...x, count: 0, sample: [] })) } },
    noPathways);
  ok("CONTROL: with nothing waiting, nothing hidden and nothing broken, it IS clear",
    quiet.allClear === true, JSON.stringify(quiet.tiles.map(t => [t.key, t.status, t.count])));
  const hidden = priorityStrip({ attention: [], blindSpots: ["follow-ups"], unreadable: [] },
    { ...groupsWithOneSharedPatient, data: { ...groupsWithOneSharedPatient.data!, groups: groupsWithOneSharedPatient.data!.groups.map(x => ({ ...x, count: 0, sample: [] })) } },
    noPathways);
  ok("A BLIND SPOT IS NOT CALM: the same zeroes with one domain hidden are NOT all clear",
    hidden.allClear === false &&
    hidden.tiles.find(t => t.key === "overdue_followups")!.status === "not_permitted",
    JSON.stringify(hidden.tiles.map(t => [t.key, t.status])));
  const brokenRead = priorityStrip({ attention: [], blindSpots: [], unreadable: ["follow-ups"] },
    { ...groupsWithOneSharedPatient, data: { ...groupsWithOneSharedPatient.data!, groups: groupsWithOneSharedPatient.data!.groups.map(x => ({ ...x, count: 0, sample: [] })) } },
    noPathways);
  ok("A FAILED READ IS NOT CALM EITHER, and it is a different answer from a blind spot",
    brokenRead.allClear === false &&
    brokenRead.tiles.find(t => t.key === "overdue_followups")!.status === "unreadable",
    JSON.stringify(brokenRead.tiles.map(t => [t.key, t.status])));

  // ══ G. COHORTS: DISTINCT PATIENTS, AND THE SLICES DO NOT SUM ══════════════════════════════════════
  console.log("\n── s5: cohorts count people ──");
  const cohorts = await cohortIntelligence(admin, a.ctx, range, "diagnosis");
  const cd = cohorts.data!;
  const slice = (label: string) => cd.slices.find(s => s.label.toLowerCase() === label);
  ok("a diagnosis two patients share is one slice holding two patients",
    slice("malaria")?.patients === 2 && slice("malaria")?.records === 2,
    JSON.stringify(cd.slices.map(s => [s.label, s.patients, s.records])));
  // ⚠ p3 CARRIES TWO DIAGNOSES. The slices sum to 3 memberships and the union is 2 people.
  ok("THE SLICES DO NOT SUM: two people across three memberships is 2 distinct patients, not 3",
    cd.patientsInAnySlice === 2 &&
    cd.slices.reduce((n, s) => n + s.patients, 0) === 3,
    JSON.stringify({ union: cd.patientsInAnySlice, sum: cd.slices.reduce((n, s) => n + s.patients, 0) }));
  ok("and each slice opens: every sampled patient carries a route to their record",
    cd.slices.every(s => s.sample.every(x => x.href?.startsWith("/practice/patients/"))),
    JSON.stringify(cd.slices[0]?.sample));

  const sexCohort = await cohortIntelligence(admin, a.ctx, range, "sex");
  ok("CONTROL: a different dimension returns a different grouping over the same people",
    sexCohort.data?.dimension === "sex" &&
    sexCohort.data?.slices.find(s => s.key === "female")?.patients === 5,
    JSON.stringify(sexCohort.data?.slices.map(s => [s.key, s.patients])));

  // ══ H. THE SUITE: NO RATE ANYWHERE, EVERY FIGURE TRACEABLE ════════════════════════════════════════
  console.log("\n── The assembled suite ──");
  const suite = await intelligenceSuite(admin, a.ctx, { days: 30 });

  const violations = findRates(JSON.parse(JSON.stringify(suite)));
  ok("NO RATE-SHAPED FIELD AND NO PERCENTAGE LITERAL ANYWHERE IN THE SERIALISED SUITE",
    violations.length === 0,
    JSON.stringify(violations.slice(0, 6)));
  ok("and the payload says so as a field, so no client can render one and call it the same data",
    suite.ratesComputed === false);
  ok("CONTROL: the suite is not empty, so the assertion above is not passing over nothing",
    JSON.stringify(suite).length > 20000 && suite.patients.data !== null,
    String(JSON.stringify(suite).length));

  // ⚠ s15's FIFTH CRITERION, ASSERTED STRUCTURALLY over every figure in the payload rather than spot-
  // checked on the three somebody remembered.
  const figures = figuresWithFormula(suite);
  const undocumented = figures.filter(f =>
    String(f.o.formula).length < 30 || !Array.isArray(f.o.sources) || f.o.sources.length === 0);
  ok("EVERY FIGURE IN THE PAYLOAD IDENTIFIES ITS SOURCE DEFINITION -- a formula and at least one table.column",
    figures.length > 30 && undocumented.length === 0,
    `${figures.length} figures, ${undocumented.length} undocumented: ${undocumented.slice(0, 3).map(f => f.path).join(", ")}`);
  ok("and the suite says WHEN it was computed, in which timezone, over which window",
    !!suite.asOfIso && suite.timezone === TZ &&
    /^\d{4}-\d{2}-\d{2}$/.test(suite.range.period.fromDay) && /^\d{4}-\d{2}-\d{2}$/.test(suite.range.period.toDay),
    JSON.stringify({ tz: suite.timezone, from: suite.range.period.fromDay }));

  ok("EVERY PRIORITY TILE THAT HOLDS A FIGURE IS A LIST YOU CAN OPEN",
    suite.priority.tiles.every(t => t.href.startsWith("/practice/")) &&
    suite.priority.tiles.filter(t => t.status === "ok" && (t.count ?? 0) > 0)
      .every(t => t.sample.length > 0),
    JSON.stringify(suite.priority.tiles.map(t => [t.key, t.status, t.count, t.sample.length])));

  ok("the derived brief is labelled DERIVED as a field, with the time it was calculated",
    suite.brief.status === "derived" && !!suite.brief.calculatedAt && suite.brief.method.length > 60);

  // ══ I. TRENDS: REFUSED WHEN THE PRIOR WINDOW WAS NOT REAL, COMPUTED WHEN IT WAS ═══════════════════
  console.log("\n── s5 of CPR-PI-002: comparisons, gated rather than refused ──");
  ok("A BRAND-NEW PRACTICE GETS NO COMPARISON, and the reason names its own start date",
    suite.range.priorUsable === false &&
    /began keeping records|no recorded start date/.test(suite.range.priorReason ?? ""),
    suite.range.priorReason ?? "");
  const comps = suite.workspace.modules.overview.data?.comparisons ?? [];
  ok("and every comparison is null WITH A REASON -- never 0, never an arrow pointing at nothing",
    comps.length > 0 &&
    comps.every(c => c.prior === null && c.change === null && (c.reason ?? "").length > 20),
    JSON.stringify(comps.map(c => [c.key, c.prior, c.change])));

  // THE CONTROL. Backdate the practice AND fill both windows, so the same call must produce a real
  // signed count. Without this the assertion above would pass on any practice with no data at all.
  const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString();
  await admin.from("practice_workspace").update({ created_at: twoYearsAgo }).eq("id", wsA);
  const { data: aged } = await admin.from("practice_workspace").select("created_at").eq("id", wsA).maybeSingle();
  ok("FIXTURE: the practice really was backdated two years",
    String((aged as any)?.created_at ?? "").startsWith(twoYearsAgo.slice(0, 4)),
    String((aged as any)?.created_at));

  // 7 appointments in the current 30 days, 5 in the 30 before it: 12 observations, above the floor of
  // 10, and a difference of exactly +2.
  const appt = (dayOffset: number, i: number) => ({
    workspace_id: wsA, patient_name: `Harness ${i}`, status: "CONFIRMED",
    scheduled_at: `${dueDateFrom(today, dayOffset)}T09:00:00.000Z`,
  });
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => appt(-(i + 1), i)),
    ...Array.from({ length: 5 }, (_, i) => appt(-(35 + i), 100 + i)),
  ];
  const { error: apptError, data: apptRows } = await admin.from("practice_appointment").insert(rows).select("id");
  ok("FIXTURE: twelve appointments were really written, seven in this window and five in the one before",
    !apptError && ((apptRows ?? []) as any[]).length === 12,
    apptError?.message ?? String(((apptRows ?? []) as any[]).length));

  const compared = await intelligenceSuite(admin, a.ctx, { days: 30 });
  const booked = (compared.workspace.modules.overview.data?.comparisons ?? []).find(c => c.key === "booked");
  ok("CONTROL: WITH A REAL PRIOR WINDOW AND ENOUGH RECORDS, THE COMPARISON IS COMPUTED",
    compared.range.priorUsable === true && booked?.status === "ok",
    JSON.stringify({ usable: compared.range.priorUsable, status: booked?.status, reason: booked?.reason }));
  // ⚠ THE EXACT SIGNED COUNT. "change is a number" would pass on 0; the fixture makes the right answer +2.
  ok("and it is a SIGNED COUNT, not a percentage: 7 against 5 is +2",
    booked?.current === 7 && booked?.prior === 5 && booked?.change === 2,
    JSON.stringify({ current: booked?.current, prior: booked?.prior, change: booked?.change }));
  ok("no rate has appeared now that a comparison exists -- the detector is run again over the new payload",
    findRates(JSON.parse(JSON.stringify(compared))).length === 0,
    JSON.stringify(findRates(JSON.parse(JSON.stringify(compared))).slice(0, 4)));

  // ⚠ THE OTHER GATE, PROVEN SEPARATELY. A real prior window is not enough: below the observation floor
  // the comparison is still refused. `no_show` has 0 and 0 across both windows.
  const noShow = (compared.workspace.modules.overview.data?.comparisons ?? []).find(c => c.key === "no_show");
  ok("BELOW THE OBSERVATION FLOOR THE COMPARISON IS STILL REFUSED, even though the prior window is now real",
    noShow?.status === "unknowable" && noShow?.change === null && /needed before a difference means anything/.test(noShow?.reason ?? ""),
    JSON.stringify({ status: noShow?.status, reason: noShow?.reason }));

  // ══ J. THE ASSISTANT REFUSES WITHOUT A GROUNDING CONTEXT ══════════════════════════════════════════
  console.log("\n── CPR-PI-003 s6: no context, no answer ──");
  const none = await assistantGrounding(admin, a.ctx, { task: "ask" });
  ok("NO CONTEXT MEANS NO GROUNDING: the assistant is handed nothing and therefore has nothing to say",
    none === null, JSON.stringify(none));
  const grounded = await assistantGrounding(admin, a.ctx, { task: "ask", encounterId: e3 });
  ok("CONTROL: with a consultation it grounds, and every source is a row in this practice that opens",
    grounded !== null && grounded!.grounding.length > 0 &&
    grounded!.grounding.some(s => s.kind === "encounter" && s.href?.startsWith("/practice/encounters/")),
    JSON.stringify(grounded?.grounding.map(s => s.kind)));

  const practiceCtx = await assistantGrounding(admin, a.ctx, { task: "ask", practice: true });
  ok("THE PRACTICE CONTEXT GROUNDS ON COUNTS, and says in the text that no rate may be derived from them",
    practiceCtx !== null && /There are no rates here/.test(practiceCtx!.text) &&
    practiceCtx!.grounding.some(s => s.kind === "practice"),
    practiceCtx?.text.slice(0, 90));
  ok("and NOT ONE PERCENTAGE reaches the model in that grounding text",
    findRates({ text: practiceCtx!.text }).length === 0,
    JSON.stringify(findRates({ text: practiceCtx!.text }).slice(0, 3)));

  const blindReports = await withoutCapability(wsA, OWNER, ["report.view"]);
  const refusedPractice = await assistantGrounding(admin, blindReports, { task: "ask", practice: true });
  ok("WITHOUT report.view THE PRACTICE CONTEXT REFUSES rather than returning a thinner answer",
    refusedPractice === null, JSON.stringify(refusedPractice));

  ok("all five of s8's contexts are declared, and each names the parameter that carries it",
    CONTEXT_KINDS.length === 5 &&
    CONTEXT_KINDS.map(c => c.key).sort().join(",") === "document,encounter,follow_up,patient,practice" &&
    CONTEXT_KINDS.every(c => c.param.length > 0),
    CONTEXT_KINDS.map(c => c.key).join(","));

  const figuresForAi = suiteGroundingFigures(compared);
  ok("ONLY FIGURES THAT STAND ARE OFFERED TO THE MODEL -- a labelled blank is how a generator invents a number",
    figuresForAi.length > 0 &&
    figuresForAi.every(f => f.value !== null && f.formula.length > 20 && f.sources.length > 0),
    String(figuresForAi.length));
  ok("and the refused comparisons are ABSENT rather than present-and-null",
    !figuresForAi.some(f => f.key === "no_show_change"),
    figuresForAi.map(f => f.key).join(","));

  // ══ K. PERMISSION AND ISOLATION ═══════════════════════════════════════════════════════════════════
  console.log("\n── s11: permissions, and one practice cannot see another ──");
  const blind = await withoutCapability(wsA, OWNER, ["patient.view"]);
  const blindSuite = await intelligenceSuite(admin, blind, { days: 30 });
  ok("report.view without patient.view is marked unidentified and no patient NAME appears anywhere",
    blindSuite.identified === false &&
    !JSON.stringify(blindSuite).includes("Overdue Lost Inactive") &&
    !JSON.stringify(blindSuite).includes("Registered Never Seen"),
    "a name leaked");
  ok("CONTROL: their counts are still complete, so it is de-identification rather than an empty page",
    (blindSuite.patients.data?.groups ?? []).find(x => x.key === "inactive")?.count === 2,
    JSON.stringify((blindSuite.patients.data?.groups ?? []).map(x => [x.key, x.count])));

  const bSuite = await intelligenceSuite(admin, b.ctx, { days: 365 });
  ok("B'S SUITE COUNTS NONE OF A'S WORK",
    (bSuite.patients.data?.groups ?? []).every(x => x.count === 0) &&
    (bSuite.cohorts.data?.slices ?? []).length === 0,
    JSON.stringify((bSuite.patients.data?.groups ?? []).map(x => [x.key, x.count])));
  ok("and A's is non-empty, so the isolation test is not vacuous",
    (suite.patients.data?.groups ?? []).some(x => (x.count ?? 0) > 0));

  const { data: logs } = await admin.from("practice_access_log")
    .select("detail, route").eq("workspace_id", wsA).eq("route", "/practice/intelligence");
  ok("READING THE WHOLE PRACTICE IS LOGGED, like any other read",
    ((logs ?? []) as any[]).some(l => /Practice Intelligence suite/.test(l.detail ?? "")),
    JSON.stringify(((logs ?? []) as any[])[0]));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
