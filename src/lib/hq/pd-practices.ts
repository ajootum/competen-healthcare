// CPR-PD-003 — THE PRACTICE ESTATE AND PRACTICE 360, READ FROM THE PLATFORM PLANE.
//
// PD-014 build 3 (OPERATE). One loader for both surfaces so the estate row and the 360 header cannot
// disagree about the same workspace — PD-003 §1 forbids "duplicate Practice records, competing status
// definitions or separate lifecycle truth", and two loaders is how that happens.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHAT BOUNDS THIS FILE IS NOT THE SCHEMA. IT IS `src/lib/access/plane-boundary.ts`.
//
// This module is imported by `src/app/super-admin/pd/practices/**`, so every `.from("practice_*")` in it
// is judged by scripts/plane-boundary-harness.ts against PRACTICE_ALLOWLIST. That allowlist admits
// exactly seven practice tables to this plane and, for four of them, exactly one column — `workspace_id`,
// the tenancy key. `practice_entitlement`, `practice_activation_event`, `practice_configuration`,
// `practice_location`, `practice_capability_activation`, `practice_message`, `practice_session` and
// `practice_lifecycle_transition` are NOT on it, and `practice_audit_event` is refused BY NAME
// (PLAT-OVERSIGHT-SURVEY-001 §4.4: its payloads carry drug names, procedure lateralities and clinician
// free text).
//
// That is why five of PD-003 §6's eight tabs are stated as absent rather than built. The rows exist in
// the database; they are outside this plane. Widening the allowlist is a governance decision with a
// named owner, not a loader edit — so this file reads what it may and says what it cannot, which is the
// only honest option available to it.
//
// ⚠ TWO STANDING DECISIONS OF 2026-08-08 GOVERN WHAT IS RENDERED, AND BOTH NARROW PD-003.
//
//   D1 — the owner's NAME, never their email. A standing table of addresses is a directory of every
//        practitioner on the platform. An address stays reachable through the reasoned lookup at
//        /api/v1/practice/operations/users, which refuses a query under two characters.
//   D2 — counts are BANDED (0 / 1-9 / 10-99 / 100+), banded on the SERVER so the exact figure never
//        enters the payload. PD-003 §3 asks for a practitioner "count" and §7 for "key aggregates …
//        counts only"; D2 says "Dr Nakato's Practice — 412 patients" is business intelligence about a
//        named clinician's book. The two collide. This file takes D2, the safer reading, and the
//        surfaces say so where the number would otherwise appear.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import type { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

/** 0 / 1-9 / 10-99 / 100+ (D2). `null` means the count could NOT BE READ — which is not zero. */
export type CountBand = "0" | "1-9" | "10-99" | "100+";
export type Band = CountBand | null;

/**
 * ⚠ CEILING TRUNCATION CANNOT MOVE A BAND, WHICH IS WHY THE PAGING LOOP BELOW IS SAFE.
 * The top band opens at 100 and the loop stops at 100,000, so a count that truncates has already
 * passed 100+ and lands in the same band the true figure would. A truncated EXACT number would have
 * been wrong; a truncated band is not. The truncation is still reported, because a reader deserves to
 * know a read hit a ceiling even when the answer survives it.
 */
export const bandOf = (n: number): CountBand => (n === 0 ? "0" : n < 10 ? "1-9" : n < 100 ? "10-99" : "100+");

/** The ten governed states of `practice_workspace.status` (migration 191:38). PD-003 §5 names six. */
export const LIFECYCLE_STATES = [
  "REQUESTED", "IDENTITY_PENDING", "PROVISIONING", "ONBOARDING", "ACTIVE",
  "SUSPENDED", "MIGRATING", "CLOSING", "CLOSED", "FAILED",
] as const;

