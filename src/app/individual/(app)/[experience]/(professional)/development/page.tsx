import { EXPERIENCES } from "@/lib/individual/experiences";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { loadSharedFrameworks, referenceNames } from "@/lib/individual/professional/frameworks";
import { GOAL_STATUS, GOAL_STATUS_LABEL, NEED_ORIGIN_LABEL, NEED_STATUS_LABEL } from "@/lib/individual/professional/vocabulary";
import { planProgress } from "@/lib/individual/professional/progress";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable } from "../../../../_components/chrome";
import { AddPanel, ApiButton, ApiForm, Field, inputCls } from "../../../../_components/professional/forms";
import FrameworkPicker from "../../../../_components/professional/FrameworkPicker";
import AssistPanel from "../../../../_components/professional/AssistPanel";
import CompetencyLinks from "../../../../_components/professional/CompetencyLinks";
import { GoalEdit, NeedEdit } from "../../../../_components/professional/edit-forms";
import { linksFor, loadMappingView } from "@/lib/individual/professional/mapping-store";
import { Empty, NotProvisioned, Section, fmtDate } from "../../../../_components/professional/bits";
import { loadProfessionalLearning } from "@/lib/individual/professional/learning";
import { learningForCompetencies } from "@/lib/learning/products";
import { LearningServes } from "../../../../_components/professional/LearningRefs";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// DEVELOPMENT NEEDS AND THE LEARNING PLAN -- COMPETEN-IND-007 s2 and s3.
//
// Needs are the person's own, optionally against a SHARED framework competency. The page also offers the
// assessed competencies in their Passport that are not current (expired, or not yet competent) as needs
// they may choose to record -- the person decides; nothing is added for them. Goals have target dates and
// may serve a need. The personal AI can suggest a plan; it saves nothing.
//
// ⚠ LEARNING THAT SERVES A NEED IS SHOWN, NEVER APPLIED (COMPETEN-LEARNING-01 H1). Under a need with a framework
// competency, or a goal with accepted competency links (393), completed Competen Learning that shares one is listed, with
// "Find learning". Computed on read, nothing linked or stored, and a need is never marked met by it.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Needs & plan" }); }

