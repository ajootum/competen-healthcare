/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { loadReminderPrefs } from "@/lib/individual/professional/preferences";
import { dueRenewals } from "@/lib/individual/professional/renewals";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { RenewalsDue } from "./RenewalsDue";

// The in-app reminder on the Competen Professional home (COMPETEN-IND-007, migration 374). Rendered by the
// experience home only for Professional, which the experience layout has already gated (release gate,
// gate 3, live entitlement, terms). Nothing when the person's in-app switch is off, or nothing is due.

export default async function HomeReminders({ admin, userId }: { admin: any; userId: string }) {
  const [prefs, record, policy] = await Promise.all([loadReminderPrefs(admin, userId), loadProfessionalRecord(admin, userId), loadIndividualPolicy(admin)]);
  if (!prefs.inApp) return null;
  const today = new Date().toISOString().slice(0, 10);
  const items = dueRenewals({
    registration: record.profile ? { body: record.profile.self_declared_registration_body, expiresOn: record.profile.self_declared_registration_expires_on } : null,
    credentials: record.evidence ?? [],
  }, today, policy.reminderHorizonDays);
  return <RenewalsDue items={items} today={today} linkToEvidence />;
}
