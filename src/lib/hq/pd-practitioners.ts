// CPR-PD-004 — the landlord-side PRACTITIONER ESTATE, and only the estate.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHAT THIS FILE DELIBERATELY DOES NOT PRODUCE, AND WHY IT IS A FINDING RATHER THAN A SHORTCUT.
//
// PD-004 §3 asks the estate table for thirteen columns. Six of them — Activation, Adoption, Commercial,
// Support, and the behavioural halves of Lifecycle (ACTIVE / DORMANT) — have no person-level fact in
// this database. Not an empty table: no table.
//
//   1. THE ACTIVATION LEDGER IS PER-PRACTICE, NOT PER-PRACTITIONER.
//      supabase/migrations/283-progressive-adoption-and-activation-telemetry.sql:105-106 creates
//        `ux_practice_activation_event on practice_activation_event(workspace_id, event_key)`
//      — a unique index on the workspace and the milestone. Each of the ten milestones can be recorded
//      once per practice and never once per person. `actor_id` (283:96) is stamped only by whoever
//      tripped the milestone FIRST, because 283:88-91 says the index is what makes emission idempotent.
//      On a `managed_practice` (191:34) rendering that ledger under a person's name would credit one
//      colleague's first booking to everybody in the room. So there is no per-practitioner activation
//      milestone, no per-practitioner activation percentage, and this file computes neither. A rate
//      computed from workspace events and labelled per-practitioner is the exact shape of the recorded
//      IntelSlice.total failure — five screens rendering fields that never existed.
//
//   2. THERE IS NO PRODUCT TELEMETRY.
//      No page-view, feature-invocation, session-start, error or abandonment event is written anywhere
//      in this estate. The one genuine per-practitioner signal is `practice_session.last_seen_at`
//      (213:46), maintained by the Practice shell guard — and it is an UPDATE, at
//      src/lib/practice/security.ts:342, not an append. It can answer "seen in the last 30 days, as of
//      now" and nothing else. Activity days, sessions per week, engagement scores, 7/30/90-day trends
//      and retention curves have no source, and the codebase already says so in its own voice at
//      src/lib/practice/adoption-constants.ts:101 ("needs a usage-recency signal; the activation ledger
//      records first occurrences only").
//
// So this loader returns identity, membership, market, lifecycle-from-membership-state, joined date and
// ONE binary recency flag. Everything else the specification asks for is returned as a named absence by
// the page, in words, with the reason. Nothing here is a placeholder and nothing is an em dash standing
// in for a measured zero.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ PRIVACY, per docs/PLAT-OVERSIGHT-SURVEY-001 §9.
//   D1 — NAME, NEVER EMAIL. `profiles.email` is not selected here at all, not selected-and-hidden. A
//        standing table of every practitioner's email is a directory of the platform's whole user base
//        wearing a search box.
//   D2 — no per-named-practice clinical volume. This file reads no clinical table at all: not
//        `practice_patient`, not `practice_encounter`, not `practice_appointment`. There is therefore
//        nothing to band. PD-014 Build 3, verbatim: no patient clinical data.
//   Profession / specialty (PD-004 §3) is NOT read. The platform-plane allowlist
//   (src/lib/access/plane-boundary.ts, `practice_practitioner_identity`) says "⚠ NO PROFILE FIELDS" and
//   names `display_name`, `handle`, `discovery` and the licence columns as outside this plane;
//   `self_declared_profession` (270:79) is the same class of field and is self-declared besides —
//   nothing contacts a regulator. Two readings were available and the SAFER one is taken: the column is
//   absent from the roster and the page says why.
//
// ⚠ THIS FILE IS IN THE PLATFORM-PLANE CLOSURE, so scripts/plane-boundary-harness.ts judges every read
// below against PRACTICE_ALLOWLIST. The reads are written with LITERAL table names and LITERAL select
// lists on purpose — a table name held in a variable is judged UNRESOLVED_TABLE and refused, which is
// the correct default and not a thing to route around. Where a value is only needed to narrow rows it is
// a FILTER rather than a select (the allowlist judges selects; filters are reported, not asserted), which
// is why `practice_session` gives up only `user_id`.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The two windows this module uses, named once, server-side.
 *
 * PD-004 §14: "Thresholds must be configuration/analytics rules, not magic numbers hard-coded into the
 * frontend." There is no metric registry on the landlord plane yet (PD-005 §4 requires one and nothing
 * like it exists — the tenant-side shape to copy is src/lib/practice/intelligence-registry.ts:33). Until
 * there is, these live here, exported, so the page renders the number it filtered on rather than a
 * second copy of it, and so both move in one edit.
 */
