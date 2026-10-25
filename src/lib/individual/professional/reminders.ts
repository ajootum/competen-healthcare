/* eslint-disable @typescript-eslint/no-explicit-any */
import { dispatch } from "@/lib/notifications/dispatch";
import { loadIndividualPolicy } from "../policy";
import { individualAppEnabled } from "../gate";
import { scanLearningDuplicateNotices } from "./cpd-duplicates";

// ── EXPIRY REMINDERS FOR THE PERSON'S OWN CREDENTIALS AND REGISTRATION ── COMPETEN-IND-007 s4 ────────────
//
// Run daily by the platform job runner (src/lib/platform/jobs.ts, key individual_professional_reminders).
// Reuses the notification dispatcher's EMAIL channel (src/lib/notifications/dispatch.ts -- Resend, with a
// delivery row per attempt). One reminder per expiry date, recorded on the row it is about.
//
// ⚠ NOT cdp_reminders. The estate's reminder ledger is stamped with the person's hospital_id and its
// console lists subject labels by hospital (src/lib/delivery/reminders.ts loadReminderStatus). A reminder
// about a credential kept in Competen Professional, recorded there, would tell the employer it exists.
// So the once-only mark is a column on the person's own row (migration 373: expiry_reminded_for,
// registration_reminded_for), which 373's CHECK ties to the expiry date it was about.
//
// ⚠ EMAIL, NOT AN IN-APP NOTIFICATION ROW. `notifications` rows are counted by type across every user on
// estate consoles (educator communication, assessor automation), and an Individual-only person has no
// notification inbox to read them in. The in-app surface for these reminders is Competen Professional's
// own evidence and home pages, which compute "expires soon" from the same rows on every visit
// (renewals.ts), shown while the person's in-app switch is on.
//
// ⚠ EMAIL IS OPT-IN (migration 374, owner continuation GO). Only people whose reminder_email is TRUE are
// emailed. It defaults to false. If the column is absent (374 not applied), nobody is emailed. The switch
// is the person's own, on their own row, and never the estate notification_preferences (owner ruling D1).
//
// ⚠ ONLY PEOPLE WHO HOLD PROFESSIONAL NOW. Liveness comes from individual_live_entitlement (the database
// clock, migration 370). A person whose Professional period ended keeps their record and gets no mail.

// ⚠ PART B (COMPETEN-PROFESSIONAL-PROFILE-01, owner continuation GO): CONFIGURABLE SCHEDULE AND ELIGIBILITY.
// The Individual policy (WCE) decides what is reminded (professional_reminder_kinds), which registration
// standings count (professional_reminder_standings), and, for profile records (migration 450), at which
// offsets before expiry (professional_reminder_offsets). A profile record gets ONE email for the tightest
// offset it has reached and not yet been reminded at: added 20 days before expiry with offsets 60 and 30, it
// is reminded once (at 30), not twice. The once-only claim for profile records is a row in migration 452's
// ledger, keyed on record, expiry date and offset. The primary registration and credentials keep the MVP's
// single lead time and their own marks, unchanged.

export type ReminderCandidate = {
  table: "individual_professional_evidence" | "individual_professional_profile" | "individual_professional_profile_item";
  /** Profile records only: the offset this reminder is for (452's key). */
  offsetDays?: number;
  /** Where the email sends the person to update the record. */
  href?: string;
  id: string;
  userId: string;
  expiresOn: string;
  title: string;
  /** The marker before this run, restored if the send does not succeed. */
  prior: string | null;
};

/** Sends one reminder email and says whether it was delivered. Injected so tests can plant a failure. */
export type ReminderSender = (admin: any, userId: string, message: ReturnType<typeof reminderMessage>) => Promise<{ sent: boolean; error?: string }>;

/** The existing email sender: dispatch() (Resend), which records a notif_deliveries row for every attempt. */
export const dispatchEmail: ReminderSender = async (admin, userId, message) => {
  try {
    const { deliveries } = await dispatch(admin, [userId], message, ["email"]);
    const email = deliveries.find(d => d.channel === "email");
    return email?.status === "sent" ? { sent: true } : { sent: false, error: email?.error ?? email?.status ?? "no delivery attempted" };
  } catch (e: any) {
    return { sent: false, error: String(e?.message ?? e) };
  }
};

/** Pure: the reminder message. The title names nothing -- subjects travel through more systems than bodies. */
export function reminderMessage(c: ReminderCandidate, today: string) {
  const past = c.expiresOn < today;
  return {
    type: "reminder",
    title: past ? "A credential on your Competen Professional record has expired" : "A credential on your Competen Professional record expires soon",
    body: `${c.title} ${past ? "expired" : "expires"} on ${c.expiresOn}, according to the date you recorded. Competen has not checked this with the issuing body. Update the record in Competen Professional once you have renewed it.`,
    href: c.href ?? "/individual/professional/evidence",
  };
}

/**
 * The job runner's one door into Professional (individual-professional-harness R3) also carries the CPD duplicate
 * notices (cpd-duplicates.ts): a Learning completion that now counts an entry the person logged once. They are posted
 * in the person's own account (migration 466), never emailed.
 */
