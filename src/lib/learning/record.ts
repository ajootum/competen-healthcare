/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes, randomUUID } from "node:crypto";
import { allActivities, evaluateCompletion, learnerView, normaliseBlueprint, resumePoint, scoreCheck, type Blueprint } from "./blueprint";
import { loadLearningPolicy } from "./policy";

// ── THE ONE AUTHORITATIVE PERSONAL LEARNING RECORD ── COMPETEN-LEARNING-01 S2, migration 462 ─────────────────────────
//
// Enrol -> Learn -> Assess -> Complete -> Record (product definition s10-s12). Every function takes the person's id
// from the Individual guard, never from the browser, and reads or writes only that person's rows.
//
// ⚠ THE SERVER DECIDES COMPLETION. The browser reports that a lesson was opened to its end, or sends its answers to a
// check. Scoring, the completion rule and the certificate all run here, against the STORED version the record is
// pinned to -- so what a learner completed never changes when a later version is published.
//
// ⚠ ONE RECORD, MANY READERS. Professional (CPD, evidence, progress), the Passport and Scholar read these rows by
// reference through ./products.ts. Nothing here writes a Professional, Scholar or estate table (ADR-016 D1).
//
// ⚠ NOTHING IS VERIFIED HERE. Hosted completion is platform_recorded, an external completion self_declared or
// source_linked. A certificate states course completion or assessed knowledge, under an issuer authorisation, and
// never competence, accreditation or regulatory approval (D6).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(e?.message ?? "");
type R<T = unknown> = ({ ok: true } & T) | { ok: false; error: string; status?: number };

export const EVIDENCE_BUCKET = "learning-evidence";
export const EVIDENCE_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;

export const OUTCOME_LABEL = { course_completion: "Course completion", assessed_knowledge: "Assessed knowledge", external_completion: "Completed with the external provider (self-reported)" } as const;
export const EVIDENCE_LABEL = { platform_recorded: "Recorded by Competen Learning", self_declared: "Self-declared", source_linked: "Self-declared, with a document attached" } as const;
export const CERTIFICATE_DISCLAIMER = "This certificate records what the learner completed, or what the course assessed, on Competen Learning. "
  + "It is not a professional accreditation, a regulatory approval, CPD accreditation or a verification of clinical competence.";

/** The version a record is pinned to, as its stored blueprint. */
async function versionOf(admin: any, versionId: string): Promise<{ content: Blueprint; delivery: "hosted" | "external"; v: any } | null> {
  const { data: v } = await admin.from("learning_offering_version").select("id, version_no, content, certificate_issuer_id, learning_offering!inner(id, code, title, delivery)").eq("id", versionId).maybeSingle();
  if (!v) return null;
  const delivery = v.learning_offering.delivery as "hosted" | "external";
  return { content: normaliseBlueprint(v.content, delivery), delivery, v };
}

async function ownRecord(admin: any, userId: string, recordId: string): Promise<any | null> {
  if (!UUID.test(recordId)) return null;
  const { data } = await admin.from("learning_record").select("*").eq("id", recordId).eq("user_id", userId).maybeSingle();
  return data ?? null;
}

/** True when the person may use the record's hosted content now: free, or a live course entitlement. */
async function accessLive(admin: any, rec: any): Promise<boolean> {
  if (rec.access_kind === "free") return true;
  if (rec.access_kind !== "entitlement" || !rec.course_entitlement_id) return false;
  const { data } = await admin.from("individual_live_course_entitlement").select("id").eq("id", rec.course_entitlement_id).maybeSingle();
  return !!data;
}

/**
 * Enrol on the deliverable published version of an offering. Free learning needs nothing more. Paid learning needs a
 * live course entitlement of this person (a purchase or an HQ grant) -- never a Scholar or Professional subscription.
 * External learning opens a record the person completes themselves. Enrolling twice returns the same record.
 */