/**
 * PD-003 §5 maps its six prescribed states onto ten real ones. The four it does not name are given a
 * governed meaning here rather than being rendered raw, because §5 also says "do not infer lifecycle
 * independently in the frontend" — so the mapping is written once, in the loader, and shared.
 *
 * ⚠ FAILED IS NOT A LIFECYCLE STATE IN THE SPEC. §5: "ERROR / ATTENTION … Not a lifecycle substitute.
 * Show as an exception overlay linked to the underlying issue." The database stores it as a status, so
 * it is carried as one AND raised as an attention item — the overlay §5 asks for.
 */
export const LIFECYCLE_MEANING: Record<string, string> = {
  REQUESTED: "Provisioning — the request exists; the workspace transaction has not started.",
  IDENTITY_PENDING: "Provisioning — waiting on the owner's Competen identity.",
  PROVISIONING: "Provisioning — the workspace creation saga is in progress or incomplete.",
  ONBOARDING: "Onboarding — the workspace exists; governed activation milestones are incomplete.",
  ACTIVE: "Active — governed activation criteria satisfied; available for normal use.",
  SUSPENDED: "Suspended — access restricted by an authorised operational or governance action.",
  MIGRATING: "Provisioning — a migration into or within the estate is in progress.",
  CLOSING: "Closing — closure has begun and has not completed.",
  CLOSED: "Closed / archived — retained under policy and audit rules.",
  FAILED: "Exception overlay, not a lifecycle state — the provisioning transaction failed.",
};

/**
 * The two states PD-003 §5 treats as exceptional and the ONLY two that drive the default sort, because
 * the default sort has to be expressible as a database order across pages. Everything else that counts
 * as attention (a failed provisioning saga) is raised as a banner instead — an attention rule that
 * silently only ranked the current page would be worse than one that says where it applies.
 */
export const ATTENTION_STATES = ["FAILED", "SUSPENDED"] as const;

export type AttentionItem = {
  severity: "critical" | "warning";
  label: string;
  detail: string;
  /** Where the authoritative workflow for this exception lives (§20: "attention items link to sources"). */
  source: { label: string; href: string } | null;
};

export type EstateRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  country: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  /** D1 — name, never email. Null when the profile row could not be read; not a blank. */
  ownerName: string | null;
  /**
   * D2 band over `practice_membership` rows for this workspace. ⚠ ROWS OF ANY STATUS: `status` is not
   * an allowlisted column on this plane, so this cannot be narrowed to "active" practitioners and must
   * not be labelled as if it were. Null = could not be read.
   */
  membershipBand: Band;
  attention: AttentionItem[];

  /**
   * §4's human-facing identifier. Added by migration 312 and only readable from this plane since the
   * boundary was taught about it — the register spent that gap refusing to search by handle for a
   * reason that had stopped being true.
   */
  handle: string | null;

  /**
   * §3's ACTIVITY column, MEASURED rather than invented.
   *
   * ⚠ THIS COLUMN USED TO SAY A "recent activity" CLASSIFICATION WOULD HAVE TO BE INVENTED. That was
   * true: appointments and encounters are held to their tenancy column on this plane, so no timestamp
   * was readable. The event store closed it — mos_event carries a practice_id, a journey, an outcome
   * and a duration, and cannot carry clinical content by construction.
   *
   * So this counts what the practice DID, never what it was about. Null means the store could not be
   * read; a zero here means the store was read and this practice ran nothing.
   */
  activity30d: { attempts: number; failures: number; journeys: number } | null;
};

export type EstateSort = "attention" | "created_desc" | "created_asc" | "name" | "lifecycle";

export type EstateQuery = {
  q?: string;
  market?: string;
  lifecycle?: string;
  attentionOnly?: boolean;
  sort?: EstateSort;
  page?: number;
};

