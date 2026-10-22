/* eslint-disable @typescript-eslint/no-explicit-any */
import { dispatch } from "@/lib/notifications/dispatch";
import { REMINDER_HORIZON_DAYS } from "./vocabulary";

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
// own evidence and home pages, which compute "expires soon" from the same rows on every visit.
//
// ⚠ ONLY PEOPLE WHO HOLD PROFESSIONAL NOW. Liveness comes from individual_live_entitlement (the database
// clock, migration 370). A person whose Professional period ended keeps their record and gets no mail.

export type ReminderCandidate = {
  table: "individual_professional_evidence" | "individual_professional_profile";
  id: string;
  userId: string;
  expiresOn: string;
  title: string;
};

/** Pure: the reminder message. The title names nothing -- subjects travel through more systems than bodies. */
export function reminderMessage(c: ReminderCandidate, today: string) {
  const past = c.expiresOn < today;
  return {
    type: "reminder",
    title: past ? "A credential on your Competen Professional record has expired" : "A credential on your Competen Professional record expires soon",
    body: `${c.title} ${past ? "expired" : "expires"} on ${c.expiresOn}, according to the date you recorded. Competen has not checked this with the issuing body. Update the record in Competen Professional once you have renewed it.`,
    href: "/individual/professional/evidence",
  };
}

export async function scanProfessionalReminders(admin: any, now = new Date()): Promise<{ sent: number; skipped: number }> {
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + REMINDER_HORIZON_DAYS * 864e5).toISOString().slice(0, 10);

  const { data: live, error: liveErr } = await admin.from("individual_live_entitlement").select("user_id").eq("experience_code", "professional").limit(20000);
  if (liveErr) throw new Error(`individual_live_entitlement: ${liveErr.message}`);
  const users = [...new Set(((live ?? []) as any[]).map(r => r.user_id).filter(Boolean))] as string[];
  if (!users.length) return { sent: 0, skipped: 0 };
  const { data: members } = await admin.from("individual_membership").select("user_id").in("user_id", users).eq("status", "active");
  const active = new Set(((members ?? []) as any[]).map(m => m.user_id));

  const candidates: ReminderCandidate[] = [];
  const { data: creds, error: credErr } = await admin.from("individual_professional_evidence")
    .select("id, user_id, title, expires_on, expiry_reminded_for").eq("kind", "credential")
    .not("expires_on", "is", null).lte("expires_on", horizon).in("user_id", [...active]).limit(5000);
  if (credErr) throw new Error(`individual_professional_evidence: ${credErr.message}`);
  for (const c of (creds ?? []) as any[]) {
    if (c.expiry_reminded_for === c.expires_on) continue;
    candidates.push({ table: "individual_professional_evidence", id: c.id, userId: c.user_id, expiresOn: c.expires_on, title: c.title });
  }
  const { data: regs, error: regErr } = await admin.from("individual_professional_profile")
    .select("id, user_id, self_declared_registration_body, self_declared_registration_expires_on, registration_reminded_for")
    .not("self_declared_registration_expires_on", "is", null).lte("self_declared_registration_expires_on", horizon).in("user_id", [...active]).limit(5000);
  if (regErr) throw new Error(`individual_professional_profile: ${regErr.message}`);
  for (const r of (regs ?? []) as any[]) {
    if (r.registration_reminded_for === r.self_declared_registration_expires_on) continue;
    candidates.push({
      table: "individual_professional_profile", id: r.id, userId: r.user_id, expiresOn: r.self_declared_registration_expires_on,
      title: r.self_declared_registration_body ? `Your registration with ${r.self_declared_registration_body}` : "Your professional registration",
    });
  }

  let sent = 0, skipped = 0;
  for (const c of candidates.slice(0, 1000)) {
    // Mark first, conditionally on the date still being the one we are reminding about: the update is the
    // once-only gate, so two overlapping runs cannot both send.
    const mark = c.table === "individual_professional_evidence"
      ? await admin.from("individual_professional_evidence").update({ expiry_reminded_for: c.expiresOn })
        .eq("id", c.id).eq("expires_on", c.expiresOn).or(`expiry_reminded_for.is.null,expiry_reminded_for.neq.${c.expiresOn}`).select("id")
      : await admin.from("individual_professional_profile").update({ registration_reminded_for: c.expiresOn })
        .eq("id", c.id).eq("self_declared_registration_expires_on", c.expiresOn).or(`registration_reminded_for.is.null,registration_reminded_for.neq.${c.expiresOn}`).select("id");
    if (mark.error || !(mark.data ?? []).length) { skipped++; continue; }
    await dispatch(admin, [c.userId], reminderMessage(c, today), ["email"]);
    sent++;
  }
  return { sent, skipped };
}