export async function enrol(admin: any, userId: string, offeringId: string): Promise<R<{ recordId: string; existing: boolean }>> {
  if (!UUID.test(offeringId)) return { ok: false, error: "No such course.", status: 404 };
  const { data: o } = await admin.from("learning_offering").select("id, delivery, status").eq("id", offeringId).maybeSingle();
  if (!o || o.status !== "active") return { ok: false, error: "That course is not offered.", status: 404 };
  const { data: vs } = await admin.from("learning_offering_version").select("id, access_model").eq("offering_id", offeringId).eq("state", "published").limit(1);
  const v = (vs ?? [])[0];
  if (!v) return { ok: false, error: "That course is not offered.", status: 404 };
  const { data: ok } = await admin.rpc("learning_offering_deliverable", { p_version: v.id });
  if (ok !== true) return { ok: false, error: "That course is not available just now.", status: 409 };
  const { data: had } = await admin.from("learning_record").select("id, status").eq("user_id", userId).eq("version_id", v.id).maybeSingle();
  if (had && had.status !== "withdrawn") return { ok: true, recordId: had.id, existing: true };
  if (had) return { ok: false, error: "You withdrew from this version. It stays in your record, and you can enrol when a new version is published.", status: 409 };
  const access_kind: "free" | "entitlement" | "external" = o.delivery === "external" ? "external" : v.access_model === "free" ? "free" : "entitlement";
  let course_entitlement_id: string | null = null;
  if (access_kind === "entitlement") {
    const { data: ent, error } = await admin.from("individual_live_course_entitlement").select("id").eq("user_id", userId).eq("offering_id", offeringId).order("starts_at", { ascending: false }).limit(1);
    if (error && !missing(error)) return { ok: false, error: "Your access could not be checked just now.", status: 503 };
    course_entitlement_id = (ent ?? [])[0]?.id ?? null;
    if (!course_entitlement_id) return { ok: false, error: "This course needs access first. You do not need Competen Scholar or Competen Professional to get it.", status: 402 };
  }
  const { data: r, error } = await admin.from("learning_record").insert({ user_id: userId, offering_id: offeringId, version_id: v.id, delivery: o.delivery, access_kind, course_entitlement_id }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) { const { data: again } = await admin.from("learning_record").select("id").eq("user_id", userId).eq("version_id", v.id).maybeSingle(); if (again) return { ok: true, recordId: again.id, existing: true }; }
    return { ok: false, error: /not free|entitlement/i.test(error.message) ? "This course needs access first." : "You could not be enrolled just now.", status: 409 };
  }
  return { ok: true, recordId: r.id, existing: false };
}

async function done(admin: any, recordId: string): Promise<{ activity_key: string; kind: string; passed: boolean | null; score: number | null; max_score: number | null; attempts: number }[]> {
  const { data } = await admin.from("learning_record_activity").select("activity_key, kind, passed, score, max_score, attempts").eq("record_id", recordId);
  return data ?? [];
}

/** Record that a lesson or a reflection was completed, then check whether the course is now complete. */
export async function completeActivity(admin: any, userId: string, recordId: string, activityKey: string): Promise<R<{ completed: boolean; next: string | null }>> {
  const rec = await ownRecord(admin, userId, recordId);
  if (!rec) return { ok: false, error: "No such record.", status: 404 };
  if (rec.delivery !== "hosted") return { ok: false, error: "External learning is recorded with its completion form.", status: 409 };
  if (!["enrolled", "in_progress"].includes(rec.status)) return { ok: false, error: rec.status === "completed" ? "You have completed this course." : "This record is closed.", status: 409 };
  if (!(await accessLive(admin, rec))) return { ok: false, error: "Your access to this course has ended. What you did is kept in your record.", status: 403 };
  const ver = await versionOf(admin, rec.version_id);
  const a = ver ? allActivities(ver.content).find(x => x.id === activityKey) : null;
  if (!ver || !a || !KEY.test(activityKey)) return { ok: false, error: "That is not part of this course.", status: 404 };
  if (a.kind === "check") return { ok: false, error: "A knowledge check is completed by answering it.", status: 409 };
  const ins = await admin.from("learning_record_activity").upsert({ record_id: rec.id, user_id: userId, activity_key: activityKey, kind: a.kind === "case" ? "lesson" : a.kind }, { onConflict: "record_id,activity_key", ignoreDuplicates: true });
  if (ins.error) return { ok: false, error: "Your progress could not be saved just now.", status: 503 };
  return settle(admin, userId, rec, ver);
}

