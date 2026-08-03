import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { practiceReport } from "@/lib/practice/reports";
import PeriodPicker from "./PeriodPicker";

// /practice/reports -- CPR-330.
//
// EVERY FIGURE ON THIS PAGE IS A COUNT AND ITS DENOMINATOR. There is no percentage anywhere, deliberately
// -- see the engine header. "67% attendance" over three appointments sounds like a measurement and is
// not one, and a report is the last place in this product where the comps' invented dashboards could
// still get in.
//
// THE CAVEATS RENDER ON THE PAGE, not just in a comment. Somebody reading a number here is deciding
// something with it, and what the number deliberately is not is part of what it means.

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ from?: string; to?: string; days?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "report.view")) redirect("/practice/home");

  const { from, to, days } = await searchParams;
  const admin = createAdminClient();
  const report = await practiceReport(admin, shell.ctx, {
    fromDay: from, toDay: to,
    days: days ? Math.min(Math.max(Number(days) || 30, 1), 366) : undefined,
  });

  const { activity, diagnoses, backlog } = report;

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reports</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            What this practice did, counted from its own records. {report.period.label}.
          </p>
        </div>
        <a href={`/api/v1/practice/reports/export?from=${report.period.fromDay}&to=${report.period.toDay}`}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          Download CSV
        </a>
      </div>

      <PeriodPicker fromDay={report.period.fromDay} toDay={report.period.toDay} />

      {/* Activity */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Activity</h2>
        <ul className="mt-2 flex flex-col">
          {activity.lines.map(l => (
            <li key={l.label} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
              <Link href={l.href} className="text-[12px] text-gray-700 hover:underline">{l.label}</Link>
              <span className="ml-auto text-[13px] font-bold text-gray-900">{l.value}</span>
              {/* THE DENOMINATOR, ALWAYS, WHERE THERE IS ONE. Never a percentage. */}
              {l.of !== null && <span className="w-24 text-right text-[11px] text-gray-500">of {l.of}</span>}
              {l.of === null && <span className="w-24" />}
            </li>
          ))}
        </ul>
      </section>

      {/* What this practice sees */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-[13px] font-bold text-gray-900">What this practice sees</h2>
          <span className="text-[11px] text-gray-500">
            {diagnoses.total} {diagnoses.total === 1 ? "diagnosis" : "diagnoses"} across {diagnoses.distinctLabels} labels
          </span>
        </div>
        {diagnoses.rows.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nothing recorded in this period.</p>
        ) : (
          <>
            <ul className="mt-2 flex flex-col">
              {diagnoses.rows.map(r => (
                <li key={r.label} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                  <span className="text-[12px] text-gray-800">{r.label}</span>
                  {r.code && <span className="font-mono text-[10px] text-gray-400">{r.code}</span>}
                  <span className="ml-auto text-[13px] font-bold text-gray-900">{r.total}</span>
                  <span className="w-28 text-right text-[11px] text-gray-500">
                    {r.patients} {r.patients === 1 ? "patient" : "patients"}
                  </span>
                  <span className="w-24 text-right text-[11px] text-gray-500">{r.confirmed} confirmed</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-gray-400">
              {diagnoses.coded} of {diagnoses.total} carry a code. Labels are counted as they were typed
              &mdash; nothing here forces a terminology, so two spellings of one condition are two rows.
              {diagnoses.truncated && " Showing the most frequent 25."}
            </p>
          </>
        )}
      </section>

      {/* Backlog: about now, not about the period */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Backlog, right now</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Not part of the period above: &ldquo;how far behind am I&rdquo; is a question about the present,
          and averaging it over a month is how a backlog stops looking urgent.
        </p>
        <div className="mt-2 grid sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[12px] font-semibold text-gray-800">
              Consultations awaiting signature: {backlog.unsignedEncounters.total}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {Object.entries(backlog.unsignedEncounters.byAge).filter(([, n]) => n > 0).map(([age, n]) => (
                <li key={age} className={`text-[11px] ${age === "30+ days" ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-600"}`}>
                  {n} for {age}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-gray-800">
              Received documents awaiting review: {backlog.unreviewedIncoming.total}
              {backlog.unreviewedIncoming.urgent > 0 && (
                <span className="ml-1 text-[var(--cmp-text-critical)]">({backlog.unreviewedIncoming.urgent} urgent)</span>
              )}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {Object.entries(backlog.unreviewedIncoming.byAge).filter(([, n]) => n > 0).map(([age, n]) => (
                <li key={age} className={`text-[11px] ${age === "30+ days" ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-600"}`}>
                  {n} for {age}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[12px] text-gray-700">
            Follow-ups overdue: <span className="font-bold">{backlog.overdueFollowUps}</span>
            <span className="text-[11px] text-gray-500"> of {backlog.openFollowUps} open</span>
          </p>
          <p className="text-[12px] text-gray-700">
            Tasks overdue: <span className="font-bold">{backlog.overdueTasks}</span>
            <span className="text-[11px] text-gray-500"> of {backlog.openTasks} open</span>
          </p>
        </div>
      </section>

      {/* What these numbers deliberately are not */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">What these numbers are not</h2>
        <ul className="mt-2 flex flex-col gap-1.5">
          {report.caveats.map((c, i) => (
            <li key={i} className="text-[12px] text-gray-600">{c}</li>
          ))}
        </ul>
      </section>

      {!report.identified && (
        <p className="mt-3 text-[11px] text-gray-500">
          You hold reporting access but not clinical access, so this page shows counts and no patient
          names &mdash; the same rule the access log follows.
        </p>
      )}
    </div>
  );
}