export type PracticeEstate = {
  rows: EstateRow[];
  /** Practices matching the current filters. Null = the count could not be read. NEVER inferred from rows.length. */
  matchTotal: number | null;
  /** Practices in the estate, unfiltered — what tells "none exist" apart from "none match" (§4). */
  estateTotal: number | null;
  /** Matching practices in FAILED or SUSPENDED. Drives the attention-first page window. */
  attentionTotal: number | null;
  page: number;
  pageSize: number;
  /** Distinct markets offered as filter options, and whether that scan hit its ceiling. */
  markets: string[];
  marketsTruncated: boolean;
  /** Failed provisioning sagas across the whole estate — visible without opening every practice (§2). */
  failedProvisioning: { total: number; withWorkspace: number; orphaned: number } | null;
  /** Every read that could not be completed, named. Empty means every figure above is complete. */
  problems: string[];
  generatedAt: string;
};

const PAGE_SIZE = 25;
const WS_COLUMNS = "id, name, type, status, owner_person_id, country, timezone, created_at, updated_at, practice_handle";

type WsRow = {
  id: string; name: string; type: string; status: string; owner_person_id: string;
  country: string; timezone: string; created_at: string; updated_at: string;
};

/** PostgREST list literal for `.not(col, "in", …)`. Quoted so a value containing a comma cannot split it. */
const inList = (values: readonly string[]) => `(${values.map(v => `"${v}"`).join(",")})`;

/**
 * Count rows of an allowlisted table per workspace, by PAGING the tenancy column.
 *
 * ⚠ NOT `.limit(5000)`. PostgREST answers an unbounded select with at most 1,000 rows and no indication
 * that it did; this codebase has been bitten by that on this exact console. Paged with `.range()`, and a
 * failed page returns NULL for the whole table rather than a smaller number — treating an error as "no
 * more rows" would truncate in a second way while looking fixed.
 */
async function countByWorkspace(
  admin: Admin, table: string, wsIds: string[], problems: string[],
): Promise<Record<string, number> | null> {
  if (!wsIds.length) return {};
  const PAGE = 1000;
  const CEILING = 100_000;
  const counts: Record<string, number> = {};
  for (let from = 0; from < CEILING; from += PAGE) {
    const { data, error } = await admin
      .from(table).select("workspace_id").in("workspace_id", wsIds).range(from, from + PAGE - 1);
    if (error) { problems.push(`${table}: ${error.message}`); return null; }
    const page = (data ?? []) as { workspace_id: string }[];
    for (const r of page) counts[r.workspace_id] = (counts[r.workspace_id] ?? 0) + 1;
    if (page.length < PAGE) return counts;
    if (from + PAGE >= CEILING) problems.push(`${table}: more than ${CEILING.toLocaleString()} rows; bands at this volume read 100+ either way`);
  }
  return counts;
}

/** An exact count of one allowlisted table for ONE workspace. `null` is unknown and must render as unknown. */
async function countOne(
  admin: Admin, table: string, wsId: string, problems: string[],
): Promise<number | null> {
  const { count, error } = await admin
    .from(table).select("workspace_id", { count: "exact", head: true }).eq("workspace_id", wsId);
  if (error) { problems.push(`${table}: ${error.message}`); return null; }
  // ⚠ A head+count against a table that does not exist returns count NULL with error NULL. The COUNT is
  // the discriminator (scripts/practice-pilot-gate.ts:88). Null is unknown, never zero.
  return count ?? null;
}

/** Attention derived from the workspace row itself. Provisioning failures are merged in by the caller. */
function lifecycleAttention(status: string): AttentionItem[] {
  if (status === "FAILED") return [{
    severity: "critical",
    label: "Provisioning failed",
    detail: "The workspace row is in FAILED. PD-003 §5 treats this as an exception overlay rather than a lifecycle state; the saga is resumable from Product Operations.",
    source: { label: "Provisioning & Onboarding", href: "/super-admin/pd/operations/provisioning" },
  }];
  if (status === "SUSPENDED") return [{
    severity: "critical",
    label: "Suspended",
    detail: "Access is restricted by an authorised operational or governance action. The reason is held in practice_workspace.suspension_reason, which is not an allowlisted column on this plane.",
    source: null,
  }];
  if (status === "CLOSING") return [{
    severity: "warning",
    label: "Closure in progress",
    detail: "Closure has begun and has not completed.",
    source: null,
  }];
  if (status === "REQUESTED" || status === "IDENTITY_PENDING" || status === "PROVISIONING" || status === "MIGRATING") return [{
    severity: "warning",
    label: "Provisioning incomplete",
    detail: `The workspace is in ${status}. This is a state, not an age: no stuck-after-N-hours threshold is applied, because nothing on this plane governs one.`,
    source: { label: "Provisioning & Onboarding", href: "/super-admin/pd/operations/provisioning" },
  }];
  return [];
}

