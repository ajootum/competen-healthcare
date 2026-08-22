/**
 * CP-OFFLINE-SURVEY-001 s9 item 4 — THE CACHED GUIDANCE LIBRARY.
 *
 * WHAT IT PROVES, taken from the rules rather than from what the code happens to do:
 *   - ONLY `published` DOCUMENTS ARE CACHED, proved against a real database holding a draft, an
 *     in-review and an archived document that must all be absent. The single most important assertion
 *     here: a draft protocol on a device with no connection is indistinguishable from an approved one.
 *   - the status filter is WELDED IN and cannot be widened by a caller.
 *   - no person is named -- not an author, not an owner, not an approver -- searched BY VALUE.
 *   - s3.5  ZERO ENABLED MUTATING CONTROLS, over the real control list.
 *   - hard expiry after OFFLINE_GUIDANCE_MAX_DAYS, and past it the record is WITHHELD AND DELETED.
 *   - a clock earlier than capture means nothing is shown.
 *   - ⚠ the review verdict is computed AT READ TIME: the same stored library answers differently on two
 *     different days. A verdict frozen at capture would read "in date" for the whole week.
 *   - a failed read is never an empty library, and a genuinely empty one still caches.
 *   - no silent cap: what was left behind is counted against the TRUE total and said out loud.
 *
 * ⚠ WHAT THIS HARNESS CANNOT PROVE, STATED SO NOBODY READS ITS GREEN AS COVERING IT.
 * `offline-store.ts` needs `indexedDB`, which node does not have. So the two rules that keep the day and
 * the guidance from destroying each other -- separate AES keys, and META_ACTIVE surviving a day purge --
 * are asserted against the SOURCE TEXT below, not against behaviour. That is weaker than a test and it is
 * the honest state: proving it properly needs a browser, which this repository has no harness for. It is
 * the same gap CP-OFFLINE-SURVEY-001 s5 precondition 1 names for phase two.
 *
 *   npx --yes tsx scripts/practice-offline-guidance-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { offlineGuidancePayload } from "../src/lib/practice/offline-guidance-source";
import {
  OFFLINE_GUIDANCE_MAX_DAYS, OFFLINE_GUIDANCE_SCHEMA_VERSION, OFFLINE_GUIDANCE_DOC_KEYS,
  OFFLINE_GUIDANCE_FORBIDDEN_FIELDS, capOfflineGuidance, enabledMutatingGuidanceControls,
  offlineGuidanceControls, offlineGuidanceExpiry, offlineGuidanceNotice, offlineGuidanceReviewNote,
  offlineGuidanceRow, projectOfflineGuidanceDoc, projectOfflineGuidanceLibrary, readOfflineGuidance,
  type OfflineGuidanceDoc, type OfflineGuidanceLibrary,
} from "../src/lib/practice/offline-guidance";
import { guidanceFieldsNotAllowed } from "../src/lib/practice/offline-store";
import { generateCacheKey, openRecord, sealRecord } from "../src/lib/practice/offline-crypto";
import { KNOWLEDGE_CAPABILITIES } from "../src/lib/practice/knowledge-constants";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const USER = "00000000-0000-4000-8000-00000000fc02";
const TZ = "Africa/Kampala";
const ALL = [KNOWLEDGE_CAPABILITIES.view, KNOWLEDGE_CAPABILITIES.manage, "practice.home.view"];

const ctxFor = (workspaceId: string, caps: string[] = ALL): WorkspaceContext => ({
  // ⚠ THE SAME SYMBOL THE WORKSPACE WAS PROVISIONED WITH, never a fresh literal -- a fixture
  // whose ctx claims one zone while its row holds another tests a state that cannot exist.
  workspaceTimezone: TZ,
  userId: USER, workspaceId, workspaceName: "H", workspaceType: "individual_practice",
  workspaceStatus: "active", roleCodes: ["owner"], capabilities: caps, entitled: true,
  entitlementStatus: "trial", onboardingComplete: true, onboardingStep: null,
  // A fixture stands in for a resolved context; nothing here exercises invalidation.
  contextVersion: "harness",
});

// ⚠ THE VALUES THAT MUST NOT SURVIVE THE PROJECTION, searched for BY VALUE in the serialised record. A
// key-name check alone would miss a field renamed on its way into the cache.
const OWNER_ID = "00000000-0000-4000-8000-00000000fc03";
const DRAFT_BODY = "DRAFT-ONLY-TEXT-must-never-reach-a-device";
const ARCHIVED_REASON = "ARCHIVED-REASON-must-never-reach-a-device";
const PUBLISHED_BODY = "Give oral rehydration solution after each loose stool.";

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", USER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_guidance_section").delete().eq("workspace_id", w.id);
    await admin.from("practice_guidance_document").delete().eq("workspace_id", w.id);
    await admin.from("practice_approval_request").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", USER);
  await admin.from("provisioning_request").delete().eq("target_user_id", USER);
  await purgeWorkspacesOwnedBy(admin, [USER], { quiet: true });
}

/** Every key at every depth, so a forbidden field cannot hide inside a nested object. */
function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) { for (const v of value) allKeys(v, into); return into; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { into.add(k); allKeys(v, into); }
  }
  return into;
}

