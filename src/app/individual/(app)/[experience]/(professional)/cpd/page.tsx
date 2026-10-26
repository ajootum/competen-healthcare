import Link from "next/link";
import { EXPERIENCES } from "@/lib/individual/experiences";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { cpdHoursByYear } from "@/lib/individual/professional/progress";
import { CPD_ACTIVITY_LABEL } from "@/lib/individual/professional/vocabulary";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing } from "../../../../_components/chrome";
import { ApiButton } from "../../../../_components/professional/forms";
import CpdForm from "../../../../_components/professional/CpdForm";
import { CpdEdit } from "../../../../_components/professional/edit-forms";
import CompetencyLinks from "../../../../_components/professional/CompetencyLinks";
import RequirementPicker from "../../../../_components/professional/RequirementPicker";
import { linksFor, loadMappingView } from "@/lib/individual/professional/mapping-store";
import { countedOnce, cpdYearsWithLearning, learningRecordHref, loadProfessionalLearning } from "@/lib/individual/professional/learning";
import { loadLcpdConfig, REVIEW_LABEL } from "@/lib/individual/lcpd-config";
import { lcpdSchemaReady, recordableTypes } from "@/lib/individual/professional/lcpd-schema";
import { inEffect, loadCpdHistory, loadCpdSetting, summarise } from "@/lib/individual/professional/cpd-requirements";
import { myRecords } from "@/lib/learning/record";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import LearningRefs from "../../../../_components/professional/LearningRefs";
import LearningReflectionList from "../../../../_components/professional/LearningReflectionList";
import ReflectOnLearning from "../../../../_components/professional/ReflectOnLearning";
import { loadLearningReflections } from "@/lib/individual/professional/learning-reflections";
import { ClassLabel, Empty, NotProvisioned, Section, fmtDate } from "../../../../_components/professional/bits";
import RecordGoalLink from "../../../../_components/professional/RecordGoalLink";
import { loadPlanWorkspace } from "@/lib/individual/professional/plan-store";
import { goalsByRecord, openActivities, type RecordGoal } from "@/lib/individual/professional/record-goals";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// MY LEARNING AND CPD -- COMPETEN-IND-007 s4, owner ruling D1, and COMPETEN-PROFESSIONAL-LCPD-01 LCPD-1 to LCPD-5.
//
// ⚠ NOT YOUR EMPLOYER'S CPD LOG. This reads and writes migration 373's individual_professional_cpd, never
// cpd_logs, which hospital analytics read. The page says so, because a person who also works somewhere on
// Competen has two logs and must know which one their employer sees.
//
// ⚠ THE ONE RECORD OF WHAT HAPPENED (LCPD-01 shared contract). A CPD entry here is the authoritative record of learning or
// development that actually happened. A Stage 3 development activity references it and never stores its own hours.
//
// ⚠ LEARNING BY REFERENCE (COMPETEN-LEARNING-01 H1). Courses in progress come from Competen Learning's own myRecords, and
// completed ones from its loadLearningRecords. Nothing is copied into this log. Learning off: none of it shows, and the page
// is a complete CPD log without it. An entry of the person's own that is the same course is COUNTED ONCE.
//
// ⚠ A REQUIREMENT IS COUNTED AGAINST, NEVER MET. With a configured requirement the person chose (LCPD-5), the page shows
// what is recorded and what is potentially eligible. Nothing is verified or accepted: Competen has no authorised route.
//
// ⚠ THE GOALS IT SERVED (PLAN-01, migration 480). With 480 a CPD entry or a learning record serves goals through the
// Stage 3 activity that references it, read once from the plan and linked through Stage 3's route. Before 480, the
// entry's own 373 goal, as before. An earlier 373 goal stays shown either way.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Learning & CPD" }); }

