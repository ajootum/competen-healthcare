import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPracticeEstate, LIFECYCLE_STATES, LIFECYCLE_MEANING,
  type EstateSort, type Band,
} from "@/lib/hq/pd-practices";

// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT. PD-001 s7: "A hidden navigation item does not
// constitute authorization. Every destination must enforce server-side authorization", and "direct URL
// access to an unauthorized item must fail safely". Next's own authentication guide says a layout check
// is not sufficient because layouts do not re-render on navigation, so each page repeats it. The await
// completes before any JSX is returned: nothing renders ahead of the decision.
//
// ⚠ ONE SCOPE, STATED. There is no per-practice entitlement on this plane: a holder of
// hq.practice.practices.view sees the whole Practice estate. PD-003 s19's "outside entitlement scope"
// is therefore answered entirely by this capability, and the surface says so rather than implying a
// narrower scope it does not have.

export const dynamic = "force-dynamic";

const SORTS: { value: EstateSort; label: string }[] = [
  { value: "attention", label: "Attention first, then newest" },
  { value: "created_desc", label: "Created — newest first" },
  { value: "created_asc", label: "Created — oldest first" },
  { value: "name", label: "Practice name (A–Z)" },
  { value: "lifecycle", label: "Lifecycle state" },
];

/** A band renders as itself. `null` renders as the words, never as a dash and never as zero. */
/**
 * ⚠ A COLUMN THAT HAS NO PRODUCER, RENDERED IN ITS DESIGNED POSITION.
 *
 * The recorded doctrine is "refuse the claim, keep the layout" — an unavailable figure occupies the
 * cell §3 gives it, with the reason on hover, because a MISSING column reads as a defect while an
 * EMPTY one reads as a decision. This register previously dropped five columns and explained them in
 * prose underneath, which is how it stopped resembling its own specification.
 *
 * ⚠ AND EVERY REASON HERE IS A CURRENT ONE. Three of the five refusals this page carried were stale by
 * the time anybody looked: handle search, activity and health had all gained producers in the meantime
 * and nothing went back to check. A dark cell is a claim about today, and it decays.
 */
const DARK: Record<string, string> = {
  plan:
    "No producer. A Practice cannot be the subject of a subscription row at all — plat_subscriptions, "
    + "plat_billing_accounts and plat_invoices key on tenants(id) and practice_workspace has no "
    + "tenant_id, so a Practice plan is unrepresentable rather than unpopulated.",
  patients:
    "Refused by decision, not by absence. The count exists; oversight decision D2 of 2026-08-08 says an "
    + "exact per-practice patient count is business intelligence about a named clinician's book.",
  adoption:
    "The governed activation ladder is real and lives in practice_activation_event, which is not on "
    + "this plane's allowlist. ⚠ The one absence on this row a governance decision could remove without "
    + "a migration.",
  health:
    "No per-practice health objective is declared. Product Health computes product-level domains, and "
    + "§4 is explicit that missing evidence must never resolve to Healthy — so this stays unknown rather "
    + "than green until an objective exists to judge the evidence against.",
};

function DarkCell({ reason }: { reason: keyof typeof DARK | string }) {
  return (
    <span
      className="cursor-help text-[10.5px] italic text-gray-300 underline decoration-dotted underline-offset-2"
      title={DARK[reason] ?? "No producer."}
    >
      no producer
    </span>
  );
}

function BandCell({ band }: { band: Band }) {
  if (band === null) return <span className="text-[11px] italic text-[var(--cmp-text-warning)]">not readable</span>;
  return <span className="tabular-nums text-gray-700">{band}</span>;
}

