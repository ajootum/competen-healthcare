/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../individual/access";
import { composeFullName, type Participation, type PersonDetails } from "./person-details";

// ── WHAT HQ RECORDS ABOUT A PERSON IT HAS JUST INVITED ── owner GO "HQ User Management, Invitations and Individual
//    Profile Completion" (2 Nov 2026), migration 850 ────────────────────────────────────────────────────────────────
//
// Called by POST /api/hq/individual/invitations AFTER the invitation row exists. It lives in the HQ plane, not in
// src/lib/individual, because scripts/individual-foundation-harness.ts pins that no Individual file writes profiles
// except to clear a new identity role to null (1d, 12n) and that the Individual files write nothing but their own
// tables (2a). The details are HQ's act, so HQ's module records them.
//
// ⚠ ONLY THE IDENTITY THIS INVITATION CREATED. `reusedIdentity` true means the identity already existed (a previous
// invitation made it and it never signed in): its name, phone, country and preferred name are NOT touched. The
// participation label is a different matter: it is a label on an identity that holds nothing, set by this invitation.
//
// ⚠ BEST EFFORT, NEVER UNDOING THE INVITATION. A failure here is returned as a warning for the administrator. The
// invitation is already recorded, the full name is already on the identity from the invite metadata, and every
// value can be edited later (PATCH /api/super-admin/users/profile).
//
// ⚠ FAILS CLOSED WHILE 850 IS ABSENT. middle_names is dropped and the write retried. The participation write is
// skipped and reported as not set up. Nothing here reads the label to decide anything.

export type InviteeRecord = {
  details: "none" | "set" | "partial" | "failed";
  participation: { category: Participation; status: "set" | "not_set_up" | "failed" };
  preferredName: "none" | "set" | "skipped";
  warnings: string[];
};

export async function recordInviteeDetails(
  admin: any,
  p: { authUserId: string; reusedIdentity: boolean; details: PersonDetails; participation: Participation; inviterId: string },
): Promise<InviteeRecord> {
  const out: InviteeRecord = { details: "none", participation: { category: p.participation, status: "set" }, preferredName: "none", warnings: [] };
  const d = p.details;

  // 1. Name parts, phone and country, onto an identity this call created.
  if (!p.reusedIdentity) {
    const full = composeFullName(d);
    // ⚠ COUNTRY IS ALWAYS WRITTEN for a new identity: profiles.country defaults to 'Kenya' in the database (migration
    //    001), so an invitation that did not choose one would otherwise store a country nobody chose. Null = not recorded.
    const supplied = !!(full || d.phone || d.country || d.givenName || d.familyName || d.middleNames);
    const base: Record<string, unknown> = { ...(full ? { full_name: full } : {}), ...(d.phone ? { phone: d.phone } : {}), country: d.country ?? null };
    const parts = { ...(d.givenName ? { given_name: d.givenName } : {}), ...(d.familyName ? { family_name: d.familyName } : {}) };
    const attempts: Record<string, unknown>[] = [
      { ...base, ...parts, ...(d.middleNames ? { middle_names: d.middleNames } : {}) },
      { ...base, ...parts },
      base,
    ].filter(a => Object.keys(a).length > 0);
    if (attempts.length) {
      let wrote = false;
      let lastWasMissingColumn = false;
      for (let i = 0; i < attempts.length; i++) {
        try {
          const res = await admin.from("profiles").update(attempts[i]).eq("id", p.authUserId);
          if (!res.error) { wrote = true; out.details = i === 0 ? "set" : "partial"; break; }
          lastWasMissingColumn = isNotProvisioned(res.error);
          if (!lastWasMissingColumn) break;
        } catch { break; }
      }
      if (!wrote && !supplied) { /* nothing the administrator entered was lost */ }
      else if (!wrote) { out.details = "failed"; out.warnings.push("The person's name parts, phone or country could not be saved. They can be added later from the user's details."); }
      else if (!supplied) out.details = "none";
      else if (out.details === "partial") out.warnings.push("Some details (such as middle names) are not available in this environment yet and were left out.");
    }
  }

  // 2. The preferred name: only for a new identity, and only where the person has no identity profile row yet
  //    (an insert that does nothing on conflict, never an overwrite).
  if (d.preferredName) {
    if (p.reusedIdentity) out.preferredName = "skipped";
    else {
      try {
        const res = await admin.from("individual_identity_profile")
          .upsert({ user_id: p.authUserId, preferred_name: d.preferredName }, { onConflict: "user_id", ignoreDuplicates: true });
        if (res?.error) { out.preferredName = "skipped"; out.warnings.push("The preferred name could not be saved."); } else out.preferredName = "set";
      } catch { out.preferredName = "skipped"; }
    }
  }

  // 3. The participation label. It decides no access. Absent table: skipped and reported as not set up.
  try {
    const res = await admin.from("hq_account_participation")
      .upsert({ user_id: p.authUserId, category: p.participation, reason: "Set at invitation", set_by: p.inviterId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (res?.error) {
      out.participation.status = isNotProvisioned(res.error) ? "not_set_up" : "failed";
      out.warnings.push(out.participation.status === "not_set_up" ? "The participation label was not recorded (not set up in this environment yet)." : "The participation label could not be saved.");
    }
  } catch { out.participation.status = "failed"; out.warnings.push("The participation label could not be saved."); }

  return out;
}
