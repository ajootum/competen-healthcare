/* eslint-disable @typescript-eslint/no-explicit-any */
import { isAbsent } from "@/lib/hq/account-participation";
import { AUDIT_PAGE_SIZE } from "@/lib/hq/user-detail";

// ── THE USER DETAIL LOADER ── HQ users directory, owner GO 2 Nov 2026 ───────────────────────────────────────────
//
// Everything the profile shows beyond the directory row, for ONE person, read when the profile opens. It lives under
// src/app/super-admin/users/ so scripts/plane-boundary-harness.ts walks it: every individual_* and hq_account_*
// read below is judged against the allowlist in src/lib/access/plane-boundary.ts, column by column.
//
// ⚠ EACH SOURCE IS READ AND REPORTED SEPARATELY. A source that fails is `unreadable`, a table or column that is not
// there yet is `not_set_up` (migration 850 and 402 may be absent), and neither is ever shown as "none". A person with
// no Scholar programme is `ok` with a null value, which the screen words as Not applicable.
//
// ⚠ NOTHING PRIVATE. This reads labels the person chose to hold in their profile (programme, level, institution,
// profession, registration body and country) and HQ's own records about them. It reads no Scholar note, learning
// history, Personal AI, formative assessment, plan, passport item, registration number or biography, and the audit
// read selects names and times, never the old or new values of a change.

export type Src<T> = { state: "ok"; value: T } | { state: "not_set_up" } | { state: "unreadable" };

export type PersonalDetail = {
  email: string | null;
  fullName: string | null; givenName: string | null; middleNames: string | null; familyName: string | null;
  phone: string | null; country: string | null;
  /** Migration 380 (given/family) and 850 (middle) may be absent. */
  namesSupported: boolean; middleSupported: boolean;
};
export type PreferredName =
  | { kind: "chosen"; value: string | null }   // the person has an identity profile: read-only for HQ
  | { kind: "no_profile" }                      // none yet: nothing chosen
  | { kind: "not_set_up" } | { kind: "unreadable" };

export type EntitlementRow = {
  id: string; experience: string; status: string; live: boolean; startsAt: string; endsAt: string | null;
  source: string; planCode: string | null; grantedBy: string | null; createdAt: string;
};
export type InvitationRow = {
  id: string; status: string; live: boolean; experiences: string[]; expiresAt: string; endsAt: string | null;
  createdAt: string; acceptedAt: string | null; revokedAt: string | null;
  /** Migration 850: which source an accepted invitation writes. null is a legacy row, accepted as pilot. */
  entitlementSource: string | null; prefill: unknown;
};
export type MembershipRow = { status: string; source: string; onboardedAt: string | null; createdAt: string };
export type ParticipationDetail = {
  category: string; cohort: string | null; validUntil: string | null; reason: string; setBy: string | null; updatedAt: string | null;
};
export type AppointmentRow = {
  position: string; name: string | null; status: string; scope: string | null; validFrom: string | null; validTo: string | null;
};
export type AuditRow = {
  id: string; action: string; entityType: string | null; at: string; actor: string | null; direction: "by" | "on" | "both";
};
export type ClassificationRow = { id: string; at: string; by: string; from: string; to: string; reason: string | null };

export type UserDetail = {
  id: string;
  personal: Src<PersonalDetail>;
  preferred: PreferredName;
  education: {
    scholar: Src<{ programme: string | null; level: string | null; institution: string | null } | null>;
    professional: Src<{ profession: string | null; registrationBody: string | null; registrationCountry: string | null } | null>;
  };
  products: {
    membership: Src<MembershipRow | null>;
    entitlements: Src<EntitlementRow[]>;
    invitations: Src<InvitationRow[]>;
    participation: Src<ParticipationDetail | null>;
  };
  appointments: Src<AppointmentRow[]>;
  account: Src<{ createdAt: string | null; lastSignInAt: string | null; emailConfirmed: boolean; invitedAt: string | null; bannedUntil: string | null }>;
  classification: Src<ClassificationRow[]>;
  /** Names for the ids above (grantors, who set a category). Only id to full name. */
  names: Record<string, string>;
  audit: Src<AuditPage>;
};
export type AuditPage = { rows: AuditRow[]; page: number; more: boolean };

type Res = { data: any; error: any };