export const scanDuplicateNotices = (admin: any) => scanLearningDuplicateNotices(admin);

export type ScanResult = { sent: number; skipped: number; failed: number; recipients: string[]; failures: { userId: string; error: string }[]; disabled?: true };

const EMPTY = (): ScanResult => ({ sent: 0, skipped: 0, failed: 0, recipients: [], failures: [] });

export async function scanProfessionalReminders(admin: any, now = new Date(), send: ReminderSender = dispatchEmail): Promise<ScanResult> {
  // The release gate (src/lib/individual/gate.ts): while Competen Individual is off it does not exist, and
  // nobody is emailed about it.
  if (!(await individualAppEnabled(admin))) return { ...EMPTY(), disabled: true };
  const today = now.toISOString().slice(0, 10);
  // The lead time is Individual policy (COMPETEN-CONFIG-002), clamped to its fixed range, 60 days by default.
  const horizonDays = (await loadIndividualPolicy(admin)).reminderHorizonDays;
  // Part B: what is reminded, and on what schedule, comes from the same policy.
  const policy = await loadIndividualPolicy(admin);
  const kinds = new Set(policy.professionalProfile.reminderKinds);
  const horizon = new Date(now.getTime() + horizonDays * 864e5).toISOString().slice(0, 10);

  const { data: live, error: liveErr } = await admin.from("individual_live_entitlement").select("user_id").eq("experience_code", "professional").limit(20000);
  if (liveErr) throw new Error(`individual_live_entitlement: ${liveErr.message}`);
  const users = [...new Set(((live ?? []) as any[]).map(r => r.user_id).filter(Boolean))] as string[];
  if (!users.length) return EMPTY();
  const { data: members } = await admin.from("individual_membership").select("user_id").in("user_id", users).eq("status", "active");
  const entitled = ((members ?? []) as any[]).map(m => m.user_id as string);
  if (!entitled.length) return EMPTY();
  // Opted in to email: reminder_email = true on their own row. An error (374 absent, or unreadable) means
  // nobody is emailed -- the opt-in cannot be confirmed, and email is never the default.
  const { data: optedIn, error: optErr } = await admin.from("individual_professional_profile")
    .select("user_id").in("user_id", entitled).eq("reminder_email", true).limit(20000);
  const active = new Set(optErr ? [] : ((optedIn ?? []) as any[]).map(r => r.user_id as string));
  if (!active.size) return EMPTY();

  const candidates: ReminderCandidate[] = [];
  const { data: creds, error: credErr } = !kinds.has("credentials") ? { data: [], error: null } : await admin.from("individual_professional_evidence")
    .select("id, user_id, title, expires_on, expiry_reminded_for").eq("kind", "credential")
    .not("expires_on", "is", null).lte("expires_on", horizon).in("user_id", [...active]).limit(5000);
  if (credErr) throw new Error(`individual_professional_evidence: ${credErr.message}`);
  for (const c of (creds ?? []) as any[]) {
    if (c.expiry_reminded_for === c.expires_on) continue;
    candidates.push({ table: "individual_professional_evidence", id: c.id, userId: c.user_id, expiresOn: c.expires_on, title: c.title, prior: c.expiry_reminded_for ?? null });
  }
  const { data: regs, error: regErr } = !kinds.has("primary_registration") ? { data: [], error: null } : await admin.from("individual_professional_profile")
    .select("id, user_id, self_declared_registration_body, self_declared_registration_expires_on, registration_reminded_for")
    .not("self_declared_registration_expires_on", "is", null).lte("self_declared_registration_expires_on", horizon).in("user_id", [...active]).limit(5000);
  if (regErr) throw new Error(`individual_professional_profile: ${regErr.message}`);
  for (const r of (regs ?? []) as any[]) {
    if (r.registration_reminded_for === r.self_declared_registration_expires_on) continue;
    candidates.push({
      table: "individual_professional_profile", id: r.id, userId: r.user_id, expiresOn: r.self_declared_registration_expires_on, prior: r.registration_reminded_for ?? null,
      title: r.self_declared_registration_body ? `Your registration with ${r.self_declared_registration_body}` : "Your professional registration",
    });
  }

  candidates.push(...await profileItemCandidates(admin, [...active], today, policy.professionalProfile));

  const out = EMPTY();
  const recipients = new Set<string>();
  for (const c of candidates.slice(0, 1000)) {
    // CLAIM first, conditionally on the date still being the one we are reminding about: the update is the
    // once-only gate, so two overlapping runs cannot both send.
    const mark = c.table === "individual_professional_profile_item"
      ? await admin.from("individual_professional_reminder_log").insert({ user_id: c.userId, item_id: c.id, expires_on: c.expiresOn, offset_days: c.offsetDays }).select("id")
      : c.table === "individual_professional_evidence"
      ? await admin.from("individual_professional_evidence").update({ expiry_reminded_for: c.expiresOn })
        .eq("id", c.id).eq("expires_on", c.expiresOn).or(`expiry_reminded_for.is.null,expiry_reminded_for.neq.${c.expiresOn}`).select("id")
      : await admin.from("individual_professional_profile").update({ registration_reminded_for: c.expiresOn })
        .eq("id", c.id).eq("self_declared_registration_expires_on", c.expiresOn).or(`registration_reminded_for.is.null,registration_reminded_for.neq.${c.expiresOn}`).select("id");
    if (mark.error || !(mark.data ?? []).length) { out.skipped++; continue; }

    // ⚠ A CLAIM IS NOT A SEND (owner review, 2026-10-23). The marker stays only when the email was actually
    // delivered. A failed or skipped send -- provider down, provider not configured, no address -- RELEASES
    // the claim back to its prior value, so the next run tries again instead of the reminder being silently
    // used up. The attempt stays observable: dispatch() records a notif_deliveries row with its status and
    // error, the failure is logged here, and the job run reports the failed count.
    const result = await send(admin, c.userId, reminderMessage(c, today));
    if (result.sent) { recipients.add(c.userId); out.sent++; continue; }
    const release = c.table === "individual_professional_profile_item"
      ? await admin.from("individual_professional_reminder_log").delete().eq("item_id", c.id).eq("expires_on", c.expiresOn).eq("offset_days", c.offsetDays).select("id")
      : c.table === "individual_professional_evidence"
      ? await admin.from("individual_professional_evidence").update({ expiry_reminded_for: c.prior })
        .eq("id", c.id).eq("expiry_reminded_for", c.expiresOn).select("id")
      : await admin.from("individual_professional_profile").update({ registration_reminded_for: c.prior })
        .eq("id", c.id).eq("registration_reminded_for", c.expiresOn).select("id");
    const error = `${result.error ?? "not delivered"}${release.error ? ` (and the claim could not be released: ${release.error.message})` : ""}`;
    console.error(`[individual_professional_reminders] email to ${c.userId} for ${c.table}:${c.id} not delivered -- ${error}`);
    out.failed++;
    out.failures.push({ userId: c.userId, error });
  }
  out.recipients = [...recipients];
  return out;
}

