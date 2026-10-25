/* eslint-disable @typescript-eslint/no-explicit-any */
import { individualAppEnabled } from "../gate";
import { loadIndividualPolicy } from "../policy";
import { learningEnabled } from "@/lib/learning/policy";
import { currentTraceId } from "@/lib/trace";
import { LEARNING_UNMATCH_ACTION, countedOnce, learningRecordHref, loadProfessionalLearning, matchCpdToLearning, type CpdMatch, type MatchableCpd } from "./learning";
import { loadReminderPrefs } from "./preferences";
import { dispatchEmail, type ReminderSender } from "./reminders";

// ── A CPD ENTRY THAT IS ALREADY IN THE RECORD THROUGH COMPETEN LEARNING ── owner: "we don't post this and send a
// notification to the user" ─────────────────────────────────────────────────────────────────────────────────────
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
// ⚠ NOTIFICATION = THE EXISTING INDIVIDUAL CHANNELS, AS reminders.ts USES THEM. In the app, the refusal itself and the
// "Counted once" mark on the entry (an Individual-only person has no notification inbox, and `notifications` rows
// are counted on estate consoles). By email, through dispatch(), only to people whose reminder_email is on (374,
// opt-in, off by default), at most once per learning record per kind -- an ids-only audit_log marker, no migration.
// A failed send leaves no marker, so it is tried again.
//
// ⚠ NOTHING THE PERSON WROTE IS EVER DELETED OR CHANGED HERE.

export const DIFFERENT_ACTIVITY_FIELD = "differentActivity";
export const DUPLICATE_NOTICE_ACTION = "individual_professional_cpd_learning_duplicate_notice";

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

/** Pure: the refusal, in plain words, with the record and the override. */
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

/** Pure: the email. Its subject names no course -- subjects travel through more systems than bodies. */
export function noticeMessage(kind: NoticeKind, m: CpdMatch) {
  return {
    type: "reminder",
    title: "A course is already in your Competen Professional record",
    body: kind === "refused"
      ? `You tried to add ${m.title} to your CPD log, but it is already in your record through Competen Learning (completed ${m.completedOn}). It was not added again, so its hours are not counted twice. If it was a different activity, add it again and choose "This is a different activity".`
      : `${m.title}, which you logged in your CPD log, is also in your record through Competen Learning (completed ${m.completedOn}). Its hours are now counted once. Your entry is kept as you wrote it. If it was a different activity, say so on the entry.`,
    href: kind === "refused" ? learningRecordHref(m.recordId) : "/individual/professional/cpd",
  };
}

const markerOf = (kind: NoticeKind, m: CpdMatch) => kind === "refused"
  ? { entity_type: "learning_record", entity_id: m.recordId, kind }
  : { entity_type: "individual_professional_cpd", entity_id: m.cpdId, kind };

/**
 * Email the person about a duplicate, if they opted in, once per (kind, record or entry). Never throws: a refusal
 * or a page must not fail because a notice could not go out. Returns what happened, for the caller and the tests.
 */
export async function notifyDuplicate(admin: any, userId: string, kind: NoticeKind, m: CpdMatch, send: ReminderSender = dispatchEmail): Promise<"sent" | "not_opted_in" | "already" | "failed"> {
  try {
    if (!(await loadReminderPrefs(admin, userId)).email) return "not_opted_in";
    const mk = markerOf(kind, m);
    const { data, error } = await admin.from("audit_log").select("id, new_value").eq("actor_id", userId).eq("action", DUPLICATE_NOTICE_ACTION)
      .eq("entity_type", mk.entity_type).eq("entity_id", mk.entity_id).limit(20);
    if (error) return "failed";
    if ((data ?? []).some((r: any) => r?.new_value?.kind === kind && (kind === "refused" || r?.new_value?.learning_record_id === m.recordId))) return "already";
    const result = await send(admin, userId, noticeMessage(kind, m));
    if (!result.sent) return "failed";
    await admin.from("audit_log").insert({
      trace_id: await currentTraceId(), actor_id: userId, actor_name: null, action: DUPLICATE_NOTICE_ACTION,
      entity_type: mk.entity_type, entity_id: mk.entity_id, new_value: { experience: "professional", kind, learning_record_id: m.recordId },
    });
    return "sent";
  } catch { return "failed"; }
}

export type DuplicateScan = { sent: number; already: number; failed: number; disabled?: true };

/**
 * Daily (the individual_professional_reminders job): people who hold Professional, opted in to email, with an entry
 * they logged that a later Learning completion now counts once. Reads and notifies; changes no CPD row.
 */
export async function scanLearningDuplicateNotices(admin: any, send: ReminderSender = dispatchEmail): Promise<DuplicateScan> {
  const out: DuplicateScan = { sent: 0, already: 0, failed: 0 };
  if (!(await individualAppEnabled(admin)) || !(await learningEnabled(admin))) return { ...out, disabled: true };
  const windowDays = (await loadIndividualPolicy(admin)).professionalLearningMatchDays;
  const { data: live, error: liveErr } = await admin.from("individual_live_entitlement").select("user_id").eq("experience_code", "professional").limit(20000);
  if (liveErr) throw new Error(`individual_live_entitlement: ${liveErr.message}`);
  const users = [...new Set(((live ?? []) as any[]).map(r => r.user_id).filter(Boolean))] as string[];
  if (!users.length) return out;
  const { data: members } = await admin.from("individual_membership").select("user_id").in("user_id", users).eq("status", "active");
  const entitled = ((members ?? []) as any[]).map(m => m.user_id as string);
  if (!entitled.length) return out;
  const { data: optedIn, error: optErr } = await admin.from("individual_professional_profile").select("user_id").in("user_id", entitled).eq("reminder_email", true).limit(20000);
  const active = optErr ? [] : ((optedIn ?? []) as any[]).map(r => r.user_id as string);
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
      if (out.sent >= 1000) return out;
      const r = await notifyDuplicate(admin, userId, "counted_once", m, send);
      if (r === "sent") out.sent++; else if (r === "already") out.already++; else if (r === "failed") out.failed++;
    }
  }
  return out;
}