export default async function DevelopmentPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "development");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  const [record, passport, frameworks, map, learning] = await Promise.all([
    loadProfessionalRecord(ctx.admin, ctx.userId),
    loadIndividualPassport(ctx.admin, ctx.userId, today),
    loadSharedFrameworks(ctx.admin),
    loadMappingView(ctx.admin, ctx.userId),
    loadProfessionalLearning(ctx.admin, ctx.userId),
  ]);
  // Learning on and readable: the serving list. Off or unreadable: nothing extra renders.
  const serves = (competencies: { id: string; name: string }[]) => learning.enabled && learning.refs !== null && competencies.length > 0
    ? <LearningServes matches={learningForCompetencies(learning.refs, competencies.map(c => c.id))} competencies={competencies} accent={x.accent} /> : null;
  const needs = record.needs;
  const goals = record.goals;
  const names = needs ? await referenceNames(ctx.admin,
    [...new Set(needs.map(n => n.framework_id).filter((v): v is string => !!v))],
    [...new Set(needs.map(n => n.framework_competency_id).filter((v): v is string => !!v))]) : new Map<string, string>();

  // Passport gaps the person has not already recorded as a need, by title.
  const recorded = new Set((needs ?? []).map(n => n.title.toLowerCase()));
  const gaps = (passport.competencies ?? []).filter(c => !c.current && !recorded.has(c.name.toLowerCase())).slice(0, 8);
  const openNeeds = (needs ?? []).filter(n => n.status === "open");
  const plan = goals ? planProgress(goals, today) : null;
  const needTitle = new Map((needs ?? []).map(n => [n.id, n.title]));

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your development" title="Needs & plan"
        intro="Name what you want to develop, then plan how. Your needs and goals are private to you." />
      {!record.provisioned && <NotProvisioned />}

      <Section id="needs-h" title="Development needs" note="What you want to develop. Each one is recorded by you.">
        {needs === null ? <Unreadable what="development needs" /> : needs.length === 0 ? <Empty>No development needs yet. Add your first one below.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {needs.map(n => (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold text-gray-900">{n.title}</p>
                  <p className="text-[12.5px] text-gray-500">
                    {NEED_ORIGIN_LABEL[n.origin] ?? n.origin} · {NEED_STATUS_LABEL[n.status] ?? n.status}
                    {n.framework_competency_id && names.get(n.framework_competency_id) ? ` · ${names.get(n.framework_competency_id)}` : ""}
                    {n.framework_id && names.get(n.framework_id) ? ` (${names.get(n.framework_id)})` : ""}
                  </p>
                  {n.detail && <p className="mt-1 text-[13.5px] text-gray-700">{n.detail}</p>}
                  {n.framework_competency_id && serves([{ id: n.framework_competency_id, name: names.get(n.framework_competency_id) ?? "this competency" }])}
                  <NeedEdit n={n} accent={x.accent} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {n.status === "open"
                    ? <ApiButton action="/api/individual/professional/needs" method="PATCH" body={{ id: n.id, status: "met" }} label="Mark met" />
                    : <ApiButton action="/api/individual/professional/needs" method="PATCH" body={{ id: n.id, status: "open" }} label="Reopen" />}
                  {n.status === "open" && <ApiButton action="/api/individual/professional/needs" method="PATCH" body={{ id: n.id, status: "closed" }} label="Set aside" />}
                  <ApiButton action={`/api/individual/professional/needs?id=${n.id}`} method="DELETE" label="Remove" confirm="Remove this need? Goals and evidence linked to it are kept, without the link." />
                </div>
              </li>
            ))}
          </ul>
        )}

        {needs !== null && record.provisioned && (
          <AddPanel label="Add a development need" accent={x.accent} suggestOpen={needs.length === 0}>
            <ApiForm action="/api/individual/professional/needs" submitLabel="Add need" accent={x.accent} savedText="Need added.">
              <Field label="What do you want to develop?" htmlFor="need-title"><input id="need-title" name="title" required minLength={3} maxLength={200} className={inputCls} placeholder="e.g. Confidence leading a resuscitation" /></Field>
              <Field label="Why, or what good looks like (optional)" htmlFor="need-detail"><textarea id="need-detail" name="detail" rows={3} maxLength={2000} className={inputCls} /></Field>
              <FrameworkPicker idPrefix="need" frameworks={frameworks?.map(f => ({ id: f.id, name: f.name })) ?? null} />
            </ApiForm>
          </AddPanel>
        )}
      </Section>

      {passport.competencies !== null && gaps.length > 0 && needs !== null && record.provisioned && (
        <Section title="From your Passport" note="Assessed competencies an organisation recorded for you that are not current. Add any you want to work on.">
          <ul className="divide-y divide-gray-100">
            {gaps.map(g => (
              <li key={g.competencyId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-gray-900">{g.name}</p>
                  <p className="text-[12.5px] text-gray-500">{g.outcome.replace(/_/g, " ")}{g.expiryDate ? ` · expiry ${fmtDate(g.expiryDate)}` : ""}{g.issuer ? ` · issued by ${g.issuer}` : ""}</p>
                </div>
                <ApiForm action="/api/individual/professional/needs" submitLabel="Add as a need" accent={x.accent} savedText="Added.">
                  <input type="hidden" name="title" value={g.name} />
                  <input type="hidden" name="origin" value="passport_gap" />
                </ApiForm>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="plan-h" title="Learning plan" note="Goals with target dates. Link a goal to the need it serves.">
        {goals === null ? <Unreadable what="learning plan" /> : goals.length === 0 ? <Empty>No goals yet. {openNeeds.length ? "Add a goal for one of your needs below." : "Add a need first, or a goal on its own."}</Empty> : (
          <>
            {plan && <p className="mb-2 text-[13px] text-gray-600">{plan.done} of {plan.total - plan.dropped} goals done{plan.overdue ? ` · ${plan.overdue} past their target date` : ""}.</p>}
            <ul className="divide-y divide-gray-100">
              {goals.map(g => {
                const overdue = (g.status === "planned" || g.status === "in_progress") && g.target_date < today;
                return (
                  <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{g.title}</p>
                      <p className="text-[12.5px] text-gray-500">
                        {GOAL_STATUS_LABEL[g.status] ?? g.status} · target {fmtDate(g.target_date)}
                        {overdue && <span className="font-semibold text-amber-800"> · past target date</span>}
                        {g.need_id && needTitle.get(g.need_id) ? ` · for: ${needTitle.get(g.need_id)}` : ""}
                      </p>
                      {g.detail && <p className="mt-1 text-[13.5px] text-gray-700">{g.detail}</p>}
                      <GoalEdit g={g} needs={(needs ?? []).map(n => ({ id: n.id, title: n.title }))} accent={x.accent} />
                      {map.mappings === null ? <p className="mt-2 text-[12.5px] text-gray-600">Competency links could not be read just now.</p> : map.provisioned && (
                        <CompetencyLinks kind="goal" subjectId={g.id} links={linksFor(map, "goal", g.id)} offered={map.offered} accent={x.accent} idPrefix={`goal-${g.id}`} />
                      )}
                      {serves(linksFor(map, "goal", g.id).filter(l => l.state === "accepted").map(l => ({ id: l.competencyId, name: l.title })))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {GOAL_STATUS.filter(([s]) => s !== g.status).map(([s, label]) => (
                        <ApiButton key={s} action="/api/individual/professional/goals" method="PATCH" body={{ id: g.id, status: s }} label={label} />
                      ))}
                      <ApiButton action={`/api/individual/professional/goals?id=${g.id}`} method="DELETE" label="Remove" confirm="Remove this goal? CPD entries linked to it are kept, without the link." />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {goals !== null && record.provisioned && (
          <AddPanel label="Add a goal" accent={x.accent} suggestOpen={goals.length === 0 && (needs?.length ?? 0) > 0}>
              <ApiForm action="/api/individual/professional/goals" submitLabel="Add goal" accent={x.accent} savedText="Goal added.">
                <Field label="Goal" htmlFor="goal-title"><input id="goal-title" name="title" required minLength={3} maxLength={200} className={inputCls} placeholder="e.g. Complete an ALS course" /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Target date" htmlFor="goal-date"><input id="goal-date" name="targetDate" type="date" required className={inputCls} /></Field>
                  <Field label="Need it serves (optional)" htmlFor="goal-need">
                    <select id="goal-need" name="needId" className={inputCls} defaultValue="">
                      <option value="">Not linked to a need</option>
                      {openNeeds.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="How you will do it (optional)" htmlFor="goal-detail"><textarea id="goal-detail" name="detail" rows={3} maxLength={2000} className={inputCls} /></Field>
              </ApiForm>
          </AddPanel>
        )}
      </Section>

      <Section title="Plan with your personal AI" note="Suggestions from your own needs, goals and CPD. Advisory, and not saved.">
        <AssistPanel accent={x.accent} />
      </Section>
    </>
  );
}
