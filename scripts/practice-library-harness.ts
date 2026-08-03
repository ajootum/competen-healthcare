/**
 * Practice document-library harness -- CPR-320's library, folders, recycle bin and the correspondence
 * register. Migration 210.
 *
 * WHAT IT PROVES:
 *   1. A CLINICAL DOCUMENT NEVER ENTERS THE RECYCLE BIN, and the refusal SAYS SO rather than returning a
 *      bare not-found that would send somebody hunting for a bug. This is the boundary the module turns
 *      on: a clinical record is marked entered-in-error and kept, a protocol is deleted.
 *   2. PURGING GOES THROUGH THE BIN. A one-click permanent delete is how a practice loses its only copy
 *      of a consent form on a Friday evening.
 *   3. A PURGED DOCUMENT CANNOT BE RESTORED -- a row pointing at bytes that are gone is a document that
 *      will not open, which is worse than refusing.
 *   4. DELETING A FOLDER DOES NOT DELETE ITS DOCUMENTS. Tidying is not deleting.
 *   5. A BULK MOVE REPORTS BOTH NUMBERS and cannot reach another workspace's rows.
 *   6. THE CORRESPONDENCE REGISTER IS COMPOSED, not stored: it shows documents issued, copies released,
 *      documents received and calls recorded, in one timeline -- and says in the payload that this
 *      product sent none of it.
 *   7. THE LIBRARY REPORTS BYTES BUT NO QUOTA, because there is no quota to report.
 *   8. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-library-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter } from "../src/lib/practice/encounters";
import { createDocument, transitionDocument, recordRelease } from "../src/lib/practice/documentation";
import { recordContact, recordIncoming } from "../src/lib/practice/communication";
import {
  createFolder, deleteFolder, listFolders, recordLibraryDocument, listLibrary, librarySummary,
  binDocument, restoreDocument, purgeDocument, moveDocuments, patientCorrespondence,
} from "../src/lib/practice/document-library";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e25d1";
const OTHER = "00000000-0000-4000-8000-0000000e25d2";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-lib-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-lib",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-lib", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

const base = { actorId: OWNER, correlationId: "harness-lib" };


const file = (title: string, folderId: string | null, bytes = 2048) => ({
  title, folderId, storagePath: `probe/${title.replace(/\W+/g, "_")}.pdf`,
  fileName: `${title}.pdf`, mimeType: "application/pdf", byteSize: bytes,
});

async function main() {
  console.log("\nPractice document-library harness (CPR-320, migration 210)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Library A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Library B (synthetic)", "b");

  // ── Folders ──────────────────────────────────────────────────────────────
  const protocols = await createFolder(admin, { workspaceId: wsA, name: "Protocols", ...base });
  ok("a folder is created", protocols.ok, protocols.ok ? "" : protocols.message);
  const dup = await createFolder(admin, { workspaceId: wsA, name: "protocols", ...base });
  ok("the same name in a different case is refused", !dup.ok && dup.code === "NAME_IN_USE",
    dup.ok ? "created" : dup.code);
  const forms = await createFolder(admin, { workspaceId: wsA, name: "Blank forms", ...base });
  ok("CONTROL: a different name is accepted", forms.ok);
  if (!protocols.ok || !forms.ok) return report();

  // ── The library ──────────────────────────────────────────────────────────
  const p1 = await recordLibraryDocument(admin, { workspaceId: wsA, ...file("Sepsis protocol", protocols.data.id), ...base });
  const p2 = await recordLibraryDocument(admin, { workspaceId: wsA, ...file("Consent form", forms.data.id, 4096), ...base });
  const p3 = await recordLibraryDocument(admin, { workspaceId: wsA, ...file("Unfiled note", null, 1024), ...base });
  ok("documents are added, filed and unfiled", p1.ok && p2.ok && p3.ok,
    [p1, p2, p3].map(r => r.ok ? "ok" : r.message).join("; "));
  if (!p1.ok || !p2.ok || !p3.ok) return report();

  const badFolder = await recordLibraryDocument(admin, {
    workspaceId: wsA, ...file("Wrong", "00000000-0000-4000-8000-00000000dead"), ...base,
  });
  ok("a folder that does not exist is refused", !badFolder.ok && badFolder.code === "NOT_FOUND");

  // ── 7. Bytes, but no quota ───────────────────────────────────────────────
  const summary = await librarySummary(admin, wsA);
  ok("the library reports its real byte total",
    summary.totalFiles === 3 && summary.totalBytes === 2048 + 4096 + 1024,
    JSON.stringify({ files: summary.totalFiles, bytes: summary.totalBytes }));
  ok("THERE IS NO QUOTA, and the payload says so rather than drawing a bar against a limit nobody set",
    summary.quotaBytes === null && !/%/.test(JSON.stringify(summary)));
  ok("it counts per folder, and the unfiled separately",
    summary.folders.find(f => f.name === "Protocols")?.files === 1 && summary.unfiled.files === 1,
    JSON.stringify(summary.folders.map(f => [f.name, f.files])));

  // ── 1. The boundary: a clinical document is not a library document ───────
  const patient = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Achieng Grace", sex: "female", birthDate: "1993-04-19",
    phone: "0772 555 700", ...base,
  });
  if (!patient.ok) { ok("patient registers", false, patient.message); return report(); }
  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patient.data.id, pathway: "new_walk_in", reasonForVisit: "Review", ...base,
  });
  if (!enc.ok) { ok("encounter launches", false, enc.message); return report(); }

  const clinical = await createDocument(admin, {
    workspaceId: wsA, patientId: patient.data.id, encounterId: enc.data.id,
    title: "Referral to cardiology", docType: "referral_letter", body: "Please see this patient.", ...base,
  });
  ok("a clinical document is created", clinical.ok, clinical.ok ? "" : clinical.message);
  if (!clinical.ok) return report();

  const cannotBin = await binDocument(admin, { workspaceId: wsA, documentId: clinical.data.id, ...base });
  ok("A CLINICAL DOCUMENT NEVER ENTERS THE RECYCLE BIN",
    !cannotBin.ok && cannotBin.code === "CLINICAL_DOCUMENT", cannotBin.ok ? "binned" : cannotBin.code);
  ok("and the refusal SAYS SO -- not a bare not-found that sends somebody hunting for a bug",
    !cannotBin.ok && /entered in error/i.test(cannotBin.message), cannotBin.ok ? "" : cannotBin.message);
  const { data: stillThere } = await admin.from("practice_clinical_document")
    .select("status").eq("id", clinical.data.id).maybeSingle();
  ok("the clinical document is untouched by the attempt", stillThere?.status === "DRAFT", String(stillThere?.status));

  // ── 2 and 3. The bin ─────────────────────────────────────────────────────
  const purgeFirst = await purgeDocument(admin, { workspaceId: wsA, documentId: p3.data.id, ...base });
  ok("PURGING GOES THROUGH THE BIN -- there is no one-click permanent delete",
    !purgeFirst.ok && purgeFirst.code === "NOT_BINNED", purgeFirst.ok ? "purged" : purgeFirst.code);

  const binned = await binDocument(admin, { workspaceId: wsA, documentId: p3.data.id, ...base });
  ok("a library document goes to the bin", binned.ok, binned.ok ? "" : binned.message);
  ok("and leaves the library", (await listLibrary(admin, wsA)).length === 2);
  ok("but is in the bin, not gone", (await listLibrary(admin, wsA, { bin: true })).length === 1);

  const restored = await restoreDocument(admin, { workspaceId: wsA, documentId: p3.data.id, ...base });
  ok("it can be restored", restored.ok && (await listLibrary(admin, wsA)).length === 3,
    restored.ok ? "" : restored.message);

  await binDocument(admin, { workspaceId: wsA, documentId: p3.data.id, ...base });
  const purged = await purgeDocument(admin, { workspaceId: wsA, documentId: p3.data.id, ...base });
  ok("CONTROL: once binned it can be purged", purged.ok, purged.ok ? "" : purged.message);
  const afterPurge = await restoreDocument(admin, { workspaceId: wsA, documentId: p3.data.id, ...base });
  ok("A PURGED DOCUMENT CANNOT BE RESTORED -- a row pointing at bytes that are gone will not open",
    !afterPurge.ok && afterPurge.code === "PURGED", afterPurge.ok ? "restored" : afterPurge.code);
  ok("and it is out of the bin too", (await listLibrary(admin, wsA, { bin: true })).length === 0);
  // The row survives the purge, so the trail is not erased with the bytes.
  const { data: purgedRow } = await admin.from("practice_library_document")
    .select("id, purged_at").eq("id", p3.data.id).maybeSingle();
  ok("THE ROW SURVIVES THE PURGE -- the trail is not erased with the bytes",
    !!purgedRow?.purged_at, JSON.stringify(purgedRow));

  // ── 4. Deleting a folder does not delete its documents ───────────────────
  const removed = await deleteFolder(admin, { workspaceId: wsA, folderId: forms.data.id, ...base });
  ok("a folder is deleted, and says how many documents fell out of it",
    removed.ok && removed.data.orphaned === 1, removed.ok ? JSON.stringify(removed.data) : removed.message);
  const survivors = await listLibrary(admin, wsA);
  ok("DELETING A FOLDER DOES NOT DELETE ITS DOCUMENTS -- tidying is not deleting",
    survivors.length === 2 && survivors.some(d => d.title === "Consent form"),
    survivors.map(d => d.title).join(", "));
  ok("and the orphan is simply unfiled", survivors.find(d => d.title === "Consent form")?.folder_id === null);
  ok("CONTROL: the folder itself is gone", (await listFolders(admin, wsA)).length === 1);

  // ── 5. Bulk move ─────────────────────────────────────────────────────────
  const moved = await moveDocuments(admin, {
    workspaceId: wsA, documentIds: [p1.data.id, p2.data.id], folderId: protocols.data.id, ...base,
  });
  ok("a bulk move works", moved.ok && moved.data.moved === 2, moved.ok ? JSON.stringify(moved.data) : moved.message);

  const partial = await moveDocuments(admin, {
    // One real, one from nowhere: the count must report what actually moved.
    workspaceId: wsA, documentIds: [p1.data.id, "00000000-0000-4000-8000-00000000beef"], folderId: null, ...base,
  });
  ok("A BULK MOVE REPORTS WHAT ACTUALLY MOVED, not what was asked for",
    partial.ok && partial.data.moved === 1, partial.ok ? JSON.stringify(partial.data) : partial.message);
  const empty = await moveDocuments(admin, { workspaceId: wsA, documentIds: [], folderId: null, ...base });
  ok("moving nothing is refused", !empty.ok);

  // ── 6. The correspondence register ───────────────────────────────────────
  await transitionDocument(admin, { workspaceId: wsA, documentId: clinical.data.id, to: "FINAL", ...base });
  await transitionDocument(admin, { workspaceId: wsA, documentId: clinical.data.id, to: "SIGNED", ...base });
  await recordRelease(admin, {
    workspaceId: wsA, documentId: clinical.data.id, channel: "handed_over",
    recipient: "The patient", ...base,
  });
  await recordIncoming(admin, {
    workspaceId: wsA, patientId: patient.data.id, source: "City Laboratory",
    title: "Full blood count", docType: "lab_result", ...base,
  });
  await recordContact(admin, {
    workspaceId: wsA, patientId: patient.data.id, channel: "phone", direction: "outgoing",
    outcome: "reached", summary: "Called about the result", ...base,
  });

  const register = await patientCorrespondence(admin, wsA, patient.data.id);
  ok("THE REGISTER IS ONE TIMELINE of everything that passed between practice and patient",
    register.entries.length === 3 &&
    new Set(register.entries.map(e => e.kind)).size === 3,
    JSON.stringify(register.entries.map(e => e.kind)));
  ok("it counts what was issued, received, released and recorded",
    register.issued === 1 && register.received === 1 && register.contacts === 1 && register.copiesReleased === 1,
    JSON.stringify({ i: register.issued, r: register.received, c: register.contacts, rel: register.copiesReleased }));
  ok("the issued document carries the copy that was released with it",
    register.entries.find(e => e.kind === "issued")?.releases.length === 1);
  ok("IT SAYS IN THE PAYLOAD that this product sent none of it",
    register.sentByThisProduct === false);
  ok("and it is newest first", register.entries[0].at >= register.entries[register.entries.length - 1].at);

  // ── 8. Isolation ─────────────────────────────────────────────────────────
  const crossBin = await binDocument(admin, { workspaceId: wsB, documentId: p1.data.id, actorId: OTHER, correlationId: "h" });
  ok("another workspace's document cannot be binned", !crossBin.ok && crossBin.code === "NOT_FOUND");
  const crossMove = await moveDocuments(admin, {
    workspaceId: wsB, documentIds: [p1.data.id, p2.data.id], folderId: null, actorId: OTHER, correlationId: "h",
  });
  ok("A BULK MOVE CANNOT REACH ANOTHER WORKSPACE'S ROWS",
    crossMove.ok && crossMove.data.moved === 0, crossMove.ok ? JSON.stringify(crossMove.data) : crossMove.message);
  ok("B's library is empty", (await listLibrary(admin, wsB)).length === 0);
  ok("A's is not (the isolation test is not vacuous)", (await listLibrary(admin, wsA)).length === 2);
  const bRegister = await patientCorrespondence(admin, wsB, patient.data.id);
  ok("and B's correspondence register holds none of A's", bRegister.entries.length === 0);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
