import { EXPERIENCES } from "@/lib/individual/experiences";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { cpdHoursByYear } from "@/lib/individual/professional/progress";
import { CPD_ACTIVITY_LABEL } from "@/lib/individual/professional/vocabulary";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing } from "../../../../_components/chrome";
import { ApiButton } from "../../../../_components/professional/forms";
import CpdForm from "../../../../_components/professional/CpdForm";
import { ClassLabel, Empty, NotProvisioned, Section, fmtDate } from "../../../../_components/professional/bits";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// THE PRIVATE CPD LOG -- COMPETEN-IND-007 s4, owner ruling D1.
//
// ⚠ NOT YOUR EMPLOYER'S CPD LOG. This reads and writes migration 373's individual_professional_cpd, never
// cpd_logs, which hospital analytics read. The page says so, because a person who also works somewhere on
// Competen has two logs and must know which one their employer sees.
//
// ⚠ HOURS, NOT A TARGET (the src/app/dashboard/cpd header rule). Hours are summed by year. There is no
// annual target, because no store holds one for an Individual person and their regulator's requirement
// is not something Competen knows.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "CPD log" }); }

export default async function CpdPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "cpd");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  const record = await loadProfessionalRecord(ctx.admin, ctx.userId);
  const cpd = record.cpd;
  const years = cpd ? cpdHoursByYear(cpd) : null;
  const goalTitle = new Map((record.goals ?? []).map(g => [g.id, g.title]));
  const liveGoals = (record.goals ?? []).filter(g => g.status === "planned" || g.status === "in_progress");

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your development" title="CPD log"
        intro="Your continuing professional development, kept privately by you. This is not an employer's CPD record: no organisation sees it unless you share your Passport." />
      {!record.provisioned && <NotProvisioned />}

      <Section title="Hours by year" note="Hours you recorded. Competen sets no target. Check your regulator's current requirement yourself.">
        {years === null ? <Unreadable what="CPD log" /> : years.length === 0 ? <Empty>No CPD recorded yet.</Empty> : (
          <ul className="grid gap-3 sm:grid-cols-3">
            {years.map(y => (
              <li key={y.year} className="rounded-xl border border-gray-200 p-4">
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">{y.year}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{y.hours} <span className="text-[14px] font-semibold text-gray-600">{y.hours === 1 ? "hour" : "hours"}</span></p>
                <p className="text-[12.5px] text-gray-600">{y.entries} {y.entries === 1 ? "entry" : "entries"} · {y.withDocument} with a document</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {cpd !== null && record.provisioned && (
        <Section title="Add an activity">
          <CpdForm accent={x.accent} today={today} goals={liveGoals.map(g => ({ id: g.id, title: g.title }))} />
        </Section>
      )}

      <Section title="Your activities" note="Each entry says whether a document is attached. Neither kind is verified by anyone.">
        {cpd === null ? <Unreadable what="CPD log" /> : cpd.length === 0 ? <Empty>Your activities will appear here.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {cpd.map(c => (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-semibold text-gray-900">{c.title}</p>
                    <p className="text-[12.5px] text-gray-500">
                      {CPD_ACTIVITY_LABEL[c.activity_type] ?? c.activity_type} · {fmtDate(c.activity_date)} · {c.hours} {c.hours === 1 ? "hour" : "hours"}
                      {c.cpd_points !== null ? ` · ${c.cpd_points} points` : ""}{c.provider ? ` · ${c.provider}` : ""}
                      {c.goal_id && goalTitle.get(c.goal_id) ? ` · goal: ${goalTitle.get(c.goal_id)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ClassLabel value={c.evidence_class} />
                    {c.document_name && (
                      <a href={`/api/individual/professional/documents?type=cpd&id=${c.id}`} target="_blank" rel="noopener noreferrer"
                        className={`text-[12.5px] font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>
                        Open {c.document_name}
                      </a>
                    )}
                    <ApiButton action={`/api/individual/professional/cpd?id=${c.id}`} method="DELETE" label="Remove" confirm="Remove this CPD entry and its document?" />
                  </div>
                </div>
                {c.reflection && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-[13.5px] leading-relaxed text-gray-700">{c.reflection}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
