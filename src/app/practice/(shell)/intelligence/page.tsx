import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { practiceIntelligence, myGrowth } from "@/lib/practice/intelligence";
import PeriodPicker from "../reports/PeriodPicker";
import Trend from "./Trend";

// /practice/intelligence -- CPR-200 PRACTICE INTELLIGENCE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE COMP IS ALMOST ENTIRELY RATES, AND ALMOST NONE OF THEM SURVIVE.
//
// Follow-up Rate 86.2% · Completed Notes 96.3% · Complication Rate 2.1% · Readmission 1.8% · Retention
// 78% · Data Quality 96% · Patient Satisfaction 4.6/5 · Benchmarks "Top 20%" · and a green arrow on
// every tile. This product computes no rates, for the reason CPR-270 gives: a percentage is where a
// small number hides, and a practice with nine follow-ups does not have an 86.2% anything.
//
// So the LAYOUT is the comp's -- the KPI strip, the trend, case mix, outcomes, the summary rail -- and
// every figure inside it is a count and its denominator. What cannot be counted at all is named in its
// designed position with the reason, because a reader cannot tell an absent number from an unbuilt one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NO MIGRATION. Every input already existed; this page is a composing layer. An intelligence table would
// be a second copy of the truth that disagrees with the first the day somebody backdates a record.

export const dynamic = "force-dynamic";