/**
 * THE ESTATE (PD-003 §2–§4).
 *
 * ⚠ THE DEFAULT SORT IS IMPLEMENTED AS TWO ORDERED QUERIES, NOT AS A CLIENT-SIDE RE-SORT OF ONE PAGE.
 * §4 asks for "highest actionable attention/severity first, then recent meaningful activity". The first
 * half is expressible: FAILED and SUSPENDED are read first, then everything else. The second half is
 * NOT — the four activity tables are allowlisted to `workspace_id` alone, so no timestamp of a booking
 * or an encounter is readable from this plane and "recent meaningful activity" has no producer here.
 * The tiebreak is `created_at desc`, and the surface says which half it is honouring.
 */
export async function loadPracticeEstate(admin: Admin, query: EstateQuery = {}): Promise<PracticeEstate> {
  const problems: string[] = [];
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const sort: EstateSort = query.sort ?? "attention";
  const q = (query.q ?? "").trim().slice(0, 80).replace(/%/g, "");
  const market = (query.market ?? "").trim().slice(0, 8);
  const lifecycle = LIFECYCLE_STATES.includes(query.lifecycle as (typeof LIFECYCLE_STATES)[number])
    ? (query.lifecycle as string) : "";

  type Q = ReturnType<Admin["from"]>;
  const filtered = (builder: ReturnType<Q["select"]>) => {
    let b = builder;
    if (q) b = b.ilike("name", `%${q}%`);
    if (market) b = b.eq("country", market);
    if (lifecycle) b = b.eq("status", lifecycle);
    if (query.attentionOnly) b = b.in("status", ATTENTION_STATES as unknown as string[]);
    return b;
  };

  // Three counts, all server-side. `estateTotal` is what tells "no practices exist" apart from "none
  // match these filters" (§4), and it is the figure the header quotes — never rows.length, which is a
  // page size. (The recorded defect this avoids: a console that printed its 200-row page as the total.)
  const [estateRes, matchRes, attentionRes] = await Promise.all([
    admin.from("practice_workspace").select("id", { count: "exact", head: true }),
    filtered(admin.from("practice_workspace").select("id", { count: "exact", head: true })),
    filtered(admin.from("practice_workspace").select("id", { count: "exact", head: true }))
      .in("status", ATTENTION_STATES as unknown as string[]),
  ]);
  if (estateRes.error) problems.push(`practice count: ${estateRes.error.message}`);
  if (matchRes.error) problems.push(`filtered count: ${matchRes.error.message}`);
  if (attentionRes.error) problems.push(`attention count: ${attentionRes.error.message}`);
  const estateTotal = estateRes.error ? null : (estateRes.count ?? null);
  const matchTotal = matchRes.error ? null : (matchRes.count ?? null);
  const attentionTotal = attentionRes.error ? null : (attentionRes.count ?? null);

  // ── The page window ──────────────────────────────────────────────────────────────────────────────
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let rows: WsRow[] = [];

  // ⚠ THE ATTENTION SORT DEGRADES TO NEWEST-FIRST RATHER THAN TO A SILENTLY SHORTER LIST. The split
  // window below sizes bucket A from `attentionTotal`; if that count failed, treating it as 0 would skip
  // bucket A altogether and hide exactly the FAILED and SUSPENDED practices the sort exists to raise.
  // A read that failed must not remove rows from an estate register, so the split is abandoned instead
  // and the degradation is named in `problems`.
  const canSplit = sort === "attention" && attentionTotal !== null;
  if (sort === "attention" && attentionTotal === null) {
    problems.push("attention-first sort: the exception count could not be read, so this page is ordered newest-first and nothing is ranked");
  }

  if (canSplit) {
    const attn = attentionTotal as number;
    if (from < attn) {
      const { data, error } = await filtered(admin.from("practice_workspace").select(WS_COLUMNS))
        .in("status", ATTENTION_STATES as unknown as string[])
        .order("created_at", { ascending: false })
        .range(from, Math.min(to, attn - 1));
      if (error) problems.push(`attention page: ${error.message}`);
      rows = rows.concat((data ?? []) as WsRow[]);
    }
    const restTo = to - attn;
    if (restTo >= 0) {
      const restFrom = Math.max(0, from - attn);
      const { data, error } = await filtered(admin.from("practice_workspace").select(WS_COLUMNS))
        .not("status", "in", inList(ATTENTION_STATES))
        .order("created_at", { ascending: false })
        .range(restFrom, restTo);
      if (error) problems.push(`estate page: ${error.message}`);
      rows = rows.concat((data ?? []) as WsRow[]);
    }
  } else {
    const column = sort === "name" ? "name" : sort === "lifecycle" ? "status" : "created_at";
    // `attention` reaches here only on the degraded path above, where newest-first is the stated fallback.
    // Name, lifecycle and `created_asc` read forwards; `created_desc` AND the degraded `attention` path
    // both read backwards, so the fallback actually is the newest-first order the problem note promises.
    const ascending = sort === "created_asc" || sort === "name" || sort === "lifecycle";
    const { data, error } = await filtered(admin.from("practice_workspace").select(WS_COLUMNS))
      .order(column, { ascending })
      .range(from, to);
    if (error) problems.push(`estate page: ${error.message}`);
    rows = (data ?? []) as WsRow[];
  }

  const wsIds = rows.map(r => r.id);

  // ── Owner names (D1), membership bands (D2), failed sagas ────────────────────────────────────────
  const ownerIds = [...new Set(rows.map(r => r.owner_person_id).filter(Boolean))];
  const [peopleRes, memberCounts, failedRes, marketRes, activityRes] = await Promise.all([
    ownerIds.length
      // ⚠ `email` IS NOT SELECTED, not selected-and-dropped. What is not fetched cannot be spread into
      // a payload by a later edit.
      ? admin.from("profiles").select("id, full_name").in("id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    countByWorkspace(admin, "practice_membership", wsIds, problems),
    // Estate-wide, not page-wide: §2 requires exception state to be visible "without requiring the
    // director to open every Practice", and a failure on page 4 is still a failure.
    admin.from("provisioning_request").select("id, workspace_id, status").eq("status", "FAILED").limit(500),
    // Filter options, read from the data rather than hard-coded, so a new market appears on its own.
    admin.from("practice_workspace").select("country").range(0, 999),
    // §3's activity, over the last 30 days. ⚠ Scoped to the page's practices rather than the estate:
    // this is a per-row column, and reading every event ever emitted to fill six cells would be a table
    // scan pretending to be a lookup.
    admin.from("mos_event")
      .select("practice_id, journey_key, outcome")
      .in("practice_id", wsIds)
      .gte("occurred_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .limit(5000),
  ]);

  if (peopleRes.error) problems.push(`owner names: ${peopleRes.error.message}`);
  const ownerName = new Map(
    ((peopleRes.data ?? []) as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name]),
  );

  if (failedRes.error) problems.push(`failed provisioning: ${failedRes.error.message}`);
  const failedRows = (failedRes.data ?? []) as { id: string; workspace_id: string | null }[];
  const failedByWs = new Map<string, number>();
  for (const r of failedRows) if (r.workspace_id) failedByWs.set(r.workspace_id, (failedByWs.get(r.workspace_id) ?? 0) + 1);
  const failedProvisioning = failedRes.error ? null : {
    total: failedRows.length,
    withWorkspace: failedRows.filter(r => r.workspace_id).length,
    // A saga that failed before the workspace row existed has nothing to attach to and would otherwise
    // vanish from an estate view keyed on practices.
    orphaned: failedRows.filter(r => !r.workspace_id).length,
  };

  // §3's ACTIVITY, aggregated per practice.
  //
  // ⚠ A null map means the store could not be read, and that is carried through to the row as null
  // rather than collapsing to zero. "This practice did nothing" and "nobody could tell" are the two
  // readings this whole module exists to keep apart, and an aggregation is the easiest place to lose
  // the distinction — an empty Map and an unreadable one look identical to a `.get()`.
  if (activityRes.error) problems.push(`activity: ${activityRes.error.message}`);
  const activityByWs = activityRes.error
    ? null
    : new Map<string, { attempts: number; failures: number; journeys: Set<string> }>();
  if (activityByWs) {
    const events = (activityRes.data ?? []) as {
      practice_id: string | null; journey_key: string | null; outcome: string;
    }[];
    for (const e of events) {
      if (!e.practice_id) continue;
      const cur = activityByWs.get(e.practice_id)
        ?? { attempts: 0, failures: 0, journeys: new Set<string>() };
      cur.attempts += 1;
      if (e.outcome === "failure" || e.outcome === "timeout") cur.failures += 1;
      if (e.journey_key) cur.journeys.add(e.journey_key);
      activityByWs.set(e.practice_id, cur);
    }
  }

  if (marketRes.error) problems.push(`markets: ${marketRes.error.message}`);
  const marketRows = (marketRes.data ?? []) as { country: string }[];
  const markets = [...new Set(marketRows.map(m => m.country).filter(Boolean))].sort();

  return {
    rows: rows.map(r => ({
      id: r.id, name: r.name, type: r.type, status: r.status, country: r.country,
      timezone: r.timezone, created_at: r.created_at, updated_at: r.updated_at,
      ownerName: ownerName.get(r.owner_person_id) ?? null,
      // D2: banded HERE, on the server. Returning the number and rounding it for display would put the
      // exact figure in the payload, where anyone can read it.
      membershipBand: memberCounts === null ? null : bandOf(memberCounts[r.id] ?? 0),
      handle: (r as unknown as { practice_handle: string | null }).practice_handle ?? null,
      activity30d: activityByWs === null
        ? null
        : {
            attempts: activityByWs.get(r.id)?.attempts ?? 0,
            failures: activityByWs.get(r.id)?.failures ?? 0,
            journeys: activityByWs.get(r.id)?.journeys.size ?? 0,
          },
      attention: [
        ...lifecycleAttention(r.status),
        ...(failedByWs.has(r.id) ? [{
          severity: "critical" as const,
          label: "Failed provisioning request",
          detail: `${failedByWs.get(r.id)} provisioning request(s) for this workspace are in FAILED and need resuming or clearing.`,
          source: { label: "Provisioning & Onboarding", href: "/super-admin/pd/operations/provisioning" },
        }] : []),
      ],
    })),
    matchTotal, estateTotal, attentionTotal,
    page, pageSize: PAGE_SIZE,
    markets,
    marketsTruncated: marketRows.length >= 1000,
    failedProvisioning,
    problems,
    generatedAt: new Date().toISOString(),
  };
}

// ── PRACTICE 360 ─────────────────────────────────────────────────────────────────────────────────────

export type Aggregate = {
  key: string;
  label: string;
  band: Band;
  /** What the band is a band OF, in the reader's words. Every figure carries its own definition (§17). */
  definition: string;
};

export type ProvisioningEvent = {
  id: string;
  requestType: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  /** D1 — names, never emails. Null where the profile could not be read. */
  actorName: string | null;
  targetName: string | null;
  steps: { step: string; status: string; errorCode: string | null; startedAt: string | null; completedAt: string | null }[];
};

export type Practice360 = {
  workspace: {
    id: string; name: string; type: string; status: string; country: string;
    timezone: string; created_at: string; updated_at: string;
  };
  ownerName: string | null;
  aggregates: Aggregate[];
  attention: AttentionItem[];
  provisioning: ProvisioningEvent[];
  problems: string[];
  generatedAt: string;
};

/**
 * One Practice, for the 360. Returns null when no such workspace exists — the caller must 404 rather
 * than render a shell, because §19 requires a direct URL outside scope to "fail safely before protected
 * data renders".
 *
 * ⚠ EXACT COUNTS ARE TAKEN AND THEN THROWN AWAY. `head: true` returns the count and NO ROWS, so not one
 * patient, appointment or encounter row crosses onto this plane; the integer is banded before it enters
 * the return value. That is D2 and it is why the 360 cannot quote "412 patients" even to its own author.
 */
export async function loadPractice360(admin: Admin, practiceId: string): Promise<Practice360 | null> {
  const problems: string[] = [];

  const { data: wsData, error: wsErr } = await admin
    .from("practice_workspace").select(WS_COLUMNS).eq("id", practiceId).limit(1);
  if (wsErr) {
    // ⚠ A FAILED READ IS NOT A MISSING PRACTICE. Returning null here would render a 404 for a database
    // hiccup, which is a lie about the estate. Thrown so the route surfaces an error instead.
    throw new Error(`practice_workspace: ${wsErr.message}`);
  }
  const ws = ((wsData ?? []) as WsRow[])[0];
  if (!ws) return null;

  // ⚠ SIX LITERAL TABLE NAMES, WRITTEN OUT, NOT MAPPED OVER A REGISTRY. The boundary scanner resolves a
  // `.from(table)` parameter from the CALL SITES in the same file, so a literal at each call site is what
  // makes every one of these reads visible to the harness that judges them. A registry object read as
  // `AGG.map(a => countOne(admin, a.table, …))` risks resolving to nothing, and an unresolved read is a
  // blind spot rather than a refusal.
  const AGG: { key: string; label: string; definition: string }[] = [
    { key: "membership", label: "Membership rows",
      definition: "Rows in practice_membership for this workspace, ANY status. `status` is not an allowlisted column on this plane, so this cannot be narrowed to active practitioners and is not labelled as if it were." },
    { key: "patients", label: "Patients",
      definition: "Rows in practice_patient. The tenancy column is the only column this plane may read; no name, date of birth or identifier is fetched." },
    { key: "appointments", label: "Appointments",
      definition: "Rows in practice_appointment, all time. No appointment time is read — a patient's appointment time is not operational telemetry." },
    { key: "encounters", label: "Encounters",
      definition: "Rows in practice_encounter, all time. Tenancy column only." },
    { key: "invoices", label: "Invoices raised",
      definition: "Rows in practice_invoice — the practitioner billing her own patients, not Competen's revenue. Counts answer \"is the money loop alive\"; amounts and currencies stay on the practice plane." },
    { key: "payments", label: "Payments recorded",
      definition: "Rows in practice_payment. Amounts, methods and collectors are outside this plane permanently." },
  ];

  const counts = await Promise.all([
    countOne(admin, "practice_membership", ws.id, problems),
    countOne(admin, "practice_patient", ws.id, problems),
    countOne(admin, "practice_appointment", ws.id, problems),
    countOne(admin, "practice_encounter", ws.id, problems),
    countOne(admin, "practice_invoice", ws.id, problems),
    countOne(admin, "practice_payment", ws.id, problems),
  ]);

  // Signed encounters, counted separately: an unsigned record does not prove the clinical loop closed.
  // ⚠ A FILTER IS NOT A SELECT. `status` is filtered on and never selected, which is the one use the
  // allowlist blesses on practice_encounter (plane-boundary.ts, practice_encounter's `why`).
  const { count: signedRaw, error: signedErr } = await admin
    .from("practice_encounter").select("workspace_id", { count: "exact", head: true })
    .eq("workspace_id", ws.id).in("status", ["SIGNED", "AMENDED"]);
  if (signedErr) problems.push(`signed encounters: ${signedErr.message}`);

  const aggregates: Aggregate[] = [
    ...AGG.map((a, i) => ({
      key: a.key, label: a.label,
      band: counts[i] === null ? null : bandOf(counts[i] as number),
      definition: a.definition,
    })),
    {
      key: "signed", label: "Signed encounters",
      band: signedErr ? null : (signedRaw === null ? null : bandOf(signedRaw)),
      definition: "Rows in practice_encounter whose status is SIGNED or AMENDED. Any band other than 0 proves the clinical loop closed at least once in this practice.",
    },
  ];

  // ── The provisioning trail (§14) ─────────────────────────────────────────────────────────────────
  const { data: reqData, error: reqErr } = await admin
    .from("provisioning_request")
    .select("id, request_type, status, error_code, actor_user_id, target_user_id, created_at, updated_at")
    .eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(50);
  if (reqErr) problems.push(`provisioning requests: ${reqErr.message}`);
  const requests = (reqData ?? []) as {
    id: string; request_type: string; status: string; error_code: string | null;
    actor_user_id: string; target_user_id: string; created_at: string; updated_at: string;
  }[];

  const [stepsRes, peopleRes] = await Promise.all([
    requests.length
      ? admin.from("provisioning_step")
        .select("request_id, step_code, status, error_code, started_at, completed_at")
        .in("request_id", requests.map(r => r.id))
      : Promise.resolve({ data: [], error: null }),
    (() => {
      const ids = [...new Set([
        ws.owner_person_id,
        ...requests.map(r => r.actor_user_id),
        ...requests.map(r => r.target_user_id),
      ].filter(Boolean))];
      return ids.length
        ? admin.from("profiles").select("id, full_name").in("id", ids)
        : Promise.resolve({ data: [], error: null });
    })(),
  ]);
  if (stepsRes.error) problems.push(`provisioning steps: ${stepsRes.error.message}`);
  if (peopleRes.error) problems.push(`names: ${peopleRes.error.message}`);

  const nameOf = new Map(
    ((peopleRes.data ?? []) as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name]),
  );
  const stepsByRequest = new Map<string, ProvisioningEvent["steps"]>();
  for (const s of (stepsRes.data ?? []) as {
    request_id: string; step_code: string; status: string; error_code: string | null;
    started_at: string | null; completed_at: string | null;
  }[]) {
    const list = stepsByRequest.get(s.request_id) ?? [];
    list.push({ step: s.step_code, status: s.status, errorCode: s.error_code, startedAt: s.started_at, completedAt: s.completed_at });
    stepsByRequest.set(s.request_id, list);
  }
  for (const list of stepsByRequest.values()) {
    list.sort((a, b) => String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? "")));
  }

  const provisioning: ProvisioningEvent[] = requests.map(r => ({
    id: r.id, requestType: r.request_type, status: r.status, errorCode: r.error_code,
    createdAt: r.created_at, updatedAt: r.updated_at,
    actorName: nameOf.get(r.actor_user_id) ?? null,
    targetName: nameOf.get(r.target_user_id) ?? null,
    steps: stepsByRequest.get(r.id) ?? [],
  }));

  return {
    workspace: {
      id: ws.id, name: ws.name, type: ws.type, status: ws.status, country: ws.country,
      timezone: ws.timezone, created_at: ws.created_at, updated_at: ws.updated_at,
    },
    ownerName: nameOf.get(ws.owner_person_id) ?? null,
    aggregates,
    attention: [
      ...lifecycleAttention(ws.status),
      ...(provisioning.some(p => p.status === "FAILED") ? [{
        severity: "critical" as const,
        label: "Failed provisioning request",
        detail: "At least one provisioning request for this workspace is in FAILED. The saga is resumable from Product Operations.",
        source: { label: "Provisioning & Onboarding", href: "/super-admin/pd/operations/provisioning" },
      }] : []),
    ],
    provisioning,
    problems,
    generatedAt: new Date().toISOString(),
  };
}