/** Pure: the offset a profile record is due at today -- the tightest one reached -- or null when none is. */
export function dueOffset(expiresOn: string, today: string, offsets: readonly number[]): number | null {
  const daysLeft = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
  const due = offsets.filter(o => daysLeft <= o);
  return due.length ? Math.min(...due) : null;
}

/** Pure: whether a profile record is eligible under the policy (kind and, for a registration, its standing). */
export function itemEligible(i: { section: string; type_code: string | null }, p: { reminderKinds: readonly string[]; reminderStandings: readonly string[] }): boolean {
  if (i.section === "registration") return p.reminderKinds.includes("registration_items") && (i.type_code === null || p.reminderStandings.includes(i.type_code));
  if (i.section === "qualification") return p.reminderKinds.includes("qualification_items");
  return false;
}

/**
 * Profile records due a reminder now (migration 450 records, 452 ledger). FAIL-SOFT: before 450/452 are applied,
 * or on any error, it returns none -- the MVP reminders above must never stop because of this branch.
 */
async function profileItemCandidates(admin: any, users: string[], today: string,
  p: { reminderKinds: readonly string[]; reminderStandings: readonly string[]; reminderOffsets: readonly number[] }): Promise<ReminderCandidate[]> {
  try { return await itemCandidates(admin, users, today, p); } catch { return []; }
}

async function itemCandidates(admin: any, users: string[], today: string,
  p: { reminderKinds: readonly string[]; reminderStandings: readonly string[]; reminderOffsets: readonly number[] }): Promise<ReminderCandidate[]> {
  if (!users.length || !p.reminderOffsets.length || !(p.reminderKinds.includes("registration_items") || p.reminderKinds.includes("qualification_items"))) return [];
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + Math.max(...p.reminderOffsets) * 864e5).toISOString().slice(0, 10);
  const { data: items, error } = await admin.from("individual_professional_profile_item")
    .select("id, user_id, section, title, type_code, expires_on").in("section", ["registration", "qualification"]).in("user_id", users)
    .is("superseded_at", null).is("withdrawn_at", null).not("expires_on", "is", null).lte("expires_on", horizon).limit(5000);
  if (error) return [];
  const due = ((items ?? []) as any[]).filter(i => itemEligible(i, p)).map(i => ({ i, offset: dueOffset(i.expires_on, today, p.reminderOffsets) })).filter(x => x.offset !== null);
  if (!due.length) return [];
  const { data: sent, error: logErr } = await admin.from("individual_professional_reminder_log").select("item_id, expires_on, offset_days").in("item_id", due.map(d => d.i.id));
  if (logErr) return [];
  const done = new Set(((sent ?? []) as any[]).map(r => `${r.item_id}|${r.expires_on}|${r.offset_days}`));
  return due.filter(d => !done.has(`${d.i.id}|${d.i.expires_on}|${d.offset}`)).map(d => ({
    table: "individual_professional_profile_item" as const, id: d.i.id, userId: d.i.user_id, expiresOn: d.i.expires_on, prior: null, offsetDays: d.offset!,
    title: d.i.section === "registration" ? `Your registration "${d.i.title}"` : `Your qualification "${d.i.title}"`,
    href: "/individual/professional/registration",
  }));
}
