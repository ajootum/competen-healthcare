import Link from "next/link";
import type { IntelligenceSuite } from "@/lib/practice/intelligence";
import type { PiV2Extras } from "@/lib/practice/pi-v2";
import { metricById } from "@/lib/practice/intelligence-registry";
import { weekdayPattern } from "@/lib/practice/intelligence-constants";

// CPR-PI-001 v2 P0 -- the five rebuilt screen contracts (s6-s10), composed from the EXISTING modules
// plus pi-v2's three extras. No figure here is computed in this file: presentation only, so a screen
// can never disagree with the engine that owns its number.
//
// THE PERCENTAGE RULE, APPLIED: a proportion renders as a percentage ONLY beside its own counts
// ("72 of 96 · 75%"), only where a registry entry governs it, and never as a judgement. Every
// percentage in this file is derived inline from a numerator and denominator that print WITH it --
// there is no % without its fraction in the same breath (v2 s19).
//
// DRILL-THROUGH (s17): intelligence informs, operational workspaces act. Every actionable row is a
// LINK into the workspace that owns the work, carrying its filter.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Suite = IntelligenceSuite;
const CARD = "rounded-xl border border-gray-200 bg-white p-4";

/** "72 of 96 (75%)" -- the only way a percentage is ever born on these screens. */
function ofPct(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null) return "not available";
  if (denominator === 0) return `${numerator} of 0`;
  return `${numerator} of ${denominator} (${Math.round((numerator / denominator) * 100)}%)`;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-[10px] text-gray-500">{sub}</p>}
    </div>
  );
}

function TrustFooter({ ids }: { ids: string[] }) {
  // s6's trust footer, on every rebuilt screen: where the numbers come from and which definitions
  // they answer to. The registry names render so a reader can ask for any definition by name.
  return (
    <p className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 text-[11px] text-gray-500">
      <strong className="text-gray-600">All insights are derived from this practice&apos;s own records.</strong>{" "}
      Definitions: {ids.map(id => metricById(id)?.displayName ?? id).join(", ")}. Every percentage on
      this screen prints beside its own counts; a figure that could not be read says so rather than
      rendering as zero.
    </p>
  );
}

function Unavailable({ module: m }: { module: any }) {
  return <p className="text-[12px] text-gray-600">{m.unavailableReason ?? "This module could not be read. That is not a zero."}</p>;
}

function metricValue(m: any): string {
  return m?.value === null || m?.value === undefined ? "—" : String(m.value);
}

// weekdayPattern moved to intelligence-constants.ts: the report engine renders the same weekday
// grouping, and two copies of that loop is how two surfaces disagree about what a Tuesday is.

function MiniTrend({ buckets }: { buckets: { day: string; total: number }[] }) {
  const max = Math.max(1, ...buckets.map(b => b.total));
  return (
    <div className="flex h-16 items-end gap-[2px]" role="img"
      aria-label={`Consultations per day, peak ${max}`}>
      {buckets.map(b => (
        <div key={b.day} title={`${b.day}: ${b.total}`}
          className="min-w-[3px] flex-1 rounded-t bg-[var(--cp-primary)]/60"
          style={{ height: `${Math.max(3, Math.round((b.total / max) * 100))}%` }} />
      ))}
    </div>
  );
}

// ══ 1. OVERVIEW (v2 s6) ═════════════════════════════════════════════════════════════════════════════