export default async function IntelligencePage({ searchParams }: {
  searchParams: Promise<{ from?: string; to?: string; days?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "report.view")) redirect("/practice/home");

  const { from, to, days } = await searchParams;
  const admin = createAdminClient();
  const intel = await practiceIntelligence(admin, shell.ctx, {
    fromDay: from, toDay: to,
    days: days ? Math.min(Math.max(Number(days) || 30, 1), 366) : undefined,
  });
  const growth = await myGrowth(admin, shell.ctx, intel.period);

  const card = "rounded-xl border border-gray-200 bg-white p-4";
  const { outcomes, caseMix } = intel;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Practice intelligence</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            What your own records add up to. {intel.period.label}.
          </p>
        </div>
        <Link href="/practice/reports/analytics"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          Activity report
        </Link>
      </div>

      <PeriodPicker fromDay={intel.period.fromDay} toDay={intel.period.toDay} />

      {/* ── KPI strip (comp: six tiles) ─────────────────────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Consultations</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{intel.trend.total}</p>
          {/* A COUNT AGAINST A COUNT. The comp writes "↑12.4% vs last year". */}
          <p className="mt-0.5 text-[10px] text-gray-500">{intel.trend.priorTotal} in the period before</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Procedures</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{outcomes.procedures.performed}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">{outcomes.procedures.outcomesRecorded} with an outcome</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">With a complication</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{outcomes.procedures.withComplication}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">of {outcomes.procedures.performed} performed</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Follow-ups concluded</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{outcomes.followUps.completed}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            of {outcomes.followUps.concluded}{outcomes.followUps.missed > 0 ? ` · ${outcomes.followUps.missed} missed` : ""}
          </p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Diagnoses recorded</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{caseMix.diagnoses.total}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">across {caseMix.diagnoses.distinctLabels} labels</p>
        </div>
        <div className={`${card} border-dashed bg-gray-50/60`}>
          <p className="text-[11px] font-semibold text-gray-500">Patient satisfaction</p>
          <p className="mt-1 text-2xl font-bold text-gray-300">&mdash;</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Nothing here asks a patient anything.
          </p>
        </div>
      </div>

      <div className="mt-4 grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <section className={card}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h2 className="text-[13px] font-bold text-gray-900">Consultations over the period</h2>
              <span className="text-[11px] text-gray-500">
                {intel.trend.total} this period · {intel.trend.priorTotal} in the one before
              </span>
            </div>
            <Trend buckets={intel.trend.buckets} />
            {intel.trend.busiestDay && intel.trend.busiestDay.total > 0 && (
              <p className="mt-1 text-[10px] text-gray-500">
                Busiest day: {intel.trend.busiestDay.day} with {intel.trend.busiestDay.total}.
                Counted in this practice&rsquo;s calendar, not UTC.
              </p>
            )}
          </section>

          <div className="grid sm:grid-cols-2 gap-4">
            <section className={card}>
              <h2 className="text-[13px] font-bold text-gray-900">What this practice sees</h2>
              {caseMix.diagnoses.rows.length === 0 ? (
                <p className="mt-2 text-[12px] text-gray-400">No diagnoses recorded in this period.</p>
              ) : (
                <ul className="mt-2 flex flex-col">
                  {caseMix.diagnoses.rows.slice(0, 8).map((r: { label: string; total: number; patients: number }) => (
                    <li key={r.label} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                      <span className="min-w-0 truncate text-[12px] text-gray-800">{r.label}</span>
                      <span className="ml-auto text-[12px] font-bold text-gray-900">{r.total}</span>
                      <span className="w-20 text-right text-[10px] text-gray-500">
                        {r.patients} {r.patients === 1 ? "patient" : "patients"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-[10px] text-gray-400">
                Labels counted as they were typed &mdash; nothing forces a terminology here.
              </p>
            </section>

            <section className={card}>
              <h2 className="text-[13px] font-bold text-gray-900">What this practice does</h2>
              {caseMix.procedures.length === 0 ? (
                <p className="mt-2 text-[12px] text-gray-400">No procedures recorded in this period.</p>
              ) : (
                <ul className="mt-2 flex flex-col">
                  {caseMix.procedures.map((p: { label: string; total: number }) => (
                    <li key={p.label} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                      <span className="min-w-0 truncate text-[12px] text-gray-800">{p.label}</span>
                      <span className="ml-auto text-[12px] font-bold text-gray-900">{p.total}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* ── The comp's "Data Quality 96%", replaced by something actionable ──────────────── */}
          {intel.completeness.length > 0 && (
            <section className={card}>
              <h2 className="text-[13px] font-bold text-gray-900">Records missing something</h2>
              <p className="mt-0.5 text-[11px] text-gray-500">
                The design this was built from shows a data-quality score. A score tells you nothing to do
                on a Tuesday morning; these are lists you can open and close.
              </p>
              <ul className="mt-2 flex flex-col">
                {intel.completeness.map((c: { key: string; label: string; missing: number; of: number; href: string; note: string }) => (
                  <li key={c.key} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <span className="min-w-0">
                      <Link href={c.href} className="block text-[12px] font-semibold text-gray-800 hover:underline">
                        {c.label}
                      </Link>
                      <span className="block text-[10px] text-gray-500">{c.note}</span>
                    </span>
                    <span className="ml-auto shrink-0 text-right">
                      <span className={`block text-[13px] font-bold ${c.missing > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
                        {c.missing}
                      </span>
                      <span className="block text-[10px] text-gray-500">of {c.of}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ── The summary rail ───────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">Your own work</h2>
            <ul className="mt-2 flex flex-col">
              {[
                ["Consultations you opened", growth.encounters],
                ["Procedures you performed", growth.procedures],
                ["Activities logged", growth.portfolio.activities.total],
                ["CPD minutes claimed", growth.portfolio.cpdMinutes],
              ].map(([label, value]) => (
                <li key={String(label)} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                  <span className="text-[12px] text-gray-700">{label}</span>
                  <span className="ml-auto text-[12px] font-bold text-gray-900">{value}</span>
                </li>
              ))}
            </ul>
            <Link href="/practice/activity" className="mt-2 inline-block text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Clinical activity →
            </Link>
          </section>

          {intel.locations.comparable && (
            <section className={card}>
              <h2 className="text-[13px] font-bold text-gray-900">By location</h2>
              <ul className="mt-2 flex flex-col">
                {intel.locations.locations.map((l: { id: string; name: string; appointments: number }) => (
                  <li key={l.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                    <span className="truncate text-[12px] text-gray-800">{l.name}</span>
                    <span className="ml-auto text-[12px] font-bold text-gray-900">{l.appointments}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* THE PANEL THE COMP HAS NO ROOM FOR. */}
          <section className={`${card} border-dashed bg-gray-50/60`}>
            <h2 className="text-[13px] font-bold text-gray-900">What this page will not tell you</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              The design shows each of these as a figure. None of them is knowable from this practice&rsquo;s
              own records, so none is shown.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {intel.notAvailable.map((n: { key: string; label: string; reason: string }) => (
                <li key={n.key}>
                  <p className="text-[12px] font-semibold text-gray-700">{n.label}</p>
                  <p className="text-[10px] text-gray-500">{n.reason}</p>
                </li>
              ))}
            </ul>
          </section>

          {!intel.identified && (
            <p className="text-[11px] text-gray-500">
              You hold reporting access but not clinical access, so this page shows counts and no patient
              names &mdash; the same rule the access log follows.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
