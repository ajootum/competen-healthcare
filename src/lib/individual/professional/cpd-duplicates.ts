/* eslint-disable @typescript-eslint/no-explicit-any */
import { individualAppEnabled } from "../gate";
import { loadIndividualPolicy } from "../policy";
import { postNotice, type PostResult } from "../notifications";
import { learningEnabled } from "@/lib/learning/policy";
import { currentTraceId } from "@/lib/trace";
import { LEARNING_UNMATCH_ACTION, countedOnce, learningRecordHref, loadProfessionalLearning, matchCpdToLearning, type CpdMatch, type MatchableCpd } from "./learning";

// ── A CPD ENTRY THAT IS ALREADY IN THE RECORD THROUGH COMPETEN LEARNING ── owner: "we don't post this and send a
// notification to the user", then "Use notifications in the user account, not Email" ────────────────────────────
//
// Same deterministic match as the read side (learning.ts matchCpdToLearning). Two moments:
//
//   AT ENTRY   adding or editing an entry that matches a completed Learning record is REFUSED -- the duplicate is
//              never posted -- with the course, its date and a link. "This is a different activity" saves it
//              anyway: the person's decision, written to audit_log BEFORE the row, so a saved override always has
//              its decision (a missing one would let the read side hide the entry's real hours).
//   LATER      a Learning completion that arrives after the person logged the same course: hours counted once on
//              read (learning.ts countedOnce), the row untouched, and the person notified by the daily
//              Professional job (scanLearningDuplicateNotices).
//
// ⚠ THE NOTICE IS IN THE PERSON'S ACCOUNT, NEVER EMAIL (src/lib/individual/notifications.ts, migration 466). One notice
// per course for a refusal and one per entry for the later case, made unrepeatable by 466's unique key. Its text
// names no course (the link opens the detail behind the person's sign-in). No dispatch(), no estate notifications row.
//
// ⚠ NOTHING THE PERSON WROTE IS EVER DELETED OR CHANGED HERE.

export const DIFFERENT_ACTIVITY_FIELD = "differentActivity";

type Candidate = Omit<MatchableCpd, "id">;

/**
 * The completed Learning record an entry about to be saved duplicates, or null. Learning off or unreadable: null
 * (Learning is optional, and an unreadable record must not stop the person saving their own CPD). On an edit, an
 * entry that already matched the same record before the edit is not refused: nothing new is posted, and it is
 * already counted once.
 */
export async function duplicateForSave(admin: any, userId: string, entry: Candidate, before: (MatchableCpd & { id: string }) | null): Promise<CpdMatch | null> {
  const learning = await loadProfessionalLearning(admin, userId);
  if (!learning.enabled || !learning.refs?.length) return null;
  const windowDays = (await loadIndividualPolicy(admin)).professionalLearningMatchDays;
  const id = before?.id ?? "new-entry";
  // An edit is checked against the person's earlier "different activity" decisions. If those cannot be read, an
  // edit is not refused (the decision may exist). A new entry has no decisions yet.
  if (before && learning.unmatched === null) return null;
  const decided = before ? learning.unmatched ?? new Set<string>() : new Set<string>();
  const match = matchCpdToLearning([{ id, ...entry }], learning.refs, windowDays, decided).get(id) ?? null;
  if (!match || !before) return match;
  const already = matchCpdToLearning([before], learning.refs, windowDays, decided).get(before.id);
  return already?.recordId === match.recordId ? null : match;
}

/** Pure: the refusal, in plain words, with the record and the override. Shown to the person who is saving. */
export function refusalBody(m: CpdMatch) {
  return {
    error: `This course is already in your record through Competen Learning: ${m.title}, ${m.completedOn}. It was not saved again, so its hours are not counted twice.`,
    duplicate: { recordId: m.recordId, title: m.title, completedOn: m.completedOn },
    link: { href: learningRecordHref(m.recordId), label: "Open it in Competen Learning" },
    override: { field: DIFFERENT_ACTIVITY_FIELD, label: "This is a different activity: save it anyway" },
  };
}