/** Answer a knowledge check. Scored on the server against the stored key. Once passed, a check stays passed. */
export async function answerCheck(admin: any, userId: string, recordId: string, activityKey: string, answers: unknown)
  : Promise<R<{ score: number; max: number; passed: boolean; attemptsLeft: number; feedback: { id: string; correct: boolean; rationale: string | null; correctIds: string[] | null }[]; completed: boolean; next: string | null }>> {
  const rec = await ownRecord(admin, userId, recordId);
  if (!rec) return { ok: false, error: "No such record.", status: 404 };
  if (rec.delivery !== "hosted" || !["enrolled", "in_progress"].includes(rec.status)) return { ok: false, error: "This record takes no more answers.", status: 409 };
  if (!(await accessLive(admin, rec))) return { ok: false, error: "Your access to this course has ended. What you did is kept in your record.", status: 403 };
  const ver = await versionOf(admin, rec.version_id);
  const a = ver ? allActivities(ver.content).find(x => x.id === activityKey) : null;
  if (!ver || !a || a.kind !== "check") return { ok: false, error: "That is not a knowledge check of this course.", status: 404 };
  const ans = answers && typeof answers === "object" && !Array.isArray(answers) ? answers as Record<string, unknown> : {};
  if (JSON.stringify(ans).length > 20000) return { ok: false, error: "Those answers are too long.", status: 400 };
  const policy = await loadLearningPolicy(admin);
  const before = (await done(admin, rec.id)).find(d => d.activity_key === activityKey);
  if (before?.passed) return { ok: false, error: "You have already passed this check.", status: 409 };
  const { count } = await admin.from("learning_check_attempt").select("id", { count: "exact", head: true }).eq("record_id", rec.id).eq("activity_key", activityKey);
  const used = count ?? 0;
  if (used >= policy.checkAttempts) return { ok: false, error: "You have used every attempt at this check.", status: 409 };
  const s = scoreCheck(a, ans);
  const at = await admin.from("learning_check_attempt").insert({ record_id: rec.id, user_id: userId, activity_key: activityKey, answers: ans, score: s.score, max_score: s.max, passed: s.passed });
  if (at.error) return { ok: false, error: "Your answers could not be saved just now.", status: 503 };
  const row = { record_id: rec.id, user_id: userId, activity_key: activityKey, kind: "check", score: s.score, max_score: s.max, passed: s.passed, attempts: used + 1, completed_at: new Date().toISOString() };
  const up = await admin.from("learning_record_activity").upsert(row, { onConflict: "record_id,activity_key" });
  if (up.error) return { ok: false, error: "Your result could not be saved just now.", status: 503 };
  const attemptsLeft = Math.max(0, policy.checkAttempts - used - 1);
  // The key and rationale are shown once the check is passed or no attempt is left, so a retry is not a lookup.
  const reveal = s.passed || attemptsLeft === 0;
  const st = await settle(admin, userId, rec, ver);
  if (!st.ok) return st;
  return { ok: true, score: s.score, max: s.max, passed: s.passed, attemptsLeft, feedback: s.feedback.map(f => ({ id: f.id, correct: f.correct, rationale: reveal ? f.rationale : null, correctIds: reveal ? f.correctIds : null })), completed: st.completed, next: st.next };
}