function LifecycleBadge({ status }: { status: string }) {
  const tone =
    status === "ACTIVE" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
      : status === "ONBOARDING" ? "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]"
        : status === "FAILED" || status === "SUSPENDED" ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
          : "bg-gray-100 text-gray-600";
  // Never colour alone (s18): the state's own word is the label, and the badge only tints it.
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${tone}`} title={LIFECYCLE_MEANING[status] ?? status}>{status}</span>;
}

export default async function Page(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const ctx = await requireHqCapability("hq.practice.practices.view");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const q = str("q");
  const market = str("market");
  const lifecycle = str("lifecycle");
  const attentionOnly = str("attention") === "1";
  const sort = (SORTS.some(s => s.value === str("sort")) ? str("sort") : "attention") as EstateSort;
  const page = Math.max(1, Number.parseInt(str("page") || "1", 10) || 1);

  const estate = await loadPracticeEstate(ctx.admin, { q, market, lifecycle, attentionOnly, sort, page });

  const activeFilters = [q, market, lifecycle, attentionOnly ? "1" : ""].filter(Boolean).length;
  const keep = (over: Record<string, string>) => {
    const params = new URLSearchParams();
    const base: Record<string, string> = { q, market, lifecycle, attention: attentionOnly ? "1" : "", sort, page: String(page) };
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/super-admin/pd/practices?${s}` : "/super-admin/pd/practices";
  };

  const lastPage = estate.matchTotal === null ? page : Math.max(1, Math.ceil(estate.matchTotal / estate.pageSize));

  // ⚠ THE RETURN CONTEXT TRAVELS WITH THE DRILL-THROUGH (§20: "Search/filter/sort state behaves
  // consistently and survives drill-through/return"). It is carried as a query STRING rather than a URL,
  // and Practice 360 rebuilds the destination from its own literal base path — so this cannot be bent
  // into an off-site back link.
  const returnContext = (() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (market) params.set("market", market);
    if (lifecycle) params.set("lifecycle", lifecycle);
    if (attentionOnly) params.set("attention", "1");
    if (sort !== "attention") params.set("sort", sort);
    if (page > 1) params.set("page", String(page));
    return params.toString();
  })();
  const practiceHref = (id: string) =>
    `/super-admin/pd/practices/${id}${returnContext ? `?from=${encodeURIComponent(returnContext)}` : ""}`;

  return (
    <div className="space-y-4">
      {/* ── Header (s2): title, scope, total, freshness ─────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Practice Product Director</p>
        <h1 className="mt-0.5 text-2xl font-bold text-gray-900">Practices</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          The authoritative landlord-side register of every Competen Practice workspace, and the way into
          Practice 360. It is not an EMR, not a patient search and not a door into anybody&apos;s tenant.
        </p>
        <p className="mt-1.5 text-[12px] text-gray-600">
          {estate.estateTotal === null
            ? <span className="text-[var(--cmp-text-warning)]">The estate count could not be read, so no total is shown. This is not zero.</span>
            : <>
              <span className="font-semibold text-gray-900">{estate.estateTotal.toLocaleString()}</span>
              {" "}practice{estate.estateTotal === 1 ? "" : "s"} in the estate
              {activeFilters > 0 && estate.matchTotal !== null && <> · <span className="font-semibold text-gray-900">{estate.matchTotal.toLocaleString()}</span> match the current filters</>}
              {estate.attentionTotal !== null && estate.attentionTotal > 0 && <> · <span className="font-semibold text-[var(--cmp-text-critical)]">{estate.attentionTotal.toLocaleString()}</span> in an exception state</>}
            </>}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-gray-400">
          CPR-PD-003 §2–§4 · read at {estate.generatedAt.replace("T", " ").slice(0, 19)}Z
        </p>
      </div>

      {/* ⚠ EVERY READ THAT DID NOT COMPLETE, NAMED. s17: "never convert unavailable, stale or failed
          data to zero." A figure that could not be read is stated here and rendered as unknown above. */}
      {estate.problems.length > 0 && (
        <div className="max-w-3xl rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
          <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">Some reads did not complete</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-gray-800">
            {estate.problems.map((p, i) => <li key={i} className="font-mono">{p}</li>)}
          </ul>
        </div>
      )}

      {/* ── Attention, estate-wide (s2): visible without opening every practice ───────────────────── */}
      {estate.failedProvisioning && estate.failedProvisioning.total > 0 && (
        <div className="max-w-3xl rounded-xl border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] p-3">
          <p className="text-[12px] font-bold text-[var(--cmp-text-critical)]">
            {estate.failedProvisioning.total} provisioning request{estate.failedProvisioning.total === 1 ? " is" : "s are"} in FAILED
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-800">
            {estate.failedProvisioning.withWorkspace} attach to a workspace and are flagged on its row below.
            {estate.failedProvisioning.orphaned > 0 && <> {estate.failedProvisioning.orphaned} failed before a workspace row existed, so {estate.failedProvisioning.orphaned === 1 ? "it has" : "they have"} no practice to appear against — {estate.failedProvisioning.orphaned === 1 ? "it is" : "they are"} counted here and nowhere else on this page.</>}
            {" "}The saga is resumable from{" "}
            <Link href="/super-admin/pd/operations/provisioning" className="font-semibold underline">Provisioning &amp; Onboarding</Link>.
          </p>
        </div>
      )}

      {/* ── Search, filters and sort (s2, s4) ────────────────────────────────────────────────────── */}
      <form method="get" action="/super-admin/pd/practices" className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Practice name</span>
            <input
              type="search" name="q" defaultValue={q} placeholder="Search by name"
              className="w-56 rounded border border-gray-300 px-2 py-1 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Market</span>
            <select name="market" defaultValue={market} className="rounded border border-gray-300 px-2 py-1 text-[13px]">
              <option value="">All markets</option>
              {estate.markets.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Lifecycle</span>
            <select name="lifecycle" defaultValue={lifecycle} className="rounded border border-gray-300 px-2 py-1 text-[13px]">
              <option value="">All lifecycle states</option>
              {LIFECYCLE_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Sort</span>
            <select name="sort" defaultValue={sort} className="rounded border border-gray-300 px-2 py-1 text-[13px]">
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 pb-1.5 text-[13px] text-gray-700">
            <input type="checkbox" name="attention" value="1" defaultChecked={attentionOnly} className="h-3.5 w-3.5" />
            Exception state only
          </label>
          <button type="submit" className="rounded bg-[var(--cmp-color-primary)] px-3 py-1.5 text-[13px] font-semibold text-white">
            Apply
          </button>
          {activeFilters > 0 && (
            <Link href="/super-admin/pd/practices" className="pb-1.5 text-[13px] font-semibold text-gray-600 underline">
              Clear all ({activeFilters})
            </Link>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          Search and filtering are server-side and run one query per submission rather than one per
          keystroke. Owner search is deliberately not duplicated here — it lives on the reasoned lookup at{" "}
          <code className="font-mono">/api/v1/practice/operations/users</code>, which answers one query at a
          time and refuses anything under two characters, because a lookup that answers the empty string is
          a directory dump wearing a search box.
          {estate.marketsTruncated && " ⚠ The market list was built from the first 1,000 workspaces and may be incomplete."}
        </p>
      </form>

      {/* ── The estate table (s3) ────────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Practice estate</h2>
        {estate.rows.length === 0 ? (
          // ⚠ s4: "Empty results must distinguish 'no practices exist' from 'no practices match these
          // filters'." Those are different facts and they need different sentences.
          <p className="mt-2 text-[13px] text-gray-500">
            {estate.estateTotal === null
              ? "No rows came back, and the estate count could not be read either — so this page cannot tell you whether the estate is empty or whether the read failed. It is not asserting that there are no practices."
              : estate.estateTotal === 0
                ? "No Practice workspace has been provisioned yet. Provisioning happens under Product Operations; a successful one appears here on its own."
                : activeFilters > 0
                  ? "No practice matches these filters. The estate is not empty — clear the filters to see it."
                  : `The estate holds ${estate.estateTotal.toLocaleString()} practice(s), but this page of it is empty. Go back to page 1.`}
          </p>
        ) : (
          <>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[12px]">
                <caption className="sr-only">Practice workspaces, {estate.rows.length} shown on this page</caption>
                <thead>
                  {/* ⚠ ALL TWELVE OF §3'S COLUMNS, IN THE COMP'S ORDER — including the ones with no
                      producer. The recorded doctrine is "refuse the claim, KEEP THE LAYOUT": an
                      unavailable figure renders in its designed position with a reason, because a
                      missing column reads as a defect while an empty one reads as a decision. This
                      table previously dropped five columns entirely and explained them in prose below,
                      which is the opposite of that rule and is why the screen stopped resembling its
                      own specification.
                      ⚠ AND EACH DARK CELL LIGHTS UP BY ITSELF. The cell asks its producer; when one
                      arrives it renders. Nothing here has to be switched on, and — the half that
                      actually bites — nobody has to remember to delete a refusal that has come true.
                      Three of these were already stale when this was rewritten. */}
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                    <th scope="col" className="py-1 pr-3">Practice</th>
                    <th scope="col" className="py-1 pr-3">Owner / handle</th>
                    <th scope="col" className="py-1 pr-3">Market</th>
                    <th scope="col" className="py-1 pr-3">Lifecycle</th>
                    <th scope="col" className="py-1 pr-3">Plan</th>
                    <th scope="col" className="py-1 pr-3 text-right">Practitioners</th>
                    <th scope="col" className="py-1 pr-3 text-right">Activity (30d)</th>
                    <th scope="col" className="py-1 pr-3 text-right">Patients</th>
                    <th scope="col" className="py-1 pr-3 text-right">Adoption</th>
                    <th scope="col" className="py-1 pr-3">Health</th>
                    <th scope="col" className="py-1 pr-3">Attention</th>
                    <th scope="col" className="py-1">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {estate.rows.map(r => (
                    <tr key={r.id} className="border-t border-gray-100 align-top">
                      <td className="py-1.5 pr-3">
                        <Link href={practiceHref(r.id)} className="font-semibold text-gray-900 underline">
                          {r.name}
                        </Link>
                        <span className="ml-1.5 text-[10px] text-gray-400">
                          {r.type === "managed_practice" ? "managed" : "individual"}
                        </span>
                      </td>
                      {/* ⚠ D1: the owner's NAME. Their email is not in this payload to fall back to. */}
                      <td className="py-1.5 pr-3 text-gray-600">
                        {r.ownerName ?? <span className="italic text-gray-400">name not readable</span>}
                        {r.handle && (
                          <span className="ml-1.5 font-mono text-[10.5px] text-gray-400">@{r.handle}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-gray-600">{r.country}</td>
                      <td className="py-1.5 pr-3"><LifecycleBadge status={r.status} /></td>

                      {/* PLAN — no producer. A Practice cannot be the subject of a subscription row. */}
                      <td className="py-1.5 pr-3"><DarkCell reason="plan" /></td>

                      <td className="py-1.5 pr-3 text-right"><BandCell band={r.membershipBand} /></td>

                      {/* ACTIVITY — read from the §4 projection, never scanned here. */}
                      <td className="py-1.5 pr-3 text-right">
                        {r.activity === null ? (
                          <span
                            className="cursor-help text-[10.5px] italic text-gray-300 underline decoration-dotted underline-offset-2"
                            title="Not Measured. No activity projection exists for this practice — which is different from the practice having done nothing, and different again from the projection being unreadable."
                          >
                            not measured
                          </span>
                        ) : (
                          <span
                            className="cursor-help tabular-nums text-gray-900"
                            title={`Observed ${new Date(r.activity.observedAt).toISOString().slice(0, 16).replace("T", " ")} GMT${
                              r.activity.classification ? ` · ${r.activity.classification}` : " · no published classification definition"}`}
                          >
                            {r.activity.lastAt
                              ? new Date(r.activity.lastAt).toISOString().slice(0, 10)
                              : <span className="text-gray-300">none</span>}
                            {r.activity.windowCount !== null && (
                              <span className="ml-1 text-[10.5px] text-gray-500">{r.activity.windowCount}</span>
                            )}
                          </span>
                        )}
                      </td>

                      {/* PATIENTS — refused by decision, not by absence. */}
                      <td className="py-1.5 pr-3 text-right"><DarkCell reason="patients" /></td>

                      {/* ADOPTION — the one absence a governance decision could remove today. */}
                      <td className="py-1.5 pr-3 text-right"><DarkCell reason="adoption" /></td>

                      {/* HEALTH — read from PD-008's projection. §6: never labelled here. */}
                      <td className="py-1.5 pr-3">
                        {r.health === null || r.health.state === "unknown" ? (
                          <span
                            className="cursor-help text-[10.5px] italic text-gray-300 underline decoration-dotted underline-offset-2"
                            title={r.health === null
                              ? "Not Measured. PD-008 has projected no health state for this practice. §6: PD-003 consumes a health projection and never computes one, so there is nothing here to fall back on."
                              : `Unknown. ${r.health.reason ?? "No evidence-based reason recorded."}`}
                          >
                            {r.health === null ? "not measured" : "unknown"}
                          </span>
                        ) : (
                          <span
                            className={`cursor-help rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              r.health.state === "healthy"
                                ? "bg-teal-50 text-teal-800"
                                : "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}
                            title={`${r.health.reason ?? ""} · observed ${new Date(r.health.observedAt).toISOString().slice(0, 16).replace("T", " ")} GMT`}
                          >
                            {r.health.state.replace(/_/g, " ")}
                          </span>
                        )}
                      </td>

                      <td className="py-1.5 pr-3">
                        {r.attention.length === 0
                          ? <span className="text-gray-300">none</span>
                          : r.attention.map((a, i) => (
                            <span key={i} className={`mr-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              a.severity === "critical"
                                ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
                                : "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>{a.label}</span>
                          ))}
                      </td>
                      <td className="py-1.5 font-mono text-gray-400">{String(r.created_at).slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination (s4): preserves every filter and the sort. */}
            <div className="mt-3 flex items-center gap-3 text-[12px] text-gray-600">
              {page > 1
                ? <Link href={keep({ page: String(page - 1) })} className="font-semibold underline">← Previous</Link>
                : <span className="text-gray-300">← Previous</span>}
              <span>Page {page}{estate.matchTotal !== null && ` of ${lastPage}`}</span>
              {page < lastPage
                ? <Link href={keep({ page: String(page + 1) })} className="font-semibold underline">Next →</Link>
                : <span className="text-gray-300">Next →</span>}
            </div>
          </>
        )}

        <p className="mt-3 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-500">
          <span className="font-semibold text-gray-700">Membership</span> is a band — 0 / 1-9 / 10-99 / 100+ —
          over rows of <code className="font-mono">practice_membership</code> for the workspace, of ANY status,
          because <code className="font-mono">status</code> is not a column this plane may read. It is banded
          on the server, so the exact figure is never sent to this page at all. PD-003 §3 asks for a
          practitioner count; the recorded platform-oversight decision D2 of 2026-08-08 says an exact
          per-practice count is business intelligence about a named clinician&apos;s book. This surface takes D2,
          the narrower of the two.{" "}
          <span className="font-semibold text-gray-700">Default sort</span> is the FAILED and SUSPENDED
          practices first, then everything else newest-first — §4 asks for attention first and then &quot;recent
          meaningful activity&quot;, and the second half has no producer here (see below).
        </p>
      </section>

      {/* ── What this estate does NOT show, and why (s17: every metric has a documented source) ──── */}
      <section className="max-w-3xl rounded-xl border border-gray-200 bg-[var(--cmp-surface-neutral)] p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Five prescribed columns are absent, not empty</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
          PD-003 §3 prescribes twelve estate columns. Seven are above. These five are not rendered as blanks
          or zeros, because a blank column reads as a defect and a zero reads as a measurement.
        </p>
        <dl className="mt-2 space-y-2 text-[12px] leading-relaxed">
          <div>
            <dt className="font-bold text-gray-900">Plan and Commercial</dt>
            <dd className="text-gray-700">
              A Practice has no commercial plane at all. <code className="font-mono">plat_subscriptions</code>,{" "}
              <code className="font-mono">plat_billing_accounts</code> and <code className="font-mono">plat_invoices</code>{" "}
              all key on <code className="font-mono">tenants(id)</code>, and <code className="font-mono">practice_workspace</code>{" "}
              has no <code className="font-mono">tenant_id</code> — so a Practice subscription is unrepresentable,
              not merely unpopulated. <code className="font-mono">practice_plans</code> carries no price and no
              currency column; UGX appears nowhere in this schema. Separately,{" "}
              <code className="font-mono">practice_entitlement</code> — which holds the plan code and the trial
              window — is not on this plane&apos;s table allowlist, so even the trial dates cannot be read from here.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-gray-900">Activity</dt>
            <dd className="text-gray-700">
              <code className="font-mono">practice_appointment</code> and <code className="font-mono">practice_encounter</code>{" "}
              are allowlisted to the tenancy column alone, so no booking or encounter timestamp is readable from
              this plane. A &quot;recent activity&quot; classification would have to be invented rather than measured.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-gray-900">Adoption</dt>
            <dd className="text-gray-700">
              The governed activation ladder is real and lives in <code className="font-mono">practice_activation_event</code>,
              which is not on this plane&apos;s allowlist. This is the one absence here that a governance decision
              could remove without a migration.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-gray-900">Health</dt>
            <dd className="text-gray-700">
              No service-health producer exists for the Practice product anywhere in this database — no SLO
              store, no uptime record, and nothing in the Practice module emits to the platform event stream.
              It is owned by PD-008 and is not built.
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
          §2 also asks for search by Practice number or handle. <code className="font-mono">practice_practitioner_identity</code>{" "}
          is allowlisted to the identifier and its format version with no person or workspace key, so it cannot
          be joined to a practice from here and is not offered as a search field.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
          §16: there is deliberately no &quot;Enter Practice&quot; action anywhere on this surface. Support access into a
          practitioner&apos;s tenant is a separately specified workflow with purpose, reason, time boundary, a visible
          banner and an audit trail; none of that exists, so neither does the button.
        </p>
      </section>
    </div>
  );
}