/**
 * A stub PostgREST client.
 *
 * ⚠ IT IS A THENABLE, AND THAT IS THE WHOLE POINT. A previous harness in this repository stubbed a chain
 * that terminated on `.limit()` while the function under test awaited the chain one call earlier;
 * awaiting a plain object resolves to the object, `error` came back undefined, and the failing probe
 * "succeeded". Every link here is chainable AND awaitable, so it produces the failure wherever the real
 * code stops chaining.
 */
function stubClient(answer: { data: unknown; error: unknown }) {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a self-referential chain stub cannot
     be typed without describing the whole PostgREST builder, which would be a fixture bigger than the
     thing it tests. */
  const node: any = {
    select: () => node, eq: () => node, in: () => node, order: () => node, limit: () => node,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(answer).then(resolve),
  };
  return { from: () => node };
}

function makeDoc(over: Partial<OfflineGuidanceDoc> = {}): OfflineGuidanceDoc {
  return {
    id: over.id ?? "d1", code: over.code ?? "SOP-001", title: over.title ?? "Diarrhoea in under-fives",
    summary: over.summary ?? null, docType: over.docType ?? "protocol", specialty: over.specialty ?? null,
    version: over.version ?? 1, effectiveFrom: over.effectiveFrom ?? "2026-01-01",
    reviewOn: over.reviewOn ?? null,
    sections: over.sections ?? [{ key: "purpose", heading: "Purpose", body: PUBLISHED_BODY, position: 1 }],
  };
}