export function OverviewV2Area({ suite, extras }: { suite: Suite; extras: PiV2Extras }) {
  const mods = suite.workspace.modules;
  const o = mods.overview;
  const f = mods.followUps;
  // OverviewData.metrics is the PracticeMetrics WRAPPER; the twelve live under .metrics by key.
  const metrics: any = o.available ? (o.data as any).metrics?.metrics : null;
  const patientsMod = mods.patients;
  const newTo: any = patientsMod.available ? (patientsMod.data as any).newToPractice : null;
  const completion: any = f.available ? (f.data as any).completion : null;
  const overdue: any = f.available ? (f.data as any).overdue : null;

  // s6's care gaps, each a DOOR (s17), never an action here. Only gaps the record can prove.
  const gaps: { label: string; count: number | null; href: string }[] = [
    { label: "Overdue clinical follow-ups", count: overdue?.value ?? null, href: "/practice/follow-ups?filter=overdue" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <section className={CARD}>
        {!o.available ? <Unavailable module={o} /> : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Patients seen" value={metricValue(metrics.patients_seen)} />
            <Kpi label="Consultations" value={metricValue(metrics.completed)} />
            <Kpi label="Returning patients"
              value={newTo && newTo.numerator !== null && newTo.denominator !== null
                ? ofPct(newTo.denominator - newTo.numerator, newTo.denominator) : "—"}
              sub="of patients seen; the rest are new to the practice" />
            <Kpi label="Follow-ups completed"
              value={completion ? ofPct(completion.numerator, completion.denominator) : "—"}
              sub="of those raised this period" />
            <Kpi label="Follow-ups due" value={metricValue(metrics.follow_ups_due)} />
            <Kpi label="Visits per patient"
              value={extras.available && extras.data && extras.data.avgVisitsPerPatient.patients > 0
                ? (extras.data.avgVisitsPerPatient.encounters / extras.data.avgVisitsPerPatient.patients).toFixed(1)
                : "—"}
              sub={extras.available && extras.data
                ? `${extras.data.avgVisitsPerPatient.encounters} visits, ${extras.data.avgVisitsPerPatient.patients} patients`
                : undefined} />
          </div>
        )}
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-bold text-gray-900">Top conditions</h3>
            <Link href={tabLink("clinical")} className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">View all &rarr;</Link>
          </div>
          <ConditionsList suite={suite} limit={5} />
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Practice changes</h3>
          <p className="mt-0.5 text-[10px] text-gray-500">vs the immediately preceding equal period; a comparison that was not earned says why.</p>
          {!o.available ? <Unavailable module={o} /> : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {((o.data as any).comparisons as any[]).slice(0, 6).map(c => (
                <li key={c.key} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-700">{c.label}</span>
                  <span className="ml-auto font-semibold text-gray-900">
                    {c.current ?? "—"}{c.prior !== null && <span className="font-normal text-gray-500"> vs {c.prior}</span>}
                  </span>
                  {c.status !== "ok" && c.reason && <span className="text-[10px] text-gray-400">{c.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Follow-up status</h3>
          {!f.available ? <Unavailable module={f} /> : (
            <div className="mt-1 text-[12px] text-gray-700">
              {/* pi.followup_completion: the governed denominator IS the raised-in-period cohort, and
                  the not-yet-due share prints beside the figure instead of quietly shrinking it. */}
              <p>Completed {ofPct(completion?.numerator ?? null, completion?.denominator ?? null)}</p>
              {completion?.caveat && <p className="mt-0.5 text-[11px] text-gray-500">{completion.caveat}</p>}
              <p className="mt-1">
                <Link href="/practice/follow-ups" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  Act on follow-ups &rarr;
                </Link>
              </p>
            </div>
          )}
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Care gaps detected from your records</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {gaps.map(g => (
              <li key={g.label}>
                <Link href={g.href} className="flex items-baseline gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12px] hover:bg-gray-50">
                  <span className="text-gray-800">{g.label}</span>
                  <span className="ml-auto font-bold text-gray-900">{g.count ?? "could not be read"}</span>
                  <span aria-hidden="true" className="text-gray-400">&rarr;</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-gray-500">
            A gap here is a record without a successor, never a claim that care did not happen.
          </p>
        </section>
      </div>

      <TrendSection suite={suite} />
      <TrustFooter ids={["pi.followup_completion", "pi.avg_visits_per_patient", "pi.top_conditions_by_patients"]} />
    </div>
  );
}

const tabLink = (key: string) => `/practice/intelligence?tab=${key}`;

function ConditionsList({ suite, limit }: { suite: Suite; limit: number }) {
  const p = suite.workspace.modules.patients;
  const o = suite.workspace.modules.overview;
  if (!p.available) return <Unavailable module={p} />;
  const diagnoses: any = (p.data as any).diagnoses;
  const rows: any[] = (diagnoses?.rows ?? []) as any[];
  if (rows.length === 0) return <p className="mt-1 text-[12px] text-gray-500">No diagnoses recorded in this period. The read succeeded.</p>;
  // pi.top_conditions_by_patients: the ELIGIBLE set is patients seen -- summing per-condition patient
  // counts would double-count everyone with two conditions, which is most of general practice.
  const eligible: number | null = o.available ? ((o.data as any).metrics?.metrics?.patients_seen?.value ?? null) : null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {rows.slice(0, limit).map((r, i) => (
        <li key={i} className="flex items-baseline gap-2 text-[12px]">
          <span className="text-gray-800">{r.label}</span>
          <span className="ml-auto text-[11px] text-gray-500">
            {eligible ? ofPct(r.patients, eligible) : `${r.patients} patient${r.patients === 1 ? "" : "s"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TrendSection({ suite }: { suite: Suite }) {
  const c = suite.workspace.modules.clinicalActivity;
  if (!c.available) return <section className={CARD}><Unavailable module={c} /></section>;
  const trend: any = (c.data as any).trend;
  return (
    <section className={CARD}>
      <h3 className="text-[13px] font-bold text-gray-900">Consultations over time</h3>
      <div className="mt-2"><MiniTrend buckets={trend.buckets ?? []} /></div>
      <p className="mt-1 text-[11px] text-gray-600">
        {trend.total} this period, {trend.priorTotal} in the period before
        {trend.busiestDay && trend.busiestDay.total > 0 ? ` · busiest ${trend.busiestDay.day} with ${trend.busiestDay.total}` : ""}
      </p>
    </section>
  );
}

// ══ 2. PATIENT INTELLIGENCE (v2 s7) ═════════════════════════════════════════════════════════════════

export function PatientV2Area({ suite, extras }: { suite: Suite; extras: PiV2Extras }) {
  const p = suite.workspace.modules.patients;
  if (!p.available) return <section className={CARD}><Unavailable module={p} /></section>;
  const d: any = p.data;
  const rec = extras.available && extras.data ? extras.data.recency : null;

  const dist = (dist: any, title: string) => (
    <section className={CARD}>
      <h3 className="text-[13px] font-bold text-gray-900">{title}</h3>
      {dist.status !== "ok" && dist.reason ? (
        <p className="mt-1 text-[12px] text-gray-600">{dist.reason}</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5">
          {(dist.slices as any[]).map((s: any) => (
            <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
              <span className="text-gray-800">{s.label}</span>
              {/* Distribution slices carry the module's own `of` denominator -- v2 s19 satisfied by shape. */}
              <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, dist.of)}</span>
            </li>
          ))}
          {dist.unrecorded > 0 && (
            <li className="flex items-baseline gap-2 text-[12px] text-gray-500">
              <span>Unknown / not recorded</span>
              <span className="ml-auto text-[11px]">{ofPct(dist.unrecorded, dist.of)}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-3">
      <section className={CARD}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Patients seen" value={metricValue(d.patientsSeen)} />
          <Kpi label="New registrations" value={d.registered?.value === null ? "—" : String(d.registered.value)} />
          <Kpi label="New to the practice" value={ofPct(d.newToPractice?.numerator ?? null, d.newToPractice?.denominator ?? null)}
            sub="of patients seen this period" />
          <Kpi label="Visits per patient"
            value={extras.available && extras.data && extras.data.avgVisitsPerPatient.patients > 0
              ? (extras.data.avgVisitsPerPatient.encounters / extras.data.avgVisitsPerPatient.patients).toFixed(1) : "—"}
            sub={extras.available && extras.data
              ? `${extras.data.avgVisitsPerPatient.encounters} visits over ${extras.data.avgVisitsPerPatient.patients} patients` : undefined} />
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        {dist(d.byAgeBand, "Age distribution")}
        {dist(d.bySex, "Sex distribution")}
      </div>
      <section className={CARD}>
        <div className="flex items-baseline justify-between">
          <h3 className="text-[13px] font-bold text-gray-900">Recency of last visit</h3>
          <Link href="/practice/patients" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Open the register &rarr;
          </Link>
        </div>
        {!rec ? (
          <p className="mt-1 text-[12px] text-gray-600">{extras.unavailableReason ?? "Could not be read."}</p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-0.5">
              {rec.buckets.map(bkt => (
                <li key={bkt.key} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-800">{bkt.label}</span>
                  <span className="ml-auto text-[11px] text-gray-500">{ofPct(bkt.count, rec.denominator)}</span>
                </li>
              ))}
              <li className="flex items-baseline gap-2 text-[12px] text-gray-500">
                <span>Never seen (registered, no encounter)</span>
                <span className="ml-auto text-[11px]">{ofPct(rec.neverSeen, rec.denominator)}</span>
              </li>
            </ul>
            {rec.truncated && (
              <p className="mt-1 text-[11px] text-amber-800">
                The read stopped at the row cap, so these buckets undercount. Narrow the question.
              </p>
            )}
          </>
        )}
      </section>
      <section className={CARD}>
        <h3 className="text-[13px] font-bold text-gray-900">Top conditions</h3>
        <ConditionsList suite={suite} limit={8} />
      </section>
      <TrustFooter ids={["pi.recency_last_visit", "pi.avg_visits_per_patient", "pi.top_conditions_by_patients"]} />
    </div>
  );
}

// ══ 3. CLINICAL INTELLIGENCE (v2 s8) ════════════════════════════════════════════════════════════════

export function ClinicalV2Area({ suite }: { suite: Suite }) {
  const p = suite.workspace.modules.patients;
  const c = suite.workspace.modules.clinicalActivity;
  const proc = suite.workspace.modules.procedures;
  const o = suite.workspace.modules.overview;
  const diagnoses: any = p.available ? (p.data as any).diagnoses : null;
  const rows: any[] = (diagnoses?.rows ?? []) as any[];
  const totalRecords: number | null = diagnoses?.total ?? null;
  const eligible: number | null = o.available ? ((o.data as any).metrics?.metrics?.patients_seen?.value ?? null) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Top conditions by patients</h3>
          <p className="mt-0.5 text-[10px] text-gray-500">Distinct people. Prevalence in this practice, not occurrence.</p>
          {!p.available ? <Unavailable module={p} /> : rows.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-500">No diagnoses recorded in this period.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {rows.slice(0, 8).map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-800">{r.label}</span>
                  <span className="ml-auto text-[11px] text-gray-500">{ofPct(r.patients ?? null, eligible)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Top conditions by records</h3>
          {/* v2 s15's own warning, on the screen: occurrence is NOT prevalence, so the two lists
              stand side by side under different headings instead of blending into one number. */}
          <p className="mt-0.5 text-[10px] text-gray-500">Diagnosis records, not people -- one patient reviewed monthly counts each time.</p>
          {!p.available ? <Unavailable module={p} /> : rows.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-500">No diagnoses recorded in this period.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {[...rows].sort((x, y) => (y.total ?? 0) - (x.total ?? 0)).slice(0, 8).map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-800">{r.label}</span>
                  <span className="ml-auto text-[11px] text-gray-500">{ofPct(r.total ?? null, totalRecords)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <TrendSection suite={suite} />
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Procedures</h3>
          {!proc.available ? <Unavailable module={proc} /> : (
            <p className="mt-1 text-[12px] text-gray-700">
              See the longitudinal record on{" "}
              <Link href="/practice/activity" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                Procedures &amp; Clinical Activity &rarr;
              </Link>
            </p>
          )}
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Consultation shape</h3>
          {!c.available ? <Unavailable module={c} /> : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {(((c.data as any).byMode?.slices ?? []) as any[]).map((s: any) => (
                <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-800">{s.label}</span>
                  <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, (c.data as any).byMode?.of ?? null)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <TrustFooter ids={["pi.top_conditions_by_patients", "pi.top_conditions_by_encounters"]} />
    </div>
  );
}

// ══ 4. FOLLOW-UP & OUTCOMES (v2 s9) ═════════════════════════════════════════════════════════════════

export function FollowUpV2Area({ suite, extras }: { suite: Suite; extras: PiV2Extras }) {
  const f = suite.workspace.modules.followUps;
  if (!f.available) return <section className={CARD}><Unavailable module={f} /></section>;
  const d: any = f.data;
  const median = extras.available && extras.data ? extras.data.medianDaysToFollowUp : null;

  return (
    <div className="flex flex-col gap-3">
      <section className={CARD}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Raised this period" value={String(d.completion?.denominator ?? "—")} />
          <Kpi label="Completed" value={ofPct(d.completion?.numerator ?? null, d.completion?.denominator ?? null)}
            sub={d.completion?.caveat ?? undefined} />
          <Kpi label="Overdue now" value={d.overdue?.value === null ? "—" : String(d.overdue.value)}
            sub="as at today, across all periods" />
          <Kpi label="Median days to follow-up"
            value={median?.medianDays === null || !median ? "—" : String(median.medianDays)}
            sub={median ? `${median.pairs} completed pair${median.pairs === 1 ? "" : "s"}; early completions count negative` : undefined} />
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">By kind</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {((d.byKind?.slices ?? []) as any[]).map((s: any) => (
              <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
                <span className="text-gray-800">{s.label}</span>
                <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, d.byKind?.of ?? null)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Care gaps</h3>
          <ul className="mt-1 flex flex-col gap-1">
            <li>
              <Link href="/practice/follow-ups?filter=overdue"
                className="flex items-baseline gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12px] hover:bg-gray-50">
                <span className="text-gray-800">Overdue clinical follow-ups</span>
                <span className="ml-auto font-bold text-gray-900">{d.overdue?.value ?? "—"}</span>
                <span aria-hidden="true" className="text-gray-400">&rarr;</span>
              </Link>
            </li>
          </ul>
          <p className="mt-1 text-[10px] text-gray-500">
            Every gap routes to the workspace that owns the work (v2 s17). No subsequent record in
            CompetenPractice is never a claim that care did not occur.
          </p>
        </section>
      </div>
      <TrustFooter ids={["pi.followup_completion", "pi.median_days_followup"]} />
    </div>
  );
}

// ══ 5. PRACTICE PATTERNS (v2 s10) ═══════════════════════════════════════════════════════════════════

export function PatternsV2Area({ suite }: { suite: Suite }) {
  const c = suite.workspace.modules.clinicalActivity;
  const loc = suite.workspace.modules.locations;
  if (!c.available) return <section className={CARD}><Unavailable module={c} /></section>;
  const d: any = c.data;
  const weekdays = weekdayPattern(d.trend?.buckets ?? []);
  const weekTotal = weekdays.reduce((n, w) => n + w.count, 0);
  const max = Math.max(1, ...weekdays.map(w => w.count));

  return (
    <div className="flex flex-col gap-3">
      <TrendSection suite={suite} />
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Consultations by weekday</h3>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Derived from the same daily trend every screen shares, in the practice&apos;s own calendar.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {weekdays.map(w => (
              <li key={w.label} className="flex items-center gap-2 text-[12px]">
                <span className="w-9 text-gray-600">{w.label}</span>
                <span className="h-2.5 rounded bg-[var(--cp-primary)]/50" style={{ width: `${Math.round((w.count / max) * 70)}%` }} />
                <span className="ml-auto text-[11px] text-gray-500">{ofPct(w.count, weekTotal || null)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Consultation types</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {((d.byMode?.slices ?? []) as any[]).map((s: any) => (
              <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
                <span className="text-gray-800">{s.label}</span>
                <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, d.byMode?.of ?? null)}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-3 text-[13px] font-bold text-gray-900">Entry pathway</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {((d.byPathway?.slices ?? []) as any[]).map((s: any) => (
              <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
                <span className="text-gray-800">{s.label}</span>
                <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, d.byPathway?.of ?? null)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {/* v2 s10 "By location -- counts and proportions by configured practice location", consolidated
          here from the deferral card (owner's command, 2026-08-15). The figures are the location
          module's own: attributed through the located session each consultation ran inside, because
          practice_encounter.location_id exists and NOTHING WRITES IT (see locationIntelligence). */}
      <section className={CARD}>
        <h3 className="text-[13px] font-bold text-gray-900">By location</h3>
        {!loc.available ? <Unavailable module={loc} /> : (() => {
          const e = (loc.data as any).encounters;
          const appts = (loc.data as any).appointments;
          const apptRows = ((appts?.locations ?? []) as any[]);
          const apptTotal = apptRows.reduce((n, r) => n + (r.appointments ?? 0), 0);
          if (e.status !== "ok") return <p className="mt-1 text-[12px] text-gray-600">{e.reason}</p>;
          return (
            <>
              <p className="mt-0.5 text-[10px] text-gray-500">
                Counted through the located session each consultation ran inside. A consultation outside
                any located session has no site and is disclosed below &mdash; never dropped, never
                redistributed across the sites.
              </p>
              {e.rows.length === 0 && e.unattributed === 0 ? (
                <p className="mt-2 text-[12px] text-gray-500">No consultations in this period.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {e.rows.map((r: any) => (
                    <li key={r.locationId} className="flex items-baseline gap-2 text-[12px]">
                      <span className="text-gray-800">{r.name}</span>
                      <span className="ml-auto text-[11px] text-gray-500">{ofPct(r.total, e.of)}</span>
                    </li>
                  ))}
                  {e.unattributed > 0 && (
                    <li className="flex items-baseline gap-2 text-[12px]">
                      <span className="italic text-gray-500">No location recorded</span>
                      <span className="ml-auto text-[11px] text-gray-500">{ofPct(e.unattributed, e.of)}</span>
                    </li>
                  )}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-gray-600">
                Active locations this period (v2 s15: configured, with qualifying activity):{" "}
                <span className="font-bold text-gray-900">{e.rows.length}</span>
                {apptRows.length > 0 && <> of {apptRows.length} configured</>}
              </p>
              {appts?.comparable && apptTotal > 0 && (
                <div className="mt-2 border-t border-gray-100 pt-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Appointments by location (booked, a different universe from consultations held)
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {apptRows.map((r: any) => (
                      <li key={r.id} className="flex items-baseline gap-2 text-[12px]">
                        <span className="text-gray-800">{r.name}</span>
                        <span className="ml-auto text-[11px] text-gray-500">{ofPct(r.appointments ?? 0, apptTotal)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          );
        })()}
      </section>
      <TrustFooter ids={["pi.day_of_week", "pi.consultations_trend", "pi.encounters_by_location"]} />
    </div>
  );
}