export const SEEN_WINDOW_DAYS = 30;
export const NEW_WINDOW_DAYS = 30;

/** `practice_membership.status`, migration 191:66. */
export type MembershipStatus = "active" | "invited" | "suspended" | "revoked";

/**
 * The four PD-004 §4 lifecycle states that a fact in this database can distinguish.
 *
 * ⚠ REGISTERED IS NOT THE SPEC'S "ACTIVE". §4 defines ACTIVE as "meets governed active-use criteria" and
 * DORMANT as "previously activated but has not met recent-activity threshold". Both need activity
 * history, and `last_seen_at` is overwritten rather than appended (see the header), so neither can be
 * evaluated for any past moment. An active membership means the entitlement is recognised — §4's
 * REGISTERED — and calling it ACTIVE would quietly promote "has an account" to "uses the product".
 * ONBOARDING is likewise a workspace state (`practice_workspace.status`), not a person's.
 */
export type PractitionerLifecycle = "REGISTERED" | "INVITED" | "SUSPENDED" | "REMOVED";

export const LIFECYCLE_LABEL: Record<PractitionerLifecycle, string> = {
  REGISTERED: "Registered",
  INVITED: "Invited",
  SUSPENDED: "Suspended",
  REMOVED: "Removed",
};

export type PractitionerMembership = {
  workspaceId: string;
  workspaceName: string | null;
  workspaceStatus: string | null;
  workspaceType: string | null;
  country: string | null;
  roleCode: string;
  status: MembershipStatus;
  isOwner: boolean;
  joinedAt: string | null;
  createdAt: string | null;
};

/** One PERSON, however many Practices they are in. §20: one practitioner, multiple relationships. */
export type PractitionerRow = {
  userId: string;
  fullName: string | null;
  /** `practice_practitioner_identity.practitioner_number` — permanent, never reused (218:53). */
  practitionerNumber: string | null;
  memberships: PractitionerMembership[];
  ownedCount: number;
  markets: string[];
  lifecycle: PractitionerLifecycle;
  /** Suspended somewhere while still active elsewhere — an exception, not the lifecycle. */
  suspendedElsewhere: boolean;
  /** Earliest membership `joined_at`, falling back to `created_at` for a not-yet-accepted invitation. */
  joinedAt: string | null;
  /**
   * Three values, never two. `true` seen inside the window; `false` has a session row but not inside it;
   * `null` NO SESSION ROW AT ALL — which is not "inactive". PD-004 §9/§18: never convert unavailable
   * analytics into zero activity.
   */
  seenInWindow: boolean | null;
  attention: { severity: "high" | "medium"; label: string } | null;
};

export type PdPractitioners = {
  rows: PractitionerRow[];
  /** Distinct people holding at least one Practice membership. Estate-wide, so D2's banding is not engaged. */
  total: number;
  /** True when every membership page was read. False means `total` is a floor, and the page says so. */
  complete: boolean;
  /** `false` when `practice_session` could not be read — every `seenInWindow` is then null, not false. */
  sessionsReadable: boolean;
  identitiesReadable: boolean;
  namesReadable: boolean;
  /** Named read failures, carried to the surface rather than swallowed. */
  unavailable: string[];
  seenWindowDays: number;
  newWindowDays: number;
  generatedAt: string;
};

const PAGE = 1000;
const CEILING = 50_000;
const CHUNK = 200;

const chunks = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * ⚠ PAGINATED, BECAUSE POSTGREST CAPS A RESPONSE AT 1,000 ROWS AND SAYS NOTHING. `.limit(5000)` is not
 * 5,000; past a thousand rows a count simply stops growing. This estate has cost itself a wrong figure
 * that way before (see the note in src/lib/practice/operations.ts). A failed page is REPORTED and ends
 * the read as incomplete — treating it as an empty page would end the loop early and report a smaller
 * roster with no sign anything went wrong.
 */