async function main() {
  console.log("\n=== OFFLINE GUIDANCE CACHE (CP-OFFLINE-SURVEY-001 s9 item 4) ===\n");
  await cleanup();

  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-offguide-${Date.now()}`, request_type: "pilot",
    actor_user_id: USER, target_user_id: USER, payload_hash: "harness", correlation_id: "harness-offguide",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "Harness Guidance", countryCode: "UG", timezone: TZ,
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req!.id, target_user_id: USER, correlation_id: "harness-offguide", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { console.error("provisioning failed:", run.errorCode); process.exitCode = 1; return; }
  const workspaceId = run.workspaceId;
  const ctx = ctxFor(workspaceId);

  // ── FIXTURE: four documents, one of each state that matters ──────────────────────────────────────
  // `published` requires effective_from AND approval_request_id (constraint practice_guidance_in_force),
  // so the approval is part of the fixture rather than an optional extra.
  const { data: approval } = await admin.from("practice_approval_request").insert({
    workspace_id: workspaceId, requested_by: USER, subject_kind: "other",
    summary: "harness guidance approval", urgency: "routine",
  }).select("id").single();

  const { data: pub, error: pubErr } = await admin.from("practice_guidance_document").insert({
    workspace_id: workspaceId, code: "SOP-001", title: "Diarrhoea in under-fives",
    summary: "Assessment and oral rehydration.", doc_type: "protocol", specialty: "Paediatrics",
    owner_id: OWNER_ID, created_by: OWNER_ID, status: "published", version: 2,
    approval_request_id: approval!.id, effective_from: "2026-01-01", review_on: "2026-06-01",
    published_at: new Date().toISOString(),
  }).select("id").single();
  ok("0a-control. the fixture PUBLISHED document was created", !!pub && !pubErr, pubErr?.message ?? "");
  if (!pub) { await cleanup(); report(); return; }

  const { data: draft } = await admin.from("practice_guidance_document").insert({
    workspace_id: workspaceId, code: "SOP-002", title: "Draft protocol",
    doc_type: "protocol", status: "draft", created_by: OWNER_ID,
  }).select("id").single();
  const { data: inReview } = await admin.from("practice_guidance_document").insert({
    workspace_id: workspaceId, code: "SOP-003", title: "In review protocol",
    doc_type: "protocol", status: "in_review", created_by: OWNER_ID,
  }).select("id").single();
  const { data: archived } = await admin.from("practice_guidance_document").insert({
    workspace_id: workspaceId, code: "SOP-004", title: "Withdrawn protocol",
    doc_type: "protocol", status: "archived", created_by: OWNER_ID,
    archived_at: new Date().toISOString(), archived_reason: ARCHIVED_REASON,
  }).select("id").single();
  // An empty-bodied published document: it must be dropped rather than cached as a shell.
  const { data: hollow } = await admin.from("practice_guidance_document").insert({
    workspace_id: workspaceId, code: "SOP-005", title: "Published with nothing written",
    doc_type: "sop", status: "published", created_by: OWNER_ID,
    approval_request_id: approval!.id, effective_from: "2026-01-01",
  }).select("id").single();

  ok("0b-control. the three non-published fixtures exist, so their absence below means something",
    !!draft && !!inReview && !!archived,
    `draft=${!!draft} inReview=${!!inReview} archived=${!!archived}`);
  ok("0c-control. a published document with no body exists too", !!hollow);

  await admin.from("practice_guidance_section").insert([
    { workspace_id: workspaceId, guidance_id: pub.id, section_key: "purpose", heading: "Purpose", body: PUBLISHED_BODY, position: 1 },
    { workspace_id: workspaceId, guidance_id: pub.id, section_key: "scope", heading: "Scope", body: "  ", position: 2 },
    { workspace_id: workspaceId, guidance_id: draft!.id, section_key: "purpose", heading: "Purpose", body: DRAFT_BODY, position: 1 },
    { workspace_id: workspaceId, guidance_id: hollow!.id, section_key: "purpose", heading: "Purpose", body: "   ", position: 1 },
  ]);

  // ── 1. ONLY PUBLISHED, AND NOTHING ELSE ──────────────────────────────────────────────────────────
  const built = await offlineGuidancePayload(admin, ctx, { timezone: TZ });
  ok("1a. the payload was assembled", built.ok, built.ok ? "" : built.reason);
  if (!built.ok) { await cleanup(); report(); return; }
  const lib = built.library;

  ok("1b. exactly one document is cached -- the published one with a body",
    lib.documents.length === 1 && lib.documents[0].id === pub.id,
    lib.documents.map(d => `${d.code}/${d.title}`).join(", "));

  const serialised = JSON.stringify(lib);
  ok("1c. ⚠ THE DRAFT'S TEXT IS PHYSICALLY ABSENT", !serialised.includes(DRAFT_BODY));
  ok("1d. the archived document's reason is absent", !serialised.includes(ARCHIVED_REASON));
  ok("1e. no document id other than the published one appears",
    !serialised.includes(draft!.id) && !serialised.includes(inReview!.id) && !serialised.includes(archived!.id));
  ok("1f. a published document with nothing written in it is dropped, not cached as a shell",
    !serialised.includes(hollow!.id));

  // ── 2. NOBODY IS NAMED ───────────────────────────────────────────────────────────────────────────
  ok("2a. ⚠ no person id survives the projection -- searched by value",
    !serialised.includes(OWNER_ID));
  const keys = allKeys(lib);
  const leaked = OFFLINE_GUIDANCE_FORBIDDEN_FIELDS.filter(f => keys.has(f));
  ok("2b. not one forbidden field name appears at any depth", leaked.length === 0, leaked.join(", "));
  ok("2c-control. the record DOES carry the fields it is supposed to",
    !!lib.documents[0].code && !!lib.documents[0].title && lib.documents[0].sections.length > 0);
  ok("2d. the blank section on the published document was dropped, not stored as an empty body",
    lib.documents[0].sections.length === 1 && lib.documents[0].sections[0].key === "purpose",
    lib.documents[0].sections.map(s => s.key).join(", "));

  // ── 3. THE STATUS FILTER IS WELDED IN ────────────────────────────────────────────────────────────
  // ⚠ The needle is built by concatenation so it cannot match this comment or its own explanation --
  // two harnesses in this repository have previously matched their own prose about what they searched for.
  const source = readFileSync("src/lib/practice/offline-guidance-source.ts", "utf8");
  const needle = ".eq(" + '"status"' + ", " + '"published"' + ")";
  ok("3a. the source pins status to published literally", source.includes(needle));
  ok("3b. ⚠ and takes no status parameter that could widen it",
    !/status\s*[?:]\s*string/.test(source) && !/opts\.status/.test(source));
  // ⚠ COMMENTS STRIPPED FIRST. The first version of this line searched the raw file for
  // "guidanceLibrary(" and went red against a module that never calls it -- the header explains at length
  // WHY it does not, and the explanation contains the name five times. A needle that matches its own
  // documentation can only ever fail.
  const sourceCode = source.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok("3c. it does not call guidanceLibrary(), whose status IS a caller option",
    !sourceCode.includes("guidanceLibrary"));
  ok("3d-control. stripping comments did not empty the file", sourceCode.includes(needle));

  // ── 4. ZERO ENABLED MUTATING CONTROLS (s3.5) ─────────────────────────────────────────────────────
  const controls = offlineGuidanceControls(lib.documents[0]);
  ok("4a. ⚠ no mutating control is enabled offline",
    enabledMutatingGuidanceControls(controls).length === 0,
    enabledMutatingGuidanceControls(controls).map(c => c.key).join(", "));
  ok("4b-control. there ARE mutating controls to disable, so 4a is not vacuous",
    controls.filter(c => c.mutating).length >= 3);
  ok("4c. every disabled control says why", controls.filter(c => !c.enabled).every(c => !!c.reason));
  ok("4d-control. the read control is enabled -- the screen is not simply dead",
    controls.some(c => !c.mutating && c.enabled));

  // ── 5. EXPIRY: DELETED, NOT HIDDEN ───────────────────────────────────────────────────────────────
  const asOf = lib.asOf;
  ok("5a. the expiry is MAX_DAYS after capture",
    lib.expiresAt === offlineGuidanceExpiry(asOf) &&
    Math.round((Date.parse(lib.expiresAt) - Date.parse(asOf)) / 86_400_000) === OFFLINE_GUIDANCE_MAX_DAYS);

  const justBefore = readOfflineGuidance(lib, new Date(Date.parse(lib.expiresAt) - 1));
  const atExpiry = readOfflineGuidance(lib, new Date(Date.parse(lib.expiresAt)));
  ok("5b-control. one millisecond before expiry it still reads", justBefore.state === "ok");
  ok("5c. at expiry it is withheld AND marked for deletion",
    atExpiry.state === "expired" && atExpiry.purge === true);
  ok("5d. and the reason names what happened, in a sentence",
    atExpiry.state === "expired" && /has not reached the practice/i.test(atExpiry.reason));

  const rolledBack = readOfflineGuidance(lib, new Date(Date.parse(asOf) - 60_000));
  ok("5e. a clock earlier than capture shows nothing", rolledBack.state === "clock_rollback");
  ok("5f. ⚠ and does NOT purge -- a wrong clock is not a reason to destroy the copy",
    rolledBack.state === "clock_rollback" && rolledBack.purge === false);

  const wrongSchema = readOfflineGuidance(
    { ...lib, schemaVersion: OFFLINE_GUIDANCE_SCHEMA_VERSION + 1 }, new Date(Date.parse(asOf) + 1000));
  ok("5g. a record from another schema is discarded, never guessed at",
    wrongSchema.state === "wrong_schema" && wrongSchema.purge === true);

  // ── 6. ⚠ THE REVIEW VERDICT IS COMPUTED AT READ TIME ─────────────────────────────────────────────
  // The assertion that stops the verdict being frozen into the record: ONE stored library, TWO answers.
  const dated = makeDoc({ reviewOn: "2026-06-01" });
  const before = offlineGuidanceRow(dated, new Date("2026-05-30T09:00:00+03:00"), TZ);
  const after = offlineGuidanceRow(dated, new Date("2026-06-02T09:00:00+03:00"), TZ);
  ok("6a. the same document is in date before its review date", before.reviewOverdue === false);
  ok("6b. ⚠ and overdue after it, from the identical stored record", after.reviewOverdue === true);
  ok("6c. an overdue document still says it has NOT been withdrawn",
    /has not been withdrawn/i.test(offlineGuidanceReviewNote(after) ?? ""));
  ok("6d. a document with no review date says so rather than passing silently",
    /No review date is set/i.test(offlineGuidanceReviewNote(offlineGuidanceRow(makeDoc({ reviewOn: null }), new Date(), TZ)) ?? ""));
  ok("6e-control. a document in date produces no note at all", offlineGuidanceReviewNote(before) === null);

  // ⚠ THE PRACTICE'S ZONE DECIDES, AND THE INSTANT IS CHOSEN SO THE TWO ANSWERS DIFFER.
  // Kampala is UTC+3, so at 2026-05-31T22:00Z it is already 2026-06-01 there while UTC still says
  // 2026-05-31. Against a review date of 2026-05-31 the practice calendar says OVERDUE and a device
  // computing in UTC says not yet -- so `true` here can only come from the practice's zone.
  // (The first version of this assertion picked an instant that had already rolled over in BOTH zones,
  // which proved nothing and failed correct code.)
  const edge = offlineGuidanceRow(makeDoc({ reviewOn: "2026-05-31" }), new Date("2026-05-31T22:00:00Z"), TZ);
  ok("6f. the verdict uses the PRACTICE's calendar, not the device's", edge.reviewOverdue === true);
  ok("6g-control. the same instant read in UTC gives the opposite answer, so 6f is not a tautology",
    offlineGuidanceRow(makeDoc({ reviewOn: "2026-05-31" }), new Date("2026-05-31T22:00:00Z"), "UTC")
      .reviewOverdue === false);

  // ── 7. THE STALENESS SENTENCE NAMES THE REAL HAZARD ──────────────────────────────────────────────
  const fresh = offlineGuidanceNotice(asOf, TZ, new Date(Date.parse(asOf) + 60_000));
  const old = offlineGuidanceNotice(asOf, TZ, new Date(Date.parse(asOf) + 5 * 86_400_000));
  ok("7a. it says what could have changed -- revised or withdrawn",
    /revised or withdrawn/i.test(fresh.sentence));
  ok("7b. it never claims the content is current",
    ![fresh.sentence, old.sentence].some(s => /\b(up to date|current|latest|synced|saved)\b/i.test(s)));
  ok("7c. the tone escalates with age", fresh.tone === "amber" && old.tone === "red");
  ok("7d. the stamp is absolute, not a bare relative age", /\d{2}:\d{2}/.test(fresh.atLabel));

  // ── 8. NO SILENT CAP ─────────────────────────────────────────────────────────────────────────────
  const many = Array.from({ length: 5 }, (_, i) => makeDoc({ id: `m${i}`, code: `C-${i}` }));
  const capped = capOfflineGuidance(many, { maxDocuments: 2 });
  ok("8a. the cap keeps what it says it keeps", capped.documents.length === 2);
  ok("8b. ⚠ and REPORTS what it left behind", capped.dropped?.count === 3);
  ok("8c. the reason is a sentence, not a number", /not on this device/i.test(capped.dropped?.reason ?? ""));
  ok("8d-control. under the cap, nothing is reported as dropped",
    capOfflineGuidance(many.slice(0, 2), { maxDocuments: 2 }).dropped === null);
  // ⚠ totalAvailable, not docs.length: the server reads all metadata but bodies only for a slice, so the
  // drop count must reflect what the practice actually holds.
  const slice = capOfflineGuidance(many.slice(0, 2), { maxDocuments: 60, totalAvailable: 400 });
  ok("8e. ⚠ the drop count is against the TRUE total, not the slice it was handed",
    slice.dropped?.count === 398, String(slice.dropped?.count));
  const byBytes = capOfflineGuidance(many, { maxBytes: 1 });
  ok("8f. a byte cap keeps at least one document rather than returning nothing",
    byBytes.documents.length === 1 && byBytes.dropped?.count === 4);

  // ── 9. A FAILED READ IS NEVER AN EMPTY LIBRARY ───────────────────────────────────────────────────
  const failed = await offlineGuidancePayload(
    stubClient({ data: null, error: { message: "boom", code: "57014" } }), ctx, { timezone: TZ });
  ok("9a. ⚠ a read that errored refuses -- it does not cache an empty shelf", failed.ok === false);
  const nullish = await offlineGuidancePayload(
    stubClient({ data: null, error: null }), ctx, { timezone: TZ });
  ok("9b. ⚠ neither rows nor an error is ALSO a failure", nullish.ok === false);
  const genuinelyEmpty = await offlineGuidancePayload(
    stubClient({ data: [], error: null }), ctx, { timezone: TZ });
  ok("9c-control. a practice that genuinely has no guidance DOES cache, and says so honestly",
    genuinelyEmpty.ok === true && genuinelyEmpty.library.documents.length === 0);
  ok("9d. the refusal explains itself to a person",
    failed.ok === false && /could not be read/i.test(failed.reason));

  // ── 10. THE CAPABILITY GATE ──────────────────────────────────────────────────────────────────────
  const noCap = await offlineGuidancePayload(admin, ctxFor(workspaceId, ["practice.home.view"]), { timezone: TZ });
  ok("10a. without document.view nothing is stored", noCap.ok === false);
  ok("10b-control. WITH it, the same call succeeds -- so 10a is the capability, not a broken fixture",
    (await offlineGuidancePayload(admin, ctxFor(workspaceId, [KNOWLEDGE_CAPABILITIES.view]), { timezone: TZ })).ok === true);
  ok("10c. the capability is an existing code, not a newly minted one",
    KNOWLEDGE_CAPABILITIES.view === "document.view");

  // ── 11. THE ALLOW-LIST IS RE-APPLIED AT THE WRITE ────────────────────────────────────────────────
  const dirty = { ...lib, documents: [{ ...lib.documents[0], owner_id: OWNER_ID }] } as unknown as OfflineGuidanceLibrary;
  ok("11a. a payload carrying a field nobody allowed is REFUSED, not trimmed",
    guidanceFieldsNotAllowed(dirty).some(f => f.includes("owner_id")));
  ok("11b-control. the clean payload passes the same check", guidanceFieldsNotAllowed(lib).length === 0);
  ok("11c. the doc key list and the type agree",
    OFFLINE_GUIDANCE_DOC_KEYS.every(k => k in lib.documents[0]));

  // ── 12. SEALING ROUND TRIP ───────────────────────────────────────────────────────────────────────
  const key = await generateCacheKey();
  const sealed = await sealRecord(key, lib);
  const opened = await openRecord<OfflineGuidanceLibrary>(key, sealed);
  ok("12a. what was sealed comes back identical", JSON.stringify(opened) === JSON.stringify(lib));
  ok("12b. ⚠ and the plaintext is not lying in the sealed record",
    !JSON.stringify(sealed).includes(PUBLISHED_BODY));

  // ── 13. THE TWO CACHES DO NOT DESTROY EACH OTHER (SOURCE-LEVEL -- see the header) ────────────────
  const store = readFileSync("src/lib/practice/offline-store.ts", "utf8");
  // ⚠ BOUNDED BY THE NEXT EXPORT, NOT BY A NAMED ONE. The first version sliced from purgeOfflineDay to
  // `lastCachedWorkspace` -- and then the guidance functions were added BETWEEN them, so the slice
  // silently grew to include four functions that legitimately write to the guidance store, and the
  // assertion failed against correct code. A boundary that a later edit can move is not a boundary.
  const dayPurgeStart = store.indexOf("export async function purgeOfflineDay");
  const dayPurgeEnd = store.indexOf("\nexport ", dayPurgeStart + 1);
  const dayPurge = store.slice(dayPurgeStart, dayPurgeEnd);
  ok("13-control. the sliced function is purgeOfflineDay alone",
    dayPurgeStart > 0 && dayPurgeEnd > dayPurgeStart && dayPurge.split("export ").length === 2,
    `${dayPurge.length} chars`);
  // ⚠ "DOES NOT WRITE TO", NOT "DOES NOT MENTION". purgeOfflineDay READS the guidance store — that is how
  // it decides whether META_ACTIVE may go — so a mention is expected and correct. The property that
  // matters is that it never opens it for writing, because only a readwrite transaction can delete.
  // ⚠ THE POINTER RULE MOVED, AND 13a2 IS THE CONTROL THAT CAUGHT IT MOVING.
  //
  // The check used to be written out inside purgeOfflineDay: read STORE_GUIDANCE, and delete META_ACTIVE
  // only `if (!guidance)`. When the CLINICAL cache arrived that hand-written check became wrong -- it
  // looked at one other store when there were now two -- so it was replaced by dropPointerIfOrphaned(),
  // which asks every sealed store except the one just emptied.
  //
  // ⚠ AND THAT MADE 13a PASS FOR THE WRONG REASON. purgeOfflineDay no longer MENTIONS the guidance store,
  // so "it never opens it for writing" became vacuously true -- an assertion that would keep passing if
  // the pointer logic were deleted outright. 13a2-control failed, which is precisely what a control is
  // for, and the answer is to point the assertions at where the property now lives rather than to relax
  // them.
  const pointerStart = store.indexOf("async function dropPointerIfOrphaned");
  const pointerEnd = store.indexOf("\nexport ", pointerStart + 1);
  const pointer = store.slice(pointerStart, pointerEnd);
  ok("13-control-b. the sliced helper is dropPointerIfOrphaned alone",
    pointerStart > 0 && pointerEnd > pointerStart && !pointer.includes("\nexport "),
    `${pointer.length} chars`);

  ok("13a. ⚠ neither the day purge nor the pointer helper opens the guidance store for writing",
    !/STORE_GUIDANCE(_KEY)?,\s*"readwrite"/.test(dayPurge)
    && !/STORE_GUIDANCE(_KEY)?,\s*"readwrite"/.test(pointer),
    "the nightly day expiry would delete a week of protocols");
  ok("13a-control. the regex does catch a readwrite on that store when there is one",
    /STORE_GUIDANCE(_KEY)?,\s*"readwrite"/.test('tx(db, STORE_GUIDANCE, "readwrite", s => s.delete(x))'),
    "13a would pass against any string at all");
  ok("13a2-control. the pointer helper DOES read the guidance store -- otherwise 13b is vacuous",
    /STORE_GUIDANCE/.test(pointer) && /"readonly"/.test(pointer));

  // ⚠ THE PROPERTY, NOT THE OLD SPELLING. `if (!guidance)` was one store's version of "something still
  // needs this pointer". What has to be true now is stronger: the helper consults EVERY sealed store and
  // returns without deleting the moment any of them still holds a record.
  ok("13b. ⚠ nor is META_ACTIVE deleted unconditionally -- every other cache needs that pointer",
    pointer.includes("SEALED_STORES") && /if\s*\(held\)\s*return;/.test(pointer)
    && pointer.includes("META_ACTIVE"),
    "an unconditional delete orphans a valid guidance or clinical cache every midnight");
  ok("13b2. ⚠ and the day, the guidance AND the clinical pack are all in that list",
    /SEALED_STORES\s*=\s*\[\s*STORE_DAY,\s*STORE_GUIDANCE,\s*STORE_CLINICAL\s*\]/.test(pointer),
    "a cache missing from the list is a cache the pointer can be pulled out from under");
  ok("13c. guidance has its own key store, separate from the day's",
    store.includes("STORE_GUIDANCE_KEY") && store.includes('const STORE_KEY = "key"'));

  // ⚠ NOT `DB_VERSION === 2` ANY MORE, AND NOT `=== 3` EITHER. Pinning the number means the assertion
  // fails every time a store is legitimately added -- it was pinned at 2, the clinical stores arrived,
  // and it failed against correct code. The number is not the property. THE PROPERTY IS THAT EVERY
  // DECLARED STORE IS CREATED IN THE UPGRADE HANDLER, which is what the version bump exists to trigger.
  const declaredStores = [...store.matchAll(/const (STORE_[A-Z_]+) = /g)].map(m => m[1]);
  const upgradeBody = store.slice(store.indexOf("onupgradeneeded"), store.indexOf("req.onsuccess"));
  const uncreated = declaredStores.filter(s => !upgradeBody.includes(`contains(${s})`));
  ok("13d. every declared object store is created in onupgradeneeded",
    declaredStores.length >= 6 && uncreated.length === 0,
    uncreated.length ? `never created: ${uncreated.join(", ")}` : `${declaredStores.length} stores`);
  ok("13d-control. the check can actually see the store names",
    declaredStores.includes("STORE_GUIDANCE") && declaredStores.includes("STORE_CLINICAL"),
    "13d would pass over an empty list");
  ok("13e. the switch-off path purges the WORKSPACE, not just the day",
    readFileSync("src/app/practice/(shell)/OfflineCacheWriter.tsx", "utf8").includes("purgeOfflineWorkspace("));

  // ── 14. THE PROJECTION IS FIELD BY FIELD ─────────────────────────────────────────────────────────
  const projected = projectOfflineGuidanceDoc(
    { id: "x", code: "C", title: "T", summary: null, doc_type: "sop", specialty: null, version: 1,
      effective_from: null, review_on: null, updated_at: null,
      // Fields the source row carries that must not survive. A spread would take them.
      ...({ owner_id: OWNER_ID, created_by: OWNER_ID, status: "published", archived_reason: "x" } as object) },
    [{ guidance_id: "x", section_key: "purpose", heading: "H", body: "B", position: 1 }]);
  ok("14a. ⚠ extra columns on the source row do not survive the projection",
    !JSON.stringify(projected).includes(OWNER_ID) && !("status" in projected));
  ok("14b. sections are ordered by position, not by arrival",
    projectOfflineGuidanceDoc(
      { id: "y", code: "C", title: "T", summary: null, doc_type: "sop", specialty: null, version: 1,
        effective_from: null, review_on: null, updated_at: null },
      [{ guidance_id: "y", section_key: "b", heading: "B", body: "b", position: 2 },
       { guidance_id: "y", section_key: "a", heading: "A", body: "a", position: 1 }],
    ).sections.map(s => s.key).join(",") === "a,b");
  ok("14c. the library projection stamps the schema version",
    projectOfflineGuidanceLibrary({
      workspaceId: "w", timezone: TZ, asOf: asOf, documents: [], documentsUnavailable: false, dropped: null,
    }).schemaVersion === OFFLINE_GUIDANCE_SCHEMA_VERSION);

  await cleanup();
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
