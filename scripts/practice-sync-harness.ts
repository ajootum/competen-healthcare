/**
 * PHASE TWO, PRECONDITION 3 — IDEMPOTENT SERVER ACCEPTANCE, over migration 284.
 *
 * WHAT IT PROVES, against a real database:
 *   - ⚠ THE HEADLINE: applying the same transaction twice applies it ONCE and answers the same way
 *     twice. The applier is counted, so a second apply is caught by evidence rather than by a status.
 *   - ⚠ `retryable` IS NOT `status`. A ledger that will not read and an applier that throws come back
 *     retryable, so the device marks them `failed` and keeps trying -- conflating them with `refused`
 *     would abandon a real consultation over a database blip.
 *   - a transient failure writes NO ledger row, so the retry re-checks instead of being told it is done.
 *   - the ledger is written AFTER the apply, never before.
 *   - ordering: a batch is applied by client sequence whatever order it arrives in.
 *   - migration 284's constraints hold: an update with no base version, a create with one, a blank
 *     refusal reason, and an unknown status are all refused BY THE DATABASE.
 *   - ⚠ the applier registry ships EMPTY, and an upload of any entity type is refused BY NAME.
 *
 *   npx --yes tsx scripts/practice-sync-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync } from "node:fs";
import {
  SYNC_APPLIERS, SYNC_ENTITY_TYPES, SYNC_MAX_BATCH, SYNC_TABLE,
  applyBatch, applyTransaction, syncStatus, validateTransaction,
  type SyncApplier, type SyncTransaction,
} from "../src/lib/practice/sync-engine";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter } from "../src/lib/practice/encounters";
import { ENCOUNTER_ENTITY_TYPE, FOLLOWUP_ENTITY_TYPE } from "../src/lib/practice/sync-appliers/entity-types";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const USER = "00000000-0000-4000-8000-00000000fc04";
const uuid = () => crypto.randomUUID();

const ctxFor = (workspaceId: string): WorkspaceContext => ({
  userId: USER, workspaceId, workspaceName: "H", workspaceType: "individual_practice",
  workspaceStatus: "active", roleCodes: ["owner"], capabilities: ["encounter.list", "encounter.record"],
  entitled: true, entitlementStatus: "trial", onboardingComplete: true, onboardingStep: null,
});

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", USER);
  for (const w of (ws ?? []) as { id: string }[])
    await admin.from(SYNC_TABLE).delete().eq("workspace_id", w.id);
  await admin.from("practice_practitioner_identity").delete().eq("user_id", USER);
  await admin.from("provisioning_request").delete().eq("target_user_id", USER);
  await purgeWorkspacesOwnedBy(admin, [USER], { quiet: true });
}

const tx = (over: Partial<SyncTransaction> = {}): SyncTransaction => ({
  id: over.id ?? uuid(), deviceId: over.deviceId ?? "device-a",
  entityType: over.entityType ?? "harness_note", entityId: over.entityId ?? uuid(),
  operation: over.operation ?? "create", payload: over.payload ?? { text: "a clinical note" },
  baseVersion: over.baseVersion === undefined ? null : over.baseVersion,
  clientSequence: over.clientSequence ?? 1,
  occurredAt: over.occurredAt ?? new Date("2026-08-06T10:00:00.000Z").toISOString(),
  payloadHash: over.payloadHash ?? null,
});

/** ⚠ Registered by the HARNESS, never shipped. Counts calls so a duplicate apply is caught by evidence. */
let applyCalls = 0;
const counting: SyncApplier = async () => { applyCalls++; return { ok: true, version: 1 }; };
const throwing: SyncApplier = async () => { applyCalls++; throw new Error("the database went away"); };
const conflicting: SyncApplier = async () => ({
  ok: false, conflict: true, code: "VERSION_CONFLICT",
  message: "Somebody changed this record while you were offline.", currentVersion: 7,
});
const refusing: SyncApplier = async () => ({
  ok: false, code: "NOT_ALLOWED", message: "This account may not record that.",
});