async function readMemberships(admin: any, unavailable: string[]) {
  const rows: any[] = [];
  for (let from = 0; from < CEILING; from += PAGE) {
    const { data, error } = await admin
      .from("practice_membership")
      .select("workspace_id, user_id, role_code, status, joined_at, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      unavailable.push(`practice_membership: ${error.message}`);
      return { rows, complete: false, readable: rows.length > 0 };
    }
    const page = (data ?? []) as any[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, complete: true, readable: true };
  }
  unavailable.push(`practice_membership: more than ${CEILING.toLocaleString()} rows; this roster is a page of the estate, not all of it`);
  return { rows, complete: false, readable: true };
}

export async function loadPdPractitioners(admin: any): Promise<PdPractitioners> {
  const unavailable: string[] = [];
  const generatedAt = new Date().toISOString();

  const { rows: memberships, complete, readable } = await readMemberships(admin, unavailable);

  if (!readable) {
    return {
      rows: [], total: 0, complete: false, sessionsReadable: false, identitiesReadable: false,
      namesReadable: false, unavailable, seenWindowDays: SEEN_WINDOW_DAYS,
      newWindowDays: NEW_WINDOW_DAYS, generatedAt,
    };
  }

  const userIds = [...new Set(memberships.map(m => m.user_id).filter(Boolean))] as string[];
  const workspaceIds = [...new Set(memberships.map(m => m.workspace_id).filter(Boolean))] as string[];

  // ── The workspaces those memberships point at. Identity and market only. ───────────────────────────
  const workspaces = new Map<string, any>();
  let workspacesReadable = true;
  for (const ids of chunks(workspaceIds, CHUNK)) {
    const { data, error } = await admin
      .from("practice_workspace")
      .select("id, name, type, status, country")
      .in("id", ids);
    if (error) { unavailable.push(`practice_workspace: ${error.message}`); workspacesReadable = false; break; }
    for (const w of (data ?? []) as any[]) workspaces.set(w.id, w);
  }

  // ── Names. `profiles` is platform data the operator already administers; D1 keeps it to full_name. ──
  const names = new Map<string, string | null>();
  let namesReadable = true;
  for (const ids of chunks(userIds, CHUNK)) {
    const { data, error } = await admin.from("profiles").select("id, full_name").in("id", ids);
    if (error) { unavailable.push(`profiles: ${error.message}`); namesReadable = false; break; }
    for (const p of (data ?? []) as any[]) names.set(p.id, p.full_name ?? null);
  }

  // ── The approved practitioner identifier. §3: "name plus approved practitioner identifier". ────────
  // The NUMBER only. `handle`, `display_name` and the licence-verification columns are outside this
  // plane (plane-boundary.ts), and a handle is a public booking route rather than an operator's key.
  const numbers = new Map<string, string | null>();
  let identitiesReadable = true;
  for (const ids of chunks(userIds, CHUNK)) {
    const { data, error } = await admin
      .from("practice_practitioner_identity")
      .select("user_id, practitioner_number")
      .in("user_id", ids);
    if (error) { unavailable.push(`practice_practitioner_identity: ${error.message}`); identitiesReadable = false; break; }
    for (const i of (data ?? []) as any[]) numbers.set(i.user_id, i.practitioner_number ?? null);
  }

  // ── The one honest recency signal. TWO READS, and the second is not the negation of the first. ─────
  //
  // `everSeen` is "a live device row exists for this person at all"; `seenRecently` is "one of them was
  // touched inside the window". Somebody with no row has never opened a Practice shell on a registered
  // device — which is a DIFFERENT statement from "has not been seen in thirty days", and the row type
  // keeps them apart (`null` vs `false`). Only `user_id` is selected: the window and the revocation are
  // FILTERS, so no timestamp and no device leaves the database.
  const cutoff = new Date(Date.now() - SEEN_WINDOW_DAYS * 86_400_000).toISOString();
  const everSeen = new Set<string>();
  const seenRecently = new Set<string>();
  let sessionsReadable = true;
  for (const ids of chunks(userIds, CHUNK)) {
    const live = await admin
      .from("practice_session").select("user_id").is("revoked_at", null).in("user_id", ids);
    if (live.error) { unavailable.push(`practice_session: ${live.error.message}`); sessionsReadable = false; break; }
    for (const s of (live.data ?? []) as any[]) everSeen.add(s.user_id);

    const recent = await admin
      .from("practice_session").select("user_id").is("revoked_at", null)
      .gte("last_seen_at", cutoff).in("user_id", ids);
    if (recent.error) { unavailable.push(`practice_session: ${recent.error.message}`); sessionsReadable = false; break; }
    for (const s of (recent.data ?? []) as any[]) seenRecently.add(s.user_id);
  }

  // ── Fold memberships into people ───────────────────────────────────────────────────────────────────
  const byUser = new Map<string, PractitionerMembership[]>();
  for (const m of memberships) {
    const w = workspaces.get(m.workspace_id);
    let list = byUser.get(m.user_id);
    if (!list) { list = []; byUser.set(m.user_id, list); }
    list.push({
      workspaceId: m.workspace_id,
      workspaceName: w?.name ?? null,
      workspaceStatus: w?.status ?? null,
      workspaceType: w?.type ?? null,
      country: w?.country ?? null,
      roleCode: m.role_code,
      status: m.status as MembershipStatus,
      // §7: do not infer that a practitioner owns every Practice they are a member of. The role code is
      // the fact, and 191:76 (`ux_practice_owner_single`) guarantees at most one active owner per practice.
      isOwner: m.role_code === "practice_owner" && m.status === "active",
      joinedAt: m.joined_at ?? null,
      createdAt: m.created_at ?? null,
    });
  }

  const rows: PractitionerRow[] = [...byUser.entries()].map(([userId, ms]) => {
    const has = (s: MembershipStatus) => ms.some(m => m.status === s);
    // Precedence, stated: a live entitlement anywhere outranks an invitation, an invitation outranks a
    // suspension elsewhere, and only somebody with nothing but revoked rows has left.
    const lifecycle: PractitionerLifecycle =
      has("active") ? "REGISTERED" : has("invited") ? "INVITED" : has("suspended") ? "SUSPENDED" : "REMOVED";

    const dates = ms.map(m => m.joinedAt ?? m.createdAt).filter(Boolean) as string[];
    const joinedAt = dates.length ? dates.slice().sort()[0] : null;

    const suspendedElsewhere = lifecycle === "REGISTERED" && has("suspended");
    const pendingInvite = lifecycle === "REGISTERED" ? false : has("invited");

    // ⚠ ATTENTION IS DERIVED FROM MEMBERSHIP STATE AND NOTHING ELSE. §3's Attention column wants the
    // "highest current actionable exception" across product, commercial, support, security and
    // onboarding. Four of those five have no store on this plane at all, and the fifth (onboarding) is
    // a workspace milestone, not a person's. What is left is real, small, and labelled as what it is.
    const attention: PractitionerRow["attention"] =
      lifecycle === "SUSPENDED"
        ? { severity: "high", label: `Suspended in ${ms.filter(m => m.status === "suspended").length} Practice(s)` }
        : suspendedElsewhere
          ? { severity: "medium", label: "Suspended in one Practice, active in another" }
          : pendingInvite
            ? { severity: "medium", label: "Invited; registration not completed" }
            : null;

    return {
      userId,
      fullName: names.get(userId) ?? null,
      practitionerNumber: numbers.get(userId) ?? null,
      memberships: ms.slice().sort((a, b) => Number(b.isOwner) - Number(a.isOwner)),
      ownedCount: ms.filter(m => m.isOwner).length,
      markets: [...new Set(ms.map(m => m.country).filter(Boolean))] as string[],
      lifecycle,
      suspendedElsewhere,
      joinedAt,
      seenInWindow: !sessionsReadable ? null : everSeen.has(userId) ? seenRecently.has(userId) : null,
      attention,
    };
  });

  // §17: actionable attention first, then the most recently joined — not alphabetical, which sorts by
  // an accident of somebody's surname.
  const rank = (r: PractitionerRow) => (r.attention?.severity === "high" ? 0 : r.attention ? 1 : 2);
  rows.sort((a, b) =>
    rank(a) - rank(b) || String(b.joinedAt ?? "").localeCompare(String(a.joinedAt ?? "")));

  return {
    rows, total: rows.length, complete, sessionsReadable, identitiesReadable,
    namesReadable: namesReadable && workspacesReadable, unavailable,
    seenWindowDays: SEEN_WINDOW_DAYS, newWindowDays: NEW_WINDOW_DAYS, generatedAt,
  };
}