/** The override: the person's decision, written before the row it is about. False = not saved (so neither is the row). */
export async function recordDifferentActivity(admin: any, userId: string, cpdId: string, recordId: string): Promise<boolean> {
  const { error } = await admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: userId, actor_name: null,
    action: LEARNING_UNMATCH_ACTION, entity_type: "individual_professional_cpd", entity_id: cpdId,
    new_value: { experience: "professional", learning_record_id: recordId, at: "entry" },
  });
  return !error;
}

export type NoticeKind = "refused" | "counted_once";
export const NOTICE_KIND: Record<NoticeKind, string> = { refused: "cpd_duplicate_refused", counted_once: "cpd_duplicate_counted_once" };

/** Pure: the in-account notice. Its text names no course or record: the link opens the detail. */
export function duplicateNotice(kind: NoticeKind, m: CpdMatch) {
  return kind === "refused"
    ? { kind: NOTICE_KIND.refused, dedupeKey: `learning_record:${m.recordId}`, href: learningRecordHref(m.recordId),
        body: "A course you tried to add to your CPD log is already in your record through Competen Learning, so it was not added again and its hours are not counted twice. If it was a different activity, add it again and choose \"This is a different activity\"." }
    : { kind: NOTICE_KIND.counted_once, dedupeKey: `cpd:${m.cpdId}:${m.recordId}`, href: "/individual/professional/cpd",
        body: "A course in your CPD log is also in your record through Competen Learning, so its hours are now counted once. Your entry is kept as you wrote it. If it was a different activity, say so on the entry." };
}

/** Post the notice to the person's own account. Never throws: a refusal or a job must not fail because of a notice. */
export const notifyDuplicate = (admin: any, userId: string, kind: NoticeKind, m: CpdMatch): Promise<PostResult> =>
  postNotice(admin, userId, duplicateNotice(kind, m));

export type DuplicateScan = { posted: number; already: number; failed: number; disabled?: true };

/**
 * Daily (the individual_professional_reminders job): people who hold Professional now, with an entry they logged
 * that a later Learning completion counts once, get one in-account notice per entry. Changes no CPD row.
 */
export async function scanLearningDuplicateNotices(admin: any): Promise<DuplicateScan> {
  const out: DuplicateScan = { posted: 0, already: 0, failed: 0 };
  if (!(await individualAppEnabled(admin)) || !(await learningEnabled(admin))) return { ...out, disabled: true };
  const windowDays = (await loadIndividualPolicy(admin)).professionalLearningMatchDays;
  const { data: live, error: liveErr } = await admin.from("individual_live_entitlement").select("user_id").eq("experience_code", "professional").limit(20000);
  if (liveErr) throw new Error(`individual_live_entitlement: ${liveErr.message}`);
  const users = [...new Set(((live ?? []) as any[]).map(r => r.user_id).filter(Boolean))] as string[];
  if (!users.length) return out;
  const { data: members } = await admin.from("individual_membership").select("user_id").in("user_id", users).eq("status", "active");
  const active = ((members ?? []) as any[]).map(m => m.user_id as string);
  if (!active.length) return out;
  const { data: rows, error } = await admin.from("individual_professional_cpd").select("id, user_id, title, provider, activity_type, activity_date")
    .in("user_id", active).in("activity_type", ["course", "workshop"]).limit(20000);
  if (error) throw new Error(`individual_professional_cpd: ${error.message}`);
  const byUser = new Map<string, MatchableCpd[]>();
  for (const r of (rows ?? []) as any[]) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  for (const [userId, cpd] of byUser) {
    const learning = await loadProfessionalLearning(admin, userId);
    const { matches } = countedOnce(cpd, learning, windowDays);
    for (const m of matches.values()) {
      if (out.posted >= 1000) return out;
      const r = await notifyDuplicate(admin, userId, "counted_once", m);
      if (r === "posted") out.posted++; else if (r === "already") out.already++; else if (r === "failed") out.failed++;
      // "unavailable" (466 not applied here): nothing to count, and nothing to retry until it is.
    }
  }
  return out;
}
