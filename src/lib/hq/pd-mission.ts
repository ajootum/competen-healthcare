// CPR-PD-002 — THE READ MODEL BEHIND THE PRACTICE PRODUCT DIRECTOR'S MISSION CONTROL.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THIS FILE COMPOSES. IT DOES NOT RE-ASK QUESTIONS THAT ARE ALREADY ANSWERED.
//
// PD-014 build 3 requires Mission Control to consume "authoritative source summaries rather than
// duplicating domain data", and PD-002 §1 says the operational modules "remain authoritative … and are
// not duplicated here". So the estate, the provisioning ledger, the launch gate and the practitioner
// roster arrive through loadPdOperations() and loadPdPractitioners() exactly as the Operations and
// Practitioners pages see them. If Mission Control counted them a second time, the two surfaces would
// eventually print two different totals and nobody could tell which was wrong.
//
// ⚠ THE FOUR READS THIS FILE DOES MAKE, AND WHY EACH ONE HAD TO BE NEW.
//
//   practice_workspace   id, status, country, timezone, created_at — paged over the whole estate. The
//                        composed loaders read a 200-row PAGE of practices, which cannot answer "how
//                        many Practices are in Uganda", "what is the estate's lifecycle mix" or "when
//                        did the first Practice appear" — and every one of those is a Mission Control
//                        figure. Four allowlisted columns, one scan, in place of four separate counts.
//   practice_patient     one head+count. PD-002 §3 prescribes a Patients KPI and the composed loaders
//                        band this per practice (decision D2) without ever totalling it.
//   practice_appointment three head+counts: the trailing window, the window before it, and today.
//   practice_encounter   one head+count: today.
//
// ⚠ ALL FOUR ARE COUNTS AT THE TENANCY COLUMN, WITH head:true, SO NO ROW IS EVER RETURNED. The window
// boundary is a FILTER on created_at and is never selected, so no appointment time and no encounter time
// leaves the database — the same shape the allowlist already blesses for practice_session. What makes an
// estate-wide total permissible where a per-practice one is not is stated in src/lib/practice/
// operations.ts in as many words: "Dr Nakato's Practice — 412 patients" is business intelligence about a
// named clinician's book; "1,000 practices hold 41,000 patients" is not. Mission Control shows only the
// second kind, and the per-practice figures it does show stay banded.
//
// ⚠ NO PATIENT-LEVEL CONTENT REACHES ANY OF IT (PD-002 §1, §10, §16). Not a name, not a date of birth,
// not an appointment time, not a diagnosis. There is no path to one from here because nothing is
// selected but the tenancy key.
//
// ⚠ AND EVERY FIGURE GOES THROUGH mayRender() FIRST. src/lib/hq/pd-metric-registry.ts is the law on what
// this product may claim to know; a figure with no registry definition is a figure nobody has defined,
// and `figure()` below refuses it for that reason alone. The recorded failure this exists to prevent is
// five frozen screens that shipped renders reading fields which never existed.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

import { loadPdOperations, type PdOperations } from "@/lib/hq/pd-operations";
import { loadPdPractitioners, type PdPractitioners, type PractitionerRow } from "@/lib/hq/pd-practitioners";
import { mayRender, absenceSentence } from "@/lib/hq/pd-metric-registry";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** PD-002 §13: "trailing 30 days for Pulse/adoption/funnel unless explicitly labeled otherwise." */
export const WINDOW_DAYS = 30;

/** How many practices the attention list shows before it defers to the full register. */
const ATTENTION_ROWS = 6;

// ── The three states a figure may be in, and they are not interchangeable ────────────────────────────
//
// ⚠ PD-002 §3: "display 'Not enough data' rather than zero", and §14: "do not substitute zero". A null
// count is not a zero and a failed read is not an empty result. Keeping the three apart in the TYPE is
// what stops a later edit from rendering `?? 0` and turning an unanswered question into a reassurance.
export type Figure =
  /** A real measurement. */
  | { state: "value"; value: number }
  /** The read did not complete, or the producer returned null. Never drawn as 0. */
  | { state: "unknown"; why: string }
  /** The registry refuses this figure. `why` is the registry's own sentence, not a local invention. */
  | { state: "absent"; why: string };

export type Comparison =
  | { state: "delta"; current: number; prior: number; direction: "up" | "down" | "flat" }
  /** PD-002 §3's own rule, in its own words: "Not enough data". */
  | { state: "insufficient"; why: string };

export type PulseCard = {
  key: string;
  metricId: string;
  label: string;
  figure: Figure;
  /** The period and scope this figure is OF. §15 requires explicit time windows on every metric. */
  window: string;
  /** Secondary context — the lifecycle mix, the denominator, the caveat. Rendered with the number. */
  context: string[];
  comparison: Comparison | null;
  href: string;
};

export type MissionAttention = {
  key: string;
  severity: "critical" | "warning" | "info";
  /** Plain language. §4 forbids identifiers, saga step names and implementation terms here. */
  title: string;
  evidence: string;
  scope: string;
  /** "oldest is 4 days old", or null where nothing dates the condition. */
  age: string | null;
  /** §4: deduplicate repeated alerts for one underlying condition and show an aggregate count. */
  count: number;
  action: { label: string; href: string };
};

export type TodayMetric = {
  key: string;
  metricId: string;
  label: string;
  figure: Figure;
  href: string;
  note: string | null;
};

export type JourneyStage = {
  key: string;
  label: string;
  /** Practices that reached this stage. Null = the underlying count did not complete. */
  reached: number | null;
  /** Stage-to-stage: how many reached the PREVIOUS stage. Null on the first stage. */
  from: number | null;
};

