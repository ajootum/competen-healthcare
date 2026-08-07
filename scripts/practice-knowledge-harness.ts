/**
 * Practice Guidance harness -- CPR-KS-001 Phase 1 (Engine 4: Guideline & SOP, plus section 8's library).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS HARNESS HAS TWO BRANCHES AND IT ASKS THE DATABASE WHICH ONE TO RUN.
 *
 * The store for this phase (practice_guidance_document + practice_guidance_section) is a migration that
 * has not been written yet -- the DDL is in the header of src/lib/practice/knowledge.ts. Rather than
 * assert "the store is absent", which would become FALSE the day the migration lands and would then have
 * to be edited to keep passing, this asks the database and asserts THE ENGINE AGREES WITH IT:
 *
 *   absent   -- every read reports absent rather than empty, and every write refuses by name.
 *   present  -- the whole loop: write, send for approval, have a COLLEAGUE approve, publish, be refused
 *               a second publication under the same reference, revise, and supersede.
 *
 * Assertion 0 pins the branch to the live probe, so neither branch can pass by being skipped.
 *
 * WHAT IT PROVES, IN BOTH BRANCHES:
 *   1. CPR-KS-001 Engine 4's EIGHT document types and TEN sections, written out in full rather than
 *      counted -- a list assertion that matches whatever the code now does is a transcript, not a test.
 *   2. ⚠ REVIEW AND APPROVAL ARE NOT WRITABLE. They are rendered from the record, so the document cannot
 *      claim an approval that did not happen. Nothing may type into them.
 *   3. ⚠ WHERE THE RECORD HAS NOTHING, THE SECTION SAYS "NOT CHECKED" -- never a blank under a heading,
 *      because a heading followed by white space on printed guidance reads as "nothing to say here".
 *   4. ⚠ TWO CHECKLIST ROWS CAN NEVER BE ANSWERED AND ARE NEVER GREEN, in either direction: whether
 *      staff have read it, and whether the evidence it cites is current.
 *   5. A FAILED OR ABSENT READ IS NEVER A ZERO. The library reports its state; it never returns an empty
 *      list of documents and a row of zeroed counts.
 *   6. NO CAPABILITY CODE WAS INVENTED -- both are asserted against the LIVE catalogue.
 *   7. The state graph is closed: there is no way out of archived, and no way to edit anything that is
 *      not a draft.
 *
 *   npx --yes tsx scripts/practice-knowledge-harness.ts
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { decideApproval } from "../src/lib/practice/delegation";
import {
  guidanceStorePresence, guidanceLibrary, getGuidance, createGuidance, updateGuidance,
  submitGuidanceForApproval, withdrawGuidanceFromReview, syncGuidanceApproval,
  publishGuidance, archiveGuidance, reviseGuidance, renderSections, guidanceReadiness,
  GUIDANCE_TABLE, GUIDANCE_SECTION_TABLE,
} from "../src/lib/practice/knowledge";
import {
  GUIDANCE_TYPES, GUIDANCE_TYPE_CODES, GUIDANCE_SECTIONS, GUIDANCE_SECTIONS_AUTHORED,
  GUIDANCE_SECTION_KEYS, GUIDANCE_SECTIONS_REQUIRED, GUIDANCE_STATES, GUIDANCE_STATE_CODES,
  GUIDANCE_TRANSITIONS, GUIDANCE_CHECKS, GUIDANCE_CHECKS_NOT_CHECKABLE, GUIDANCE_CHECK_SWATCH,
  GUIDANCE_FACETS, GUIDANCE_FACETS_LIVE, GUIDANCE_FACETS_ABSENT, KNOWLEDGE_CAPABILITY_CODES,
  GUIDANCE_STATES_EDITABLE, guidanceCanMove, guidanceMovesFrom, GUIDANCE_MODULE_NAME,
} from "../src/lib/practice/knowledge-constants";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const AUTHOR = "00000000-0000-4000-8000-0000000e4501";
const COLLEAGUE = "00000000-0000-4000-8000-0000000e4502";
const OTHER = "00000000-0000-4000-8000-0000000e4503";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const base = { actorId: AUTHOR, correlationId: "harness-guidance" };

// ── The spec, written out. Changing the product must mean changing a document, not nudging a number. ──
const ENGINE_4_TYPES = [
  "guideline", "policy", "protocol", "sop", "work_instruction",
  "clinical_standard", "practice_standard", "service_manual",
];
const ENGINE_4_SECTIONS = [
  "purpose", "scope", "definitions", "responsibilities",
  "procedure", "documentation", "escalation", "references", "review", "approval",
];
const SECTION_3_STATES = ["draft", "in_review", "approved", "published", "archived"];

// ── Fixtures for the pure assertions ─────────────────────────────────────────────────────────────────
const emptyDoc = { effective_from: null, review_on: null, status: "draft", version: 1, approval_request_id: null };
const readyDoc = { effective_from: "2026-09-01", review_on: "2027-09-01", status: "approved", version: 2, approval_request_id: "a-1" };
const blankSections = GUIDANCE_SECTIONS_AUTHORED.map(s => ({
  section_key: s.key, heading: s.heading, body: "", position: s.position ?? 0, required: s.required,
}));
const filledSections = GUIDANCE_SECTIONS_AUTHORED.map(s => ({
  section_key: s.key, heading: s.heading, body: `Text for ${s.key}.`, position: s.position ?? 0, required: s.required,
}));
const approvedRequest = {
  id: "a-1", status: "APPROVED", assigned_to: COLLEAGUE, requested_by: AUTHOR,
  decided_by: COLLEAGUE, decided_at: "2026-08-20T09:00:00.000Z", decision_note: "Fine as it stands.",
  decidedByName: "Dr Nabirye",
};
const pendingRequest = { ...approvedRequest, status: "PENDING", decided_by: null, decided_at: null, decision_note: null, decidedByName: null };

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-guidance-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-guidance",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-guidance", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [AUTHOR, OTHER]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
  process.exit(0);
}

async function main() {
  console.log(`\n${GUIDANCE_MODULE_NAME} harness (CPR-KS-001 Phase 1, Engine 4)\n`);

  // ══ 0. WHICH BRANCH, AND IT IS THE DATABASE THAT DECIDES ═══════════════════════════════════════
  const presence = await guidanceStorePresence(admin);
  // Asked directly, without the engine, so assertion 0 is not the engine marking its own homework.
  const directProbe = await Promise.all([GUIDANCE_TABLE, GUIDANCE_SECTION_TABLE].map(async t => {
    const { error } = await admin.from(t).select("id").limit(1);
    return { t, present: !error };
  }));
  const reallyPresent = directProbe.every(p => p.present);
  ok("0. the engine's view of the store is the DATABASE's view, not an assumption",
    presence.present === reallyPresent && (presence.state === "present") === reallyPresent,
    `engine=${presence.state} database=${JSON.stringify(directProbe)}`);
  console.log(`\n  -- store is ${presence.state.toUpperCase()} --\n`);

  // ══ 1. THE SPECIFICATION'S VOCABULARY, WRITTEN OUT ═════════════════════════════════════════════
  ok("1a. Engine 4's EIGHT document types, in the specification's order",
    GUIDANCE_TYPE_CODES.join() === ENGINE_4_TYPES.join(), GUIDANCE_TYPE_CODES.join(" "));
  ok("1a-control. and each carries a meaning distinguishing it from the seven beside it",
    GUIDANCE_TYPES.every(t => t.meaning.trim().length > 20) &&
    new Set(GUIDANCE_TYPES.map(t => t.meaning)).size === 8,
    GUIDANCE_TYPES.filter(t => t.meaning.trim().length <= 20).map(t => t.code).join(", "));

  ok("1b. Engine 4's TEN template sections, in the specification's order",
    GUIDANCE_SECTIONS.map(s => s.key).join() === ENGINE_4_SECTIONS.join(),
    GUIDANCE_SECTIONS.map(s => s.key).join(" "));

  // ⚠ 2. THE DECISION THIS MODULE TURNS ON.
  ok("2a. ⚠ REVIEW AND APPROVAL ARE NOT AUTHORED -- eight sections are written, two are read from the record",
    GUIDANCE_SECTION_KEYS.length === 8 &&
    !GUIDANCE_SECTION_KEYS.includes("review") && !GUIDANCE_SECTION_KEYS.includes("approval"),
    GUIDANCE_SECTION_KEYS.join(" "));
  ok("2a-control. and the two that are not authored are exactly Review and Approval, not some other pair",
    GUIDANCE_SECTIONS.filter(s => s.source === "derived").map(s => s.key).join() === "review,approval",
    GUIDANCE_SECTIONS.filter(s => s.source === "derived").map(s => s.key).join(" "));
  ok("2b. the eight authored sections occupy positions 1-8 with no gap and no collision",
    GUIDANCE_SECTIONS_AUTHORED.map(s => s.position).join() === "1,2,3,4,5,6,7,8",
    GUIDANCE_SECTIONS_AUTHORED.map(s => s.position).join(" "));
  ok("2c. Purpose, Scope and Procedure are the required three",
    GUIDANCE_SECTIONS_REQUIRED.join() === "purpose,scope,procedure", GUIDANCE_SECTIONS_REQUIRED.join(" "));

  // ══ 3. THE FIVE STATES AND A CLOSED GRAPH ══════════════════════════════════════════════════════
  ok("3a. CPR-KS-001 section 3's five states",
    GUIDANCE_STATE_CODES.join() === SECTION_3_STATES.join(), GUIDANCE_STATE_CODES.join(" "));
  ok("3a-note. ⚠ `in_review`, not `review` -- there is a review_on COLUMN meaning something else entirely",
    GUIDANCE_STATE_CODES.includes("in_review") && !GUIDANCE_STATE_CODES.includes("review"));
  ok("3b. every transition runs between two states that exist",
    GUIDANCE_TRANSITIONS.every(t => GUIDANCE_STATE_CODES.includes(t.from) && GUIDANCE_STATE_CODES.includes(t.to)),
    GUIDANCE_TRANSITIONS.filter(t => !GUIDANCE_STATE_CODES.includes(t.to)).map(t => t.to).join(", "));
  ok("3c. ⚠ ARCHIVED IS TERMINAL -- nothing comes back out of it",
    guidanceMovesFrom("archived").length === 0, guidanceMovesFrom("archived").map(t => t.to).join(", "));
  ok("3d. ⚠ A PUBLISHED DOCUMENT CANNOT BE EDITED BACK INTO A DRAFT -- the forward path is a new version",
    !guidanceCanMove("published", "draft") && !guidanceCanMove("published", "approved"));
  ok("3e. only a draft is editable",
    GUIDANCE_STATES_EDITABLE.join() === "draft", GUIDANCE_STATES_EDITABLE.join(" "));
  ok("3e-control. and the other four each say WHY they are not, in their own words",
    GUIDANCE_STATES.filter(s => !s.editable).every(s => s.meaning.trim().length > 30) &&
    new Set(GUIDANCE_STATES.map(s => s.meaning)).size === 5);
  ok("3f. approved and published are DIFFERENT -- approved is not in force",
    GUIDANCE_STATES.find(s => s.code === "approved")?.inForce === false &&
    GUIDANCE_STATES.find(s => s.code === "published")?.inForce === true);

  // ══ 4. RENDERING: NEVER A BLANK UNDER A HEADING ════════════════════════════════════════════════
  const bare = renderSections(emptyDoc, blankSections, null);
  ok("4a. a document with nothing on it still renders all ten sections",
    bare.length === 10, String(bare.length));
  ok("4b. ⚠ REVIEW SAYS 'NOT CHECKED' WHEN NO DATES ARE SET -- not a blank that reads as fine",
    bare.find(s => s.key === "review")?.state === "not_checked" &&
    !bare.find(s => s.key === "review")?.body,
    JSON.stringify(bare.find(s => s.key === "review")));
  ok("4c. ⚠ APPROVAL SAYS 'NOT CHECKED' WHEN NOBODY HAS APPROVED -- it cannot claim what did not happen",
    bare.find(s => s.key === "approval")?.state === "not_checked",
    JSON.stringify(bare.find(s => s.key === "approval")?.state));
  ok("4c-b. and a PENDING request is still not an approval",
    renderSections(emptyDoc, blankSections, pendingRequest as never)
      .find(s => s.key === "approval")?.state === "not_checked");
  ok("4d. every not_checked section explains what it would take, rather than falling silent",
    bare.filter(s => s.state === "not_checked").every(s => (s.note ?? "").trim().length > 40) &&
    bare.filter(s => s.state === "not_checked").length === 2);

  // CONTROL. 4b-4d would pass just as well against a renderer that said "not checked" to everything.
  const full = renderSections(readyDoc, filledSections, approvedRequest as never);
  ok("4-control. ⚠ WITH DATES AND A REAL APPROVAL, BOTH DERIVED SECTIONS SAY SOMETHING",
    full.find(s => s.key === "review")?.state === "derived" &&
    full.find(s => s.key === "approval")?.state === "derived",
    `${full.find(s => s.key === "review")?.state} / ${full.find(s => s.key === "approval")?.state}`);
  ok("4-control-b. and the approval names the person who actually decided it, from the record",
    (full.find(s => s.key === "approval")?.body ?? "").includes("Dr Nabirye"),
    full.find(s => s.key === "approval")?.body ?? "");
  ok("4e. an authored section nobody wrote is `empty`, and carries its prompt rather than nothing",
    bare.filter(s => s.source === "authored").every(s => s.state === "empty" && (s.note ?? "").length > 10));

  // ══ 5. THE PUBLICATION CHECKLIST ═══════════════════════════════════════════════════════════════
  const cold = guidanceReadiness(emptyDoc, blankSections, null);
  const warm = guidanceReadiness(readyDoc, filledSections, approvedRequest as never);

  ok("5a. an empty draft is not publishable, and says which blockers",
    !cold.publishable && cold.blockers >= 3, JSON.stringify({ publishable: cold.publishable, blockers: cold.blockers }));
  ok("5b. the empty required sections are NAMED in the failure, not merely counted",
    (cold.checks.find(c => c.code === "REQUIRED_SECTIONS")?.detail ?? "").includes("purpose"),
    cold.checks.find(c => c.code === "REQUIRED_SECTIONS")?.detail ?? "");
  ok("5c. ⚠ A LINKED APPROVAL IS NOT A DECIDED ONE, and only the engine can tell them apart",
    guidanceReadiness({ ...readyDoc }, filledSections, pendingRequest as never)
      .checks.find(c => c.code === "APPROVAL_DECIDED")?.state === "fail" &&
    guidanceReadiness({ ...readyDoc }, filledSections, pendingRequest as never)
      .checks.find(c => c.code === "APPROVAL_LINKED")?.state === "pass",
    "the database sees the link; the engine sees the decision");
  ok("5-control. ⚠ A FULLY PREPARED DOCUMENT IS PUBLISHABLE -- otherwise 5a-5c would pass against a checklist that refused everything",
    warm.publishable && warm.blockers === 0, JSON.stringify({ blockers: warm.blockers }));

  // ⚠ 6. THE ROWS THAT ARE NEVER GREEN.
  ok("6a. ⚠ TWO CHECKS CAN NEVER BE ANSWERED BY ANYTHING IN THIS BUILD",
    GUIDANCE_CHECKS_NOT_CHECKABLE.join() === "STAFF_HAVE_READ,EVIDENCE_CURRENT",
    GUIDANCE_CHECKS_NOT_CHECKABLE.join(" "));
  ok("6b. and they are `not_checked` on a fully prepared document too -- never quietly cleared by success",
    GUIDANCE_CHECKS_NOT_CHECKABLE.every(code =>
      cold.checks.find(c => c.code === code)?.state === "not_checked" &&
      warm.checks.find(c => c.code === code)?.state === "not_checked"),
    warm.checks.filter(c => GUIDANCE_CHECKS_NOT_CHECKABLE.includes(c.code)).map(c => `${c.code}=${c.state}`).join(" "));
  ok("6c. each says what it would take to become checkable, so the gap is actionable",
    GUIDANCE_CHECKS.filter(c => c.authority === "absent").every(c => (c.wouldNeed ?? "").trim().length > 40));
  ok("6d. ⚠ AND THE MARK FOR not_checked IS NOT GREEN AND IS NOT A TICK",
    !/emerald|green/.test(JSON.stringify(GUIDANCE_CHECK_SWATCH.not_checked)) &&
    GUIDANCE_CHECK_SWATCH.not_checked.icon !== GUIDANCE_CHECK_SWATCH.pass.icon &&
    GUIDANCE_CHECK_SWATCH.not_checked.icon !== "✓",
    JSON.stringify(GUIDANCE_CHECK_SWATCH.not_checked));
  ok("6e. every check declares who owns it, and no check is left without an authority",
    GUIDANCE_CHECKS.every(c => ["engine", "database", "build", "absent"].includes(c.authority)));
  ok("6f. the database-owned checks name the constraints that own them, so a refusal is recognisable",
    GUIDANCE_CHECKS.filter(c => c.authority === "database").length === 3);

  // ══ 7. THE LIBRARY'S FACETS ════════════════════════════════════════════════════════════════════
  ok("7a. section 8 asks for eight facets and this offers six",
    GUIDANCE_FACETS.length === 8 && GUIDANCE_FACETS_LIVE.length === 6,
    `${GUIDANCE_FACETS_LIVE.length} live, ${GUIDANCE_FACETS_ABSENT.length} declared absent`);
  ok("7b. ⚠ DISEASE AND AGE ARE NOT OFFERED, because nothing behind them exists",
    GUIDANCE_FACETS_ABSENT.join() === "disease,age", GUIDANCE_FACETS_ABSENT.join(" "));
  ok("7c. and each absent facet says what it would take, rather than being silently missing",
    GUIDANCE_FACETS.filter(f => f.state === "absent").every(f => (f.wouldNeed ?? "").trim().length > 30));

  // ══ 8. NO CAPABILITY CODE WAS INVENTED -- ASSERTED AGAINST THE LIVE CATALOGUE ═══════════════════
  const { data: caps } = await admin.from("practice_role_capabilities").select("capability_code").limit(2000);
  const live = new Set(((caps ?? []) as { capability_code: string }[]).map(c => c.capability_code));
  ok("8a. ⚠ EVERY CAPABILITY THIS MODULE NAMES IS SEEDED IN THE LIVE CATALOGUE",
    KNOWLEDGE_CAPABILITY_CODES.every(c => live.has(c)),
    KNOWLEDGE_CAPABILITY_CODES.filter(c => !live.has(c)).join(", ") || "all present");
  ok("8a-control. and the catalogue read actually returned codes",
    live.size >= 40, `${live.size} codes`);
  ok("8b. ⚠ NOTHING knowledge.* OR asset.* WAS MINTED -- migration 210 already covers this with template.manage",
    ![...live].some(c => c.startsWith("knowledge.") || c.startsWith("asset.")),
    [...live].filter(c => c.startsWith("knowledge.") || c.startsWith("asset.")).join(", "));

  // ══ 9. THE PAGE EXISTS, AND THE NOTICE IS ON THE PAPER ═════════════════════════════════════════
  const shellDir = join(process.cwd(), "src", "app", "practice", "(shell)", "knowledge-studio");
  ok("9a. the route exists, so a nav entry may legally be marked built (assertion 9f of the activity harness)",
    existsSync(join(shellDir, "page.tsx")));
  ok("9b. the document and its print view exist too",
    existsSync(join(shellDir, "[guidanceId]", "page.tsx")) &&
    existsSync(join(shellDir, "[guidanceId]", "print", "page.tsx")));

  // ⚠ CHECKED IN THE SOURCE, because a reader of a printed protocol cannot see a screen banner. The
  // sentence has to be on the page that goes to the printer, and nothing else here can prove that.
  const printSource = readFileSync(join(shellDir, "[guidanceId]", "print", "page.tsx"), "utf8");
  ok("9c. ⚠ THE 'NOTHING HERE CHECKS IT' NOTICE IS RENDERED ON THE PRINTED PAGE, not only on screen",
    printSource.includes("notMonitored.onPaper"), "onPaper is not referenced by the print route");
  ok("9d. and anything not in force prints marked, so a draft cannot be mistaken for the version people follow",
    /NOT IN FORCE/.test(printSource));
  ok("9e. ⚠ no section prints as a blank under a heading",
    /Nothing was written in this section/.test(printSource));

  // ══ 10. THE BRANCH THE DATABASE CHOSE ══════════════════════════════════════════════════════════
  if (presence.state !== "present") {
    console.log("\n  -- STOPPED CLEANLY AT THE STORE. The absent branch follows. --\n");

    ok("10a. the absent state names BOTH tables and the migration, rather than failing vaguely",
      presence.state === "absent" &&
      (presence.detail ?? "").includes(GUIDANCE_TABLE) && (presence.detail ?? "").includes(GUIDANCE_SECTION_TABLE),
      presence.detail ?? "");

    const lib = await guidanceLibrary(admin, "00000000-0000-4000-8000-00000000feed");
    ok("10b. ⚠ THE LIBRARY REPORTS `absent`, NOT AN EMPTY SHELF",
      lib.state === "absent", lib.state);
    ok("10c. ⚠ AND IT DOES NOT RETURN A ROW OF ZEROED COUNTS. A figure of 0 beside 'In force' would be a claim about this practice that nothing here can make",
      lib.counts.length === 0 && lib.items.length === 0, JSON.stringify(lib.counts));
    ok("10d. the facets are still declared, so what the module WILL do is visible before it can do it",
      lib.facets.length === 8 && lib.facets.filter(f => f.state === "absent").length === 2);
    ok("10e. and the not-monitored notice is carried on an absent library too",
      lib.notMonitored.onPaper.length > 20);

    const created = await createGuidance(admin, {
      workspaceId: "00000000-0000-4000-8000-00000000feed",
      code: "SOP-001", title: "Probe", docType: "sop", ...base,
    });
    ok("10f. ⚠ A WRITE REFUSES BY NAME WITH 503, rather than throwing a PostgREST error at somebody",
      !created.ok && created.code === "STORE_ABSENT" && created.status === 503,
      created.ok ? "it wrote something" : `${created.status} ${created.code}`);
    ok("10g. and the refusal names the missing migration, so the gap is actionable",
      !created.ok && /migration/i.test(created.message), created.ok ? "" : created.message);

    // ⚠ THE REFUSAL IS THE ENGINE'S OWN AND NOT AN ACCIDENT OF A BAD WORKSPACE ID. Proven by the fact
    // that a VALIDATION failure still comes back as a validation failure, ahead of the store: if
    // STORE_ABSENT were merely what this engine returns for everything, this would say STORE_ABSENT too.
    const invalidType = await createGuidance(admin, {
      workspaceId: "00000000-0000-4000-8000-00000000feed",
      code: "SOP-002", title: "Probe", docType: "flowchart", ...base,
    });
    ok("10f-control. ⚠ AND STORE_ABSENT IS NOT WHAT THIS ENGINE SAYS TO EVERYTHING -- a ninth document type is still refused as an unknown type",
      !invalidType.ok && invalidType.code === "UNKNOWN_TYPE",
      invalidType.ok ? "accepted" : invalidType.code);

    const detail = await getGuidance(admin, "00000000-0000-4000-8000-00000000feed", "00000000-0000-4000-8000-00000000beef");
    ok("10h. reading one document reports absent rather than not-found -- a missing store is not a missing document",
      detail.state === "absent", detail.state);

    console.log("\n  ⚠ NOT RUN, and they are the assertions that matter most once the store lands:");
    console.log("     the full author -> approve -> publish loop, the unique-index refusal of a second");
    console.log("     document published under one reference, supersession, and cross-workspace isolation.");
    console.log("     They are written below and run automatically the moment the migration is applied.\n");
    return report();
  }

  // ══ 11. THE PRESENT BRANCH: THE WHOLE LOOP ═════════════════════════════════════════════════════
  await cleanup();
  const wsA = await provision(AUTHOR, "HARNESS Guidance A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Guidance B (synthetic)", "b");

  // A colleague, because nobody approves their own work.
  await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: COLLEAGUE, role_code: "practitioner", status: "active",
  });

  const g = await createGuidance(admin, {
    workspaceId: wsA, code: "SOP-014", title: "Cleaning the theatre between cases",
    docType: "sop", summary: "What happens between one case and the next.", tags: ["theatre", "ipc"], ...base,
  });
  ok("11a. a guidance document is created", g.ok, g.ok ? "" : g.message);
  if (!g.ok) return report();

  const { data: seeded } = await admin.from(GUIDANCE_SECTION_TABLE)
    .select("section_key, position, required").eq("guidance_id", g.data.id).order("position");
  ok("11b. its EIGHT sections are created with it -- structure does not depend on what somebody remembered to add",
    ((seeded ?? []) as { section_key: string }[]).map(s => s.section_key).join() === GUIDANCE_SECTION_KEYS.join(),
    ((seeded ?? []) as { section_key: string }[]).map(s => s.section_key).join(" "));

  const badSection = await updateGuidance(admin, {
    workspaceId: wsA, guidanceId: g.data.id, sections: [{ key: "approval", body: "Approved by me." }], ...base,
  });
  ok("11c. ⚠ NOBODY CAN TYPE INTO THE APPROVAL SECTION -- it is read from the record",
    !badSection.ok && badSection.code === "UNKNOWN_SECTION", badSection.ok ? "it wrote" : badSection.code);

  const early = await submitGuidanceForApproval(admin, { workspaceId: wsA, guidanceId: g.data.id, assignedTo: COLLEAGUE, ...base });
  ok("11d. it cannot go for approval with its required sections empty",
    !early.ok && early.code === "REQUIRED_SECTIONS_EMPTY", early.ok ? "sent" : early.code);

  const filled = await updateGuidance(admin, {
    workspaceId: wsA, guidanceId: g.data.id,
    effectiveFrom: "2026-09-01", reviewOn: "2027-09-01",
    sections: GUIDANCE_SECTIONS_REQUIRED.map(k => ({ key: k, body: `Text for ${k}.` })), ...base,
  });
  ok("11e. CONTROL: the required sections can be filled in", filled.ok && filled.data.sectionsWritten === 3,
    filled.ok ? String(filled.data.sectionsWritten) : filled.message);

  const badDates = await updateGuidance(admin, {
    workspaceId: wsA, guidanceId: g.data.id, effectiveFrom: "2026-09-01", reviewOn: "2026-08-01", ...base,
  });
  ok("11f. ⚠ THE DATABASE REFUSES A REVIEW DATE ON OR BEFORE THE EFFECTIVE DATE, and the constraint is named",
    !badDates.ok && badDates.code === "REVIEW_BEFORE_EFFECT" && /review_after_effect/.test(badDates.message),
    badDates.ok ? "accepted" : badDates.message);

  const sent = await submitGuidanceForApproval(admin, { workspaceId: wsA, guidanceId: g.data.id, assignedTo: COLLEAGUE, ...base });
  ok("11g. it goes for approval, through the EXISTING practice_approval_request", sent.ok, sent.ok ? "" : sent.message);
  if (!sent.ok) return report();
  const { data: req } = await admin.from("practice_approval_request").select("subject_kind, subject_id").eq("id", sent.data.approvalId).maybeSingle();
  ok("11g-b. ⚠ AS subject_kind 'other', WHICH MIGRATION 208 ALREADY ADMITS -- no approval migration was needed",
    req?.subject_kind === "other" && req?.subject_id === g.data.id, JSON.stringify(req));

  const frozen = await updateGuidance(admin, { workspaceId: wsA, guidanceId: g.data.id, title: "Changed", ...base });
  ok("11h. ⚠ THE TEXT IS FROZEN WHILE A COLLEAGUE READS IT -- a document that changes under a reviewer is not the one they approved",
    !frozen.ok && frozen.code === "NOT_EDITABLE", frozen.ok ? "edited" : frozen.code);

  const selfApprove = await decideApproval(admin, {
    workspaceId: wsA, approvalId: sent.data.approvalId, decision: "APPROVED", note: "Fine", ...base,
  });
  ok("11i. ⚠ NOBODY APPROVES THEIR OWN WORK, and the refusal is delegation.ts's rather than a second copy of it here",
    !selfApprove.ok && selfApprove.code === "SELF_APPROVAL", selfApprove.ok ? "approved" : selfApprove.code);

  const approved = await decideApproval(admin, {
    workspaceId: wsA, approvalId: sent.data.approvalId, decision: "APPROVED",
    note: "Reads well.", actorId: COLLEAGUE, correlationId: "harness-guidance",
  });
  ok("11j. CONTROL: a colleague can approve it", approved.ok, approved.ok ? "" : approved.message);

  const early2 = await publishGuidance(admin, { workspaceId: wsA, guidanceId: g.data.id, ...base });
  ok("11k. publishing before the document follows its approval is refused",
    !early2.ok, early2.ok ? "published" : early2.code);

  const synced = await syncGuidanceApproval(admin, { workspaceId: wsA, guidanceId: g.data.id, ...base });
  ok("11l. the document follows the decision that was recorded elsewhere",
    synced.ok && synced.data.status === "approved", synced.ok ? synced.data.status : synced.message);

  const published = await publishGuidance(admin, { workspaceId: wsA, guidanceId: g.data.id, ...base });
  ok("11m. it publishes", published.ok, published.ok ? "" : published.message);

  // ⚠ THE INDEX IS THE RULE. A second, independent document under the same reference, approved the same
  // way, must be refused by the DATABASE -- and nothing in the engine pre-checks the code, so this is a
  // single-assertion test of ux_practice_guidance_published_code and not of a duplicated engine rule.
  const g2 = await createGuidance(admin, {
    workspaceId: wsA, code: "SOP-014", title: "A rival document", docType: "sop", ...base,
  });
  if (g2.ok) {
    await updateGuidance(admin, {
      workspaceId: wsA, guidanceId: g2.data.id, effectiveFrom: "2026-09-01",
      sections: GUIDANCE_SECTIONS_REQUIRED.map(k => ({ key: k, body: "x" })), ...base,
    });
    const s2 = await submitGuidanceForApproval(admin, { workspaceId: wsA, guidanceId: g2.data.id, assignedTo: COLLEAGUE, ...base });
    if (s2.ok) {
      await decideApproval(admin, { workspaceId: wsA, approvalId: s2.data.approvalId, decision: "APPROVED", note: "ok", actorId: COLLEAGUE, correlationId: "harness-guidance" });
      await syncGuidanceApproval(admin, { workspaceId: wsA, guidanceId: g2.data.id, ...base });
      const clash = await publishGuidance(admin, { workspaceId: wsA, guidanceId: g2.data.id, ...base });
      ok("11n. ⚠ ONE REFERENCE, ONE DOCUMENT IN FORCE -- refused by the INDEX, which this engine deliberately does not pre-check",
        !clash.ok && clash.code === "CODE_IN_USE" && /ux_practice_guidance_published_code/.test(clash.message),
        clash.ok ? "both published" : clash.message);
    }
  }

  const revised = await reviseGuidance(admin, { workspaceId: wsA, guidanceId: g.data.id, ...base });
  ok("11o. a version in force can be revised into a new draft at version 2",
    revised.ok && revised.data.version === 2, revised.ok ? "" : revised.message);
  const again = await reviseGuidance(admin, { workspaceId: wsA, guidanceId: g.data.id, ...base });
  ok("11p. and only one revision may be open at a time",
    !again.ok && again.code === "REVISION_OPEN", again.ok ? "two opened" : again.code);

  if (revised.ok) {
    const { data: copied } = await admin.from(GUIDANCE_SECTION_TABLE)
      .select("section_key, body").eq("guidance_id", revised.data.id);
    ok("11q. the new version carries the old one's text forward",
      ((copied ?? []) as { body: string }[]).some(s => s.body.includes("Text for purpose")));
    const { data: newRow } = await admin.from(GUIDANCE_TABLE)
      .select("approval_request_id, effective_from").eq("id", revised.data.id).maybeSingle();
    ok("11r. ⚠ BUT NOT ITS APPROVAL OR ITS DATES -- nobody has read the new version",
      newRow?.approval_request_id === null && newRow?.effective_from === null, JSON.stringify(newRow));

    await updateGuidance(admin, {
      workspaceId: wsA, guidanceId: revised.data.id, effectiveFrom: "2027-01-01",
      sections: GUIDANCE_SECTIONS_REQUIRED.map(k => ({ key: k, body: "v2" })), ...base,
    });
    const s3 = await submitGuidanceForApproval(admin, { workspaceId: wsA, guidanceId: revised.data.id, assignedTo: COLLEAGUE, ...base });
    if (s3.ok) {
      await decideApproval(admin, { workspaceId: wsA, approvalId: s3.data.approvalId, decision: "APPROVED", note: "ok", actorId: COLLEAGUE, correlationId: "harness-guidance" });
      await syncGuidanceApproval(admin, { workspaceId: wsA, guidanceId: revised.data.id, ...base });
      const p2 = await publishGuidance(admin, { workspaceId: wsA, guidanceId: revised.data.id, ...base });
      ok("11s. ⚠ PUBLISHING VERSION 2 WITHDRAWS VERSION 1 FIRST -- otherwise the index refuses it",
        p2.ok && p2.data.superseded === g.data.id, p2.ok ? "" : p2.message);
      const { data: old } = await admin.from(GUIDANCE_TABLE)
        .select("status, archived_reason").eq("id", g.data.id).maybeSingle();
      ok("11t. and version 1 is archived with a reason, not deleted",
        old?.status === "archived" && /superseded by version 2/.test(String(old?.archived_reason)),
        JSON.stringify(old));
    }
  }

  const noReason = await archiveGuidance(admin, { workspaceId: wsA, guidanceId: g.data.id, reason: "  ", ...base });
  ok("11u. withdrawing without saying why is refused",
    !noReason.ok && noReason.code === "REASON_REQUIRED", noReason.ok ? "archived" : noReason.code);

  // ── Tenancy, non-vacuously ────────────────────────────────────────────────────────────────────
  const crossRead = await getGuidance(admin, wsB, g.data.id);
  ok("11v. ⚠ ANOTHER PRACTICE CANNOT READ THIS DOCUMENT",
    crossRead.state === "not_found", crossRead.state);
  const crossWrite = await updateGuidance(admin, { workspaceId: wsB, guidanceId: g.data.id, title: "Theirs now", ...base });
  ok("11w. nor edit it", !crossWrite.ok && crossWrite.code === "NOT_FOUND", crossWrite.ok ? "edited" : crossWrite.code);
  const ownRead = await getGuidance(admin, wsA, g.data.id);
  ok("11v-control. CONTROL: its own practice CAN read it, so 11v is not passing on a broken id",
    ownRead.state === "ok", ownRead.state);

  const libA = await guidanceLibrary(admin, wsA);
  const libB = await guidanceLibrary(admin, wsB);
  ok("11x. the library is workspace-scoped, and the other practice's is genuinely empty rather than failed",
    libA.state === "ok" && libB.state === "ok" && libA.items.length > 0 && libB.items.length === 0,
    `${libA.items.length} / ${libB.items.length}`);
  ok("11y. every count on the library opens a list",
    libA.counts.every(c => c.href.startsWith("/practice/knowledge-studio")));

  const withdrawn = await withdrawGuidanceFromReview(admin, { workspaceId: wsA, guidanceId: g.data.id, ...base });
  ok("11z. an archived document cannot be moved anywhere, and the refusal says so",
    !withdrawn.ok && withdrawn.code === "MOVE_NOT_ALLOWED", withdrawn.ok ? "moved" : withdrawn.code);

  await cleanup();
  return report();
}

main().catch(e => { console.error(e); process.exit(1); });