/** Move the record on after progress: resume point, and completion with its certificates when the rule is met. */
async function settle(admin: any, userId: string, rec: any, ver: { content: Blueprint; v: any }): Promise<R<{ completed: boolean; next: string | null }>> {
  const d = await done(admin, rec.id);
  const next = resumePoint(ver.content, d);
  const c = evaluateCompletion(ver.content, d);
  const now = new Date().toISOString();
  if (!c.complete) {
    await admin.from("learning_record").update({ status: "in_progress", last_activity_at: now, last_activity_key: next }).eq("id", rec.id).in("status", ["enrolled", "in_progress"]);
    return { ok: true, completed: false, next };
  }
  const basis = { rule: "learning-blueprint/1", required: c.required, satisfied: c.satisfied, checks: d.filter(x => x.kind === "check").map(x => ({ id: x.activity_key, score: x.score, max: x.max_score, passed: x.passed, attempts: x.attempts })) };
  const { error } = await admin.from("learning_record").update({ status: "completed", completed_at: now, completion_kind: c.kind, completion_basis: basis, last_activity_at: now, last_activity_key: null }).eq("id", rec.id).in("status", ["enrolled", "in_progress"]);
  if (error) return { ok: false, error: "Your completion could not be recorded just now. Your progress is saved.", status: 503 };
  await issueCertificates(admin, userId, rec.id);
  return { ok: true, completed: true, next: null };
}

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Pure (given random bytes): a certificate number LC-XXXX-XXXX-XXXX and a 24-character verification code. */
export function certificateIds(bytes: Buffer): { no: string; code: string } {
  const pick = (i: number) => ALNUM[bytes[i] % ALNUM.length];
  const g = (o: number) => [0, 1, 2, 3].map(i => pick(o + i)).join("");
  const code = Array.from({ length: 24 }, (_, i) => "abcdefghijklmnopqrstuvwxyz0123456789"[bytes[12 + i] % 36]).join("");
  return { no: `LC-${g(0)}-${g(4)}-${g(8)}`, code };
}

/**
 * Issue the certificates a completed hosted record is due under the LIVE issuer authorisation of its version: course
 * completion, and assessed knowledge when the record was completed as assessed knowledge and the authorisation covers
 * it. Idempotent (one certificate per record and outcome, by a unique index). No authorisation, no certificate.
 */