export type Journey = {
  /**
   * ⚠ THE REGISTRY GATE, CARRIED IN THE TYPE. This component draws counts and stage-to-stage rates
   * without going through `figure()`, so the permission has to travel with it — otherwise re-declaring
   * mc.practice_journey as absent tomorrow would change nothing on screen, which is the one thing a
   * registry must never allow.
   */
  available: boolean;
  /** The registry's own sentence when `available` is false. Empty otherwise. */
  why: string;
  stages: JourneyStage[];
  /** What every stage is counted OVER. §19 requires the denominator wherever a rate renders. */
  denominator: number;
  denominatorNote: string;
  /** The §6 stages this plane cannot draw, each with the reason. Named, never quietly omitted. */
  unavailable: { label: string; why: string }[];
  label: string;
};

export type AdoptionRow = {
  key: string;
  label: string;
  /** Practices with at least one row. Null = that count did not complete. */
  practices: number | null;
};

export type Adoption = {
  /** Same registry gate as Journey, for the same reason. */
  available: boolean;
  why: string;
  rows: AdoptionRow[];
  denominator: number;
  denominatorNote: string;
  /** §7 capabilities this plane cannot see at all, each with the reason. */
  blind: { label: string; why: string }[];
};

export type PracticeAttentionRow = {
  /** ⚠ FOR THE LINK ONLY. §4 forbids database identifiers on screen; this one is never rendered. */
  id: string;
  name: string;
  ownerName: string | null;
  market: string | null;
  /** Plain-language lifecycle, never the raw status token. */
  lifecycle: string;
  reason: string;
  severity: "critical" | "warning";
  age: string;
  href: string;
};

export type FocusItem = {
  key: string;
  title: string;
  /** §11: every recommendation must expose its evidence. This is a deterministic rule, not a model. */
  rationale: string;
  action: { label: string; href: string };
};

export type PdMission = {
  scope: {
    market: string | null;
    markets: string[];
    /** True when the estate scan hit its ceiling: the market list is a page, not the whole set. */
    truncated: boolean;
    label: string;
  };
  day: { startIso: string; label: string; basis: string };
  windowDays: number;
  freshness: { generatedAt: string; note: string };
  pulse: PulseCard[];
  attention: MissionAttention[];
  today: TodayMetric[];
  journey: Journey;
  adoption: Adoption;
  health: { why: string; services: string[] };
  commercial: { lines: { label: string; why: string }[] };
  practices: {
    rows: PracticeAttentionRow[];
    /** Practices in an attention state across the WHOLE estate, not just the rows shown. */
    estateTotal: number | null;
    note: string;
  };
  focus: FocusItem[];
  /** Reads that did not complete, in the reader's words. §14: never swallowed, never rendered as zero. */
  problems: string[];
};

// ── Small honest helpers ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THE ONE GATE. `compute` is not even called for a metric the registry refuses, so an absent metric
 * cannot leak a value through a later careless edit — there is nothing to leak.
 */