async function main() {
  console.log("\n=== PHASE TWO: IDEMPOTENT SERVER ACCEPTANCE (precondition 3) ===\n");
  await cleanup();

  // ── 0. THE SHIPPED STATE ─────────────────────────────────────────────────────────────────────────
  // ⚠⚠ THIS PINNED "EMPTY" AND THE PROPERTY WAS NEVER EMPTINESS -- it was "NO SPECULATIVE WRITE PATH
  // INTO THE RECORD", which its own name says. The registry was empty only because no capture existed.
  // Registering the first real applier, once all seven preconditions held, turned it red against exactly
  // the work it was written to permit. THIRD TIME IN THIS REPOSITORY that a tally was pinned in place of
  // a property; see harness-assertion-shapes.
  //
  // The real rule, from sync-engine.ts's own header: "adding an applier without a capture screen that
  // produces it creates a write path into the patient record that nothing exercises." So: every
  // registered entity type must have a PRODUCER -- something that actually enqueues it.
  //
  // ⚠ IT MATCHES THE CONSTANT AS WELL AS THE LITERAL, and that is not leniency. A producer that hard-codes
  // "parameter_measurement" would be a second source of truth for the entity type, and the two could
  // drift silently -- uploads refused as ENTITY_NOT_SYNCABLE for a type the registry does say it takes.
  // Importing the constant is the CORRECT shape, so the assertion has to recognise it.
  //
  // ⚠⚠ IMPORT LINES ARE STRIPPED, AND A BREAK TEST IS WHY. The first version scanned the whole file, so
  // changing the producer's `entityType:` to something unregistered LEFT IT GREEN -- the constant was
  // still named on the `import` line at the top. The assertion was matching the import rather than the
  // use, which is the same family as a needle matching its own documentation. It now reads only the code
  // that does something.
  const producers = readFileSync("src/lib/practice/offline-capture.ts", "utf8")
    .split(/\r?\n/).filter(l => !/^\s*import\b/.test(l)).join("\n");
  const applierDir = "src/lib/practice/sync-appliers";
  const constantsByValue = new Map<string, string>();
  for (const f of readdirSync(applierDir)) {
    if (!f.endsWith(".ts")) continue;
    const src = readFileSync(`${applierDir}/${f}`, "utf8");
    for (const m of src.matchAll(/export const ([A-Z_]+ENTITY_TYPE) = "([^"]+)"/g))
      constantsByValue.set(m[2], m[1]);
  }
  const orphaned = SYNC_ENTITY_TYPES.filter(t => {
    const constant = constantsByValue.get(t);
    return !producers.includes(`"${t}"`) && !(constant && producers.includes(constant));
  });
  ok("0a. ⚠ every registered applier has a producer -- no speculative write path into the record",
    orphaned.length === 0,
    orphaned.length ? `no capture path enqueues: ${orphaned.join(", ")}` : SYNC_ENTITY_TYPES.join(", "));
  ok("0a-control. there is at least one registered applier, so 0a is not scanning an empty list",
    SYNC_ENTITY_TYPES.length > 0);

  // ── ⚠⚠ 0d. NO "use client" MODULE MAY REACH A SERVER-ONLY API, TRANSITIVELY ──────────────────────
  //
  // This exists because it happened. offline-capture.ts is "use client" and imported ONE STRING -- the
  // entity type -- from parameter-measurement.ts. An import pulls the module, not the binding, so the
  // browser bundle transitively required parameters.ts -> access.ts -> next/headers, and BOTH
  // /practice/offline and the parameters route answered 500.
  //
  // ⚠ tsc WAS CLEAN. eslint WAS CLEAN. EVERY HARNESS WAS GREEN. Only a real request found it. This is
  // the "clean tsc, clean eslint, clean harness, dead page" failure this repository has already lost a
  // board to, and a CONSTANT is what carried it in -- it looked far too small to be dangerous.
  //
  // So the graph is walked rather than trusted.
  const SERVER_ONLY = ["next/headers", "next/server", "server-only"];
  const resolveModule = (spec: string): string | null => {
    if (!spec.startsWith("@/")) return null;
    const base = `src/${spec.slice(2)}`;
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      try { readFileSync(base + ext, "utf8"); return base + ext; } catch { /* try the next */ }
    }
    return null;
  };
  const reaches = (entry: string): string[] => {
    const seen = new Set<string>();
    const stack = [entry];
    const bad: string[] = [];
    while (stack.length) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      let src: string;
      try { src = readFileSync(file, "utf8"); } catch { continue; }
      for (const s of SERVER_ONLY) if (src.includes(`"${s}"`)) bad.push(`${file} -> ${s}`);
      // ⚠ `import type` is ERASED at build time and cannot drag a module into a bundle. Counting it
      // would make this assertion fire on perfectly safe type-only references and get it disabled.
      for (const m of src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+"(@\/[^"]+)"/gm)) {
        const next = resolveModule(m[1]);
        if (next) stack.push(next);
      }
    }
    return bad;
  };
  // ⚠ EVERY BROWSER MODULE IN THE OFFLINE PATH, not just the one that broke. The uploader is the newest
  // and the most tempting to get wrong: it needs SYNC_MAX_BATCH, which lives in sync-engine.ts -- the
  // very module whose import chain reaches next/headers. That is why sync-limits.ts exists.
  const CLIENT_MODULES = [
    "src/lib/practice/offline-capture.ts",
    "src/lib/practice/sync-uploader.ts",
    "src/lib/practice/offline-store.ts",
    "src/lib/practice/outbox-store.ts",
  ];
  const clientReaches = CLIENT_MODULES.flatMap(m => reaches(m).map(r => `${m} :: ${r}`));
  ok("0d. ⚠⚠ no browser module reaches a server-only API, however far down the import graph",
    clientReaches.length === 0, clientReaches.join(" | "));
  ok("0d-control. the walker does find one when there is one to find",
    reaches("src/lib/practice/sync-appliers/parameter-measurement.ts").length > 0,
    "the graph walk is not following imports at all, so 0d proves nothing");
  ok("0d-control-b. and every module in the list actually exists to be walked",
    CLIENT_MODULES.every(m => { try { readFileSync(m, "utf8"); return true; } catch { return false; } }),
    "a renamed module would let 0d pass by reading nothing");
  const unknown = validateTransaction(tx());
  ok("0b. so an upload is refused, and the refusal NAMES the type",
    !unknown.ok && unknown.code === "ENTITY_NOT_SYNCABLE" && unknown.message.includes("harness_note"));
  ok("0c. ⚠ and tells the practitioner it is still on their device",
    !unknown.ok && /still on this device and has not been lost/i.test(unknown.message));

  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-sync-${Date.now()}`, request_type: "pilot",
    actor_user_id: USER, target_user_id: USER, payload_hash: "harness", correlation_id: "harness-sync",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "Harness Sync", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req!.id, target_user_id: USER, correlation_id: "harness-sync", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { console.error("provisioning failed:", run.errorCode); process.exitCode = 1; return; }
  const workspaceId = run.workspaceId;
  const ctx = ctxFor(workspaceId);

  // From here the harness registers its own appliers. ⚠ Removed in `finally` so a crash cannot leave a
  // test applier live in a module other code imports.
  //
  // ⚠ SNAPSHOT FIRST -- see assertion 9. The registry is no longer empty: the product's own appliers
  // arrived once all seven of s5's preconditions held. What has to stay true is that THE HARNESS LEAVES
  // NOTHING BEHIND, which is a comparison against this snapshot rather than against zero.
  const applierKeysBefore = Object.keys(SYNC_APPLIERS).sort().join(",");
  SYNC_APPLIERS.harness_note = counting;
  ok("0-control. the harness's own applier is registered, so assertion 9 has something to remove",
    Object.keys(SYNC_APPLIERS).includes("harness_note"));

  try {
    // ── 1. ⚠ THE HEADLINE: A RETRY DOES NOT DUPLICATE ──────────────────────────────────────────────
    const t1 = tx();
    applyCalls = 0;
    const first = await applyTransaction(admin, ctx, t1, { actorId: USER });
    const second = await applyTransaction(admin, ctx, t1, { actorId: USER });

    ok("1a. the first apply succeeds", first.status === "applied", first.errorMessage ?? "");
    ok("1b. ⚠ THE SECOND APPLY DID NOT RUN THE APPLIER", applyCalls === 1, `applier ran ${applyCalls} times`);
    ok("1c. and the second answer is the same verdict as the first",
      second.status === first.status && second.appliedVersion === first.appliedVersion);
    ok("1d. the second says it was a duplicate", second.duplicate === true && first.duplicate === false);

    const { data: rows } = await admin.from(SYNC_TABLE).select("id").eq("workspace_id", workspaceId).eq("id", t1.id);
    ok("1e. ⚠ exactly one ledger row exists for it", (rows ?? []).length === 1, `${(rows ?? []).length} rows`);

    // ── 2. ⚠ retryable IS NOT status ───────────────────────────────────────────────────────────────
    SYNC_APPLIERS.harness_note = throwing;
    applyCalls = 0;
    const threw = await applyTransaction(admin, ctx, tx(), { actorId: USER });
    ok("2a. an applier that throws does not report success", threw.status !== "applied");
    ok("2b. ⚠ and it is RETRYABLE -- the device keeps trying rather than giving up",
      threw.retryable === true, `retryable=${threw.retryable}`);
    ok("2c. it says the work is still on the device",
      /still on this device/i.test(threw.errorMessage ?? ""));

    const { data: threwRows } = await admin.from(SYNC_TABLE).select("id").eq("workspace_id", workspaceId).eq("status", "refused").eq("error_code", "APPLY_FAILED");
    ok("2d. ⚠ NO LEDGER ROW WAS WRITTEN, so the retry re-checks instead of being told it is done",
      (threwRows ?? []).length === 0, `${(threwRows ?? []).length} rows`);

    // A genuine refusal is the opposite: terminal, and recorded.
    SYNC_APPLIERS.harness_note = refusing;
    const refused = await applyTransaction(admin, ctx, tx(), { actorId: USER });
    ok("2e-control. a real refusal is NOT retryable", refused.status === "refused" && refused.retryable === false);
    ok("2f-control. and it IS recorded, so a retry gets the same answer",
      (await applyTransaction(admin, ctx, { ...tx(), id: refused.id }, { actorId: USER })).duplicate === true);

    // ── 3. CONFLICT (CP-SYNC-001 s6) ───────────────────────────────────────────────────────────────
    SYNC_APPLIERS.harness_note = conflicting;
    const conflict = await applyTransaction(admin, ctx,
      tx({ operation: "update", baseVersion: 3 }), { actorId: USER });
    ok("3a. a version clash is recorded as `conflict`, not as a refusal", conflict.status === "conflict");
    ok("3b. ⚠ it is not retryable -- resending the same stale change would clash again",
      conflict.retryable === false);
    ok("3c. and the message is for a person, not a constraint name",
      /somebody changed this record/i.test(conflict.errorMessage ?? ""));

    // ── 4. ORDERING (COMP-SYNC-001 s9) ─────────────────────────────────────────────────────────────
    SYNC_APPLIERS.harness_note = counting;
    const order: number[] = [];
    SYNC_APPLIERS.harness_note = async (_a, _c, t) => { order.push(t.clientSequence); return { ok: true, version: 1 }; };
    await applyBatch(admin, ctx, [
      tx({ clientSequence: 3 }), tx({ clientSequence: 1 }), tx({ clientSequence: 2 }),
    ], { actorId: USER });
    ok("4a. ⚠ a batch is applied in the practitioner's order, whatever order it arrived in",
      order.join(",") === "1,2,3", order.join(","));

    // ── 5. MIGRATION 284's CONSTRAINTS ARE REAL ────────────────────────────────────────────────────
    const badUpdate = await admin.from(SYNC_TABLE).insert({
      id: uuid(), workspace_id: workspaceId, device_id: "d", entity_type: "x", entity_id: uuid(),
      operation: "update", base_version: null, client_sequence: 1,
      occurred_at: new Date().toISOString(), status: "applied", applied_version: 1,
    });
    ok("5a. ⚠ THE DATABASE refuses an update with no base version -- a blind overwrite",
      !!badUpdate.error, badUpdate.error?.message ?? "IT WAS ACCEPTED");

    const badCreate = await admin.from(SYNC_TABLE).insert({
      id: uuid(), workspace_id: workspaceId, device_id: "d", entity_type: "x", entity_id: uuid(),
      operation: "create", base_version: 2, client_sequence: 1,
      occurred_at: new Date().toISOString(), status: "applied", applied_version: 1,
    });
    ok("5b. and a create that claims a prior version", !!badCreate.error);

    const blankReason = await admin.from(SYNC_TABLE).insert({
      id: uuid(), workspace_id: workspaceId, device_id: "d", entity_type: "x", entity_id: uuid(),
      operation: "create", base_version: null, client_sequence: 1,
      occurred_at: new Date().toISOString(), status: "refused",
      error_code: "  ", error_message: "  ",
    });
    ok("5c. ⚠ and a refusal whose reason is only whitespace -- btrim, not `is not null`",
      !!blankReason.error, blankReason.error?.message ?? "IT WAS ACCEPTED");

    const badStatus = await admin.from(SYNC_TABLE).insert({
      id: uuid(), workspace_id: workspaceId, device_id: "d", entity_type: "x", entity_id: uuid(),
      operation: "create", base_version: null, client_sequence: 1,
      occurred_at: new Date().toISOString(), status: "pending",
    });
    ok("5d. and a status outside the three verdicts", !!badStatus.error);

    const goodRow = await admin.from(SYNC_TABLE).insert({
      id: uuid(), workspace_id: workspaceId, device_id: "d", entity_type: "x", entity_id: uuid(),
      operation: "create", base_version: null, client_sequence: 99,
      occurred_at: new Date().toISOString(), status: "applied", applied_version: 1,
    });
    ok("5e-control. a well-formed row IS accepted, so 5a-5d are the constraints and not a broken insert",
      !goodRow.error, goodRow.error?.message ?? "");

    // ⚠ The reinstall case migration 284 deliberately does not constrain.
    const reused = await admin.from(SYNC_TABLE).insert({
      id: uuid(), workspace_id: workspaceId, device_id: "d", entity_type: "x", entity_id: uuid(),
      operation: "create", base_version: null, client_sequence: 99,
      occurred_at: new Date().toISOString(), status: "applied", applied_version: 1,
    });
    ok("5f. ⚠ a REUSED client sequence is accepted -- a reinstalled device must not be locked out for ever",
      !reused.error, reused.error?.message ?? "IT WAS REFUSED");

    // ── 6. VALIDATION MIRRORS THE CONSTRAINTS IN WORDS ─────────────────────────────────────────────
    const noBase = validateTransaction(tx({ entityType: "harness_note", operation: "update", baseVersion: null }));
    ok("6a. the engine refuses an update with no base version before the database has to",
      !noBase.ok && noBase.code === "NO_BASE_VERSION");
    ok("6b. ⚠ and explains the harm rather than quoting a constraint",
      !noBase.ok && /overwrite somebody else's work unseen/i.test(noBase.message));
    ok("6c. a malformed id is refused", !validateTransaction(tx({ id: "not-a-uuid" })).ok);
    ok("6d. an unreadable timestamp is refused", !validateTransaction(tx({ occurredAt: "soon" })).ok);
    ok("6e-control. a well-formed transaction for a REGISTERED type passes",
      validateTransaction(tx({ entityType: "harness_note" })).ok);

    // ── 7. STATUS ──────────────────────────────────────────────────────────────────────────────────
    const report = await syncStatus(admin, workspaceId);
    ok("7a. the status reads", report.state === "ok", report.detail ?? "");
    ok("7b. it counts what arrived", report.applied > 0);
    ok("7c. ⚠ and lists what needs a person rather than only counting it",
      report.needsAttention.length > 0 && !!report.needsAttention[0].errorMessage);
    ok("7d. ⚠ it names the syncable entity types, so a screen can say why nothing can be filed",
      Array.isArray(report.syncableEntityTypes));
    ok("7e. a missing table would report `absent`, not an empty success",
      (await syncStatus({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { code: "42P01", message: "does not exist" } }) }) }) }) }) }, workspaceId)).state === "absent");
    ok("7f. ⚠ and a failed read reports `failed`, never zero",
      (await syncStatus({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { code: "57014", message: "timeout" } }) }) }) }) }) }, workspaceId)).state === "failed");

    // ── 8. THE ROUTES ──────────────────────────────────────────────────────────────────────────────
    const upload = readFileSync("src/app/api/v1/practice/sync/upload/route.ts", "utf8");
    ok("8a. ⚠ an oversized batch is REFUSED WHOLE, never truncated",
      /status: 413/.test(upload) && upload.includes("Nothing was filed"));
    ok("8b. the batch ceiling is the engine constant, not a second number",
      upload.includes("SYNC_MAX_BATCH") && SYNC_MAX_BATCH === 100);
    ok("8c. transactions are read field by field rather than spread",
      !/\.\.\.(r|raw|body)\b/.test(upload));
    ok("8d. the response carries a verdict per transaction",
      upload.includes("verdicts: result.verdicts"));

    report8: {
      const strip = (s: string) => s.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      ok("8e. ⚠ there is no /sync/ack route -- the response IS the acknowledgement",
        !strip(upload).includes("ack"));
      break report8;
    }
    // ── 10. ⚠ THE ENCOUNTER-VISIT APPLIER, LIVE ────────────────────────────────────────────────────
    //
    // Entity two of offline capture, against the REAL registry entry -- no harness applier stands in.
    // The three properties that make a whole visit safe to capture offline, each pinned by evidence:
    //   - it files a PAST, COMPLETED encounter with the DEVICE's times, through the same versioned
    //     note write the online product uses (a raw insert would be the lenient way into the record);
    //   - a retry CONVERGES: same transaction id is deduplicated by the ledger, and a NEW transaction
    //     carrying the same visit is absorbed by the natural key -- the crash-between-apply-and-ledger
    //     window is real and this is what closes it;
    //   - ⚠ it NEVER touches the live lifecycle. launchEncounter's resume-before-create would file
    //     three-day-old notes into whatever encounter is OPEN for that patient today.
    const reg = await registerPatient(admin, {
      workspaceId, displayName: "Offline Visit Fixture", birthDate: "1988-03-04",
      phone: "+256700000411", actorId: USER, correlationId: "harness-sync-visit",
    });
    if (!reg.ok) { console.error("patient fixture failed:", reg.message); process.exitCode = 1; return; }
    const patientId = reg.data.id;

    const startedIso = new Date("2026-08-13T09:10:00.000Z").toISOString();
    const endedIso = new Date("2026-08-13T09:40:00.000Z").toISOString();
    const visitPayload = {
      patientId, pathway: "new_walk_in", encounterMode: "home_visit",
      reasonForVisit: "wound check", startedAtIso: startedIso, endedAtIso: endedIso,
      notes: { narrative: "Dressing changed. Wound edges clean, no discharge." },
    };
    const vtx = tx({ entityType: ENCOUNTER_ENTITY_TYPE, payload: visitPayload });
    const vFirst = await applyTransaction(admin, ctx, vtx, { actorId: USER });
    ok("10a. a captured visit is APPLIED through the real registry entry",
      vFirst.status === "applied", vFirst.errorMessage ?? "");

    const { data: filed } = await admin.from("practice_encounter")
      .select("id, status, started_at, completed_at, entry_pathway, encounter_mode, created_by")
      .eq("workspace_id", workspaceId).eq("patient_id", patientId).eq("started_at", startedIso);
    const enc = (filed ?? [])[0] as Record<string, string> | undefined;
    ok("10b. ⚠ it is filed COMPLETED with the DEVICE's times, not the upload moment",
      !!enc && enc.status === "COMPLETED"
      && new Date(enc.started_at).toISOString() === startedIso
      && new Date(enc.completed_at).toISOString() === endedIso
      && enc.encounter_mode === "home_visit" && enc.created_by === USER,
      JSON.stringify(enc ?? "no encounter row"));

    const { data: noteRows } = await admin.from("practice_encounter_note")
      .select("note_type, body, version").eq("encounter_id", enc?.id ?? "00000000-0000-4000-8000-000000000000");
    const { data: versionRows } = await admin.from("practice_encounter_note_version")
      .select("version, source").eq("encounter_id", enc?.id ?? "00000000-0000-4000-8000-000000000000");
    ok("10c. ⚠ the note went through the VERSIONED write -- a version row exists, so this is not the lenient path",
      (noteRows ?? []).length === 1 && (noteRows ?? [])[0]?.note_type === "narrative"
      && (versionRows ?? []).length === 1,
      `notes=${(noteRows ?? []).length} versions=${(versionRows ?? []).length}`);

    const { data: histRows } = await admin.from("practice_encounter_status_history")
      .select("to_status, occurred_at").eq("encounter_id", enc?.id ?? "00000000-0000-4000-8000-000000000000")
      .order("occurred_at");
    ok("10d. the status history walks DRAFT-ACTIVE-COMPLETED at the device's times -- averageConsultMinutes reads this",
      (histRows ?? []).length === 3
      && (histRows ?? []).every(h => [startedIso, endedIso].includes(new Date(h.occurred_at as string).toISOString())),
      JSON.stringify(histRows ?? []));

    const { data: auditRows } = await admin.from("practice_audit_event")
      .select("id").eq("workspace_id", workspaceId)
      .eq("event_type", "practice.encounter_filed_offline").eq("correlation_id", vtx.id);
    ok("10e. the filing is audited, stitched to the capture by the transaction id",
      (auditRows ?? []).length === 1, `${(auditRows ?? []).length} audit rows`);

    // The two retry shapes, which are DIFFERENT mechanisms and must both hold.
    //
    // ⚠⚠ 10f-control EXISTS BECAUSE 10f WENT RED AGAINST A BUG THE WHOLE SUITE HAD MISSED. The applier
    // returned `version: null` for an applied create; migration 284 requires an applied create to
    // carry a version; the ledger insert violated the check; recordVerdict swallows ledger failures by
    // contract -- so NO ledger row was ever written and every replay re-ran the applier. The shipped
    // MEASUREMENT applier had the same null since the day it shipped, meaning a lost sync response
    // retried would have APPENDED A DUPLICATE CLINICAL READING -- while sections 1-9 stayed green,
    // because they test a harness applier that returns version 1. The control pins the evidence
    // directly: the row must EXIST, not merely the dedup answer look right.
    const { data: vLedger } = await admin.from(SYNC_TABLE)
      .select("id, applied_version").eq("workspace_id", workspaceId).eq("id", vtx.id);
    ok("10f-control. ⚠⚠ the applied visit HAS a ledger row -- the applier's version satisfied 284's check",
      (vLedger ?? []).length === 1 && (vLedger ?? [])[0]?.applied_version !== null,
      `${(vLedger ?? []).length} rows, version=${(vLedger ?? [])[0]?.applied_version ?? "null"}`);
    const vReplay = await applyTransaction(admin, ctx, vtx, { actorId: USER });
    ok("10f. ⚠ the SAME transaction retried is deduplicated by the ledger",
      vReplay.duplicate === true && vReplay.status === "applied");
    const vCrash = await applyTransaction(admin, ctx,
      tx({ entityType: ENCOUNTER_ENTITY_TYPE, payload: visitPayload, clientSequence: 2 }), { actorId: USER });
    const { data: twins } = await admin.from("practice_encounter")
      .select("id").eq("workspace_id", workspaceId).eq("patient_id", patientId).eq("started_at", startedIso);
    const { data: versionsAfter } = await admin.from("practice_encounter_note_version")
      .select("id").eq("encounter_id", enc?.id ?? "00000000-0000-4000-8000-000000000000");
    ok("10g. ⚠⚠ a NEW transaction carrying the same visit is absorbed by the natural key -- the crash window",
      vCrash.status === "applied" && (twins ?? []).length === 1,
      `status=${vCrash.status} encounters=${(twins ?? []).length}`);
    ok("10h. ⚠ and the absorbed replay stacked no second note version -- the no-op save held",
      (versionsAfter ?? []).length === 1, `${(versionsAfter ?? []).length} versions`);
    const { data: auditAfter } = await admin.from("practice_audit_event")
      .select("id").eq("workspace_id", workspaceId).eq("event_type", "practice.encounter_filed_offline");
    ok("10i. one filing, one audit row -- a replay is not a second event",
      (auditAfter ?? []).length === 1, `${(auditAfter ?? []).length} audit rows`);

    // ⚠⚠ THE NON-INTERFERENCE CONTROL. A live consultation is OPEN when an offline visit arrives.
    const live = await launchEncounter(admin, {
      workspaceId, patientId, pathway: "booked",
      actorId: USER, correlationId: "harness-sync-live",
    });
    ok("10j-fixture. a live encounter is open (the partial index now guards this patient)",
      live.ok && live.data.status === "DRAFT", live.ok ? "" : live.message);
    const laterVisit = await applyTransaction(admin, ctx, tx({
      entityType: ENCOUNTER_ENTITY_TYPE, clientSequence: 3,
      payload: { ...visitPayload, startedAtIso: new Date("2026-08-14T11:00:00.000Z").toISOString(), endedAtIso: new Date("2026-08-14T11:20:00.000Z").toISOString() },
    }), { actorId: USER });
    const { data: liveAfter } = live.ok
      ? await admin.from("practice_encounter").select("id, status").eq("id", live.data.id).single()
      : { data: null };
    ok("10k. ⚠⚠ the offline visit filed WITHOUT touching the open consultation -- both exist, the live one undisturbed",
      laterVisit.status === "applied" && !!liveAfter && liveAfter.status === "DRAFT",
      `visit=${laterVisit.status} live=${liveAfter?.status ?? "GONE"}`);

    // The refusals, each in the practitioner's words, each terminal.
    const refusals: [string, Record<string, unknown>, string][] = [
      ["NO_TIME", { ...visitPayload, startedAtIso: "", endedAtIso: "" }, "does not say when it started and ended"],
      ["END_BEFORE_START", { ...visitPayload, startedAtIso: endedIso, endedAtIso: startedIso }, "ends before it starts"],
      ["FUTURE_TIME", { ...visitPayload, startedAtIso: new Date(Date.now() + 86_400_000).toISOString(), endedAtIso: new Date(Date.now() + 90_000_000).toISOString() }, "dated in the future"],
      ["NO_CONTENT", { ...visitPayload, notes: { narrative: "   " } }, "carries no notes at all"],
      ["BAD_KIND", { ...visitPayload, encounterMode: "seance" }, "does not recognise"],
      ["BAD_PATIENT", { ...visitPayload, patientId: uuid() }, "not in this practice"],
    ];
    for (const [code, payload, needle] of refusals) {
      const verdict = await applyTransaction(admin, ctx,
        tx({ entityType: ENCOUNTER_ENTITY_TYPE, payload, clientSequence: 4 }), { actorId: USER });
      ok(`10l-${code}. refused terminally, in words a practitioner can act on`,
        verdict.status === "refused" && verdict.retryable === false
        && verdict.errorCode === code && new RegExp(needle, "i").test(verdict.errorMessage ?? ""),
        `status=${verdict.status} code=${verdict.errorCode} msg=${verdict.errorMessage}`);
    }
    // ⚠ NONE of the refusals above may have minted an encounter row for this patient.
    const { data: allEnc } = await admin.from("practice_encounter")
      .select("id").eq("workspace_id", workspaceId).eq("patient_id", patientId);
    ok("10l-control. the refused visits filed nothing -- exactly the two applied visits plus the live one exist",
      (allEnc ?? []).length === 3, `${(allEnc ?? []).length} encounters`);

    // ⚠ THE SHARED SENTENCES DO NOT DRIFT. The bedside refusal (offline-capture.ts) and the sync-time
    // refusal (the applier) must be the same words, because the practitioner may meet either one.
    const captureSrc = readFileSync("src/lib/practice/offline-capture.ts", "utf8");
    const applierSrc = readFileSync("src/lib/practice/sync-appliers/encounter-visit.ts", "utf8");
    const noTimeSentence = captureSrc.match(/CAPTURE_VISIT_NO_TIME =\s*\n?\s*"([^"]+)"/)?.[1];
    ok("10m. ⚠ the no-time sentence is one sentence, at the bedside and at sync",
      !!noTimeSentence && applierSrc.includes(noTimeSentence),
      noTimeSentence ? "the applier does not contain the capture sentence" : "the capture sentence was not found at all");

    // ── 11. ⚠ THE FOLLOW-UP APPLIER, LIVE ──────────────────────────────────────────────────────────
    //
    // Entity three. Create-only again, but with a stronger replay mechanism than the encounter's
    // natural key: THE DEVICE-MINTED entityId IS THE ROW'S PRIMARY KEY, so the crash-window retry is
    // an exact lookup. 11d is the assertion that pins that -- a new transaction, same entityId, one
    // row -- and 11b pins that the obligation went through createFollowUp (the event row and audit
    // exist), not through some lenient parallel insert.
    const fuEntityId = uuid();
    const fuPayload = {
      patientId, reason: "Review wound healing", dueOn: "2026-08-30",
      kind: "review", priority: "soon",
    };
    const ftx = tx({ entityType: FOLLOWUP_ENTITY_TYPE, entityId: fuEntityId, payload: fuPayload, clientSequence: 5 });
    const fFirst = await applyTransaction(admin, ctx, ftx, { actorId: USER });
    ok("11a. a captured follow-up is APPLIED through the real registry entry",
      fFirst.status === "applied", fFirst.errorMessage ?? "");

    const { data: fuRow } = await admin.from("practice_follow_up")
      .select("id, reason, due_on, status, source, kind, priority, created_by")
      .eq("id", fuEntityId).eq("workspace_id", workspaceId).maybeSingle();
    ok("11b. ⚠ THE ROW ID IS THE DEVICE-MINTED ENTITY ID, open on the board, source manual, actor welded",
      !!fuRow && fuRow.status === "OPEN" && fuRow.source === "manual" && fuRow.due_on === "2026-08-30"
      && fuRow.kind === "review" && fuRow.priority === "soon" && fuRow.created_by === USER,
      JSON.stringify(fuRow ?? "no row"));
    const { data: fuEvents } = await admin.from("practice_follow_up_event")
      .select("id, to_status").eq("follow_up_id", fuEntityId);
    const { data: fuAudit } = await admin.from("practice_audit_event")
      .select("id").eq("workspace_id", workspaceId)
      .eq("event_type", "practice.followup_raised").eq("correlation_id", ftx.id);
    ok("11c. ⚠ it went through createFollowUp -- the event row and the audit exist, so this is not a lenient path",
      (fuEvents ?? []).length === 1 && (fuAudit ?? []).length === 1,
      `events=${(fuEvents ?? []).length} audits=${(fuAudit ?? []).length}`);

    const fReplay = await applyTransaction(admin, ctx, ftx, { actorId: USER });
    ok("11d-ledger. the SAME transaction retried is deduplicated by the ledger",
      fReplay.duplicate === true && fReplay.status === "applied");
    const fCrash = await applyTransaction(admin, ctx,
      tx({ entityType: FOLLOWUP_ENTITY_TYPE, entityId: fuEntityId, payload: fuPayload, clientSequence: 6 }), { actorId: USER });
    const { data: fuTwins } = await admin.from("practice_follow_up")
      .select("id").eq("workspace_id", workspaceId).eq("patient_id", patientId).eq("reason", "Review wound healing");
    ok("11d. ⚠⚠ a NEW transaction with the same device-minted id is absorbed by the PRIMARY KEY -- the crash window",
      fCrash.status === "applied" && (fuTwins ?? []).length === 1,
      `status=${fCrash.status} rows=${(fuTwins ?? []).length}`);
    const { data: fuAuditAfter } = await admin.from("practice_audit_event")
      .select("id").eq("workspace_id", workspaceId).eq("event_type", "practice.followup_raised");
    ok("11e. one raising, one audit row -- an absorbed replay is not a second event",
      (fuAuditAfter ?? []).length === 1, `${(fuAuditAfter ?? []).length} audit rows`);

    // The refusals, each terminal, each in the practitioner's words.
    const fuRefusals: [string, Record<string, unknown>, string][] = [
      ["NO_REASON", { ...fuPayload, reason: "   " }, "does not say what it is for"],
      ["NO_DUE", { ...fuPayload, dueOn: "" }, "nobody will ever be reminded"],
      ["BAD_DUE", { ...fuPayload, dueOn: "soonish" }, "could not be read"],
      ["BAD_PATIENT", { ...fuPayload, patientId: uuid() }, "not in this practice"],
    ];
    for (const [code, payload, needle] of fuRefusals) {
      const verdict = await applyTransaction(admin, ctx,
        tx({ entityType: FOLLOWUP_ENTITY_TYPE, payload, clientSequence: 7 }), { actorId: USER });
      ok(`11f-${code}. refused terminally, in words a practitioner can act on`,
        verdict.status === "refused" && verdict.retryable === false
        && verdict.errorCode === code && new RegExp(needle, "i").test(verdict.errorMessage ?? ""),
        `status=${verdict.status} code=${verdict.errorCode} msg=${verdict.errorMessage}`);
    }
    const { data: allFu } = await admin.from("practice_follow_up")
      .select("id").eq("workspace_id", workspaceId).eq("patient_id", patientId);
    ok("11f-control. the refused follow-ups filed nothing -- exactly one obligation exists",
      (allFu ?? []).length === 1, `${(allFu ?? []).length} rows`);

    // ⚠ The shared sentence pin, same shape as 10m.
    const fuApplierSrc = readFileSync("src/lib/practice/sync-appliers/follow-up.ts", "utf8");
    const noDueSentence = captureSrc.match(/CAPTURE_FOLLOWUP_NO_DUE =\s*\n?\s*"([^"]+)"/)?.[1];
    ok("11g. ⚠ the no-due sentence is one sentence, at the bedside and at sync",
      !!noDueSentence && fuApplierSrc.includes(noDueSentence),
      noDueSentence ? "the applier does not contain the capture sentence" : "the capture sentence was not found at all");
  } finally {
    delete SYNC_APPLIERS.harness_note;
  }

  // ⚠ NOT `length === 0` ANY MORE, AND THE OLD SPELLING WAS THE MISTAKE THIS REPOSITORY KEEPS MAKING.
  //
  // It pinned a TALLY the build was deliberately going to change: the registry was empty only until
  // capture shipped, and registering the first real applier -- the entire point of the work -- turned a
  // green assertion red against correct code. Its own NAME says the property: "the harness left no write
  // path behind". That is a comparison against what was there before it started.
  ok("9. ⚠ the harness left no write path behind",
    Object.keys(SYNC_APPLIERS).sort().join(",") === applierKeysBefore,
    `before=[${applierKeysBefore}] after=[${Object.keys(SYNC_APPLIERS).sort().join(",")}]`);
  ok("9-control. and there IS a product applier registered, so 9 is not comparing two empty sets",
    applierKeysBefore.length > 0, "the registry was empty -- capture may have been unregistered");

  await cleanup();
  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
