import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdPractitioners, filterPractitioners, LIFECYCLE_LABEL,
  COHORTS_WITHOUT_A_PERSON_LEVEL_FACT,
  type PractitionerLifecycle, type PractitionerRow,
} from "@/lib/hq/pd-practitioners";

// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does
// not constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything — PD-004 s19, s20.
//
// ⚠ CPR-PD-014 BUILD 3 — THE ROSTER, AND ONLY THE ROSTER, ON PURPOSE.
//
// PD-004 specifies an estate table of thirteen columns and a Practitioner 360 of eight tabs. Seven of
// those columns and four of those tabs have NO PERSON-LEVEL FACT in this database — see the header of
// src/lib/hq/pd-practitioners.ts for the two blockers, each verified against the migration that causes
// it. This page therefore ships the columns that have producers and states, in words, which fact is
// missing behind each column that does not. It renders no activation percentage, no engagement score,
// no sample row and no em dash standing in for a measured zero.

export const dynamic = "force-dynamic";

const LIFECYCLES: PractitionerLifecycle[] = ["REGISTERED", "INVITED", "SUSPENDED", "REMOVED"];

const ROLE_LABEL: Record<string, string> = {
  practice_owner: "Owner",
  practitioner: "Practitioner",
  practice_assistant: "Assistant",
  billing_reporting: "Billing & reporting",
  read_only_auditor: "Read-only auditor",
};

const MEMBERSHIP_LABEL: Record<string, string> = {
  active: "active", invited: "invited", suspended: "suspended", revoked: "revoked",
};

function day(iso: string | null) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** A named absence. Never a figure, never a dash in a metric slot — a sentence saying what is missing. */
function Absent({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-[12px] font-bold text-gray-900">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{children}</p>
    </div>
  );
}

/**
 * The practitioner's initials, leading each row the same way PracticeAvatar leads the estate register
 * (src/app/super-admin/pd/practices/page.tsx) — same hash-to-tone mapping, so a person who is also a
 * Practice owner reads with a consistent colour across both screens.
 *
 * ⚠ THE HUE IS DERIVED FROM THE NAME AND CARRIES NO MEANING. §18's rule is never to encode state in
 * colour alone; this encodes IDENTITY, so a row a reader has seen before is recognisable at a glance.
 * Lifecycle, recency and attention all print their own word via Pill below.
 */
const AVATAR_TONES = [
  "bg-teal-100 text-teal-800", "bg-sky-100 text-sky-800", "bg-violet-100 text-violet-800",
  "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-800", "bg-emerald-100 text-emerald-800",
];