export async function issueCertificates(admin: any, userId: string, recordId: string): Promise<{ issued: string[] }> {
  const rec = await ownRecord(admin, userId, recordId);
  if (!rec || rec.status !== "completed" || rec.delivery !== "hosted") return { issued: [] };
  const ver = await versionOf(admin, rec.version_id);
  if (!ver?.content.certificate.offered) return { issued: [] };
  const { data: auths } = await admin.from("learning_certificate_authorisation").select("id, outcomes, issuer_provider_id").eq("version_id", rec.version_id).is("withdrawn_at", null).limit(1);
  const auth = (auths ?? [])[0];
  if (!auth) return { issued: [] };
  const due = (auth.outcomes as string[]).filter(o => o === "course_completion" || (o === "assessed_knowledge" && rec.completion_kind === "assessed_knowledge"));
  const [{ data: issuer }, { data: person }] = await Promise.all([
    admin.from("learning_provider").select("name").eq("id", auth.issuer_provider_id).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  const issued: string[] = [];
  for (const outcome of due) {
    const ids = certificateIds(randomBytes(40));
    const snapshot = {
      learner: person?.full_name ?? null, issuer: issuer?.name ?? null, course: ver.v.learning_offering.title, code: ver.v.learning_offering.code,
      version: ver.v.version_no, outcome, outcomeLabel: OUTCOME_LABEL[outcome as "course_completion" | "assessed_knowledge"], completedAt: rec.completed_at,
      evidence: { basis: rec.completion_basis ?? null, evidenceClass: rec.evidence_class }, disclaimer: CERTIFICATE_DISCLAIMER,
    };
    const { error } = await admin.from("learning_certificate").insert({ certificate_no: ids.no, verification_code: ids.code, record_id: rec.id, user_id: userId, offering_id: rec.offering_id,
      version_id: rec.version_id, outcome, issuer_provider_id: auth.issuer_provider_id, authorisation_id: auth.id, snapshot });
    if (!error) issued.push(ids.no);
  }
  return { issued };
}

/** Pure: why an evidence file cannot be attached, or null. */
export function evidenceProblem(file: { type: string; size: number }): string | null {
  if (!(EVIDENCE_MIME as readonly string[]).includes(file.type)) return "Attach a PDF, PNG, JPEG or WebP file.";
  if (file.size <= 0 || file.size > EVIDENCE_MAX_BYTES) return "The document must be between 1 byte and 4 MB.";
  return null;
}

/**
 * Record completion of EXTERNAL learning: the date, the hours (optional), a reflection and optionally the provider's
 * certificate. Self-declared, or source-linked with a document. Never verified: nothing here reads the document.
 */
export async function recordExternalCompletion(admin: any, userId: string, recordId: string, a: { completedOn: string; hours: unknown; reflection: string; file: File | null }): Promise<R> {
  const rec = await ownRecord(admin, userId, recordId);
  if (!rec) return { ok: false, error: "No such record.", status: 404 };
  if (rec.delivery !== "external") return { ok: false, error: "Hosted learning completes as you work through it.", status: 409 };
  if (rec.status === "completed" || rec.status === "withdrawn") return { ok: false, error: "This record is already closed.", status: 409 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.completedOn ?? "") || Date.parse(a.completedOn) > Date.now() + 86_400_000) return { ok: false, error: "Give the date you completed it (not in the future).", status: 400 };
  const hours = a.hours === "" || a.hours == null ? null : Number(a.hours);
  if (hours !== null && !(Number.isFinite(hours) && hours > 0 && hours <= 1000)) return { ok: false, error: "Hours are above zero and at most 1000, or blank.", status: 400 };
  let doc: Record<string, unknown> = {};
  if (a.file) {
    const p = evidenceProblem(a.file);
    if (p) return { ok: false, error: p, status: 400 };
    const safe = (a.file.name || "document").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "document";
    const path = `${userId}/${randomUUID()}-${safe}`;
    const up = await admin.storage.from(EVIDENCE_BUCKET).upload(path, Buffer.from(await a.file.arrayBuffer()), { contentType: a.file.type, upsert: false });
    if (up.error) return { ok: false, error: "The document could not be stored just now.", status: 503 };
    doc = { document_path: path, document_name: safe, document_mime: a.file.type, document_bytes: a.file.size };
  }
  const { error } = await admin.from("learning_record").update({ status: "completed", completed_at: new Date().toISOString(), completion_kind: "external_completion", external_completed_on: a.completedOn,
    external_hours: hours === null ? null : Math.round(hours * 10) / 10, reflection: (a.reflection ?? "").trim().slice(0, 5000) || null, ...doc }).eq("id", rec.id).eq("user_id", userId).in("status", ["enrolled", "in_progress"]);
  if (error) { if (doc.document_path) await admin.storage.from(EVIDENCE_BUCKET).remove([doc.document_path]); return { ok: false, error: "Your completion could not be recorded just now.", status: 503 }; }
  return { ok: true };
}

/** Withdraw from a record that is not completed. It stays, as withdrawn. */
export async function withdraw(admin: any, userId: string, recordId: string): Promise<R> {
  const rec = await ownRecord(admin, userId, recordId);
  if (!rec) return { ok: false, error: "No such record.", status: 404 };
  const { data, error } = await admin.from("learning_record").update({ status: "withdrawn" }).eq("id", rec.id).eq("user_id", userId).in("status", ["enrolled", "in_progress"]).select("id");
  if (error) return { ok: false, error: "That could not be done just now.", status: 503 };
  return data?.length ? { ok: true } : { ok: false, error: "Only learning in progress can be withdrawn from.", status: 409 };
}

/** The lesson player's state for one record: the learner view of its pinned version and what is done. */
export async function learnState(admin: any, userId: string, recordId: string): Promise<{ record: any; content: Blueprint; done: Awaited<ReturnType<typeof done>>; next: string | null; accessLive: boolean; code: string; title: string } | null> {
  const rec = await ownRecord(admin, userId, recordId);
  if (!rec || rec.delivery !== "hosted") return null;
  const ver = await versionOf(admin, rec.version_id);
  if (!ver) return null;
  const d = await done(admin, rec.id);
  return { record: rec, content: learnerView(ver.content), done: d, next: resumePoint(ver.content, d), accessLive: await accessLive(admin, rec), code: ver.v.learning_offering.code, title: ver.v.learning_offering.title };
}

/** A short-lived URL for one lesson file, only for a person with live access to a version that names that file. */
export async function signLessonMedia(admin: any, userId: string, recordId: string, mediaPath: string): Promise<string | null> {
  const rec = await ownRecord(admin, userId, recordId);
  if (!rec || rec.delivery !== "hosted" || !(await accessLive(admin, rec))) return null;
  const ver = await versionOf(admin, rec.version_id);
  const named = ver ? allActivities(ver.content).some(a => a.kind === "lesson" && a.blocks.some(b => (b.type === "image" || b.type === "pdf") && b.mediaPath === mediaPath)) : false;
  if (!named) return null;
  try { const { data, error } = await admin.storage.from("learning-content").createSignedUrl(mediaPath, 300); return error ? null : data?.signedUrl ?? null; } catch { return null; }
}

/** A short-lived URL for the person's own external evidence document. */
export async function signEvidence(admin: any, userId: string, recordId: string): Promise<string | null> {
  const rec = await ownRecord(admin, userId, recordId);
  if (!rec?.document_path || !String(rec.document_path).startsWith(`${userId}/`)) return null;
  try { const { data, error } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUrl(rec.document_path, 300); return error ? null : data?.signedUrl ?? null; } catch { return null; }
}

export type MyRecord = { id: string; offeringId: string; code: string; title: string; delivery: string; versionNo: number; status: string; enrolledAt: string; completedAt: string | null;
  completionKind: string | null; evidenceClass: string; hasDocument: boolean; accessKind: string; accessLive: boolean;
  certificates: { id: string; no: string; outcome: string; issuedAt: string; revokedAt: string | null; verificationCode: string }[] };

/** Every record of this person, newest first, with certificates. History is kept whatever happened to access. */
export async function myRecords(admin: any, userId: string): Promise<MyRecord[] | null> {
  const { data: rs, error } = await admin.from("learning_record").select("id, offering_id, version_id, delivery, status, enrolled_at, completed_at, completion_kind, evidence_class, document_path, access_kind, course_entitlement_id, learning_offering!inner(code, title), learning_offering_version!inner(version_no)")
    .eq("user_id", userId).order("enrolled_at", { ascending: false }).limit(500);
  if (error) return missing(error) ? [] : null;
  if (!rs?.length) return [];
  const [{ data: certs }, { data: live }] = await Promise.all([
    admin.from("learning_certificate").select("id, record_id, certificate_no, outcome, issued_at, revoked_at, verification_code").eq("user_id", userId),
    admin.from("individual_live_course_entitlement").select("id").eq("user_id", userId),
  ]);
  const liveIds = new Set((live ?? []).map((x: any) => x.id));
  return rs.map((r: any) => ({
    id: r.id, offeringId: r.offering_id, code: r.learning_offering.code, title: r.learning_offering.title, delivery: r.delivery, versionNo: r.learning_offering_version.version_no, status: r.status,
    enrolledAt: r.enrolled_at, completedAt: r.completed_at, completionKind: r.completion_kind, evidenceClass: r.evidence_class, hasDocument: !!r.document_path, accessKind: r.access_kind,
    accessLive: r.access_kind === "free" || (r.access_kind === "entitlement" && liveIds.has(r.course_entitlement_id)),
    certificates: (certs ?? []).filter((c: any) => c.record_id === r.id).map((c: any) => ({ id: c.id, no: c.certificate_no, outcome: c.outcome, issuedAt: c.issued_at, revokedAt: c.revoked_at, verificationCode: c.verification_code })),
  }));
}

/** Public verification by the code printed on a certificate: what it states, and whether it stands. Nothing else. */
export async function verifyCertificate(admin: any, code: string): Promise<{ no: string; snapshot: any; issuedAt: string; revoked: { at: string; reason: string | null } | null } | null> {
  if (!/^[a-z0-9]{24}$/.test(code ?? "")) return null;
  const { data } = await admin.from("learning_certificate").select("certificate_no, snapshot, issued_at, revoked_at, revoked_reason").eq("verification_code", code).maybeSingle();
  if (!data) return null;
  return { no: data.certificate_no, snapshot: data.snapshot, issuedAt: data.issued_at, revoked: data.revoked_at ? { at: data.revoked_at, reason: data.revoked_reason } : null };
}
