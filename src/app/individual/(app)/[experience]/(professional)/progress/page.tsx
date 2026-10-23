import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { EVIDENCE_LABEL } from "@/lib/individual/passport";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { cpdHoursByYear, evidenceCoverage, planProgress } from "@/lib/individual/professional/progress";
import { NEED_STATUS_LABEL } from "@/lib/individual/professional/vocabulary";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing } from "../../../../_components/chrome";
import { NotProvisioned, Section } from "../../../../_components/professional/bits";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// PROGRESS -- COMPETEN-IND-007 s6. Plan progress, CPD hours by year and evidence coverage.
//
// ⚠ EVERY FIGURE IS A COUNT OF THE PERSON'S OWN ROWS (src/lib/individual/professional/progress.ts). There
// is no target, no score, no readiness percentage and no comparison with anyone. A ratio with nothing to
// count is "Not measured", with the reason, never 0%.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Progress" }); }

const pct = (r: number) => `${Math.round(r * 100)}%`;

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
      <p className="text-[12.5px] text-gray-600">{sub}</p>
    </div>
  );
}

function NotMeasured({ why, href, cta, accent }: { why: string; href: string; cta: string; accent: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-4">
      <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Not measured</p>
      <p className="mt-1 text-[13.5px] text-gray-700">{why}</p>
      <Link href={href} className={`mt-2 inline-flex min-h-[44px] items-center text-[13.5px] font-semibold ${focusRing}`} style={{ color: accent }}>{cta} →</Link>
    </div>
  );
}

export default async function ProgressPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "progress");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  const record = await loadProfessionalRecord(ctx.admin, ctx.userId);
  const { needs, goals, cpd, evidence } = record;
  const plan = goals ? planProgress(goals, today) : null;
  const years = cpd ? cpdHoursByYear(cpd) : null;
  const coverage = needs && goals && cpd && evidence ? evidenceCoverage(needs, goals, cpd, evidence) : null;
  const href = (s: string) => experienceHref("professional", s);

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your development" title="Progress"
        intro="Where your plan stands, from your own record. No targets are invented: hours are shown as hours, and anything with nothing to measure says so." />
      {!record.provisioned && <NotProvisioned />}

      <Section title="Learning plan">
        {plan === null ? <Unreadable what="learning plan" /> : plan.completion === null ? (
          <NotMeasured accent={x.accent} href={href("development")} cta="Add a goal"
            why={plan.total ? "Every goal in your plan is dropped, so there is nothing to measure." : "You have no goals yet, so there is no plan to measure."} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Goals done" value={pct(plan.completion)} sub={`${plan.done} of ${plan.total - plan.dropped} (dropped goals not counted)`} />
            <Stat label="In progress" value={String(plan.inProgress)} sub={`${plan.planned} more planned`} />
            <Stat label="Past target date" value={String(plan.overdue)} sub="Planned or in progress, target date passed" />
          </div>
        )}
      </Section>

      <Section title="CPD hours by year" note="Hours you recorded. Competen sets no target.">
        {years === null ? <Unreadable what="CPD log" /> : years.length === 0 ? (
          <NotMeasured accent={x.accent} href={href("cpd")} cta="Record CPD" why="No CPD recorded yet." />
        ) : (
          <table className="w-full text-left text-[14px]">
            <caption className="sr-only">CPD hours by calendar year</caption>
            <thead><tr className="border-b border-gray-200 text-[12px] uppercase tracking-[0.1em] text-gray-500">
              <th scope="col" className="py-2 font-bold">Year</th><th scope="col" className="py-2 font-bold">Hours</th>
              <th scope="col" className="py-2 font-bold">Entries</th><th scope="col" className="py-2 font-bold">With a document</th>
            </tr></thead>
            <tbody>
              {years.map(y => (
                <tr key={y.year} className="border-b border-gray-100 tabular-nums">
                  <th scope="row" className="py-2 font-semibold text-gray-900">{y.year}</th>
                  <td className="py-2">{y.hours}</td><td className="py-2">{y.entries}</td><td className="py-2">{y.withDocument}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Evidence coverage" note="For each development need, the CPD (through a linked goal) and evidence you recorded against it.">
        {coverage === null ? <Unreadable what="record" /> : coverage.ratio === null ? (
          <NotMeasured accent={x.accent} href={href("development")} cta="Add a development need"
            why={coverage.needs.length ? "All your needs are set aside, so there is nothing to measure." : "You have no development needs yet, so coverage cannot be measured."} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Needs with evidence" value={pct(coverage.ratio)} sub={`${coverage.covered} of ${coverage.counted} needs not set aside`} />
              <Stat label={EVIDENCE_LABEL.self_declared} value={String(coverage.byClass.self_declared)} sub="CPD entries and evidence items" />
              <Stat label={EVIDENCE_LABEL.source_linked} value={String(coverage.byClass.source_linked)} sub="CPD entries and evidence items" />
            </div>
            <ul className="mt-4 divide-y divide-gray-100">
              {coverage.needs.map(n => (
                <li key={n.needId} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <p className="text-[14px] font-semibold text-gray-900">{n.title} <span className="font-normal text-gray-500">· {NEED_STATUS_LABEL[n.status] ?? n.status}</span></p>
                  <p className={`text-[12.5px] font-semibold ${n.covered ? "text-gray-800" : "text-amber-800"}`}>
                    {n.covered ? "Has evidence" : "No evidence yet"} · {n.goals} {n.goals === 1 ? "goal" : "goals"} · {n.cpd} CPD · {n.evidence} evidence
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-gray-500">Coverage counts what you recorded. It does not mean anyone has assessed or verified the need as met.</p>
          </>
        )}
      </Section>
    </>
  );
}
