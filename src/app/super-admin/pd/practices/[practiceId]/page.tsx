import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPractice360, LIFECYCLE_MEANING, type Band, type AttentionItem } from "@/lib/hq/pd-practices";
import { practiceEntitlements } from "@/lib/hq/entitlement";
import PlanControl from "./PlanControl";

// CPR-PD-003 §6–§14 — PRACTICE 360.
//
// ⚠ THIS PAGE AWAITS ITS OWN GUARD, AND IT IS THE SAME CAPABILITY THE NAV TABLE DECLARES FOR THE MODULE.
// A detail route is a new destination: PD-001 s7's "direct URL access to an unauthorized item must fail
// safely" is about exactly this URL, which nothing in the sidebar links to and which anybody can type.
// `capabilityForPdHref` resolves /super-admin/pd/practices/<id> to the Practices entry by prefix, so the
// code below is the one the table already answers for this path — no nav entry is added for it.
//
// ⚠ NO CLINICAL CONTENT, BY CONSTRUCTION AND NOT BY CARE. PD-014 build 3 states it, PD-001 s7 states it,
// and `src/lib/access/plane-boundary.ts` enforces it: the loader behind this page may read four clinical
// tables to their tenancy column ONLY, and every count it takes is banded on the server before it enters
// the payload. There is no patient name, diagnosis, note, attachment or encounter content on this page,
// and there is no query that could produce one from here.
//
// ⚠ AND NO WAY IN. §16: "There is deliberately no generic 'Enter Practice' or silent impersonation
// action." Every link below points at another LANDLORD surface.

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "adoption", label: "Adoption & Usage" },
  { key: "practitioners", label: "Practitioners" },
  { key: "configuration", label: "Configuration" },
  { key: "commercial", label: "Commercial" },
  { key: "communications", label: "Communications" },
  { key: "support", label: "Support & Incidents" },
  { key: "security", label: "Security & Audit" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function BandValue({ band }: { band: Band }) {
  if (band === null) return <span className="text-[13px] italic text-[var(--cmp-text-warning)]">not readable</span>;
  return <span className="text-[15px] font-bold tabular-nums text-gray-900">{band}</span>;
}

function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return <p className="mt-1 text-[13px] text-gray-500">No exception is active on this Practice.</p>;
  }
  return (
    <ul className="mt-2 space-y-2">
      {items.map((a, i) => (
        <li key={i} className={`rounded-lg border p-2.5 ${
          a.severity === "critical"
            ? "border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)]"
            : "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)]"}`}>
          <p className={`text-[12px] font-bold ${a.severity === "critical" ? "text-[var(--cmp-text-critical)]" : "text-[var(--cmp-text-warning)]"}`}>
            {a.severity === "critical" ? "Critical" : "Warning"} · {a.label}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-gray-800">{a.detail}</p>
          {a.source && (
            <p className="mt-1 text-[12px]">
              <Link href={a.source.href} className="font-semibold underline">{a.source.label} →</Link>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A tab PD-003 prescribes that this plane cannot populate.
 *
 * ⚠ IT RENDERS NO FIGURE, NO CHART, NO SAMPLE ROW AND NO DASH. An em-dash in a metric slot is a claim
 * that something was measured and came back empty. §20 permits a prescribed tab to be "implemented or
 * explicitly capability-gated"; this is the explicit half, and it names the specific missing fact rather
 * than saying "coming soon".
 */
function AbsentTab({ title, spec, wouldShow, reason }: { title: string; spec: string; wouldShow: string; reason: React.ReactNode }) {
  return (
    <div className="max-w-3xl space-y-3">
      <div>
        <h2 className="text-[15px] font-bold text-gray-900">{title}</h2>
        <p className="mt-0.5 font-mono text-[11px] text-gray-500">{spec}</p>
      </div>
      <div className="rounded-xl border border-gray-200 bg-[var(--cmp-surface-neutral)] p-4">
        <p className="text-[13px] font-bold text-gray-900">This tab is not populated, and it is not empty.</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-700">It would show {wouldShow}</p>
        <p className="mt-2 text-[12px] font-semibold uppercase tracking-wide text-gray-500">Why</p>
        <div className="mt-1 text-[13px] leading-relaxed text-gray-800">{reason}</div>
      </div>
    </div>
  );
}

export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ practiceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireHqCapability("hq.practice.practices.view");
  const { practiceId } = await params;
  const sp = await searchParams;

  const asked = typeof sp.tab === "string" ? sp.tab : "overview";
  const tab = (TABS.some(t => t.key === asked) ? asked : "overview") as TabKey;

  // ⚠ THE RETURN CONTEXT IS A QUERY STRING, NOT A URL (§20: search/filter/sort survives drill-through
  // and return). Only the estate's own parameter characters are honoured, so this cannot be bent into
  // an off-site destination — the base path is a literal below and never comes from the request.
  const rawFrom = typeof sp.from === "string" ? sp.from : "";
  const from = /^[A-Za-z0-9=&_%.-]{0,200}$/.test(rawFrom) ? rawFrom : "";
  const backHref = from ? `/super-admin/pd/practices?${from}` : "/super-admin/pd/practices";

  const p = await loadPractice360(ctx.admin, practiceId);
  // ⚠ 404, NOT AN EMPTY 360. §19: a direct URL to a Practice outside scope "must fail safely before
  // protected data renders". The loader throws rather than returning null on a READ FAILURE, so this
  // branch means the workspace genuinely does not exist and never means "the database was slow".
  if (!p) notFound();

  // The plan window, read only for the tab that shows it -- CPR-PD commercial administration.
  const entitlement = tab === "commercial"
    ? await practiceEntitlements(ctx.admin, practiceId)
    : { state: "none" as const, periods: [] as [], current: null, hasAccess: false as const, expiringSoonDays: 0 };

  const tabHref = (key: TabKey) => {
    const qs = new URLSearchParams();
    if (key !== "overview") qs.set("tab", key);
    if (from) qs.set("from", from);
    const s = qs.toString();
    return `/super-admin/pd/practices/${practiceId}${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-4">
      {/* ── Identity (§7) ────────────────────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          <Link href={backHref} className="underline">Practices</Link> · Practice 360
        </p>
        <h1 className="mt-0.5 text-2xl font-bold text-gray-900">{p.workspace.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-gray-600">
          <span>
            <span className="text-gray-500">Owner </span>
            {p.ownerName ?? <span className="italic text-gray-500">name not readable</span>}
          </span>
          <span><span className="text-gray-500">Market </span><span className="font-mono">{p.workspace.country}</span></span>
          <span><span className="text-gray-500">Timezone </span><span className="font-mono">{p.workspace.timezone}</span></span>
          <span><span className="text-gray-500">Type </span>{p.workspace.type === "managed_practice" ? "Managed practice" : "Individual practice"}</span>
          <span><span className="text-gray-500">Created </span><span className="font-mono">{String(p.workspace.created_at).slice(0, 10)}</span></span>
        </div>
        <p className="mt-1 text-[12px] text-gray-600">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
            p.workspace.status === "ACTIVE" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
              : p.workspace.status === "ONBOARDING" ? "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]"
                : p.workspace.status === "FAILED" || p.workspace.status === "SUSPENDED" ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
                  : "bg-gray-100 text-gray-600"}`}>{p.workspace.status}</span>
          <span className="ml-2 text-gray-600">{LIFECYCLE_MEANING[p.workspace.status] ?? "Lifecycle state as recorded by Product Operations."}</span>
        </p>
        <p className="mt-1 font-mono text-[11px] text-gray-500">
          CPR-PD-003 §6 · read at {p.generatedAt.replace("T", " ").slice(0, 19)}Z
        </p>
      </div>

      {p.problems.length > 0 && (
        <div className="max-w-3xl rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
          <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">Some reads did not complete</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[12px] text-gray-800">
            {p.problems.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}

      {/* ── Tabs (§6). Fixed order, never reordered by alerts (§18). ─────────────────────────────── */}
      <nav aria-label="Practice 360 sections" className="flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <Link
            key={t.key} href={tabHref(t.key)}
            aria-current={t.key === tab ? "page" : undefined}
            className={`-mb-px rounded-t border-b-2 px-2.5 py-1.5 text-[12px] font-semibold ${
              t.key === tab
                ? "border-[var(--cmp-color-primary)] text-[var(--cmp-color-primary)]"
                : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {/* ── OVERVIEW (§7) ────────────────────────────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Key aggregates</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
              Counts only, and banded — 0 / 1-9 / 10-99 / 100+ — on the server, so the exact figure never
              reaches this page. That is decision D2 of 2026-08-08: an exact per-practice count is business
              intelligence about a named clinician&apos;s book, while a band answers whether the practice is alive.
              PD-003 §7 asks for counts; this is the narrower reading of the two, taken deliberately.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {p.aggregates.map(a => (
                <div key={a.key} className="rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{a.label}</p>
                  <p className="mt-0.5"><BandValue band={a.band} /></p>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{a.definition}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="max-w-3xl rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Needs attention</h2>
            <AttentionList items={p.attention} />
          </section>

          <section className="max-w-3xl rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Quick links</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Every one of these is another landlord surface. None of them enters this practitioner&apos;s workspace.
            </p>
            <ul className="mt-2 space-y-1 text-[13px]">
              <li><Link href="/super-admin/pd/operations/provisioning" className="underline">Provisioning &amp; Onboarding</Link> — the authoritative workflow for a failed or incomplete saga.</li>
              <li><Link href="/super-admin/pd/operations/workspaces" className="underline">Practice Workspaces</Link> — the operational estate view this register converges with.</li>
              <li><Link href="/super-admin/pd/practitioners" className="underline">Practitioners</Link> — PD-004, where a person rather than a practice is the subject.</li>
              <li><Link href="/super-admin/platform-ops/practice" className="underline">Technical Operations</Link> — launch flags, the gate ledger and saga diagnostics.</li>
            </ul>
          </section>

          <section className="max-w-3xl rounded-xl border border-gray-200 bg-[var(--cmp-surface-neutral)] p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Four parts of this Overview are absent, not empty</h2>
            <dl className="mt-2 space-y-2 text-[12px] leading-relaxed">
              <div>
                <dt className="font-bold text-gray-900">Activation milestones (§7)</dt>
                <dd className="text-gray-700">
                  The governed ladder is real and lives in <code className="font-mono">practice_activation_event</code>,
                  which is not on the platform plane&apos;s table allowlist. See the Adoption &amp; Usage tab.
                </dd>
              </div>
              <div>
                <dt className="font-bold text-gray-900">Plan and commercial state (§7 status strip)</dt>
                <dd className="text-gray-700">See the Commercial tab: there is no commercial plane for Competen Practice at all.</dd>
              </div>
              <div>
                <dt className="font-bold text-gray-900">Product health (§7 status strip)</dt>
                <dd className="text-gray-700">
                  No service-health producer exists for the Practice product — no SLO store, no uptime record,
                  and nothing in the Practice module emits to the platform event stream. Owned by PD-008, not built.
                </dd>
              </div>
              <div>
                <dt className="font-bold text-gray-900">Recent trend (§7)</dt>
                <dd className="text-gray-700">
                  A trend needs a timestamp. The four activity tables are allowlisted to their tenancy column
                  alone on this plane, so no booking or encounter time is readable here and there is nothing to
                  place on a period. Nothing anywhere writes a per-practice activity snapshot either, so this is
                  not merely unqueried.
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
              Practice number and handle are also absent from the identity block:{" "}
              <code className="font-mono">practice_practitioner_identity</code> is allowlisted to the identifier
              and its format version with no person or workspace key, so it cannot be joined to a practice from here.
            </p>
          </section>
        </div>
      )}

      {/* ── ADOPTION & USAGE (§8) ────────────────────────────────────────────────────────────────── */}
      {tab === "adoption" && (
        <AbsentTab
          title="Adoption & Usage" spec="CPR-PD-003 §8"
          wouldShow="feature adoption over an eligible-population denominator, the activation milestones and time-to-milestone, 7D/30D/90D usage against this Practice's own prior period, and anonymised cohort benchmarks."
          reason={<>
            <p>
              The substrate for the first half exists and is genuinely good — <code className="font-mono">practice_activation_event</code>{" "}
              carries a governed ten-milestone ladder with occurrence times, and{" "}
              <code className="font-mono">practice_capability_activation</code> gives a real eligibility denominator, so
              &quot;unavailable features must not count as non-adoption&quot; is satisfiable. Neither table is on the platform
              plane&apos;s allowlist (<code className="font-mono">src/lib/access/plane-boundary.ts</code>), so this surface
              cannot read them. Widening that allowlist is a governance decision with a named owner, not a loader edit.
            </p>
            <p className="mt-2">
              The second half is absent for a harder reason. There is no product-telemetry event stream anywhere in
              this database — no page view, feature invocation, session start, error or abandonment event — so
              period usage, engagement depth and cohort benchmarks have no producer at any plane. Counting encounters
              is not having usage data.
            </p>
          </>}
        />
      )}

      {/* ── PRACTITIONERS (§9) ───────────────────────────────────────────────────────────────────── */}
      {tab === "practitioners" && (
        <div className="max-w-3xl space-y-3">
          <div>
            <h2 className="text-[15px] font-bold text-gray-900">Practitioners</h2>
            <p className="mt-0.5 font-mono text-[11px] text-gray-500">CPR-PD-003 §9</p>
          </div>
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Membership rows</p>
            <p className="mt-0.5">
              <BandValue band={p.aggregates.find(a => a.key === "membership")?.band ?? null} />
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
              A band over rows of <code className="font-mono">practice_membership</code> for this workspace, of ANY
              status. It is not labelled &quot;active practitioners&quot; because it cannot be narrowed to them:{" "}
              <code className="font-mono">status</code> is not a column this plane may read.
            </p>
          </section>
          <section className="rounded-xl border border-gray-200 bg-[var(--cmp-surface-neutral)] p-4">
            <p className="text-[13px] font-bold text-gray-900">There is no roster on this page, and that is the allowlist speaking.</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-gray-700">
              §9 asks for a landlord-side roster with name, product role, entitlement and membership state. Those
              rows exist — <code className="font-mono">practice_membership</code> carries{" "}
              <code className="font-mono">user_id</code>, <code className="font-mono">role_code</code> and{" "}
              <code className="font-mono">status</code>, and <code className="font-mono">practice_role_assignment</code>{" "}
              carries the provenance of every capability a person holds. The platform plane may read exactly one
              column of that table, <code className="font-mono">workspace_id</code>, which is enough to count and
              not enough to list. So this tab counts.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-700">
              §9 also says practitioner detail &quot;should ultimately drill to the dedicated PD-004 Practitioner 360
              rather than duplicate it&quot;. That is the right destination and it is a different module:{" "}
              <Link href="/super-admin/pd/practitioners" className="font-semibold underline">Practitioners</Link>.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-700">
              §9&apos;s actions — entitlement change, suspension, support intervention — are not offered here. Each is a
              write into a practitioner&apos;s workspace and needs its own capability, reason capture and audit trail.
              None of those exists, so neither does the button.
            </p>
          </section>
        </div>
      )}

      {/* ── CONFIGURATION (§10) ──────────────────────────────────────────────────────────────────── */}
      {tab === "configuration" && (
        <AbsentTab
          title="Configuration" spec="CPR-PD-003 §10"
          wouldShow="the practice profile, its locations and clinics, booking configuration, communication channels, enabled capabilities and integration status — with tenant-controlled settings visibly distinguished from landlord-controlled ones."
          reason={<>
            <p>
              Every store this tab needs is off the platform plane&apos;s allowlist:{" "}
              <code className="font-mono">practice_configuration</code>, <code className="font-mono">practice_location</code>{" "}
              and <code className="font-mono">practice_capability_activation</code>. The last of those is the
              interesting one — it records whether a capability was turned on explicitly, by dependency or by a mode
              preset, which is precisely §10&apos;s tenant-controlled versus landlord-controlled distinction, available
              for free to a plane permitted to read it.
            </p>
            <p className="mt-2">
              What this page can already tell you about configuration is on the Overview tab: the workspace type,
              its market and its timezone. Those are columns of <code className="font-mono">practice_workspace</code>,
              which is allowlisted. Nothing else on this tab would be a measurement.
            </p>
          </>}
        />
      )}

      {/* ── COMMERCIAL (§11) ─────────────────────────────────────────────────────────────────────── */}
      {tab === "commercial" && (
        <div className="space-y-4">
          {/* ⚠ THE ONE COMMERCIAL FACT THAT DOES EXIST, and it is now readable AND writable here. This
              tab used to say the trial window was "on a table this plane may not read" -- true when
              written, and false from the moment the owner decided the Product Director determines how
              long a practice keeps access (migration 367, and the plane-boundary entry that goes with
              it). The refusal below is narrowed to what is still genuinely absent: revenue. */}
          <PlanControl
            workspaceId={practiceId}
            practiceName={p.workspace.name}
            reading={entitlement}
            mayManage={ctx.capabilities.includes("hq.practice.commercial.manage")}
          />

        <AbsentTab
          title="Revenue and billing" spec="CPR-PD-003 §11"
          wouldShow="subscription status, renewal and conversion state, product-commercial events and payment attention."
          reason={<>
            <p>
              <span className="font-bold">A Practice has no commercial plane. Not an empty one — none.</span>{" "}
              <code className="font-mono">plat_subscriptions</code>, <code className="font-mono">plat_billing_accounts</code>{" "}
              and <code className="font-mono">plat_invoices</code> all key on <code className="font-mono">tenants(id)</code>,
              and <code className="font-mono">practice_workspace</code> has no <code className="font-mono">tenant_id</code>{" "}
              column, so a Practice subscription is unrepresentable rather than unpopulated.{" "}
              <code className="font-mono">practice_plans</code> carries a code, a name, a trial length and an active
              flag — no price column and no currency column. UGX appears nowhere in this schema. There is no payment
              provider and nothing anywhere collects a card, so MRR, conversion, renewal and payment attention have
              no producer to be unqueried from.
            </p>
            <p className="mt-2">
              The plan window above is the one commercial fact that does exist. It used to be unreadable
              from here too, and this paragraph said so — until the owner decided the Product Director
              determines how long a practice keeps access. §11 says to &quot;hide unavailable capabilities
              cleanly rather than displaying false zeros&quot;, and what remains hidden is revenue, which
              genuinely has no producer.
            </p>
            <p className="mt-2">
              ⚠ The invoice and payment bands on the Overview tab are <span className="font-bold">not</span> this. Those
              count the practitioner billing her own patients. Reading them as Competen&apos;s revenue would be both a
              category error and a privacy breach, which is why they are banded and carry no amount and no currency.
            </p>
          </>}
        />
        </div>
      )}

      {/* ── COMMUNICATIONS (§12) ─────────────────────────────────────────────────────────────────── */}
      {tab === "communications" && (
        <AbsentTab
          title="Communications" spec="CPR-PD-003 §12"
          wouldShow="aggregate delivery and operational state per enabled channel, failure rates and configuration issues needed for product support — never message content."
          reason={<>
            <p>
              <code className="font-mono">practice_message</code> holds what this tab needs — a delivery status, a
              handover time, a confirmation time and a refusal reason per message — and it is not on the platform
              plane&apos;s allowlist, so this surface cannot read it.
            </p>
            <p className="mt-2">
              Two cautions belong with it whenever it is built, because both are ways to render a lie: the channel
              list is closed to six patient and OTP purposes, so there is no practitioner-directed channel to report
              on at all; and <code className="font-mono">delivery_confirmed_at</code> stays null forever on channels
              that return no receipts, so a landlord view must report &quot;no receipts available&quot; rather than reading
              null as a delivery failure. The in-practice engine already does exactly that and the landlord view must
              not do otherwise.
            </p>
          </>}
        />
      )}

      {/* ── SUPPORT & INCIDENTS (§13) ────────────────────────────────────────────────────────────── */}
      {tab === "support" && (
        <AbsentTab
          title="Support & Incidents" spec="CPR-PD-003 §13"
          wouldShow="open and recent support cases and incidents associated with this Practice, with severity, owner, status, age and resolution."
          reason={<>
            <p>
              This one is not the allowlist. <span className="font-bold">There is no Practice support-case table and
              no Practice incident store anywhere in this database.</span> The platform&apos;s own{" "}
              <code className="font-mono">plat_support_tickets</code> keys on <code className="font-mono">tenants</code>{" "}
              and belongs to the Competency platform&apos;s support workspace — a different product, a different audience
              and a different tenancy column. Pointing this tab at it would attribute another product&apos;s tickets to a
              named practitioner.
            </p>
            <p className="mt-2">
              Nothing can be shown here until PD-009 creates the store. Widening a permission would not help.
            </p>
          </>}
        />
      )}

      {/* ── SECURITY & AUDIT (§14) ───────────────────────────────────────────────────────────────── */}
      {tab === "security" && (
        <div className="max-w-4xl space-y-3">
          <div>
            <h2 className="text-[15px] font-bold text-gray-900">Security &amp; Audit</h2>
            <p className="mt-0.5 font-mono text-[11px] text-gray-500">CPR-PD-003 §14</p>
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="text-[13px] font-bold text-gray-900">Provisioning trail</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
              The administrative events this plane can evidence: who requested this workspace, for whom, of what
              type, what the saga did step by step and where it stopped. Actor and target are named — never emailed
              — under decision D1.
            </p>
            {p.provisioning.length === 0 ? (
              <p className="mt-2 text-[13px] text-gray-500">
                No provisioning request is recorded against this workspace. That is a real absence of rows, not a
                failed read — workspaces created before the saga spine, or by a path that did not record one, have none.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {p.provisioning.map(r => (
                  <li key={r.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        r.status === "COMPLETED" || r.status === "ACTIVE"
                          ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                          : r.status === "FAILED"
                            ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"
                            : "bg-gray-100 text-gray-600"}`}>{r.status}</span>
                      <span className="font-semibold text-gray-900">{r.requestType}</span>
                      <span className="text-gray-500">
                        requested by {r.actorName ?? <span className="italic text-gray-500">name not readable</span>}
                        {" "}for {r.targetName ?? <span className="italic text-gray-500">name not readable</span>}
                      </span>
                      <span className="font-mono text-gray-500">{String(r.createdAt).replace("T", " ").slice(0, 16)}</span>
                      {r.errorCode && <span className="font-mono text-[var(--cmp-text-critical)]">{r.errorCode}</span>}
                    </div>
                    {r.steps.length > 0 && (
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                              <th scope="col" className="py-1 pr-3">Step</th>
                              <th scope="col" className="py-1 pr-3">Status</th>
                              <th scope="col" className="py-1 pr-3">Started</th>
                              <th scope="col" className="py-1 pr-3">Completed</th>
                              <th scope="col" className="py-1">Error</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.steps.map(s => (
                              <tr key={s.step} className="border-t border-gray-100">
                                <td className="py-1 pr-3 font-mono text-gray-700">{s.step}</td>
                                <td className={`py-1 pr-3 font-semibold ${
                                  s.status === "succeeded" ? "text-[var(--cmp-text-success)]"
                                    : s.status === "failed" ? "text-[var(--cmp-text-critical)]" : "text-gray-500"}`}>{s.status}</td>
                                <td className="py-1 pr-3 font-mono text-gray-500">{s.startedAt ? String(s.startedAt).replace("T", " ").slice(0, 16) : ""}</td>
                                <td className="py-1 pr-3 font-mono text-gray-500">{s.completedAt ? String(s.completedAt).replace("T", " ").slice(0, 16) : ""}</td>
                                <td className="py-1 font-mono text-[var(--cmp-text-critical)]">{s.errorCode ?? ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="max-w-3xl rounded-xl border border-gray-200 bg-[var(--cmp-surface-neutral)] p-4">
            <h3 className="text-[13px] font-bold text-gray-900">The rest of §14 is deliberately not here</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-gray-700">
              §14 asks for entitlement changes, lifecycle changes and landlord configuration changes as well. Those
              are recorded — <code className="font-mono">practice_audit_event</code> has been append-only in the
              database since migration 247, and <code className="font-mono">practice_lifecycle_transition</code>{" "}
              records refused transitions as well as applied ones, with a mandatory reason. It is the best-provisioned
              audit substrate in the Practice product.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-700">
              <code className="font-mono">practice_audit_event</code> is refused to this plane{" "}
              <span className="font-bold">by name</span>, and that refusal is correct rather than incidental: its
              payloads carry a drug name beside a patient id, a procedure label with its laterality, consent types and
              clinician free text. A landlord surface that rendered that trail would be clinical-record access wearing
              an audit label, which §21 and the platform-oversight survey both forbid. Reaching it from a page like
              this one is designed to turn the boundary harness red.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-700">
              ⚠ One thing this page does not do, and it is worth knowing rather than assuming: opening this Practice 360
              writes no record into the practice&apos;s own audit trail. A practitioner asking &quot;has anyone at Competen
              looked at my practice?&quot; cannot be answered from any store in this repository today. That is an open
              decision (D6 of the platform-oversight survey), not an oversight of this build.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