export default async function CpdPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "cpd");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  const [record, map, learning, policy, cfg, ready, setting, history, reflections, plan] = await Promise.all([
    loadProfessionalRecord(ctx.admin, ctx.userId), loadMappingView(ctx.admin, ctx.userId), loadProfessionalLearning(ctx.admin, ctx.userId),
    loadIndividualPolicy(ctx.admin), loadLcpdConfig(ctx.admin), lcpdSchemaReady(ctx.admin), loadCpdSetting(ctx.admin, ctx.userId), loadCpdHistory(ctx.admin, ctx.userId),
    loadLearningReflections(ctx.admin, ctx.userId), loadPlanWorkspace(ctx.admin, ctx.userId),
  ]);
  // 480: goal links live in the plan. Readable: shown and linkable. Unreadable: said so, and nothing offered.
  const planLinks = plan.provisioned && plan.activities !== null && plan.activityGoals !== null && plan.goals !== null;
  const servedBy = planLinks ? goalsByRecord(plan) : new Map<string, RecordGoal[]>();
  // LCPD-3: reflections on learning, once 491 is here. Unreadable or absent: no reflection controls, nothing implied.
  const canReflect = !!reflections?.available && record.provisioned;
  const reflectionsOf = (key: string) => reflections?.bySubject.get(key) ?? [];
  const inProgress = learning.enabled ? (await myRecords(ctx.admin, ctx.userId))?.filter(r => r.status === "enrolled" || r.status === "in_progress") ?? null : [];
  const cpd = record.cpd;
  const once = cpd ? countedOnce(cpd, learning, policy.professionalLearningMatchDays) : null;
  const years = cpd && once ? cpdYearsWithLearning(cpdHoursByYear(once.counted), learning.refs ?? []) : null;
  const goalTitle = new Map((record.goals ?? []).map(g => [g.id, g.title]));
  const liveGoals = (record.goals ?? []).filter(g => g.status === "planned" || g.status === "in_progress");
  const options = { types: recordableTypes(cfg, ready), flexible: ready, plan: plan.provisioned ? { activities: openActivities(plan) } : null };
  const goalChoices = liveGoals.map(g => ({ id: g.id, title: g.title }));
  const labelOf = (code: string) => cfg.activityTypes.find(t => t.code === code)?.label ?? CPD_ACTIVITY_LABEL[code] ?? code.replace(/_/g, " ");
  const offered = cfg.requirements.filter(r => inEffect(r, today));
  const chosen = setting?.setting.requirementCode ? cfg.requirements.find(r => r.code === setting.setting.requirementCode) ?? null : null;
  const summary = chosen && setting?.setting.cycleStart && once ? summarise(chosen, setting.setting.cycleStart, once.counted, learning.refs ?? [], today) : null;
  const timeline = [
    ...(cpd ?? []).map(c => ({ key: `c-${c.id}`, date: c.activity_date, title: c.title, kind: labelOf(c.activity_type), source: "Recorded by you" })),
    ...(learning.refs ?? []).map(r => ({ key: `l-${r.recordId}`, date: r.completedOn, title: r.title, kind: r.outcomeLabel, source: "Competen Learning" })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your development" title="Learning & CPD"
        intro="Your learning and continuing professional development, kept privately by you, wherever the learning happened. This is not an employer's CPD record: no organisation sees it unless you share your Passport." />
      {!record.provisioned && <NotProvisioned />}

      <nav aria-label="On this page" className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold">
        {/* HFE-01 Wave 5 (F7): each jump link only when its section renders (Continue learning needs Competen Learning). */}
        {[...(learning.enabled ? [["#continue-h", "Continue learning"]] : []), ["#record-h", "Record CPD"], ["#log-h", "CPD log"], ["#req-h", "CPD requirements"], ["#history-h", "Learning history"]].map(([h, l]) => (
          <a key={h} href={h} className={`underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>{l}</a>
        ))}
        {learning.enabled && <Link href="/individual/learning" className={`underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Explore courses</Link>}
        <a href="/api/individual/professional/cpd/export" className={`underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Export my CPD (CSV)</a>
      </nav>

      {learning.enabled && (
        <Section id="continue-h" title="Continue learning" note="Courses you started on Competen Learning. Your progress stays there.">
          {inProgress === null ? <Unreadable what="learning in progress" /> : inProgress.length === 0 ? (
            <Empty>No course in progress. <Link href="/individual/learning" className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Explore courses</Link>, or record learning from anywhere below.</Empty>
          ) : (
            <ul className="divide-y divide-gray-100">
              {inProgress.map(r => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <p className="text-[14px] font-semibold text-gray-900">{r.title} <span className="font-normal text-gray-500">· version {r.versionNo} · enrolled {fmtDate(r.enrolledAt)}{!r.accessLive ? " · your access has ended" : ""}</span></p>
                  <a href={learningRecordHref(r.id)} className={`text-[13px] font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Continue</a>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section id="req-h" title="CPD requirements" note="A requirement is what an administrator recorded from a named source. Competen does not decide what your body accepts.">
        {setting === null ? <Unreadable what="CPD requirement" /> : !setting.available ? <Empty>CPD requirements are not available here yet.</Empty>
          : offered.length === 0 && !chosen ? <Empty>No CPD requirement is configured yet. Your CPD log is complete without one.</Empty> : (
            <>
              {summary && chosen && (
                <div className="mb-4 rounded-xl border border-gray-200 p-4">
                  <p className="text-[14.5px] font-semibold text-gray-900">{chosen.label} <span className="font-normal text-gray-600">· {chosen.body}, {chosen.jurisdiction} · version {chosen.version}</span></p>
                  <p className="text-[12.5px] text-amber-900">{REVIEW_LABEL[chosen.reviewStatus]}{chosen.reviewedOn ? ` (${fmtDate(chosen.reviewedOn)})` : ""}. Source: {chosen.source.title}{chosen.source.reference ? `, ${chosen.source.reference}` : ""}{chosen.source.url && <> · <a href={chosen.source.url} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${focusRing}`}>open the source</a></>}</p>
                  <p className="mt-1 text-[12.5px] text-gray-600">Cycle {fmtDate(summary.cycle.start)} to {fmtDate(summary.cycle.end)}{summary.cycle.current ? "" : " (not the current cycle)"}.</p>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-gray-50 p-3"><dt className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">Recorded</dt>
                      <dd className="text-[14px] text-gray-900">{summary.recorded.hours} hours{summary.recorded.credits ? `, ${summary.recorded.credits} credits` : ""} in {summary.recorded.entries} {summary.recorded.entries === 1 ? "activity" : "activities"}{summary.recorded.withoutHours ? ` (${summary.recorded.withoutHours} with no hours recorded)` : ""}</dd></div>
                    <div className="rounded-lg bg-gray-50 p-3"><dt className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">Potentially eligible</dt>
                      <dd className="text-[14px] text-gray-900">{summary.eligible.hours}{summary.requiredHours != null ? ` of ${summary.requiredHours}` : ""} hours{summary.requiredCredits != null ? `, ${summary.eligible.credits} of ${summary.requiredCredits} credits` : ""}</dd></div>
                    <div className="rounded-lg bg-gray-50 p-3"><dt className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">Verified or accepted</dt>
                      <dd className="text-[13px] text-gray-700">Not verified. {summary.verifiedReason}</dd></div>
                  </dl>
                  {summary.mandatory.length > 0 && (
                    <ul className="mt-3 space-y-0.5 text-[12.5px] text-gray-700">{summary.mandatory.map(m => <li key={m.label}>{m.label}: {m.eligibleHours} of {m.minHours} hours recorded</li>)}</ul>
                  )}
                  {chosen.evidence && <p className="mt-2 text-[12.5px] text-gray-600">Evidence this requirement expects: {chosen.evidence}</p>}
                </div>
              )}
              {record.provisioned && (
                <RequirementPicker today={today} accent={x.accent} current={setting.setting.requirementCode} cycleStart={setting.setting.cycleStart}
                  options={offered.map(r => ({ code: r.code, label: `${r.label} (${r.body}, ${r.jurisdiction})`, detail: `${REVIEW_LABEL[r.reviewStatus]}. Source: ${r.source.title}. Cycle of ${r.cycleMonths} months${r.requiredHours != null ? `, ${r.requiredHours} hours` : ""}${r.requiredCredits != null ? `, ${r.requiredCredits} credits` : ""}.` }))} />
              )}
            </>
          )}
      </Section>

      <Section title="Hours by year" note={`Hours you recorded${learning.enabled ? ", and courses you completed on Competen Learning" : ""}. Competen sets no target.`}>
        {years === null ? <Unreadable what="CPD log" /> : years.length === 0 ? <Empty>No CPD recorded yet.</Empty> : (
          <ul className="grid gap-3 sm:grid-cols-3">
            {years.map(y => (
              <li key={y.year} className="rounded-xl border border-gray-200 p-4">
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">{y.year}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{y.hours} <span className="text-[14px] font-semibold text-gray-600">{y.hours === 1 ? "hour" : "hours"}</span></p>
                <p className="text-[12.5px] text-gray-600">{y.entries} {y.entries === 1 ? "entry" : "entries"} · {y.withDocument} with a document{y.withoutHours ? ` · ${y.withoutHours} with no hours recorded` : ""}</p>
                {y.learningEntries > 0 && (
                  <p className="text-[12.5px] text-gray-600">
                    of which {y.fromLearning} {y.fromLearning === 1 ? "hour" : "hours"} from Competen Learning
                    {y.learningWithoutHours ? ` (${y.learningWithoutHours} ${y.learningWithoutHours === 1 ? "course" : "courses"} gave no hours)` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {learning.enabled && learning.refs === null && <p className="mt-2 text-[12.5px] text-gray-600">Your Competen Learning record could not be read just now, so courses from it are not included.</p>}
        {once && once.matches.size > 0 && <p className="mt-2 text-[12.5px] text-gray-600">{once.matches.size} of your own {once.matches.size === 1 ? "entry is" : "entries are"} the same course as a Competen Learning record, so {once.matches.size === 1 ? "it is" : "they are"} counted once, from the learning record. Each one is marked below.</p>}
        {once?.checkUnavailable && <p className="mt-2 text-[12.5px] font-semibold text-amber-900">The check for courses you logged twice could not run just now, so an entry you also completed on Competen Learning may be counted twice.</p>}
      </Section>

      {reflections === null && <p role="alert" className="mb-4 text-[13px] text-amber-900">Your reflections on learning could not be read just now.</p>}
      {plan.provisioned && !planLinks && <p role="alert" className="mb-4 text-[13px] text-amber-900">The goals your learning served could not be read from your development plan just now.</p>}

      {cpd !== null && record.provisioned && (
        <Section id="record-h" title="Record CPD" note={options.flexible ? "From anywhere: a course, conference, workplace learning, teaching, mentorship, research, quality improvement or study. Only what you did and when are required." : "From anywhere: a course, conference, teaching, research or study."}>
          <CpdForm accent={x.accent} today={today} goals={liveGoals.map(g => ({ id: g.id, title: g.title }))} options={options} />
        </Section>
      )}

      <Section id="log-h" title="CPD log" note="Each entry says whether a document is attached. Neither kind is verified by anyone. Corrections keep the earlier version.">
        {cpd === null ? <Unreadable what="CPD log" /> : cpd.length === 0 ? <Empty>Your activities will appear here.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {cpd.map(c => {
              const earlier = history?.get(c.id) ?? [];
              return (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{c.title}</p>
                      <p className="text-[12.5px] text-gray-500">
                        {labelOf(c.activity_type)} · {fmtDate(c.activity_date)} · {c.hours == null ? "no hours recorded" : `${c.hours} ${c.hours === 1 ? "hour" : "hours"}`}
                        {c.cpd_points !== null ? ` · ${c.cpd_points} credits` : ""}{c.provider ? ` · ${c.provider}` : ""}
                        {c.goal_id && goalTitle.get(c.goal_id) && !(servedBy.get(`cpd:${c.id}`) ?? []).some(s => s.goalId === c.goal_id) ? ` · goal: ${goalTitle.get(c.goal_id)}` : ""}
                        {c.created_at && c.created_at.slice(0, 10) !== c.activity_date ? ` · recorded ${fmtDate(c.created_at)}` : ""}
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
                  {once?.matches.get(c.id) && (() => { const m = once.matches.get(c.id)!; return (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[12.5px] text-slate-800">
                      <span><span className="font-semibold">Counted once: matched to your Competen Learning record</span> ({m.title}, {fmtDate(m.completedOn)}). Its hours are counted from that record, not twice. This entry is kept as you wrote it.</span>
                      <ApiButton action="/api/individual/professional/cpd/learning-match" method="PATCH" body={{ cpdId: c.id, recordId: m.recordId }} label="This is a different activity" />
                    </div>
                  ); })()}
                  {c.reflection && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-[13.5px] leading-relaxed text-gray-700">{c.reflection}</p>}
                  <LearningReflectionList items={reflectionsOf(`cpd:${c.id}`)} />
                  {canReflect && <ReflectOnLearning subject={{ cpdId: c.id }} templates={cfg.reflectionTemplates} accent={x.accent} />}
                  {earlier.length > 0 && (
                    <details className="mt-1"><summary className="cursor-pointer text-[12.5px] text-gray-600">Corrected {earlier.length} {earlier.length === 1 ? "time" : "times"}: earlier versions</summary>
                      <ul className="mt-1 space-y-0.5 text-[12.5px] text-gray-600">{earlier.map((h, i) => <li key={i}>Until {fmtDate(h.corrected_at)}: {h.title} · {fmtDate(h.activity_date)} · {h.hours == null ? "no hours" : `${h.hours} hours`}</li>)}</ul>
                    </details>
                  )}
                  {planLinks && <RecordGoalLink subject={{ cpdId: c.id }} served={servedBy.get(`cpd:${c.id}`) ?? []} goals={goalChoices} accent={x.accent} idPrefix={`cpd-${c.id}-g`} />}
                  <CpdEdit c={c} goals={(record.goals ?? []).map(g => ({ id: g.id, title: g.title }))} today={today} accent={x.accent} options={options} />
                  {map.mappings === null ? <p className="mt-2 text-[12.5px] text-gray-600">Competency links could not be read just now.</p> : map.provisioned && (
                    <CompetencyLinks kind="cpd" subjectId={c.id} links={linksFor(map, "cpd", c.id)} offered={map.offered} accent={x.accent} idPrefix={`cpd-${c.id}`} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {learning.enabled && (
        <Section title="Completed on Competen Learning" note="Courses you completed, read from your learning record. They are not copied into this log and cannot be edited here. A course already here is not added to your log again. If you logged one before it arrived here, it is counted once and marked on your entry.">
          {learning.refs === null ? <Unreadable what="learning record" /> : learning.refs.length === 0 ? <Empty>No completed Competen Learning courses. Your own entries above are a complete CPD log without them.</Empty>
            : <LearningRefs refs={learning.refs} accent={x.accent} competencies certificates below={r => (
              <>
                {planLinks && <RecordGoalLink subject={{ learningRecordId: r.recordId }} served={servedBy.get(`rec:${r.recordId}`) ?? []} goals={goalChoices} accent={x.accent} idPrefix={`rec-${r.recordId}-g`} />}
                <LearningReflectionList items={reflectionsOf(`rec:${r.recordId}`)} />
                {canReflect && <ReflectOnLearning subject={{ learningRecordId: r.recordId }} templates={cfg.reflectionTemplates} accent={x.accent} />}
              </>
            )} />}
        </Section>
      )}

      <Section id="history-h" title="Learning history" note="Everything you learned, newest first, wherever it happened. It stays with you across jobs, professions and countries, and after any course access ends.">
        {cpd === null ? <Unreadable what="learning history" /> : timeline.length === 0 ? <Empty>Your learning history will appear here.</Empty> : (
          <ol className="divide-y divide-gray-100">
            {timeline.slice(0, 200).map(t => (
              <li key={t.key} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <p className="text-[13.5px] text-gray-900"><span className="font-semibold">{t.title}</span> <span className="text-gray-500">· {t.kind}</span></p>
                <p className="text-[12.5px] text-gray-600">{fmtDate(t.date)} · {t.source}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