function PractitionerAvatar({ name }: { name: string | null }) {
  const label = name ?? "?";
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "?";
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return (
    <span
      aria-hidden
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10.5px] font-bold ${
        AVATAR_TONES[hash % AVATAR_TONES.length]}`}
    >
      {initials}
    </span>
  );
}

function Pill({ tone, children }: { tone: "neutral" | "warning" | "error" | "success"; children: React.ReactNode }) {
  const map = {
    neutral: "border-gray-300 bg-[var(--cmp-surface-neutral)] text-[var(--cmp-text-neutral)]",
    warning: "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
    error: "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]",
    success: "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  } as const;
  // s17: never colour alone. Every pill carries its own words, so the tone is emphasis, not meaning.
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const ctx = await requireHqCapability("hq.practice.practitioners.view");

  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };

  const q = one("q") ?? "";
  const lifecycleParam = one("lifecycle");
  const lifecycle = LIFECYCLES.includes(lifecycleParam as PractitionerLifecycle)
    ? (lifecycleParam as PractitionerLifecycle) : null;
  const market = one("market") || null;
  const workspaceId = one("practice") || null;
  const cohortParam = one("cohort");
  const cohort = cohortParam === "new" || cohortParam === "invited" || cohortParam === "suspended"
    ? cohortParam : null;

  const data = await loadPdPractitioners(ctx.admin);
  const rows = filterPractitioners(
    data.rows, { q, lifecycle, market, workspaceId, cohort }, data.newWindowDays);

  const activeFilters = [q.trim() ? 1 : 0, lifecycle ? 1 : 0, market ? 1 : 0, workspaceId ? 1 : 0, cohort ? 1 : 0]
    .reduce((a: number, b: number) => a + b, 0);

  const markets = [...new Set(data.rows.flatMap(r => r.markets))].sort();
  const practices = [...new Map(
    data.rows.flatMap(r => r.memberships.map(m => [m.workspaceId, m.workspaceName ?? m.workspaceId] as const)),
  ).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));

  const cohortLink = (key: string | null, label: string) => (
    <Link
      href={key ? `/super-admin/pd/practitioners?cohort=${key}` : "/super-admin/pd/practitioners"}
      className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${
        cohort === key
          ? "border-[var(--cmp-color-primary)] bg-[var(--cmp-color-primary-light)] text-[var(--cmp-color-primary-dark)]"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div data-wide className="space-y-4">
      {/* ── Header: scope, exact estate total, freshness (s2) ───────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Practice Product Director
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-gray-900">Practitioners</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Everyone holding a Competen Practice membership, as one person per row however many Practices
          they are in. Identity resolves from the central Competen identity model; this screen keeps no
          second store of its own.
        </p>
        <p className="mt-1 font-mono text-[11px] text-gray-500">CPR-PD-004 §2–§4 · the estate only</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-gray-200 bg-[var(--cmp-surface-neutral)] px-4 py-2.5 text-[12px]">
        <span className="text-gray-700">
          <strong className="text-gray-900">{data.total.toLocaleString()}</strong> practitioner
          {data.total === 1 ? "" : "s"} across the whole estate
          {data.complete ? "" : " (at least — the membership read did not complete)"}
        </span>
        <span className="text-gray-700">
          Scope: <strong className="text-gray-900">all markets, all Practices</strong> — because{" "}
          <code>hq.practice.practitioners.view</code> carries no market restriction today, not because
          one was dropped
        </span>
        <span className="text-gray-500">
          Read at {data.generatedAt.slice(0, 16).replace("T", " ")}Z, live on this request. Nothing on
          this page is cached or precomputed.
        </span>
        <span className="text-gray-500">No actions: this screen writes nothing.</span>
      </div>

      {data.unavailable.length > 0 && (
        <div className="rounded-xl border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] p-3">
          <p className="text-[12px] font-bold text-[var(--cmp-text-error)]">
            Part of this roster could not be read, and is missing rather than empty.
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-gray-800">
            {data.unavailable.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </div>
      )}

      {/* ── Cohorts (s2) — only the three that resolve to a PERSON ──────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Cohorts</span>
        {cohortLink(null, "Everyone")}
        {cohortLink("new", `New (joined in the last ${data.newWindowDays} days)`)}
        {cohortLink("invited", "Invited, not registered")}
        {cohortLink("suspended", "Suspended")}
        <span className="text-[11px] text-gray-500">
          Three of the ten cohorts PD-004 §14 prescribes. The other seven are listed at the foot of this
          page with the fact each one needs.
        </span>
      </div>

      {/* ── Search and filters (s2, s17) ─────────────────────────────────────────────────────────── */}
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="pd-q" className="block text-[11px] font-semibold text-gray-600">
            Search name, practitioner number or Practice
          </label>
          <input
            id="pd-q" name="q" defaultValue={q} type="search"
            placeholder="Name, practitioner number or Practice name"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-[13px]"
          />
        </div>
        <div>
          <label htmlFor="pd-lifecycle" className="block text-[11px] font-semibold text-gray-600">Lifecycle</label>
          <select id="pd-lifecycle" name="lifecycle" defaultValue={lifecycle ?? ""}
            className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-[13px]">
            <option value="">Any</option>
            {LIFECYCLES.map(l => <option key={l} value={l}>{LIFECYCLE_LABEL[l]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pd-market" className="block text-[11px] font-semibold text-gray-600">Market</label>
          <select id="pd-market" name="market" defaultValue={market ?? ""}
            className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-[13px]">
            <option value="">Any</option>
            {markets.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pd-practice" className="block text-[11px] font-semibold text-gray-600">Practice</label>
          <select id="pd-practice" name="practice" defaultValue={workspaceId ?? ""}
            className="mt-1 max-w-[16rem] rounded border border-gray-300 px-2 py-1.5 text-[13px]">
            <option value="">Any</option>
            {practices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        {cohort && <input type="hidden" name="cohort" value={cohort} />}
        <button type="submit"
          className="rounded bg-[var(--cmp-color-primary)] px-3 py-1.5 text-[13px] font-semibold text-white">
          Apply
        </button>
        <Link href="/super-admin/pd/practitioners"
          className="rounded border border-gray-300 px-3 py-1.5 text-[13px] font-semibold text-gray-700">
          Clear all
        </Link>
        <span className="text-[12px] text-gray-600">
          {activeFilters} filter{activeFilters === 1 ? "" : "s"} active ·{" "}
          <strong className="text-gray-900">{rows.length.toLocaleString()}</strong> of{" "}
          {data.total.toLocaleString()} shown
        </span>
      </form>

      {/* ── The estate table (s3) ─────────────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[62rem] border-collapse text-[13px]">
          <caption className="sr-only">
            Practitioner estate: name, Practice memberships, market, lifecycle, recent sign-in recency,
            join date and highest current exception.
          </caption>
          <thead>
            <tr className="border-b border-gray-200 bg-[var(--cmp-surface-neutral)] text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th scope="col" className="px-3 py-2 font-semibold">Practitioner</th>
              <th scope="col" className="px-3 py-2 font-semibold">Practice(s)</th>
              <th scope="col" className="px-3 py-2 font-semibold">Market</th>
              <th scope="col" className="px-3 py-2 font-semibold">Lifecycle</th>
              <th scope="col" className="px-3 py-2 font-semibold">Seen in last {data.seenWindowDays} days</th>
              <th scope="col" className="px-3 py-2 font-semibold">Joined</th>
              <th scope="col" className="px-3 py-2 font-semibold">Attention</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-[13px] text-gray-600">
                  {data.total === 0
                    ? "No Practice membership exists in this estate yet. This is a measured empty roster, not a failed read."
                    : "No practitioner matches these filters."}
                </td>
              </tr>
            )}
            {rows.map((r: PractitionerRow) => {
              const first = r.memberships[0];
              const extra = r.memberships.length - 1;
              return (
                <tr key={r.userId} className="border-b border-gray-100 align-top last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="flex items-start gap-2">
                      <PractitionerAvatar name={r.fullName} />
                      <span className="min-w-0">
                        <span className="block font-semibold text-gray-900">
                          {r.fullName ?? <span className="italic text-gray-500">Name not recorded on the profile</span>}
                        </span>
                        <span className="block font-mono text-[11px] text-gray-500">
                          {r.practitionerNumber
                            ?? (data.identitiesReadable
                              ? "no practitioner number issued"
                              : "practitioner numbers could not be read")}
                        </span>
                      </span>
                    </span>
                  </th>
                  <td className="px-3 py-2">
                    {first ? (
                      <>
                        <span className="block text-gray-900">{first.workspaceName ?? first.workspaceId}</span>
                        <span className="block text-[11px] text-gray-500">
                          {ROLE_LABEL[first.roleCode] ?? first.roleCode}
                          {", "}{MEMBERSHIP_LABEL[first.status] ?? first.status}
                          {r.ownedCount > 0 && first.isOwner ? " · owns this Practice" : ""}
                        </span>
                        {extra > 0 && (
                          <span className="block text-[11px] text-gray-500">
                            + {extra} further membership{extra === 1 ? "" : "s"}:{" "}
                            {r.memberships.slice(1).map(m => m.workspaceName ?? m.workspaceId).join(", ")}
                          </span>
                        )}
                      </>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-gray-800">
                    {r.markets.length ? r.markets.join(", ") : (
                      <span className="text-[11px] italic text-gray-500">no country on the Practice</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Pill tone={r.lifecycle === "SUSPENDED" ? "error" : r.lifecycle === "INVITED" ? "warning" : "neutral"}>
                      {LIFECYCLE_LABEL[r.lifecycle]}
                    </Pill>
                  </td>
                  <td className="px-3 py-2">
                    {r.seenInWindow === true && <Pill tone="success">Yes</Pill>}
                    {r.seenInWindow === false && <Pill tone="neutral">No</Pill>}
                    {r.seenInWindow === null && (
                      <span className="text-[11px] text-gray-500">
                        {data.sessionsReadable ? "no session ever recorded" : "session store unreadable"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-gray-700">
                    {day(r.joinedAt) ?? <span className="font-sans text-[11px] italic text-gray-500">not recorded</span>}
                  </td>
                  <td className="px-3 py-2">
                    {r.attention
                      ? <Pill tone={r.attention.severity === "high" ? "error" : "warning"}>{r.attention.label}</Pill>
                      : <span className="text-[11px] text-gray-500">none from membership state</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── What each column is read from (s18: every metric carries its definition) ──────────────── */}
      <details className="rounded-xl border border-gray-200 bg-white p-3">
        <summary className="cursor-pointer text-[12px] font-bold text-gray-900">
          Where each column comes from
        </summary>
        <dl className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-gray-700">
          <div><dt className="inline font-semibold">Practitioner. </dt>
            <dd className="inline">Name from <code>profiles.full_name</code>; identifier from{" "}
              <code>practice_practitioner_identity.practitioner_number</code> — permanent and never reused.
              Email is not read at all, per decision D1 of docs/PLAT-OVERSIGHT-SURVEY-001: a standing table
              of every practitioner&apos;s email is a directory of the platform&apos;s user base, and one
              is not needed to run the product.</dd></div>
          <div><dt className="inline font-semibold">Practice(s). </dt>
            <dd className="inline"><code>practice_membership</code>, folded so one person is one row.
              Ownership is <code>role_code = &apos;practice_owner&apos;</code> on an active membership,
              never inferred from being a member.</dd></div>
          <div><dt className="inline font-semibold">Market. </dt>
            <dd className="inline"><code>practice_workspace.country</code>, which is NOT NULL. There is no
              per-person market, so a person in two markets shows both.</dd></div>
          <div><dt className="inline font-semibold">Lifecycle. </dt>
            <dd className="inline"><code>practice_membership.status</code>. Registered means the
              entitlement is recognised — it is not PD-004 §4&apos;s <em>Active</em>, which requires a
              governed active-use threshold this estate cannot evaluate.</dd></div>
          <div><dt className="inline font-semibold">Seen in last {data.seenWindowDays} days. </dt>
            <dd className="inline"><code>practice_session.last_seen_at</code>, maintained per practitioner
              by the Practice shell guard. A snapshot as of this request and nothing more — see below.
              &ldquo;No session ever recorded&rdquo; means no device row exists for that person, which is
              a different statement from &ldquo;not seen&rdquo;.</dd></div>
          <div><dt className="inline font-semibold">Joined. </dt>
            <dd className="inline">Earliest <code>practice_membership.joined_at</code>, falling back to{" "}
              <code>created_at</code> where an invitation has not been accepted and so has no join date.</dd></div>
          <div><dt className="inline font-semibold">Attention. </dt>
            <dd className="inline">Membership state only: suspension, and an invitation that has not been
              completed. PD-004 §3 wants the highest exception across product, commercial, support,
              security and onboarding; four of those have no store on this plane and the fifth is a
              Practice milestone rather than a person&apos;s.</dd></div>
        </dl>
      </details>

      {/* ── THE NAMED ABSENCES (s9, s18: distinguish no activity from unavailable analytics) ──────── */}
      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
          Six columns PD-004 §3 prescribes are absent from this table. Each one is missing a fact, not a
          screen.
        </p>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          <Absent title="Activation">
            No activation state is shown, because no activation fact exists for a person.{" "}
            <code>practice_activation_event</code> carries a unique index on{" "}
            <code>(workspace_id, event_key)</code> — migration 283, lines 105–106 — so each of the ten
            milestones can be recorded once per Practice and never once per practitioner.{" "}
            <code>actor_id</code> is stamped only by whoever tripped the milestone first, because that
            index is what makes emission idempotent. On a managed Practice, rendering that ledger under a
            person&apos;s name would credit one colleague&apos;s first booking to everybody in the room.
            There is no per-practitioner activation percentage to compute, so none is computed and none
            is shown.
          </Absent>
          <Absent title="Adoption, engagement and product usage">
            Nothing is shown, because Competen Practice records no product telemetry. No page view,
            feature invocation, session start, error or abandonment event is written anywhere in this
            estate. The one genuine per-practitioner signal is <code>practice_session.last_seen_at</code>,
            and it is an UPDATE (src/lib/practice/security.ts:342) rather than an append — it can answer
            &ldquo;seen in the last {data.seenWindowDays} days, as of now&rdquo; and nothing else.
            Activity days, sessions per week, feature breadth, engagement scores, 7/30/90-day trends and
            retention curves are not thin here; they have no source. The codebase already refuses this by
            name at src/lib/practice/adoption-constants.ts:101.
          </Absent>
          <Absent title="Plan and Commercial">
            Not shown, and not because it is unbuilt. <code>practice_plans</code> has no price column and
            no currency column, and the only Practice-side commercial row,{" "}
            <code>practice_entitlement</code>, records no amount, no payer and no renewal date. A plan
            belongs to the Practice rather than the person in any case, so it belongs on Practice 360.
            Nothing on this plane can distinguish a paying practitioner from a provisioned one.
          </Absent>
          <Absent title="Support">
            Not shown. There is no support-case or incident store for Competen Practice at all — the
            platform&apos;s support tables key on <code>tenants</code>, a different product with a
            different tenancy column, and reusing them would attribute a Competency Platform ticket to a
            Practice user.
          </Absent>
          <Absent title="Profession and specialty">
            Not shown, on the safer of two readings. The platform-plane allowlist
            (src/lib/access/plane-boundary.ts) states &ldquo;no profile fields&rdquo; for{" "}
            <code>practice_practitioner_identity</code>; profession is the same class of field, is
            self-declared, and nothing in this product contacts a regulator. PD-004 §3 asks for the
            column and docs/PLAT-OVERSIGHT-SURVEY-001 does not permit it — the conflict is reported
            rather than resolved here.
          </Absent>
          <Absent title="Active / Dormant, as lifecycle states">
            PD-004 §4 defines Active as &ldquo;meets governed active-use criteria&rdquo; and Dormant as
            &ldquo;previously activated but below a recent-activity threshold&rdquo;. Both need activity
            history for a past window. <code>last_seen_at</code> is overwritten in place, so no past
            window can be evaluated for anybody. Four of the seven prescribed states are shown; three are
            not, rather than three being guessed.
          </Absent>
        </div>
      </div>

      {/* ── The §14 cohorts that have no person-level definition ──────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-[13px] font-bold text-gray-900">
          Seven of the ten cohorts in PD-004 §14 resolve to a Practice, not to a person
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
          They are named here rather than rendered, because filtering a list of people by their
          workspace&apos;s milestones would make Mission Control and this screen quote different numbers
          for the same word. On an estate of individual Practices the two entities coincide by accident;
          on a managed Practice they do not.
        </p>
        <dl className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-gray-700">
          {COHORTS_WITHOUT_A_PERSON_LEVEL_FACT.map(c => (
            <div key={c.cohort}>
              <dt className="inline font-semibold">{c.cohort}. </dt>
              <dd className="inline text-gray-600">{c.why}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ── The clinical boundary, stated on the surface that has to keep it ──────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-[var(--cmp-surface-neutral)] p-3">
        <p className="text-[12px] leading-relaxed text-gray-600">
          <strong className="text-gray-900">No patient data reaches this page.</strong> It reads no
          clinical table — not <code>practice_patient</code>, not <code>practice_encounter</code>, not{" "}
          <code>practice_appointment</code> — so there is no count to band and no drill-through to close.
          PD-004 §16 and §21: the Product Director may understand whether product workflows were used
          without seeing what those workflows produced, and this is not a tool for judging a
          clinician&apos;s work. Practitioner 360 is not built; when it is, its Practices &amp;
          Memberships, Access &amp; Security and Audit tabs have real producers and its Activation,
          Product Usage, Commercial and Support tabs do not.
        </p>
      </div>
    </div>
  );
}