// ── FILTERING ────────────────────────────────────────────────────────────────────────────────────────
//
// Applied over the folded rows rather than in SQL, because the fold is what makes one person one row:
// filtering `practice_membership` first would drop a person's OTHER memberships from the payload and
// then render "1 Practice" for somebody who is in three. §20: one practitioner, multiple relationships,
// not duplicate identities.

export type PractitionerFilter = {
  q: string;
  lifecycle: PractitionerLifecycle | null;
  market: string | null;
  workspaceId: string | null;
  cohort: "new" | "invited" | "suspended" | null;
};

export function filterPractitioners(
  rows: PractitionerRow[], f: PractitionerFilter, newWindowDays: number,
): PractitionerRow[] {
  const needle = f.q.trim().toLowerCase();
  const newCutoff = Date.now() - newWindowDays * 86_400_000;
  return rows.filter(r => {
    if (needle) {
      // Name and practitioner number. NOT email — D1. §2 also asks for handle, which is outside this
      // plane's allowlist and so is not searchable here either.
      const hay = `${r.fullName ?? ""} ${r.practitionerNumber ?? ""} ${r.memberships.map(m => m.workspaceName ?? "").join(" ")}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (f.lifecycle && r.lifecycle !== f.lifecycle) return false;
    if (f.market && !r.markets.includes(f.market)) return false;
    if (f.workspaceId && !r.memberships.some(m => m.workspaceId === f.workspaceId)) return false;
    if (f.cohort === "new" && !(r.joinedAt && Date.parse(r.joinedAt) >= newCutoff)) return false;
    if (f.cohort === "invited" && r.lifecycle !== "INVITED") return false;
    if (f.cohort === "suspended" && !(r.lifecycle === "SUSPENDED" || r.suspendedElsewhere)) return false;
    return true;
  });
}

/**
 * The PD-004 §14 cohorts that CANNOT be built per practitioner today, each with the fact that is missing.
 *
 * ⚠ THIS LIST IS THE DELIVERABLE, not an apology for one. §14 prescribes ten cohorts and names them
 * practitioner cohorts; seven of them resolve at PRACTICE level or not at all. Rendering them anyway —
 * filtering a person list by their workspace's milestones — would make Mission Control and this screen
 * quote different numbers for the same word.
 */
export const COHORTS_WITHOUT_A_PERSON_LEVEL_FACT: { cohort: string; why: string }[] = [
  {
    cohort: "Stalled onboarding",
    why: "the onboarding risk rules (src/lib/practice/adoption-constants.ts:88) run over the activation ledger, which is unique on (workspace_id, event_key). They classify a Practice, not a person.",
  },
  {
    cohort: "Configured, no availability",
    why: "`practice.setup_completed` is a workspace milestone, and the ten-milestone pipeline has no availability event at all.",
  },
  {
    cohort: "Availability, no booking",
    why: "`booking.first_received` is recorded once for the whole Practice; on a managed practice it names one colleague and covers everyone.",
  },
  {
    cohort: "Booked, no encounter",
    why: "same ledger, same unique index. There is no per-person first booking or first encounter.",
  },
  {
    cohort: "Dormant",
    why: "dormancy needs activity history. `practice_session.last_seen_at` is overwritten in place (src/lib/practice/security.ts:342), so no past window can be evaluated. The codebase already refuses this rule by name at adoption-constants.ts:101.",
  },
  {
    cohort: "Highly engaged",
    why: "no engagement measure exists. No page view, feature invocation or session-start event is written anywhere in this product.",
  },
  {
    cohort: "Trial expiring",
    why: "a trial belongs to the Practice (`practice_entitlement`), not to a person, and there is nothing to convert to — no plan on this plane carries a price, a currency or a payer.",
  },
  {
    cohort: "Support burden",
    why: "there is no support-case or incident store for Competen Practice.",
  },
];
