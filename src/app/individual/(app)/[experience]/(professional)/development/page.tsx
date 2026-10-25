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
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadNeedsWorkspace, ruleSuggestions, type NeedCompetencyLink } from "@/lib/individual/professional/needs-store";
import { evidenceByCompetency } from "@/lib/individual/professional/mapping-store";
import { loadProfessionalProfile } from "@/lib/individual/professional/profile-store";
import { publishedCatalogue, type CatalogueItem } from "@/lib/learning/catalogue";
import { NeedDetail, NeedFields, NeedRow, NeedsOverview, Reflections, Suggestions, VIEWS, inView, type CompetencyView, type View } from "../../../../_components/professional/needs-workspace";
import { loadPlanWorkspace } from "@/lib/individual/professional/plan-store";
import { matchCompetencies, planReminders } from "@/lib/individual/professional/plan-form";
import { GoalDetail, GoalFields, GoalRow, PLAN_VIEWS, PlanOverview, PlanReminders, inPlanView, type PlanSources, type PlanView } from "../../../../_components/professional/plan-workspace";

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

export default async function DevelopmentPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await experienceModulePage((await params).experience, "development");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  const [record, passport, frameworks, map, learning, ws, policy, profile, pw] = await Promise.all([
    loadProfessionalRecord(ctx.admin, ctx.userId),
    loadIndividualPassport(ctx.admin, ctx.userId, today),
    loadSharedFrameworks(ctx.admin),
    loadMappingView(ctx.admin, ctx.userId),
    loadProfessionalLearning(ctx.admin, ctx.userId),
    loadNeedsWorkspace(ctx.admin, ctx.userId),
    loadIndividualPolicy(ctx.admin),
    loadProfessionalProfile(ctx.admin, ctx.userId),
    loadPlanWorkspace(ctx.admin, ctx.userId),
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

  // COMPETEN-PROFESSIONAL-NEEDS-01 (Stage 2): with migration 470 applied, the needs section is the workspace below.
  // Before it, the MVP section renders exactly as it did.
  const sp = await searchParams;
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;
  const view = (VIEWS.some(([v]) => v === one(sp.view)) ? one(sp.view) : "all") as View;
  const np = policy.professionalNeeds;
  const stage2 = ws.provisioned && ws.needs !== null;
  const open = stage2 ? ws.needs!.find(n => n.id === one(sp.need)) ?? null : null;
  const linksOf = (needId: string) => (ws.competencies ?? []).filter(l => l.need_id === needId);
  const goalIdsOf = (needId: string) => new Set([...(goals ?? []).filter(g => g.need_id === needId).map(g => g.id), ...(ws.goalLinks ?? []).filter(l => l.need_id === needId).map(l => l.goal_id)]);
  const evidence = map.mappings ? evidenceByCompetency(map.mappings, record) : new Map<string, { evidence: number; positive: number }>();
  const competencyView = (l: NeedCompetencyLink): CompetencyView => {
    const c = map.catalogue?.find(cc => cc.competencyId === l.framework_competency_id);
    const decided = passport.competencies?.find(pc => pc.competencyId === l.framework_competency_id && pc.current);
    const ev = evidence.get(l.framework_competency_id)?.evidence ?? 0;
    const learned = learning.enabled && learning.refs ? learningForCompetencies(learning.refs, [l.framework_competency_id]).length : 0;
    const parts = [ev ? `${ev} evidence or CPD ${ev === 1 ? "record" : "records"}` : null, learned ? `${learned} completed learning` : null].filter(Boolean);
    return {
      link: l, name: c?.title ?? map.names.get(l.framework_competency_id) ?? "A competency no longer offered",
      expected: c?.expectedLevel?.label ?? null,
      observed: parts.length ? parts.join(", ") : "Nothing recorded",
      verified: decided ? `Assessed competent${decided.issuer ? ` by ${decided.issuer}` : ""}` : null,
    };
  };
  let learningItems: CatalogueItem[] | null = [];
  if (open && np.learning === "on" && learning.enabled) {
    const ids = linksOf(open.id).filter(l => !l.unlinked_at).map(l => l.framework_competency_id).slice(0, 3);
    const found = ids.length ? await Promise.all(ids.map(id => publishedCatalogue(ctx.admin, { competencyId: id }))) : [];
    learningItems = found.some(f => f === null) ? null : [...new Map(found.flat().filter((i): i is CatalogueItem => !!i).map(i => [i.offeringId, i])).values()];
  }
  const rules = stage2 && np.ruleSuggestions === "on"
    ? ruleSuggestions({ items: profile.items ?? [], needs: ws.needs!, decided: (ws.suggestions ?? []).filter(sg => sg.source === "rule"), today, windowDays: np.reviewDays })
    : [];
  const aiOpen = (ws.suggestions ?? []).filter(sg => sg.source === "ai" && sg.status === "suggested");

  // COMPETEN-PROFESSIONAL-PLAN-01 (Stage 3): with migration 480 applied, the learning plan is the plan workspace below.
  // Before it, the MVP plan renders exactly as it did.
  const pp = policy.professionalPlan;
  const stage3 = pw.provisioned && pw.goals !== null;
  const planView = (PLAN_VIEWS.some(([v]) => v === one(sp.plan)) ? one(sp.plan) : "open") as PlanView;
  const goal = stage3 ? pw.goals!.find(g => g.id === one(sp.goal)) ?? null : null;
  const needIdsOf = (goalId: string, legacy: string | null) => [...new Set([legacy, ...(ws.goalLinks ?? []).filter(l => l.goal_id === goalId).map(l => l.need_id)].filter(Boolean))] as string[];
  const activitiesOf = (goalId: string) => (pw.activityGoals ?? []).filter(l => l.goal_id === goalId).sort((a, b) => a.position - b.position)
    .map(l => (pw.activities ?? []).find(a => a.id === l.activity_id)).filter((a): a is NonNullable<typeof a> => !!a);
  const planSources: PlanSources = {
    cpd: record.cpd?.map(c => ({ id: c.id, title: c.title, activity_date: c.activity_date, evidence_class: c.evidence_class })) ?? null,
    learning: { enabled: learning.enabled, refs: learning.refs?.map(r => ({ recordId: r.recordId, title: r.title, completedOn: r.completedOn, evidenceLabel: r.evidenceLabel })) ?? null },
    evidenceItems: record.evidence?.map(e => ({ id: e.id, title: e.title, evidence_class: e.evidence_class })) ?? null,
    reflections: ws.reflections?.map(r => ({ id: r.id, created_at: r.created_at, template_label: r.template_label })) ?? null,
    needs: (stage2 ? ws.needs ?? [] : needs ?? []).map(n => ({ id: n.id, title: n.title })),
    offered: map.catalogue, names: map.names,
  };
  let goalLearning: CatalogueItem[] | null = [];
  if (goal && pp.learning !== "off" && learning.enabled) {
    const ids = (pw.competencies ?? []).filter(l => l.goal_id === goal.id && !l.unlinked_at).map(l => l.framework_competency_id).slice(0, 3);
    const word = pp.learning === "search" ? [...goal.title.toLowerCase().matchAll(/[a-z0-9]{4,}/g)].map(m => m[0]).sort((a, b) => b.length - a.length)[0] : undefined;
    const found = await Promise.all([...ids.map(id => publishedCatalogue(ctx.admin, { competencyId: id })), ...(word ? [publishedCatalogue(ctx.admin, { q: word })] : [])]);
    goalLearning = found.some(f => f === null) ? null : [...new Map(found.flat().filter((i): i is CatalogueItem => !!i).map(i => [i.offeringId, i])).values()];
  }
  const reminders = stage3 ? planReminders({ goals: pw.goals!, milestones: pw.milestones ?? [], today, leadDays: pp.reminderDays, reviewDays: pp.reviewDays }) : [];
  const aspirations = (profile.items ?? []).filter(i => i.section === "aspiration" && !i.superseded_at && !i.withdrawn_at).map(i => ({ id: i.id, title: i.title }));

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your development" title="Needs & plan"
        intro="Name what you want to develop, then plan how. Your needs and goals are private to you." />
      {!record.provisioned && <NotProvisioned />}

      {stage2 && (
        <>
          {open && (
            <NeedDetail n={open} policy={np} accent={x.accent} today={today}
              history={(ws.history ?? []).filter(h => h.need_id === open.id)}
              competencies={linksOf(open.id).filter(l => !l.unlinked_at).map(competencyView)}
              formerCompetencies={linksOf(open.id).filter(l => l.unlinked_at).map(competencyView)}
              offered={map.catalogue}
              goals={(goals ?? []).filter(g => goalIdsOf(open.id).has(g.id)).map(g => ({ id: g.id, title: g.title, status: g.status, viaJoin: g.need_id !== open.id }))}
              otherGoals={(goals ?? []).filter(g => !goalIdsOf(open.id).has(g.id)).map(g => ({ id: g.id, title: g.title }))}
              reflection={open.reflection_id ? (ws.reflections ?? []).find(r => r.id === open.reflection_id) ?? null : null}
              learning={{ enabled: learning.enabled, items: learningItems }} stage3={stage3} />
          )}
          <Section id="needs-h" title="My development needs" note="What you want to develop, in your own words. A need is never a judgement about your competence, and it is private to you.">
            <NeedsOverview needs={ws.needs!} view={view} today={today} policy={np} accent={x.accent} />
            {ws.needs!.filter(n => inView(n, view, today, np.reviewDays)).length === 0
              ? <Empty>{ws.needs!.length === 0 ? "No development needs yet. Add your first one below: a short description is enough." : "Nothing in this view."}</Empty>
              : (
                <ul className="divide-y divide-gray-100">
                  {ws.needs!.filter(n => inView(n, view, today, np.reviewDays)).map(n => (
                    <NeedRow key={n.id} n={n} today={today} policy={np} accent={x.accent} competencies={linksOf(n.id).filter(l => !l.unlinked_at).length} goals={goalIdsOf(n.id).size} />
                  ))}
                </ul>
              )}
            <AddPanel label="Add a development need" accent={x.accent} suggestOpen={ws.needs!.length === 0}>
              <ApiForm action="/api/individual/professional/needs" submitLabel="Save need" accent={x.accent} savedText="Saved. Add more detail whenever you like.">
                <NeedFields policy={np} idPrefix="new-need" />
              </ApiForm>
            </AddPanel>
          </Section>
          {(np.ruleSuggestions === "on" || np.aiSuggestions === "on") && (
            <Section title="Suggested development needs" note="From your own profile and record. You decide.">
              <Suggestions rules={rules} ai={aiOpen} policy={np} accent={x.accent} />
            </Section>
          )}
          {np.fields.includes("reflection") && (
            <Section title="Private reflections" note="Think something through, then turn it into a need if you want to.">
              <Reflections reflections={ws.reflections} policy={np} accent={x.accent} />
            </Section>
          )}
        </>
      )}

      {!stage2 && <Section id="needs-h" title="Development needs" note="What you want to develop. Each one is recorded by you.">
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
      </Section>}

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

      {stage3 && goal && (
        <GoalDetail g={goal} policy={pp} accent={x.accent} today={today}
          history={(pw.history ?? []).filter(h => h.goal_id === goal.id)}
          activities={activitiesOf(goal.id)} allActivities={pw.activities ?? []} activityGoals={pw.activityGoals ?? []}
          milestones={(pw.milestones ?? []).filter(m => m.goal_id === goal.id)}
          competencies={pw.competencies ?? []} evidence={pw.evidence ?? []} reviews={(pw.reviews ?? []).filter(r => r.goal_id === goal.id)}
          linkedNeeds={needIdsOf(goal.id, goal.need_id).map(id => ({ id, title: needTitle.get(id) ?? (ws.needs ?? []).find(n => n.id === id)?.title ?? "A development need", viaJoin: id !== goal.need_id }))}
          sources={planSources} suggestedCompetencies={pp.competencyLinks === "offered" ? matchCompetencies(`${goal.title} ${goal.intended_outcome ?? ""}`, map.catalogue ?? []) : []}
          learningItems={goalLearning} />
      )}

      {stage3 && (
        <Section id="plan-h" title="My development plan" note="Your goals, and how you plan to reach them. Private to you: never shared, never sent to an employer, never added to your Passport.">
          <PlanReminders reminders={reminders} />
          <PlanOverview goals={pw.goals!} view={planView} accent={x.accent} />
          {pw.goals!.filter(g => inPlanView(g, planView)).length === 0
            ? <Empty>{pw.goals!.length === 0 ? "No goals yet. Add your first one below: a short description is enough." : "Nothing in this view."}</Empty>
            : (
              <ul className="divide-y divide-gray-100">
                {pw.goals!.filter(g => inPlanView(g, planView)).map(g => (
                  <GoalRow key={g.id} g={g} accent={x.accent} activities={activitiesOf(g.id).length}
                    needs={needIdsOf(g.id, g.need_id).map(id => needTitle.get(id) ?? (ws.needs ?? []).find(n => n.id === id)?.title).filter((t): t is string => !!t)} />
                ))}
              </ul>
            )}
          <AddPanel label="Add a goal" accent={x.accent} suggestOpen={pw.goals!.length === 0 && planSources.needs.length > 0}>
            <ApiForm action="/api/individual/professional/goals" submitLabel="Save goal" accent={x.accent} savedText="Saved. Add activities, dates or evidence whenever you like.">
              <GoalFields policy={pp} idPrefix="new-goal" sources={{
                needs: planSources.needs, aspirations,
                reflections: (ws.reflections ?? []).map(r => ({ id: r.id, label: `${fmtDate(r.created_at)}${r.template_label ? ` · ${r.template_label}` : ""}` })),
                competencies: (map.catalogue ?? []).map(c => ({ id: c.competencyId, label: `${c.title} · ${c.catalogue.name}` })),
              }} />
            </ApiForm>
          </AddPanel>
        </Section>
      )}

      {!stage3 && <Section id="plan-h" title="Learning plan" note="Goals with target dates. Link a goal to the need it serves.">
        {goals === null ? <Unreadable what="learning plan" /> : goals.length === 0 ? <Empty>No goals yet. {openNeeds.length ? "Add a goal for one of your needs below." : "Add a need first, or a goal on its own."}</Empty> : (
          <>
            {plan && <p className="mb-2 text-[13px] text-gray-600">{plan.done} of {plan.total - plan.dropped} goals done{plan.overdue ? ` · ${plan.overdue} past their target date` : ""}.</p>}
            <ul className="divide-y divide-gray-100">
              {goals.map(g => {
                const overdue = (g.status === "planned" || g.status === "in_progress") && !!g.target_date && g.target_date < today;
                return (
                  <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{g.title}</p>
                      <p className="text-[12.5px] text-gray-500">
                        {GOAL_STATUS_LABEL[g.status] ?? g.status} · {g.target_date ? `target ${fmtDate(g.target_date)}` : "no target date"}
                        {overdue && <span className="font-semibold text-amber-800"> · past target date</span>}
                        {(() => {
                          const ids = [...new Set([g.need_id, ...(ws.goalLinks ?? []).filter(l => l.goal_id === g.id).map(l => l.need_id)].filter(Boolean))] as string[];
                          const t = ids.map(i => needTitle.get(i)).filter(Boolean);
                          return t.length ? ` · for: ${t.join("; ")}` : "";
                        })()}
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
      </Section>}

      <Section title="Plan with your personal AI" note="Suggestions from your own needs, goals and CPD. Advisory, and not saved.">
        <AssistPanel accent={x.accent} />
      </Section>
    </>
  );
}