function figure(metricId: string, compute: () => number | null, unreadable: string): Figure {
  if (!mayRender(metricId)) return { state: "absent", why: absenceSentence(metricId) };
  const n = compute();
  return n === null ? { state: "unknown", why: unreadable } : { state: "value", value: n };
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Plain-language age. No timestamps, no identifiers — §4. */
function ageOf(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 60) return `${mins} ${plural(mins, "minute")} old`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} ${plural(hrs, "hour")} old`;
  const days = Math.floor(hrs / 24);
  return `${days} ${plural(days, "day")} old`;
}

const oldest = (isos: (string | null | undefined)[]) =>
  isos.filter(Boolean).sort()[0] as string | undefined ?? null;

/**
 * The instant local midnight began in `tz`, as an ISO string.
 *
 * ⚠ COMPUTED BY SUBTRACTING THE LOCAL TIME OF DAY FROM NOW, not by assembling a date string. Building
 * "2026-08-18T00:00:00" and parsing it applies the SERVER's offset, which is the bug that makes a
 * "today" panel show yesterday for half the world. Returns null on an unknown zone so the caller can
 * say which basis it fell back to rather than silently using its own.
 *
 * The one case this is off by an hour is the day a zone changes its clocks. That is stated rather than
 * corrected: a correction needs a zone database this build does not carry, and being quietly wrong once
 * a year is worse than being visibly approximate.
 */
function startOfLocalDay(tz: string, now: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? NaN);
    const h = get("hour") % 24, mi = get("minute"), s = get("second");
    if ([h, mi, s].some(Number.isNaN)) return null;
    return new Date(now.getTime() - (((h * 60 + mi) * 60 + s) * 1000 + now.getMilliseconds())).toISOString();
  } catch {
    return null;
  }
}

// ── The estate index ────────────────────────────────────────────────────────────────────────────────

type WsIndexRow = { id: string; status: string; country: string | null; timezone: string | null; created_at: string };

/**
 * Every Practice workspace, at four allowlisted columns.
 *
 * ⚠ PAGED WITH .range(), NOT .limit(). PostgREST answers an unbounded select with at most 1,000 rows and
 * says nothing about it; this console has printed a wrong total that way before. A failed page ends the
 * scan as INCOMPLETE rather than as "no more rows", because treating an error as the end of the data
 * would shrink the estate while looking fixed.
 */
async function readWorkspaceIndex(admin: any, problems: string[]): Promise<{ rows: WsIndexRow[]; complete: boolean }> {
  const PAGE = 1000;
  const CEILING = 50_000;
  const rows: WsIndexRow[] = [];
  for (let from = 0; from < CEILING; from += PAGE) {
    const { data, error } = await admin
      .from("practice_workspace")
      .select("id, status, country, timezone, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      problems.push(`The list of Practices could not be read in full (${error.message}). Figures counted from it are incomplete, not zero.`);
      return { rows, complete: false };
    }
    const page = (data ?? []) as WsIndexRow[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, complete: true };
  }
  problems.push(`More than ${CEILING.toLocaleString()} Practices exist; the figures below are counted over the first ${CEILING.toLocaleString()}.`);
  return { rows, complete: false };
}

/**
 * Sum an exact count across workspace-id chunks.
 *
 * `ids === null` means "every Practice" and issues ONE unfiltered count. A non-null empty array means
 * "no Practice is in scope", which is a genuine zero and needs no query at all.
 *
 * ⚠ A NULL COUNT IS UNKNOWN, NEVER ZERO. PostgREST answers a head+count against a table that does not
 * exist with count null and error null, so the count is the discriminator — the trap this codebase has
 * already paid for once.
 */
async function sumCount(
  build: (ids: string[] | null) => any, ids: string[] | null, label: string, problems: string[],
): Promise<number | null> {
  const CHUNK = 200;
  if (ids !== null && ids.length === 0) return 0;
  const groups: (string[] | null)[] = ids === null
    ? [null]
    : Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, i * CHUNK + CHUNK));
  let total = 0;
  for (const g of groups) {
    const { count, error } = await build(g);
    if (error) { problems.push(`${label} could not be counted (${error.message}). That is unknown, not zero.`); return null; }
    if (count === null || count === undefined) { problems.push(`${label} returned no count. That is unknown, not zero.`); return null; }
    total += count as number;
  }
  return total;
}

// ── Plain language for things whose raw form is implementation detail (§4) ───────────────────────────

/** `practice_workspace.status` in the reader's words. The raw token never reaches the screen. */
const LIFECYCLE_WORDS: Record<string, string> = {
  REQUESTED: "Sign-up requested",
  IDENTITY_PENDING: "Waiting on the owner's identity",
  PROVISIONING: "Being created",
  ONBOARDING: "Setting up",
  ACTIVE: "Open for use",
  SUSPENDED: "Suspended",
  MIGRATING: "Being migrated",
  CLOSING: "Closing",
  CLOSED: "Closed",
  FAILED: "Could not be created",
};

/**
 * What a practitioner actually loses when creation stops at each step.
 *
 * ⚠ WRITTEN HERE RATHER THAN BORROWED FROM pd-operations.STEP_FAILURE_CONSEQUENCE, which is the right
 * sentence for the wrong audience: it cites file names and line numbers, and PD-002 §4 forbids
 * implementation terminology on Mission Control. Those belong in Product Operations, which is exactly
 * where this card's one action sends the reader. The step CODE is never rendered — only its consequence.
 */
const FAILURE_IN_PLAIN_WORDS: Record<string, string> = {
  create_workspace: "nothing was created, so a fresh attempt starts clean",
  create_owner_membership: "the Practice exists but its owner is not a member of it",
  assign_capabilities: "the owner can sign in and can do nothing — an empty sidebar",
  create_configuration: "the Practice has no settings and cannot take a booking",
  create_entitlement: "the Practice has neither a trial nor a plan",
  create_onboarding: "the owner cannot start setting the Practice up",
  publish_completed: "everything was built but the Practice was never opened for use",
};

// ── The loader ───────────────────────────────────────────────────────────────────────────────────────

export async function loadPdMission(admin: any, opts: { market?: string | null } = {}): Promise<PdMission> {
  const problems: string[] = [];
  const now = new Date();
  const nowMs = now.getTime();
  const generatedAt = now.toISOString();

  const index = await readWorkspaceIndex(admin, problems);
  const allMarkets = [...new Set(index.rows.map(r => r.country).filter(Boolean) as string[])].sort();
  // ⚠ A SCOPE THE VIEWER CANNOT REACH IS NOT HONOURED (§13: "do not persist a scope the user no longer
  // has permission to access"). An unknown market falls back to All rather than rendering an empty
  // dashboard that looks like a dead product.
  const market = opts.market && allMarkets.includes(opts.market) ? opts.market : null;

  const scoped = market ? index.rows.filter(r => r.country === market) : index.rows;
  const scopedIds = market ? scoped.map(r => r.id) : null;
  const scopeLabel = market ? `${market} only` : "All markets";

  /**
   * §5: a drill-through carries the scope filter forward — but ONLY to a destination that honours it.
   *
   * ⚠ THE ALLOWLIST IS EXACT PATHS, NOT PREFIXES, AND THAT IS THE POINT. `/pd/practices` reads a market
   * filter; `/pd/practices/<id>` is one named Practice, where a market filter means nothing and would
   * read as a filter that silently did not apply. A link that appears to carry a filter it drops is the
   * "reachable but not usable" defect this estate has already paid for.
   */
  const MARKET_AWARE = ["/super-admin/pd/practices", "/super-admin/pd/practitioners"];
  const withMarket = (href: string) => {
    if (!market) return href;
    const [path, qs] = href.split("?");
    if (!MARKET_AWARE.includes(path)) return href;
    const p = new URLSearchParams(qs ?? "");
    p.set("market", market);
    return `${path}?${p.toString()}`;
  };

  // ── The day boundary (§13, §17: "Today uses the selected scope's local-day definition") ────────────
  const zones = [...new Set(scoped.map(r => r.timezone).filter(Boolean) as string[])];
  const chosenZone = zones.length === 1 ? zones[0] : null;
  const localStart = chosenZone ? startOfLocalDay(chosenZone, now) : null;
  const dayStart = localStart ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const dayBasis = localStart
    ? `Local day in ${chosenZone} — the one time zone every Practice in this scope uses.`
    : zones.length > 1
      ? `UTC day. This scope spans ${zones.length} time zones, so it has no single local day; narrow the market to get one.`
      : `UTC day. No Practice in this scope declares a time zone, so there is no local day to use.`;

  // ── The windows ────────────────────────────────────────────────────────────────────────────────────
  const windowStart = new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString();
  const priorStart = new Date(nowMs - 2 * WINDOW_DAYS * 86_400_000).toISOString();
  const earliestPractice = scoped.length ? scoped.map(r => r.created_at).sort()[0] : null;
  /**
   * ⚠ THE COMPARISON RULE, AND IT IS §3'S OWN. A prior window that begins before the first Practice in
   * scope existed is not a low period — it is a period this product did not have. Comparing against it
   * would manufacture a triumphant delta out of the product's own birthday.
   */
  const priorComparable = !!earliestPractice && earliestPractice <= priorStart;
  const notComparable = earliestPractice
    ? `The period before this one starts before the first Practice in scope existed, so there is nothing to compare against yet.`
    : `No Practice is in scope, so there is no earlier period to compare against.`;

  const [ops, practitioners, patientCount, bookings, bookingsPrior, bookingsToday, encountersToday] = await Promise.all([
    loadPdOperations(admin),
    loadPdPractitioners(admin),
    sumCount(ids => {
      let q = admin.from("practice_patient").select("workspace_id", { count: "exact", head: true });
      if (ids) q = q.in("workspace_id", ids);
      return q;
    }, scopedIds, "Patient records", problems),
    sumCount(ids => {
      let q = admin.from("practice_appointment").select("workspace_id", { count: "exact", head: true }).gte("created_at", windowStart);
      if (ids) q = q.in("workspace_id", ids);
      return q;
    }, scopedIds, "Bookings in the last 30 days", problems),
    sumCount(ids => {
      let q = admin.from("practice_appointment").select("workspace_id", { count: "exact", head: true })
        .gte("created_at", priorStart).lt("created_at", windowStart);
      if (ids) q = q.in("workspace_id", ids);
      return q;
    }, scopedIds, "Bookings in the previous 30 days", problems),
    sumCount(ids => {
      let q = admin.from("practice_appointment").select("workspace_id", { count: "exact", head: true }).gte("created_at", dayStart);
      if (ids) q = q.in("workspace_id", ids);
      return q;
    }, scopedIds, "Bookings today", problems),
    sumCount(ids => {
      let q = admin.from("practice_encounter").select("workspace_id", { count: "exact", head: true }).gte("created_at", dayStart);
      if (ids) q = q.in("workspace_id", ids);
      return q;
    }, scopedIds, "Encounters today", problems),
  ]);

  for (const p of practitioners.unavailable) problems.push(`Practitioner roster: ${p}`);
  for (const p of ops.estate.countsTruncated) problems.push(`Practice activity counts: ${p}`);

  // ── Scoping the composed sources ───────────────────────────────────────────────────────────────────
  const countryOf = new Map(index.rows.map(r => [r.id, r.country]));
  const inScope = (wsId: string | null) => !market || (wsId !== null && countryOf.get(wsId) === market);

  const opsWorkspaces = ops.workspaces.filter(w => !market || w.country === market);
  const people: PractitionerRow[] = market
    ? practitioners.rows.filter(r => r.markets.includes(market))
    : practitioners.rows;
  const failures = ops.failures.filter(f => inScope(f.workspaceId));
  const stranded = ops.stranded.filter(s => inScope(s.id));

  // ── B. PRODUCT PULSE (§3) ──────────────────────────────────────────────────────────────────────────
  const statusMix = new Map<string, number>();
  for (const r of scoped) statusMix.set(r.status, (statusMix.get(r.status) ?? 0) + 1);
  const inState = (...s: string[]) => s.reduce((n, k) => n + (statusMix.get(k) ?? 0), 0);
  const attentionEstate = inState("FAILED", "SUSPENDED");

  /**
   * ⚠ THE LIVE ESTATE AND THE RETIRED ONE, COUNTED SEPARATELY.
   *
   * RETIRED lists the states in which a Practice is no longer an operating one -- it takes no bookings,
   * nobody works in it, and it cannot be opened. LIVE is everything else, which is deliberately the
   * complement rather than a second hand-kept list: a state added to the schema tomorrow shows up in
   * the headline and gets noticed, where a missing entry in an allowlist would silently vanish from it.
   *
   * ⚠ ARCHIVED IS NOT DELETED, AND THAT MATTERS HERE. Migration 247 makes lifecycle transitions
   * append-only, so a Practice that has moved through states can never be removed -- archiving is the
   * estate own way of retiring one. If the headline counted every row, the count could then only ever
   * rise, and would drift further from the truth with each retirement.
   */
  const RETIRED_STATES = ["ARCHIVED", "CLOSING", "CLOSED", "FAILED"];
  const retiredCount = inState(...RETIRED_STATES);
  const liveCount = scoped.length - retiredCount;

  const newPeople = people.filter(r => r.joinedAt && r.joinedAt >= windowStart).length;
  const priorPeople = people.filter(r => r.joinedAt && r.joinedAt >= priorStart && r.joinedAt < windowStart).length;

  const seen = people.filter(r => r.seenInWindow === true).length;
  const notSeen = people.filter(r => r.seenInWindow === false).length;
  const neverSeen = people.filter(r => r.seenInWindow === null).length;

  const direction = (a: number, b: number): "up" | "down" | "flat" => (a > b ? "up" : a < b ? "down" : "flat");

  const pulse: PulseCard[] = [
    {
      key: "practices", metricId: "mc.practices_total", label: "Practices",
      // ⚠ THE HEADLINE IS THE LIVE ESTATE, NOT EVERY ROW THAT HAS EVER EXISTED (2026-08-18).
      //
      // This counted every lifecycle state, so an ARCHIVED practice was indistinguishable from an
      // operating one in the figure a Product Director reads first. The estate held one real practice
      // and one archived fixture and the card said "2" -- true of the table, and not true of the
      // product. An archived practice takes no bookings, has no practitioners working in it and cannot
      // be opened; counting it as a Practice makes the headline answer a question nobody asked.
      //
      // Archived is not hidden. It moves one line down, where it is context rather than the number.
      figure: figure("mc.practices_total", () => (index.complete || scoped.length ? liveCount : null),
        "The list of Practices could not be read."),
      window: `${scopeLabel} · open, setting up or being created — as of now`,
      context: [
        retiredCount
          ? `${retiredCount} archived or closed, not counted above`
          : "",
        `${inState("ACTIVE")} open for use · ${inState("ONBOARDING")} setting up · ${inState("REQUESTED", "IDENTITY_PENDING", "PROVISIONING", "MIGRATING")} being created`,
        // ⚠ "NONE" IS A CLAIM AND IT NEEDS A COMPLETE SCAN BEHIND IT. On a partial read the practices
        // that failed or were suspended may simply be in the part that was not read, and printing
        // "none suspended" there would be the reassuring reading of a broken query.
        !index.complete
          ? "Whether any Practice is suspended or failed cannot be stated — the list did not read in full."
          : attentionEstate
            ? `${attentionEstate} ${plural(attentionEstate, "practice")} need attention`
            : "None suspended and none failed to be created",
        index.complete ? "" : "⚠ The estate scan did not complete, so this is a floor rather than a total.",
      ].filter(Boolean),
      comparison: null,
      href: "/super-admin/pd/practices",
    },
    {
      key: "practitioners", metricId: "mc.practitioners_total", label: "Practitioners",
      figure: figure("mc.practitioners_total", () => (practitioners.rows.length || practitioners.complete ? people.length : null),
        "The practitioner roster could not be read."),
      window: `${scopeLabel} · people holding a Practice membership of any status`,
      context: [
        `${newPeople} joined in the last ${WINDOW_DAYS} days`,
        practitioners.complete ? "" : "⚠ The roster did not read completely, so this is a floor rather than a total.",
      ].filter(Boolean),
      comparison: mayRender("mc.practitioners_new")
        ? (priorComparable
          ? { state: "delta", current: newPeople, prior: priorPeople, direction: direction(newPeople, priorPeople) }
          : { state: "insufficient", why: notComparable })
        : { state: "insufficient", why: absenceSentence("mc.practitioners_new") },
      href: "/super-admin/pd/practitioners",
    },
    {
      key: "active", metricId: "mc.active_30d", label: `Active in ${WINDOW_DAYS} days`,
      figure: figure("mc.active_30d", () => (practitioners.sessionsReadable ? seen : null),
        "Sign-in sessions could not be read, so nobody's recency is known. That is not a roster of dormant practitioners."),
      window: `${scopeLabel} · trailing ${WINDOW_DAYS} days`,
      context: [
        `${seen} of ${people.length} ${plural(people.length, "practitioner")} in scope`,
        `${notSeen} last opened Practice before this window · ${neverSeen} have never opened it on a registered device`,
        "Recency, not use: this counts a Practice shell being open, not what was done in it.",
      ],
      comparison: null,
      href: "/super-admin/pd/practitioners",
    },
    {
      key: "patients", metricId: "mc.patient_records", label: "Patient records",
      figure: figure("mc.patient_records", () => patientCount, "The patient record count could not be read."),
      window: `${scopeLabel} · all time, counts only`,
      context: [
        "Records, not people — someone registered at two Practices is two records.",
        "No name, date of birth or identifier is read; only how many rows exist.",
      ],
      comparison: null,
      href: "/super-admin/pd/practices",
    },
    {
      key: "bookings", metricId: "mc.bookings_window", label: `Bookings in ${WINDOW_DAYS} days`,
      figure: figure("mc.bookings_window", () => bookings, "The booking count could not be read."),
      window: `${scopeLabel} · bookings TAKEN in the trailing ${WINDOW_DAYS} days`,
      context: ["Counted by when the booking was made, not when the patient is due to be seen."],
      comparison: bookings === null || bookingsPrior === null
        ? { state: "insufficient", why: "One of the two periods could not be counted, so no comparison is drawn." }
        : priorComparable
          ? { state: "delta", current: bookings, prior: bookingsPrior, direction: direction(bookings, bookingsPrior) }
          : { state: "insufficient", why: notComparable },
      href: "/super-admin/pd/intelligence/adoption",
    },
    {
      key: "health", metricId: "mc.product_health", label: "Product health",
      // ⚠ THE SHORT FORM HERE, THE REGISTRY'S FULL SENTENCE IN COMPONENT G. §3 wants six KPIs scannable
      // in ten seconds and the registry's reason for this one runs to five lines — long enough to push
      // the other five cards off the fold, which would make the honest card the reason the page stopped
      // working. The full text is rendered where §2 puts the health card, and this points at it.
      figure: mayRender("mc.product_health")
        ? figure("mc.product_health", () => null, "unreachable — the registry permits this metric but nothing computes it")
        : { state: "absent", why: "Nothing in this product measures service health. The specific missing facts are named in Product health, below." },
      window: "Not measured anywhere in this product",
      context: [],
      comparison: null,
      href: "/super-admin/pd/health",
    },
  ];

  // ── C. NEEDS ATTENTION (§4) ────────────────────────────────────────────────────────────────────────
  const attention: MissionAttention[] = [];

  if (failures.length) {
    const consequences = [...new Set(failures.map(f => (f.failedStep ? FAILURE_IN_PLAIN_WORDS[f.failedStep] : null)).filter(Boolean))];
    attention.push({
      key: "provisioning-failed", severity: "critical", count: failures.length,
      title: `${failures.length} Practice sign-${plural(failures.length, "up")} could not be completed`,
      evidence: consequences.length
        ? `For the practitioners affected, ${consequences.join("; and for others, ")}.`
        : "Creation stopped before the Practice was ready and no step recorded where.",
      scope: market ? `${market} · ${failures.length} ${plural(failures.length, "practitioner")}` : `${failures.length} ${plural(failures.length, "practitioner")} across all markets`,
      age: ageOf(oldest(failures.map(f => f.createdAt)), nowMs) && `oldest is ${ageOf(oldest(failures.map(f => f.createdAt)), nowMs)}`,
      action: { label: "Open provisioning", href: "/super-admin/pd/operations/provisioning" },
    });
  }

  const strandedUnsettled = stranded.filter(s => s.verdict === "unsettled");
  if (strandedUnsettled.length) {
    attention.push({
      key: "stranded", severity: "critical", count: strandedUnsettled.length,
      title: `${strandedUnsettled.length} ${plural(strandedUnsettled.length, "Practice")} ${strandedUnsettled.length === 1 ? "is" : "are"} stuck part-built`,
      evidence: "Each was started and never finished, and no recent sign-up attempt explains why. Nobody can use them and nobody has been told.",
      scope: market ? `${market}` : "All markets",
      age: ageOf(oldest(strandedUnsettled.map(s => s.createdAt)), nowMs) && `oldest is ${ageOf(oldest(strandedUnsettled.map(s => s.createdAt)), nowMs)}`,
      action: { label: "Open provisioning", href: "/super-admin/pd/operations/provisioning" },
    });
  }

  if (ops.open.length) {
    attention.push({
      key: "in-flight", severity: "warning", count: ops.open.length,
      title: `${ops.open.length} Practice sign-${plural(ops.open.length, "up")} still in progress`,
      // ⚠ NOT CALLED "STALLED". No governed threshold for a stuck sign-up exists anywhere in this
      // product, and inventing "over four hours" here would be a rule nobody agreed and nobody could
      // change. The age is shown; the verdict is left to the reader who can see the queue.
      evidence: "Whether any of these is stuck cannot be judged here: no agreed time limit for a sign-up exists yet. The age is shown so the queue can be read.",
      scope: "All markets — a sign-up has no market until its Practice exists",
      age: ageOf(oldest(ops.open.map(o => o.createdAt)), nowMs) && `oldest is ${ageOf(oldest(ops.open.map(o => o.createdAt)), nowMs)}`,
      action: { label: "Open provisioning", href: "/super-admin/pd/operations/provisioning" },
    });
  }

  const suspended = inState("SUSPENDED");
  if (suspended) {
    attention.push({
      key: "suspended", severity: "warning", count: suspended,
      title: `${suspended} ${plural(suspended, "Practice")} suspended`,
      evidence: "Access is restricted by an operational or governance decision. The reason is held with the Practice and is not readable from here.",
      scope: scopeLabel, age: null,
      action: { label: "Review practices", href: "/super-admin/pd/practices?lifecycle=SUSPENDED" },
    });
  }

  const invited = people.filter(p => p.lifecycle === "INVITED").length;
  if (invited) {
    attention.push({
      key: "invited", severity: "warning", count: invited,
      title: `${invited} ${plural(invited, "invitation")} not taken up`,
      evidence: "These practitioners were invited to a Practice and have not completed registration, so they cannot yet be worked with.",
      scope: scopeLabel, age: null,
      action: { label: "Review practitioners", href: "/super-admin/pd/practitioners?cohort=invited" },
    });
  }

  if (ops.gateSummary.fail || ops.gateSummary.manualOutstanding) {
    const outstanding = ops.gateSummary.fail + ops.gateSummary.manualOutstanding;
    attention.push({
      key: "gate", severity: "warning", count: outstanding,
      title: `Launch readiness is not complete`,
      evidence: `${ops.gateSummary.pass} of ${ops.gateSummary.total} readiness checks pass. ${ops.gateSummary.fail} ${plural(ops.gateSummary.fail, "check")} ${ops.gateSummary.fail === 1 ? "is" : "are"} failing and ${ops.gateSummary.manualOutstanding} ${plural(ops.gateSummary.manualOutstanding, "check")} still ${ops.gateSummary.manualOutstanding === 1 ? "needs" : "need"} a person to sign it off.`,
      scope: `Competen Practice as a product — ${ops.launch.state}`,
      age: null,
      action: { label: "Open launch readiness", href: "/super-admin/pd/operations/launch-readiness" },
    });
  }

  // ⚠ A FAILED READ IS AN EXCEPTION, NOT A BLANK. §14 requires a plain-language failure state, and a
  // dashboard that quietly drops the components it could not fill is the one that gets believed.
  if (problems.length) {
    attention.push({
      key: "reads", severity: "warning", count: problems.length,
      title: `${problems.length} ${plural(problems.length, "figure")} on this page could not be read`,
      evidence: "The affected components say so where they sit. None of them is showing a zero in place of the answer.",
      scope: "This page", age: null,
      action: { label: "Open operations", href: "/super-admin/pd/operations" },
    });
  }

  const RANK: Record<MissionAttention["severity"], number> = { critical: 0, warning: 1, info: 2 };
  attention.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count);

  // ── D. TODAY (§5) ──────────────────────────────────────────────────────────────────────────────────
  const joinedToday = people.filter(r => r.joinedAt && r.joinedAt >= dayStart).length;
  const today: TodayMetric[] = [
    {
      key: "new-practitioners", metricId: "mc.practitioners_new", label: "New practitioners",
      figure: figure("mc.practitioners_new", () => (practitioners.rows.length || practitioners.complete ? joinedToday : null),
        "The practitioner roster could not be read."),
      href: "/super-admin/pd/practitioners?cohort=new", note: null,
    },
    {
      key: "onboarding", metricId: "mc.practices_total", label: "Practices setting up",
      figure: figure("mc.practices_total", () => (index.complete || scoped.length ? inState("ONBOARDING") : null),
        "The list of Practices could not be read."),
      href: "/super-admin/pd/practices?lifecycle=ONBOARDING",
      note: "A standing count, not a today count — a Practice can be setting up for weeks.",
    },
    {
      key: "bookings-today", metricId: "mc.bookings_window", label: "Bookings taken",
      figure: figure("mc.bookings_window", () => bookingsToday, "The booking count could not be read."),
      href: "/super-admin/pd/intelligence/adoption", note: null,
    },
    {
      key: "encounters-today", metricId: "mc.encounters_window", label: "Encounters recorded",
      figure: figure("mc.encounters_window", () => encountersToday, "The encounter count could not be read."),
      href: "/super-admin/pd/intelligence/adoption", note: null,
    },
    {
      key: "support", metricId: "mc.support_requests", label: "Support requests",
      figure: figure("mc.support_requests", () => null, "unreachable — the registry refuses this metric"),
      href: "/super-admin/pd/support", note: null,
    },
    {
      key: "incidents", metricId: "mc.open_incidents", label: "Open incidents",
      figure: figure("mc.open_incidents", () => null, "unreachable — the registry refuses this metric"),
      href: "/super-admin/pd/support/incidents", note: null,
    },
  ];

  // ── E. PRACTICE JOURNEY (§6) ───────────────────────────────────────────────────────────────────────
  //
  // ⚠ A PRACTICE FUNNEL, LABELLED AS ONE. §6 asks for a practitioner funnel; the activation ledger is
  // unique on (workspace_id, event_key), so a milestone belongs to a Practice and is stamped by whoever
  // tripped it first. On a shared Practice, relabelling that as a person's progress would credit one
  // colleague's first booking to everybody in the room.
  const countFailed = (key: string) => ops.estate.countsTruncated.some(t => t.startsWith(`${key}:`));
  const journeyOk = mayRender("mc.practice_journey");
  const adoptionOk = mayRender("mc.feature_adoption");
  /**
   * ⚠ A MISSING BAND IS A ZERO; A FAILED COUNT IS NOT. loadPracticeOps records a band only for a
   * workspace that had rows, so an absent key means "none". A count that ERRORED is reported through
   * countsTruncated instead, and that whole stage becomes unknown rather than quietly counting the
   * practices whose pages happened to succeed.
   */
  const withRows = (key: string, gate: boolean) =>
    !gate || countFailed(key)
      ? null
      : opsWorkspaces.filter(w => { const b = w.counts[key]; return !!b && b !== "0"; }).length;

  const provisioned = opsWorkspaces.length;
  const openForUse = opsWorkspaces.filter(w => w.status === "ACTIVE").length;
  const bookedPractices = withRows("appointments", journeyOk);
  const journey: Journey = {
    available: journeyOk,
    why: journeyOk ? "" : absenceSentence("mc.practice_journey"),
    label: "Practices, not practitioners",
    denominator: provisioned,
    denominatorNote: ops.estate.pagePartial
      ? `Measured over the ${provisioned} most recently created ${plural(provisioned, "Practice")} in scope, which is a page of the estate rather than all of it.`
      : `Measured over all ${provisioned} ${plural(provisioned, "Practice")} in scope.`,
    stages: [
      { key: "provisioned", label: "Practice created", reached: journeyOk ? provisioned : null, from: null },
      { key: "open", label: "Finished setting up", reached: journeyOk ? openForUse : null, from: journeyOk ? provisioned : null },
      { key: "booked", label: "Took a first booking", reached: bookedPractices, from: journeyOk ? openForUse : null },
      { key: "seen", label: "Recorded a first encounter", reached: withRows("encounters", journeyOk), from: bookedPractices },
    ],
    unavailable: [
      { label: "Visited / invited", why: "nothing records a visit to the product or an invitation to try it. There is no producer for this stage at all." },
      { label: "Configured Practice", why: "a Practice's settings are held on the Practice's own side of the boundary and Mission Control may not read them." },
      { label: "Created availability", why: "the availability tables are on the Practice's own side of the boundary, for the same reason." },
      { label: "Active at 30 days", why: "the only recency signal in this product belongs to a person's sign-in session, not to a Practice, so a Practice cannot be shown as still active thirty days on." },
    ],
  };

  // ── F. FEATURE ADOPTION (§7) ───────────────────────────────────────────────────────────────────────
  const adoption: Adoption = {
    available: adoptionOk,
    why: adoptionOk ? "" : absenceSentence("mc.feature_adoption"),
    denominator: provisioned,
    denominatorNote: "Every Practice in scope counts in the denominator, whether or not the capability is switched on for it — which capabilities each Practice holds is not readable from here, so each figure is a floor.",
    rows: [
      { key: "bookings", label: "Bookings", practices: withRows("appointments", adoptionOk) },
      { key: "encounters", label: "Encounters", practices: withRows("encounters", adoptionOk) },
      { key: "invoices", label: "Invoices", practices: withRows("invoices", adoptionOk) },
    ],
    blind: [
      { label: "Follow-ups", why: "follow-ups are recorded on the Practice's own side of the boundary; Mission Control cannot see whether one was created." },
      { label: "Documents", why: "documents are held with the Practice's clinical record and are outside this view permanently." },
      { label: "Self-booking", why: "whether a booking arrived from a patient or was typed in by the Practice is a property of the booking itself, which this view may not read — only how many exist." },
      { label: "AI Assistant", why: "nothing records an assistant being used. No feature-invocation event is written anywhere in this product." },
    ],
  };

  // ── G. PRODUCT HEALTH (§8) and H. GROWTH & COMMERCIAL (§9) ─────────────────────────────────────────
  const health = {
    why: absenceSentence("mc.product_health"),
    services: ["Authentication", "Practice core", "Booking", "Notifications", "Documents & storage", "Offline sync", "AI services", "Integrations"],
  };
  const commercial = {
    lines: [
      { label: "Paid practitioners, MRR and revenue", why: absenceSentence("cm.mrr") },
      { label: "Active trials and trial-to-paid conversion", why: absenceSentence("cm.trial_to_paid") },
      { label: "Payment failures needing action", why: absenceSentence("cm.payment_failures") },
    ],
  };

  // ── I. PRACTICES REQUIRING ATTENTION (§10) ─────────────────────────────────────────────────────────
  const failedByWs = new Map(failures.filter(f => f.workspaceId).map(f => [f.workspaceId as string, f]));
  const strandedByWs = new Map(stranded.map(s => [s.id, s]));
  const attentionRows: PracticeAttentionRow[] = opsWorkspaces
    .map(w => {
      const bad = failedByWs.get(w.id);
      const stuck = strandedByWs.get(w.id);
      let severity: PracticeAttentionRow["severity"] | null = null;
      let reason = "";
      if (w.status === "FAILED" || bad) {
        severity = "critical";
        reason = bad?.failedStep && FAILURE_IN_PLAIN_WORDS[bad.failedStep]
          ? `Creation stopped part-way: ${FAILURE_IN_PLAIN_WORDS[bad.failedStep]}.`
          : "Creation stopped part-way and the Practice is not usable.";
      } else if (w.status === "SUSPENDED") {
        severity = "critical";
        reason = "Access is restricted by an operational or governance decision.";
      } else if (stuck) {
        severity = "warning";
        reason = stuck.verdict === "in_flight"
          ? "Being created right now."
          : "Started and never finished, with no recent attempt explaining why.";
      } else if (w.status === "CLOSING") {
        severity = "warning";
        reason = "Closure has begun and has not completed.";
      } else if (w.status === "ONBOARDING" && (!w.counts.appointments || w.counts.appointments === "0")) {
        severity = "warning";
        reason = "Setting up, and it has never taken a booking.";
      } else return null;
      return {
        id: w.id, name: w.name, ownerName: w.ownerName, market: w.country,
        lifecycle: LIFECYCLE_WORDS[w.status] ?? "Unrecognised state",
        reason, severity,
        age: ageOf(w.created_at, nowMs) ?? "age unknown",
        href: `/super-admin/pd/practices/${w.id}`,
      } as PracticeAttentionRow;
    })
    .filter((r): r is PracticeAttentionRow => r !== null)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));

  // ── J. PRODUCT DIRECTOR FOCUS (§11) — deterministic rules, each with its evidence ───────────────────
  const neverBooked = bookedPractices === null ? null : provisioned - bookedPractices;
  const focus: FocusItem[] = [];
  if (ops.gateSummary.fail || ops.gateSummary.manualOutstanding) {
    focus.push({
      key: "gate", title: "Close out launch readiness",
      rationale: `${ops.gateSummary.pass} of ${ops.gateSummary.total} checks pass; ${ops.gateSummary.fail} failing and ${ops.gateSummary.manualOutstanding} awaiting sign-off. Practice is currently ${ops.launch.state.toLowerCase()}.`,
      action: { label: "Launch readiness", href: "/super-admin/pd/operations/launch-readiness" },
    });
  }
  if (failures.length || strandedUnsettled.length) {
    focus.push({
      key: "provisioning", title: "Clear the Practices that could not be created",
      rationale: `${failures.length} sign-${plural(failures.length, "up")} failed and ${strandedUnsettled.length} ${plural(strandedUnsettled.length, "Practice")} ${strandedUnsettled.length === 1 ? "is" : "are"} stuck part-built. Each is a practitioner who signed up and cannot work.`,
      action: { label: "Provisioning", href: "/super-admin/pd/operations/provisioning" },
    });
  }
  if (neverBooked !== null && neverBooked > 0) {
    focus.push({
      key: "never-booked", title: "Find out why Practices are not booking",
      rationale: `${neverBooked} of ${provisioned} ${plural(provisioned, "Practice")} in scope ${neverBooked === 1 ? "has" : "have"} never taken a booking. Bookings are the first thing a Practice does that proves the product works for it.`,
      action: { label: "Practices", href: "/super-admin/pd/practices" },
    });
  }
  if (invited) {
    focus.push({
      key: "invited", title: "Chase invitations that were never taken up",
      rationale: `${invited} invited ${plural(invited, "practitioner")} never completed registration. They are the cheapest growth on the board and nothing currently follows them up.`,
      action: { label: "Practitioners", href: "/super-admin/pd/practitioners?cohort=invited" },
    });
  }
  focus.push({
    key: "instrumentation", title: "Decide whether Practice gets product instrumentation",
    rationale: "Product health, engagement, retention and every commercial figure are unanswerable today because nothing records them — not because they are unbuilt screens. Four of this page's own components say so rather than showing a number. That is a product decision, and it is yours.",
    action: { label: "Product health", href: "/super-admin/pd/health" },
  });

  // ⚠ THE SCOPE IS CARRIED FORWARD IN ONE PLACE, ONCE, NOT AT TWENTY-SIX HREFS. A rule that has to be
  // remembered at every call site is a rule the twenty-seventh call site will not follow. The Practice
  // 360 links are deliberately left alone: they name one Practice, so a market filter is meaningless
  // there and withMarket refuses that path anyway.
  const carry = <T extends { action: { label: string; href: string } }>(xs: T[]): T[] =>
    xs.map(x => ({ ...x, action: { ...x.action, href: withMarket(x.action.href) } }));

  return {
    scope: { market, markets: allMarkets, truncated: !index.complete, label: scopeLabel },
    day: {
      startIso: dayStart,
      label: chosenZone ? `Today in ${chosenZone}` : "Today (UTC)",
      basis: dayBasis,
    },
    windowDays: WINDOW_DAYS,
    freshness: {
      generatedAt,
      note: "Read live from the platform on this request. Nothing on this page is cached or pre-aggregated.",
    },
    pulse: pulse.map(c => ({ ...c, href: withMarket(c.href) })),
    attention: carry(attention),
    today: today.map(t => ({ ...t, href: withMarket(t.href) })),
    journey, adoption, health, commercial,
    practices: {
      rows: attentionRows.slice(0, ATTENTION_ROWS),
      estateTotal: index.complete ? attentionEstate : null,
      note: ops.estate.pagePartial
        ? `Ranked over the ${opsWorkspaces.length} most recently created ${plural(opsWorkspaces.length, "Practice")} in scope. An older Practice in difficulty is counted in the estate figure beside this list but will not appear in it.`
        : `Ranked over every Practice in scope.`,
    },
    focus: carry(focus.slice(0, 5)),
    problems,
  };
}

/** Re-exported so the page can type its props without importing the source loaders directly. */
export type { PdOperations, PdPractitioners };