/** Run a read; map the rows on success; classify a failure as not-set-up (absent) or unreadable. Never throws. */
async function src<T>(run: PromiseLike<Res>, map: (data: any) => T): Promise<Src<T>> {
  try {
    const { data, error } = await run;
    if (error) return isAbsent(error) ? { state: "not_set_up" } : { state: "unreadable" };
    return { state: "ok", value: map(data) };
  } catch { return { state: "unreadable" }; }
}

/** Try each query in turn while the failure is "column absent"; return the first answer that is not. */
async function firstPresent(tries: (() => PromiseLike<Res>)[]): Promise<Res> {
  let last: Res = { data: null, error: { code: "42703" } };
  for (const t of tries) {
    try { last = await t(); } catch { return { data: null, error: { code: "XX000" } }; }
    if (!last.error || !isAbsent(last.error)) return last;
  }
  return last;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export async function loadAuditPage(admin: any, userId: string, page: number): Promise<Src<AuditPage>> {
  // One extra row says whether another page exists. old_value and new_value are never selected.
  return src(
    admin.from("audit_log")
      .select("id, actor_id, actor_name, action, entity_type, entity_id, created_at")
      .or(`entity_id.eq.${userId},actor_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .range(page * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE + AUDIT_PAGE_SIZE),
    (data: any[]) => {
      const rows = (data ?? []).slice(0, AUDIT_PAGE_SIZE).map(r => ({
        id: r.id as string, action: (r.action ?? "unknown") as string, entityType: text(r.entity_type), at: r.created_at as string,
        actor: text(r.actor_name),
        direction: (r.actor_id === userId && r.entity_id === userId ? "both" : r.actor_id === userId ? "by" : "on") as AuditRow["direction"],
      }));
      return { rows, page, more: (data ?? []).length > AUDIT_PAGE_SIZE };
    },
  );
}

export async function loadUserDetail(admin: any, userId: string): Promise<UserDetail> {
  const [
    profile, identity, scholar, professional, membership, ents, liveEnts, invs, liveInvs,
    participation, offices, authRes, classHistory, audit, programmes,
  ] = await Promise.all([
    firstPresent([
      () => admin.from("profiles").select("email, full_name, phone, country, given_name, middle_names, family_name").eq("id", userId).maybeSingle(),
      () => admin.from("profiles").select("email, full_name, phone, country, given_name, family_name").eq("id", userId).maybeSingle(),
      () => admin.from("profiles").select("email, full_name, phone, country").eq("id", userId).maybeSingle(),
    ]),
    admin.from("individual_identity_profile").select("user_id, preferred_name").eq("user_id", userId).maybeSingle(),
    firstPresent([
      () => admin.from("individual_scholar_learner").select("user_id, programme_code, level_label, institution_label").eq("user_id", userId).maybeSingle(),
      () => admin.from("individual_scholar_learner").select("user_id, programme_code").eq("user_id", userId).maybeSingle(),
    ]),
    admin.from("individual_professional_profile")
      .select("user_id, self_declared_profession, self_declared_registration_body, self_declared_registration_country")
      .eq("user_id", userId).maybeSingle(),
    admin.from("individual_membership").select("user_id, status, source, onboarded_at, created_at").eq("user_id", userId).maybeSingle(),
    firstPresent([
      () => admin.from("individual_entitlement")
        .select("id, user_id, experience_code, status, starts_at, ends_at, source, plan_code, granted_by, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
      () => admin.from("individual_entitlement")
        .select("id, user_id, experience_code, status, starts_at, ends_at, source, granted_by, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    ]),
    admin.from("individual_live_entitlement").select("id").eq("user_id", userId).limit(50),
    firstPresent([
      () => admin.from("individual_invitation")
        .select("id, status, invite_scholar, invite_professional, expires_at, entitlement_ends_at, created_at, accepted_at, revoked_at, entitlement_source, prefill")
        .eq("auth_user_id", userId).order("created_at", { ascending: false }).limit(20),
      () => admin.from("individual_invitation")
        .select("id, status, invite_scholar, invite_professional, expires_at, entitlement_ends_at, created_at, accepted_at, revoked_at")
        .eq("auth_user_id", userId).order("created_at", { ascending: false }).limit(20),
    ]),
    admin.from("individual_live_invitation").select("id").eq("auth_user_id", userId).limit(20),
    admin.from("hq_account_participation")
      .select("user_id, category, cohort_code, valid_until, set_by, reason, updated_at").eq("user_id", userId).maybeSingle(),
    admin.from("ogs_offices").select("id").like("office_type", "hq_%").limit(500),
    admin.auth.admin.getUserById(userId).then((r: any) => r, () => ({ data: null, error: { code: "XX000" } })),
    admin.from("audit_log").select("id, actor_name, old_value, new_value, created_at")
      .eq("action", "hq_account_classified").eq("entity_id", userId).order("created_at", { ascending: false }).limit(10),
    loadAuditPage(admin, userId, 0),
    // the catalogue, so a programme code reads as its name (platform configuration, names no person)
    admin.from("individual_scholar_programme").select("code, label").limit(500),
  ]);

  // ── personal ──
  const personal: Src<PersonalDetail> = profile.error
    ? { state: isAbsent(profile.error) ? "not_set_up" : "unreadable" }
    : !profile.data ? { state: "unreadable" }
    : {
      state: "ok",
      value: {
        email: text(profile.data.email), fullName: text(profile.data.full_name), givenName: text(profile.data.given_name),
        middleNames: text(profile.data.middle_names), familyName: text(profile.data.family_name),
        phone: text(profile.data.phone), country: text(profile.data.country),
        namesSupported: "given_name" in profile.data, middleSupported: "middle_names" in profile.data,
      },
    };

  const preferred: PreferredName = identity.error
    ? isAbsent(identity.error) ? { kind: "not_set_up" } : { kind: "unreadable" }
    : identity.data ? { kind: "chosen", value: text(identity.data.preferred_name) } : { kind: "no_profile" };

  // ── education: labels the person set in their own profile ──
  const programmeName = new Map<string, string>(programmes.error ? [] : (programmes.data ?? []).map((r: any) => [r.code, r.label]));
  const education: UserDetail["education"] = {
    scholar: scholar.error
      ? { state: isAbsent(scholar.error) ? "not_set_up" : "unreadable" }
      : { state: "ok", value: scholar.data ? {
        programme: programmeName.get(scholar.data.programme_code) ?? text(scholar.data.programme_code), level: text(scholar.data.level_label), institution: text(scholar.data.institution_label),
      } : null },
    professional: professional.error
      ? { state: isAbsent(professional.error) ? "not_set_up" : "unreadable" }
      : { state: "ok", value: professional.data ? {
        profession: text(professional.data.self_declared_profession),
        registrationBody: text(professional.data.self_declared_registration_body),
        registrationCountry: text(professional.data.self_declared_registration_country),
      } : null },
  };

  // ── products ──
  const liveIds = new Set<string>(liveEnts.error ? [] : (liveEnts.data ?? []).map((r: any) => r.id));
  const liveInvIds = new Set<string>(liveInvs.error ? [] : (liveInvs.data ?? []).map((r: any) => r.id));
  const grantorIds = new Set<string>();
  const entitlements: Src<EntitlementRow[]> = ents.error || liveEnts.error
    ? { state: (ents.error && isAbsent(ents.error)) || (liveEnts.error && isAbsent(liveEnts.error)) ? "not_set_up" : "unreadable" }
    : {
      state: "ok",
      value: (ents.data ?? []).map((r: any) => {
        if (r.granted_by) grantorIds.add(r.granted_by);
        return {
          id: r.id, experience: r.experience_code, status: r.status, live: liveIds.has(r.id), startsAt: r.starts_at, endsAt: r.ends_at ?? null,
          source: r.source, planCode: text(r.plan_code), grantedBy: r.granted_by ?? null, createdAt: r.created_at,
        } as EntitlementRow;
      }),
    };
  const invitations: Src<InvitationRow[]> = invs.error
    ? { state: isAbsent(invs.error) ? "not_set_up" : "unreadable" }
    : {
      state: "ok",
      value: (invs.data ?? []).map((r: any) => ({
        id: r.id, status: r.status, live: liveInvIds.has(r.id),
        experiences: [r.invite_scholar ? "scholar" : null, r.invite_professional ? "professional" : null].filter(Boolean) as string[],
        expiresAt: r.expires_at, endsAt: r.entitlement_ends_at ?? null, createdAt: r.created_at,
        acceptedAt: r.accepted_at ?? null, revokedAt: r.revoked_at ?? null,
        entitlementSource: text(r.entitlement_source), prefill: r.prefill ?? null,
      })),
    };
  const members: Src<MembershipRow | null> = membership.error
    ? { state: isAbsent(membership.error) ? "not_set_up" : "unreadable" }
    : { state: "ok", value: membership.data ? {
      status: membership.data.status, source: membership.data.source, onboardedAt: membership.data.onboarded_at ?? null, createdAt: membership.data.created_at,
    } : null };
  const part: Src<ParticipationDetail | null> = participation.error
    ? { state: isAbsent(participation.error) ? "not_set_up" : "unreadable" }
    : { state: "ok", value: participation.data ? (() => {
      if (participation.data.set_by) grantorIds.add(participation.data.set_by);
      return {
        category: participation.data.category, cohort: text(participation.data.cohort_code), validUntil: participation.data.valid_until ?? null,
        reason: participation.data.reason, setBy: participation.data.set_by ?? null, updatedAt: participation.data.updated_at ?? null,
      };
    })() : null };

  // ── HQ appointments with scope and term ──
  let appointments: Src<AppointmentRow[]>;
  const hqOfficeIds = offices.error ? [] : (offices.data ?? []).map((o: any) => o.id);
  if (offices.error) appointments = { state: "unreadable" };
  else if (!hqOfficeIds.length) appointments = { state: "ok", value: [] };
  else {
    const apps = await admin.from("ogs_office_appointments")
      .select("role, status, term_start, term_end, scope, office_id").eq("person_id", userId).in("office_id", hqOfficeIds).limit(100);
    if (apps.error) appointments = { state: isAbsent(apps.error) ? "not_set_up" : "unreadable" };
    else {
      const codes = [...new Set<string>((apps.data ?? []).map((a: any) => a.role).filter(Boolean))];
      const pos = codes.length ? await admin.from("hq_position").select("code, name").in("code", codes) : { data: [], error: null };
      const nameOf = new Map<string, string | null>((pos.data ?? []).map((p: any) => [p.code, p.name]));
      appointments = {
        state: "ok",
        value: (apps.data ?? []).filter((a: any) => a.role).map((a: any) => ({
          position: a.role, name: nameOf.get(a.role) ?? null, status: a.status ?? "unknown",
          scope: a.scope == null ? null : Array.isArray(a.scope) ? a.scope.join(", ") : typeof a.scope === "string" ? a.scope : JSON.stringify(a.scope),
          validFrom: a.term_start ?? null, validTo: a.term_end ?? null,
        })),
      };
    }
  }

  // ── account ──
  const au = authRes?.data?.user;
  const account: Src<{ createdAt: string | null; lastSignInAt: string | null; emailConfirmed: boolean; invitedAt: string | null; bannedUntil: string | null }> =
    authRes?.error || !au ? { state: "unreadable" }
    : { state: "ok", value: {
      createdAt: au.created_at ?? null, lastSignInAt: au.last_sign_in_at ?? null, emailConfirmed: !!au.email_confirmed_at,
      invitedAt: au.invited_at ?? null, bannedUntil: au.banned_until ?? null,
    } };

  // The classification history reads the account type and reason out of the change, nothing else.
  const classification: Src<ClassificationRow[]> = classHistory.error
    ? { state: isAbsent(classHistory.error) ? "not_set_up" : "unreadable" }
    : { state: "ok", value: (classHistory.data ?? []).map((e: any) => ({
      id: e.id, at: e.created_at, by: e.actor_name ?? "System (migration 650)",
      from: String(e.old_value?.account_type ?? "unclassified"), to: String(e.new_value?.account_type ?? ""),
      reason: typeof e.new_value?.reason === "string" ? e.new_value.reason : null,
    })) };

  // Names for the people who granted access or set a category: id to full name and nothing else.
  const names: Record<string, string> = {};
  if (grantorIds.size) {
    const g = await admin.from("profiles").select("id, full_name").in("id", [...grantorIds]);
    if (!g.error) for (const p of g.data ?? []) if (p.full_name) names[p.id] = p.full_name;
  }

  return {
    id: userId, personal, preferred, education,
    products: { membership: members, entitlements, invitations, participation: part },
    appointments, account, classification, names, audit,
  };
}
