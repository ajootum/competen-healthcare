import Link from "next/link";
import type { ProfessionalPlanPolicy } from "@/lib/individual/policy";
import type { CatalogueCompetency } from "@/lib/individual/catalogue";
import type { CatalogueItem } from "@/lib/learning/catalogue";
import { findLearningHref } from "@/lib/individual/professional/learning";
import { experienceHref } from "@/lib/individual/experiences";
import { milestoneIdeas, templatePrompts, type PlanReminder } from "@/lib/individual/professional/plan-form";
import {
  ACTIVITY_STATUS_TEXT, EVIDENCE_CLASS_TEXT, GOAL_FIELD_LABEL, GOAL_SOURCE_LABEL, GOAL_STATUS_TEXT, REVIEW_DECISIONS, REVIEW_DECISION_LABEL,
  REVIEW_FIELD_LABEL, goalOpen, type ActivityStatus, type GoalStatus,
} from "@/lib/individual/professional/plan-vocabulary";
import type {
  ActivityGoalLink, GoalEvidenceLink, GoalHistoryRow, GoalReview, Milestone, PlanActivity, PlanCompetencyLink, PlanGoal,
} from "@/lib/individual/professional/plan-store";
import { Empty, fmtDate } from "./bits";
import { AddPanel, ApiButton, ApiForm, Field, inputCls } from "./forms";
import PlanAssist from "./PlanAssist";

// MY DEVELOPMENT PLAN -- COMPETEN-PROFESSIONAL-PLAN-01 (Professional Stage 3), P1 to P6.
//
// Server-rendered pieces of the plan inside Needs & plan. No new navigation: the overview, the filters and a goal's
// detail are views of the same page (?plan=, ?goal=). Need, goal, activities, learning, evidence and review can be
// entered in any order, and every part except the goal's description is optional.
//
// ⚠ WHAT THE PLAN NEVER SAYS. Completing an activity does not achieve a goal. Addressing a goal is the person's own
// judgement and does not verify competence. Evidence keeps the class its source record has (self-reported,
// document-supported, verified). Plans, goals, reviews and reflections are private: nothing here is shared, sent to an
// employer or added to the Passport.

export const PLAN_VIEWS = [["open", "Open"], ["deferred", "Deferred"], ["closed", "Addressed and retired"], ["all", "All"]] as const;
export type PlanView = (typeof PLAN_VIEWS)[number][0];
export const inPlanView = (g: PlanGoal, v: PlanView) =>
  v === "all" ? true : v === "open" ? goalOpen(g.status) : v === "deferred" ? g.status === "deferred" : g.status === "done" || g.status === "dropped";

const dateIn = (id: string, name: string, label: string, value?: string | null) => (
  <Field label={`${label} (optional)`} htmlFor={id}><input id={id} name={name} type="date" defaultValue={value ? value.slice(0, 10) : ""} className={inputCls} /></Field>
);
const optSelect = (id: string, name: string, label: string, opts: { code: string; label: string }[], value: string | null | undefined, none = "Not now") => (
  <Field label={`${label} (optional)`} htmlFor={id}>
    <select id={id} name={name} defaultValue={value ?? ""} className={inputCls}>
      <option value="">{none}</option>
      {opts.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
    </select>
  </Field>
);

// ── The goal form (P1): one required field, the rest configured and optional ─────────────────────────────────

export function GoalFields({ policy, g, idPrefix, sources }: {
  policy: ProfessionalPlanPolicy; g?: PlanGoal; idPrefix: string;
  sources?: { needs: { id: string; title: string }[]; aspirations: { id: string; title: string }[]; reflections: { id: string; label: string }[]; competencies: { id: string; label: string }[]; needId?: string | null };
}) {
  const id = (f: string) => `${idPrefix}-${f}`;
  const has = (f: (typeof policy.fields)[number]) => policy.fields.includes(f);
  return (
    <>
      <input type="hidden" name="stage3" value="true" />
      <Field label="What do you want to achieve?" htmlFor={id("title")} hint="In your own words. This is the only thing you need to fill in.">
        <input id={id("title")} name="title" required minLength={3} maxLength={200} defaultValue={g?.title ?? ""} className={inputCls} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {policy.fields.map(f => {
          if (f === "type" && policy.goalTypes.length) return <div key={f}>{optSelect(id("type"), "type", GOAL_FIELD_LABEL.type, policy.goalTypes, g?.goal_type_code)}</div>;
          if (f === "priority" && policy.priorities.length) return <div key={f}>{optSelect(id("priority"), "priority", GOAL_FIELD_LABEL.priority, policy.priorities, g?.priority_code)}</div>;
          if (f === "motivation") return <div key={f} className="sm:col-span-2"><Field label={`${GOAL_FIELD_LABEL.motivation} (optional)`} htmlFor={id("motivation")}><textarea id={id("motivation")} name="motivation" rows={2} maxLength={1000} defaultValue={g?.motivation ?? ""} className={inputCls} /></Field></div>;
          if (f === "outcome") return <div key={f} className="sm:col-span-2"><Field label={`${GOAL_FIELD_LABEL.outcome} (optional)`} htmlFor={id("outcome")} hint="What will be different when you get there?"><textarea id={id("outcome")} name="outcome" rows={2} maxLength={2000} defaultValue={g?.intended_outcome ?? ""} className={inputCls} /></Field></div>;
          if (f === "evidence") return (
            <div key={f} className="sm:col-span-2">
              <Field label={`${GOAL_FIELD_LABEL.evidence} (optional)`} htmlFor={id("evidence")} hint={policy.evidenceKinds.length ? `For example: ${policy.evidenceKinds.map(k => k.label.toLowerCase()).join("; ")}.` : undefined}>
                <textarea id={id("evidence")} name="expectedEvidence" rows={2} maxLength={2000} defaultValue={g?.expected_evidence ?? ""} className={inputCls} />
              </Field>
            </div>
          );
          if (f === "dates") return (
            <div key={f} className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
              {dateIn(id("start"), "startDate", "Start", g?.start_date)}
              {dateIn(id("target"), "targetDate", "Target", g?.target_date)}
              {dateIn(id("review"), "reviewDate", "Review", g?.review_date)}
            </div>
          );
          if (f === "needs" && !g && sources?.needs.length) return (
            <Field key={f} label={`${GOAL_FIELD_LABEL.needs} (optional)`} htmlFor={id("need")}>
              <select id={id("need")} name="needId" defaultValue={sources.needId ?? ""} className={inputCls}>
                <option value="">Not linked to a need</option>
                {sources.needs.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
              </select>
            </Field>
          );
          if (f === "competencies" && !g && policy.competencyLinks === "offered" && sources?.competencies.length) return (
            <Field key={f} label="Start from a competency (optional)" htmlFor={id("comp")}>
              <select id={id("comp")} name="competencyId" defaultValue="" className={inputCls}>
                <option value="">None</option>
                {sources.competencies.slice(0, 400).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
          );
          return null;
        })}
        {!g && sources && sources.aspirations.length > 0 && (
          <Field label="From a career aspiration (optional)" htmlFor={id("asp")}>
            <select id={id("asp")} name="aspirationItemId" defaultValue="" className={inputCls}>
              <option value="">None</option>
              {sources.aspirations.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          </Field>
        )}
        {!g && sources && sources.reflections.length > 0 && (
          <Field label="From one of your reflections (optional)" htmlFor={id("ref")} hint="The reflection stays private. Its words are not copied.">
            <select id={id("ref")} name="reflectionId" defaultValue="" className={inputCls}>
              <option value="">None</option>
              {sources.reflections.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
        )}
        {!g && (
          <label className="flex items-start gap-2 self-end text-[13px] text-gray-700">
            <input type="checkbox" name="createdFrom" value="evaluation" className="mt-1 h-4 w-4" />
            <span>This came from an evaluation or assessment</span>
          </label>
        )}
      </div>
      {g && <Field label="Notes (optional)" htmlFor={id("detail")}><textarea id={id("detail")} name="detail" rows={3} maxLength={2000} defaultValue={g.detail ?? ""} className={inputCls} /></Field>}
      {!has("dates") && !g && <p className="text-[12px] text-gray-500">No dates are needed. Add them later if you want reminders.</p>}
    </>
  );
}

// ── The list and reminders (P4) ────────────────────────────────────────────────────────────────────────────

export function PlanOverview({ goals, view, accent }: { goals: PlanGoal[]; view: PlanView; accent: string }) {
  return (
    <nav aria-label="Filter goals" className="mb-3 flex flex-wrap gap-2">
      {PLAN_VIEWS.map(([v, label]) => (
        <Link key={v} href={`?plan=${v}#plan-h`} aria-current={view === v ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${view === v ? "text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
          style={view === v ? { background: accent, borderColor: accent } : undefined}>
          {label} <span className="font-normal">({goals.filter(g => inPlanView(g, v)).length})</span>
        </Link>
      ))}
    </nav>
  );
}

export function PlanReminders({ reminders }: { reminders: PlanReminder[] }) {
  if (!reminders.length) return null;
  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3" role="note">
      <p className="text-[12.5px] font-bold text-amber-900">Coming up in your plan</p>
      <ul className="mt-1 space-y-0.5 text-[13px] text-amber-900">
        {reminders.slice(0, 8).map((r, i) => <li key={i}><Link href={`?goal=${r.goalId}#goal-detail`} className="underline underline-offset-2">{r.text}</Link> · {fmtDate(r.on)}</li>)}
      </ul>
    </div>
  );
}

export function GoalRow({ g, accent, activities, needs }: { g: PlanGoal; accent: string; activities: number; needs: string[] }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link href={`?goal=${g.id}#goal-detail`} className="text-[14.5px] font-semibold text-gray-900 underline-offset-2 hover:underline">{g.title}</Link>
        <p className="text-[12.5px] text-gray-500">
          {GOAL_STATUS_TEXT[g.status] ?? g.status}{g.priority_label ? ` · ${g.priority_label} priority` : ""}{g.goal_type_label ? ` · ${g.goal_type_label}` : ""}
          {g.target_date ? ` · target ${fmtDate(g.target_date)}` : ""}{activities ? ` · ${activities} ${activities === 1 ? "activity" : "activities"}` : ""}
          {needs.length ? ` · for: ${needs.join("; ")}` : ""}
        </p>
      </div>
      <Link href={`?goal=${g.id}#goal-detail`} className="text-[13px] font-semibold" style={{ color: accent }}>Open →</Link>
    </li>
  );
}

// ── The goal in detail (P1 to P6) ──────────────────────────────────────────────────────────────────────────

export type PlanSources = {
  cpd: { id: string; title: string; activity_date: string; evidence_class: string | null }[] | null;
  learning: { enabled: boolean; refs: { recordId: string; title: string; completedOn: string; evidenceLabel: string }[] | null };
  evidenceItems: { id: string; title: string; evidence_class: string | null }[] | null;
  reflections: { id: string; created_at: string; template_label: string | null }[] | null;
  needs: { id: string; title: string }[];
  offered: CatalogueCompetency[] | null;
  names: Map<string, string>;
};

export function GoalDetail(p: {
  g: PlanGoal; policy: ProfessionalPlanPolicy; accent: string; today: string;
  history: GoalHistoryRow[]; activities: PlanActivity[]; allActivities: PlanActivity[]; activityGoals: ActivityGoalLink[]; milestones: Milestone[];
  competencies: PlanCompetencyLink[]; evidence: GoalEvidenceLink[]; reviews: GoalReview[]; linkedNeeds: { id: string; title: string; viaJoin: boolean }[];
  sources: PlanSources; suggestedCompetencies: CatalogueCompetency[]; learningItems: CatalogueItem[] | null;
}) {
  const { g, policy, accent, sources } = p;
  const closed = g.status === "done" || g.status === "dropped";
  const statuses = policy.goalStatuses.filter(s => s !== g.status && !(policy.reopen === "off" && closed && goalOpen(s)));
  const open = (l: { unlinked_at: string | null }) => !l.unlinked_at;
  const goalComps = p.competencies.filter(l => l.goal_id === g.id);
  const linkedCompIds = new Set(goalComps.filter(open).map(l => l.framework_competency_id));
  const usedCpd = new Set(p.allActivities.map(a => a.cpd_id).filter(Boolean));
  const usedRecord = new Set(p.allActivities.map(a => a.learning_record_id).filter(Boolean));
  const cpdOf = (id: string | null) => (id ? sources.cpd?.find(c => c.id === id) ?? null : null);
  const recOf = (id: string | null) => (id ? sources.learning.refs?.find(r => r.recordId === id) ?? null : null);
  const compName = (id: string) => sources.offered?.find(c => c.competencyId === id)?.title ?? sources.names.get(id) ?? "A competency no longer offered";
  const otherActivities = p.allActivities.filter(a => !p.activities.some(x => x.id === a.id));
  const ideas = milestoneIdeas(g).filter(i => !p.milestones.some(m => m.title === i.title));
  const fromRecords = p.activities.flatMap(a => {
    const c = cpdOf(a.cpd_id), r = recOf(a.learning_record_id);
    return [
      ...(c ? [{ key: `c${c.id}`, what: `CPD entry: ${c.title}`, when: c.activity_date, cls: EVIDENCE_CLASS_TEXT[c.evidence_class ?? "self_declared"] ?? "Self-reported" }] : []),
      ...(r ? [{ key: `r${r.recordId}`, what: `Learning completed: ${r.title}`, when: r.completedOn, cls: r.evidenceLabel }] : []),
    ];
  });
  const evLinks = p.evidence.filter(e => e.goal_id === g.id);

  return (
    <section id="goal-detail" aria-labelledby="goal-detail-h" className="mb-5 rounded-2xl border-2 bg-white p-5 sm:p-6" style={{ borderColor: accent }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Development goal · private to you</p>
          <h2 id="goal-detail-h" className="text-[18px] font-bold text-gray-900">{g.title}</h2>
          <p className="text-[12.5px] text-gray-600">{GOAL_STATUS_TEXT[g.status] ?? g.status} · {GOAL_SOURCE_LABEL[g.created_from] ?? g.created_from} · recorded {fmtDate(g.created_at)}</p>
        </div>
        <Link href="?#plan-h" className="text-[13px] font-semibold text-gray-700 underline">Close</Link>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-2">
        {([["Type", g.goal_type_label], ["Priority", g.priority_label], ["Why it matters", g.motivation], ["Intended outcome", g.intended_outcome],
          ["Evidence you expect", g.expected_evidence], ["Start", fmtDate(g.start_date)], ["Target", fmtDate(g.target_date)], ["Review", fmtDate(g.review_date)], ["Notes", g.detail]] as const)
          .map(([k, v]) => <div key={k}><dt className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{k}</dt><dd className="whitespace-pre-wrap text-gray-900">{v ?? <span className="text-gray-500">Not recorded</span>}</dd></div>)}
      </dl>
      {g.template_label && g.template_answers && (
        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[13px]">
          <p className="font-semibold text-gray-800">Planned with {g.template_label}</p>
          <dl className="mt-1 grid gap-1">{Object.entries(g.template_answers).map(([q, a]) => <div key={q}><dt className="inline font-semibold text-gray-700">{q}: </dt><dd className="inline text-gray-800">{a}</dd></div>)}</dl>
        </div>
      )}

      <div className="mt-4">
        <p className="text-[12.5px] font-semibold text-gray-700">Status (any order)</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {statuses.map(s => <ApiButton key={s} action="/api/individual/professional/goals" method="PATCH" body={{ id: g.id, status: s, stage3: "true" }} label={GOAL_STATUS_TEXT[s as GoalStatus]} />)}
        </div>
        <p className="mt-1 text-[12px] text-gray-500">Addressed is your own judgement. It does not verify competence, and completing activities does not decide it for you.</p>
      </div>

      <AddPanel label="Revise this goal" accent={accent} suggestOpen={false}>
        <ApiForm action={`/api/individual/professional/goals?id=${g.id}`} method="PUT" submitLabel="Save changes" accent={accent} reset={false} savedText="Saved. The earlier version is kept in its history.">
          <GoalFields policy={policy} g={g} idPrefix={`edit-${g.id}`} />
        </ApiForm>
      </AddPanel>

      {policy.fields.includes("template") && policy.templates.length > 0 && (
        <AddPanel label={g.template_label ? `Revise your ${g.template_label} plan` : "Plan it with a template (optional)"} accent={accent} suggestOpen={false}>
          <div className="space-y-4">
            {policy.templates.map(t => {
              const { name, prompts } = templatePrompts(t.label);
              return (
                <details key={t.code} className="rounded-xl border border-gray-200 p-3">
                  <summary className="cursor-pointer text-[13px] font-semibold text-gray-800">{name}</summary>
                  <div className="mt-2">
                    <ApiForm action={`/api/individual/professional/goals?id=${g.id}`} method="PUT" submitLabel={`Save ${name}`} accent={accent} reset={false} savedText="Saved.">
                      <input type="hidden" name="stage3" value="true" />
                      <input type="hidden" name="template" value={t.code} />
                      {prompts.map((q, i) => (
                        <Field key={q} label={`${q} (optional)`} htmlFor={`tpl-${g.id}-${t.code}-${i}`}>
                          <input id={`tpl-${g.id}-${t.code}-${i}`} name={`answer${i}`} maxLength={600} defaultValue={g.template_code === t.code ? g.template_answers?.[q] ?? "" : ""} className={inputCls} />
                        </Field>
                      ))}
                    </ApiForm>
                  </div>
                </details>
              );
            })}
          </div>
        </AddPanel>
      )}

      {/* Needs (P3: many to many) */}
      <div className="mt-5">
        <h3 className="text-[14px] font-bold text-gray-900">Development needs it serves</h3>
        {p.linkedNeeds.length === 0 ? <Empty>Not linked to a need. A goal works without one.</Empty> : (
          <ul className="mt-1 divide-y divide-gray-100">
            {p.linkedNeeds.map(n => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[13.5px]">
                <Link href={`?need=${n.id}#need-detail`} className="underline-offset-2 hover:underline">{n.title}</Link>
                {n.viaJoin && <ApiButton action="/api/individual/professional/plan-links" method="PATCH" body={{ kind: "need", goalId: g.id, needId: n.id }} label="Unlink" />}
              </li>
            ))}
          </ul>
        )}
        {sources.needs.filter(n => !p.linkedNeeds.some(l => l.id === n.id)).length > 0 && (
          <ApiForm action="/api/individual/professional/plan-links" submitLabel="Link need" accent={accent} savedText="Linked.">
            <input type="hidden" name="kind" value="need" />
            <input type="hidden" name="goalId" value={g.id} />
            <Field label="Another need" htmlFor={`gn-${g.id}`}>
              <select id={`gn-${g.id}`} name="needId" required defaultValue="" className={inputCls}>
                <option value="">Choose…</option>
                {sources.needs.filter(n => !p.linkedNeeds.some(l => l.id === n.id)).map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
              </select>
            </Field>
          </ApiForm>
        )}
      </div>

      {/* Competencies (P3) */}
      {policy.competencyLinks === "offered" && (
        <div className="mt-5">
          <h3 className="text-[14px] font-bold text-gray-900">Competencies and outcomes</h3>
          <p className="text-[12.5px] text-gray-500">Optional. A link says what you are developing towards, never that you lack it. The framework version is kept with each link.</p>
          {goalComps.filter(open).length === 0 ? <Empty>No competencies linked.</Empty> : (
            <ul className="mt-1 divide-y divide-gray-100">
              {goalComps.filter(open).map(l => (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[13.5px]">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{compName(l.framework_competency_id)} <span className="text-[12px] font-normal text-gray-500">({l.framework_version ?? "version not recorded"}, linked {fmtDate(l.linked_at)})</span></p>
                    {l.learning_outcome && <p className="text-[12.5px] text-gray-700">Outcome: {l.learning_outcome}</p>}
                    {sources.learning.enabled && policy.learning !== "off" && <Link href={findLearningHref(l.framework_competency_id)} className="text-[12.5px] font-semibold" style={{ color: accent }}>Find learning for this competency →</Link>}
                  </div>
                  <ApiButton action="/api/individual/professional/plan-links" method="PATCH" body={{ kind: "competency", linkId: l.id }} label="Unlink" />
                </li>
              ))}
            </ul>
          )}
          {goalComps.some(l => !open(l)) && (
            <details className="mt-1"><summary className="cursor-pointer text-[12px] font-semibold text-gray-600">Earlier links ({goalComps.filter(l => !open(l)).length})</summary>
              <ul className="mt-1 text-[12px] text-gray-600">{goalComps.filter(l => !open(l)).map(l => <li key={l.id}>{compName(l.framework_competency_id)} ({l.framework_version ?? "version not recorded"}), linked {fmtDate(l.linked_at)}, unlinked {fmtDate(l.unlinked_at)}</li>)}</ul>
            </details>
          )}
          {sources.offered === null ? <p className="mt-2 text-[12.5px] text-gray-600">The competencies could not be read just now.</p>
            : sources.offered.length === 0 ? <p className="mt-2 text-[12.5px] text-gray-600">No competency catalogue is offered yet. Your plan works without one.</p> : (
              <>
                {p.suggestedCompetencies.filter(c => !linkedCompIds.has(c.competencyId)).length > 0 && (
                  <div className="mt-2">
                    <p className="text-[12.5px] font-semibold text-gray-700">These share words with your goal <span className="font-normal text-gray-500">(a suggestion, not AI)</span></p>
                    <ul className="mt-1 space-y-1">
                      {p.suggestedCompetencies.filter(c => !linkedCompIds.has(c.competencyId)).map(c => (
                        <li key={c.competencyId} className="flex flex-wrap items-center gap-2 text-[13px]">
                          <span>{c.title} <span className="text-gray-500">· {c.catalogue.name}</span></span>
                          <ApiForm action="/api/individual/professional/plan-links" submitLabel="Link" accent={accent} savedText="Linked.">
                            <input type="hidden" name="kind" value="competency" /><input type="hidden" name="goalId" value={g.id} /><input type="hidden" name="competencyId" value={c.competencyId} />
                          </ApiForm>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <ApiForm action="/api/individual/professional/plan-links" submitLabel="Link competency" accent={accent} savedText="Linked.">
                  <input type="hidden" name="kind" value="competency" />
                  <input type="hidden" name="goalId" value={g.id} />
                  <Field label="Competency" htmlFor={`gc-${g.id}`}>
                    <select id={`gc-${g.id}`} name="competencyId" required defaultValue="" className={inputCls}>
                      <option value="">Choose…</option>
                      {sources.offered.filter(c => !linkedCompIds.has(c.competencyId)).slice(0, 400).map(c => <option key={c.competencyId} value={c.competencyId}>{c.title} · {c.catalogue.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Learning outcome (optional)" htmlFor={`gco-${g.id}`} hint="Exactly as the competency states it."><input id={`gco-${g.id}`} name="outcome" maxLength={1000} className={inputCls} /></Field>
                </ApiForm>
              </>
            )}
        </div>
      )}

      {/* Activities (P2) */}
      <div className="mt-5">
        <h3 className="text-[14px] font-bold text-gray-900">Activities</h3>
        <p className="text-[12.5px] text-gray-500">What you plan to do, in your order. When something has happened, record it as CPD or link the learning record: the activity points to it and is then completed.</p>
        {p.activities.length === 0 ? <Empty>No activities yet. You can record learning without planning it first.</Empty> : (
          <ol className="mt-2 divide-y divide-gray-100">
            {p.activities.map((a, i) => {
              const c = cpdOf(a.cpd_id), r = recOf(a.learning_record_id);
              const dep = a.depends_on_activity_id ? p.allActivities.find(x => x.id === a.depends_on_activity_id) : null;
              return (
                <li key={a.id} className="py-3 text-[13.5px]">
                  <p className="font-semibold text-gray-900">{i + 1}. {a.title}</p>
                  <p className="text-[12.5px] text-gray-600">
                    {ACTIVITY_STATUS_TEXT[a.status as ActivityStatus] ?? a.status}{a.activity_type_label ? ` · ${a.activity_type_label}` : ""}{a.provider ? ` · ${a.provider}` : ""}
                    {a.planned_start || a.planned_end ? ` · planned ${[fmtDate(a.planned_start), fmtDate(a.planned_end)].filter(Boolean).join(" to ")}` : ""}
                    {dep ? ` · after "${dep.title}"` : ""}
                  </p>
                  {a.external_url && <a href={a.external_url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold underline" style={{ color: accent }}>Open the link ↗</a>}
                  {a.learning_offering_id && sources.learning.enabled && <p className="text-[12.5px] text-gray-600">From the Competen Learning catalogue. Adding it to your plan buys or enrols in nothing.</p>}
                  {c && <p className="text-[12.5px] text-gray-700">Happened: CPD entry &quot;{c.title}&quot;, {fmtDate(c.activity_date)} · {EVIDENCE_CLASS_TEXT[c.evidence_class ?? "self_declared"] ?? "Self-reported"}</p>}
                  {r && <p className="text-[12.5px] text-gray-700">Happened: learning completed &quot;{r.title}&quot;, {fmtDate(r.completedOn)} · {r.evidenceLabel}</p>}
                  {a.cpd_id && !c && sources.cpd !== null && <p className="text-[12.5px] text-gray-600">Linked to a CPD entry that could not be shown.</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {policy.activityStatuses.filter(s => s !== "completed" && s !== a.status && !(a.status === "completed")).map(s => (
                      <ApiButton key={s} action="/api/individual/professional/activities" method="PATCH" body={{ id: a.id, status: s }} label={ACTIVITY_STATUS_TEXT[s]} />
                    ))}
                    {i > 0 && <ApiButton action="/api/individual/professional/activities" method="PATCH" body={{ id: a.id, goalId: g.id, move: "up" }} label="Move up" />}
                    {i < p.activities.length - 1 && <ApiButton action="/api/individual/professional/activities" method="PATCH" body={{ id: a.id, goalId: g.id, move: "down" }} label="Move down" />}
                    {a.cpd_id && <ApiButton action="/api/individual/professional/activities" method="PATCH" body={{ id: a.id, detach: "cpd" }} label="Unlink CPD entry" />}
                    {a.learning_record_id && <ApiButton action="/api/individual/professional/activities" method="PATCH" body={{ id: a.id, detach: "learning" }} label="Unlink learning record" />}
                    <ApiButton action="/api/individual/professional/plan-links" method="PATCH" body={{ kind: "activity", activityId: a.id, goalId: g.id }} label="Take off this goal" />
                    <ApiButton action={`/api/individual/professional/activities?id=${a.id}`} method="DELETE" label="Remove" confirm="Remove this activity from your plan? Any CPD entry or learning record it points to is kept." />
                  </div>
                  {!a.cpd_id && !a.learning_record_id && (
                    <details className="mt-2 rounded-xl border border-gray-200 p-3">
                      <summary className="cursor-pointer text-[13px] font-semibold" style={{ color: accent }}>It happened</summary>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <p className="text-[12.5px] text-gray-600 sm:col-span-2">Record it in your <Link href={experienceHref("professional", "cpd")} className="font-semibold underline">CPD log</Link> first if it is not there yet, then link it here. Nothing is copied: the CPD entry stays the record.</p>
                        {(sources.cpd ?? []).filter(x => !usedCpd.has(x.id)).length > 0 && (
                          <ApiForm action="/api/individual/professional/activities" method="PATCH" submitLabel="Link CPD entry" accent={accent} savedText="Linked. The activity is completed.">
                            <input type="hidden" name="id" value={a.id} />
                            <Field label="A CPD entry" htmlFor={`ac-${a.id}`}>
                              <select id={`ac-${a.id}`} name="attachCpdId" required defaultValue="" className={inputCls}>
                                <option value="">Choose…</option>
                                {(sources.cpd ?? []).filter(x => !usedCpd.has(x.id)).map(x => <option key={x.id} value={x.id}>{x.title} · {fmtDate(x.activity_date)}</option>)}
                              </select>
                            </Field>
                          </ApiForm>
                        )}
                        {sources.learning.enabled && (sources.learning.refs ?? []).filter(x => !usedRecord.has(x.recordId)).length > 0 && (
                          <ApiForm action="/api/individual/professional/activities" method="PATCH" submitLabel="Link learning record" accent={accent} savedText="Linked. The activity is completed.">
                            <input type="hidden" name="id" value={a.id} />
                            <Field label="Learning you completed" htmlFor={`al-${a.id}`}>
                              <select id={`al-${a.id}`} name="attachLearningRecordId" required defaultValue="" className={inputCls}>
                                <option value="">Choose…</option>
                                {(sources.learning.refs ?? []).filter(x => !usedRecord.has(x.recordId)).map(x => <option key={x.recordId} value={x.recordId}>{x.title} · {fmtDate(x.completedOn)}</option>)}
                              </select>
                            </Field>
                          </ApiForm>
                        )}
                      </div>
                    </details>
                  )}
                  <details className="mt-2"><summary className="cursor-pointer text-[12.5px] font-semibold text-gray-600">Edit</summary>
                    <div className="mt-2">
                      <ApiForm action={`/api/individual/professional/activities?id=${a.id}`} method="PUT" submitLabel="Save" accent={accent} reset={false}>
                        <ActivityFields policy={policy} a={a} idPrefix={`ea-${a.id}`} others={p.allActivities.filter(x => x.id !== a.id)} />
                      </ApiForm>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <AddPanel label="Add an activity" accent={accent} suggestOpen={false}>
            <ApiForm action="/api/individual/professional/activities" submitLabel="Add activity" accent={accent} savedText="Added to the goal.">
              <input type="hidden" name="goalId" value={g.id} />
              <ActivityFields policy={policy} idPrefix={`na-${g.id}`} others={p.allActivities} />
            </ApiForm>
          </AddPanel>
          <AddPanel label="Link something that already happened" accent={accent} suggestOpen={false}>
            <p className="text-[12.5px] text-gray-600">CPD or learning you already have that served this goal. One CPD entry can serve several goals.</p>
            {(sources.cpd ?? []).length > 0 && (
              <ApiForm action="/api/individual/professional/plan-links" submitLabel="Link CPD entry" accent={accent} savedText="Linked.">
                <input type="hidden" name="kind" value="record" /><input type="hidden" name="goalId" value={g.id} />
                <Field label="A CPD entry" htmlFor={`rc-${g.id}`}>
                  <select id={`rc-${g.id}`} name="cpdId" required defaultValue="" className={inputCls}>
                    <option value="">Choose…</option>
                    {(sources.cpd ?? []).map(x => <option key={x.id} value={x.id}>{x.title} · {fmtDate(x.activity_date)}</option>)}
                  </select>
                </Field>
              </ApiForm>
            )}
            {sources.learning.enabled && (sources.learning.refs ?? []).length > 0 && (
              <ApiForm action="/api/individual/professional/plan-links" submitLabel="Link learning" accent={accent} savedText="Linked.">
                <input type="hidden" name="kind" value="record" /><input type="hidden" name="goalId" value={g.id} />
                <Field label="Learning you completed" htmlFor={`rl-${g.id}`}>
                  <select id={`rl-${g.id}`} name="learningRecordId" required defaultValue="" className={inputCls}>
                    <option value="">Choose…</option>
                    {(sources.learning.refs ?? []).map(x => <option key={x.recordId} value={x.recordId}>{x.title} · {fmtDate(x.completedOn)}</option>)}
                  </select>
                </Field>
              </ApiForm>
            )}
            {otherActivities.length > 0 && (
              <ApiForm action="/api/individual/professional/plan-links" submitLabel="Add to this goal" accent={accent} savedText="Added.">
                <input type="hidden" name="kind" value="activity" /><input type="hidden" name="goalId" value={g.id} />
                <Field label="An activity from another goal" htmlFor={`ra-${g.id}`}>
                  <select id={`ra-${g.id}`} name="activityId" required defaultValue="" className={inputCls}>
                    <option value="">Choose…</option>
                    {otherActivities.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
                  </select>
                </Field>
              </ApiForm>
            )}
            {(sources.cpd ?? []).length === 0 && !(sources.learning.refs ?? []).length && otherActivities.length === 0 && <Empty>Nothing recorded yet to link.</Empty>}
          </AddPanel>
        </div>
      </div>

      {/* Learning discovery (Learning integration) */}
      {policy.learning !== "off" && sources.learning.enabled && (
        <div className="mt-5">
          <h3 className="text-[14px] font-bold text-gray-900">Learning for this goal</h3>
          <p className="text-[12.5px] text-gray-500">From the Competen Learning catalogue: Competen, partner and external listings, each labelled. Adding one to your plan is free and enrols you in nothing.</p>
          {p.learningItems === null ? <p className="mt-2 text-[12.5px] text-gray-600">Learning could not be searched just now.</p>
            : p.learningItems.length === 0 ? <Empty>{goalComps.some(open) ? "Nothing in the catalogue matches yet." : "Link a competency to see learning for it."} You can add an external course or any other activity yourself.</Empty> : (
              <ul className="mt-2 divide-y divide-gray-100">
                {p.learningItems.slice(0, 6).map(i => {
                  const planned = p.allActivities.some(a => a.learning_offering_id === i.offeringId);
                  return (
                    <li key={i.offeringId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13.5px]">
                      <div className="min-w-0">
                        <Link href={`/individual/learning/${encodeURIComponent(i.code)}`} className="font-semibold" style={{ color: accent }}>{i.title}</Link>
                        <span className="text-[12px] text-gray-500"> · {i.provider?.name ?? i.source}{i.access === "free" ? " · free" : i.access === "external" ? " · external listing" : " · paid, optional"}</span>
                      </div>
                      {planned ? <span className="text-[12.5px] text-gray-600">In your plan</span> : (
                        <ApiForm action="/api/individual/professional/activities" submitLabel="Add to plan" accent={accent} savedText="Added.">
                          <input type="hidden" name="goalId" value={g.id} />
                          <input type="hidden" name="title" value={i.title.slice(0, 200)} />
                          <input type="hidden" name="offeringId" value={i.offeringId} />
                          {(() => {
                            const code = i.delivery === "external" ? "external-course" : i.source === "competen" ? "competen-course" : "partner-course";
                            return policy.activityTypes.some(t => t.code === code) ? <input type="hidden" name="type" value={code} /> : null;
                          })()}
                          {i.provider?.name && <input type="hidden" name="provider" value={i.provider.name.slice(0, 160)} />}
                        </ApiForm>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      )}

      {/* Milestones (P4) */}
      <div className="mt-5">
        <h3 className="text-[14px] font-bold text-gray-900">Milestones</h3>
        {p.milestones.length === 0 ? <Empty>No milestones. They are optional.</Empty> : (
          <ul className="mt-1 divide-y divide-gray-100">
            {p.milestones.map(m => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13.5px]">
                <span>{m.title}{m.milestone_type_label ? <span className="text-gray-500"> · {m.milestone_type_label}</span> : null}{m.due_on ? <span className="text-gray-500"> · due {fmtDate(m.due_on)}</span> : null}
                  {m.achieved_on ? <span className="font-semibold text-green-800"> · reached {fmtDate(m.achieved_on)}</span> : null}</span>
                <span className="flex flex-wrap gap-2">
                  {m.achieved_on
                    ? <ApiButton action="/api/individual/professional/milestones" method="PATCH" body={{ id: m.id, achievedOn: "" }} label="Not reached yet" />
                    : <ApiButton action="/api/individual/professional/milestones" method="PATCH" body={{ id: m.id, achievedOn: p.today }} label="Reached today" />}
                  <ApiButton action={`/api/individual/professional/milestones?id=${m.id}`} method="DELETE" label="Remove" />
                </span>
              </li>
            ))}
          </ul>
        )}
        {ideas.length > 0 && (
          <div className="mt-2">
            <p className="text-[12.5px] font-semibold text-gray-700">From your dates <span className="font-normal text-gray-500">(a suggestion, not AI)</span></p>
            <ul className="mt-1 space-y-1">
              {ideas.map(i => (
                <li key={i.title} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span>{i.title} · {fmtDate(i.due_on)}</span>
                  <ApiForm action="/api/individual/professional/milestones" submitLabel="Add" accent={accent} savedText="Added.">
                    <input type="hidden" name="goalId" value={g.id} /><input type="hidden" name="title" value={i.title} /><input type="hidden" name="dueOn" value={i.due_on} />
                    {policy.milestoneTypes.some(t => t.code === i.type) && <input type="hidden" name="type" value={i.type} />}
                    <input type="hidden" name="suggested" value="rule" />
                  </ApiForm>
                </li>
              ))}
            </ul>
          </div>
        )}
        <AddPanel label="Add a milestone" accent={accent} suggestOpen={false}>
          <ApiForm action="/api/individual/professional/milestones" submitLabel="Add milestone" accent={accent} savedText="Added.">
            <input type="hidden" name="goalId" value={g.id} />
            <Field label="Milestone" htmlFor={`m-${g.id}`}><input id={`m-${g.id}`} name="title" required minLength={2} maxLength={200} className={inputCls} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {policy.milestoneTypes.length > 0 && optSelect(`mt-${g.id}`, "type", "Kind", policy.milestoneTypes, null)}
              {dateIn(`md-${g.id}`, "dueOn", "Due")}
            </div>
          </ApiForm>
        </AddPanel>
      </div>

      {/* Evidence (P5) */}
      <div className="mt-5">
        <h3 className="text-[14px] font-bold text-gray-900">Evidence towards it</h3>
        <p className="text-[12.5px] text-gray-500">Each item keeps the class its own record has. Linking it here raises nothing: self-reported stays self-reported.</p>
        {fromRecords.length + evLinks.filter(open).length === 0 ? <Empty>No evidence linked yet.</Empty> : (
          <ul className="mt-1 divide-y divide-gray-100 text-[13.5px]">
            {fromRecords.map(e => <li key={e.key} className="py-1.5">{e.what} <span className="text-[12px] text-gray-500">· {fmtDate(e.when)} · {e.cls} · through an activity</span></li>)}
            {evLinks.filter(open).map(e => {
              const item = e.evidence_id ? sources.evidenceItems?.find(x => x.id === e.evidence_id) : null;
              const refl = e.reflection_id ? sources.reflections?.find(x => x.id === e.reflection_id) : null;
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{item ? <>Evidence: {item.title} <span className="text-[12px] text-gray-500">· {EVIDENCE_CLASS_TEXT[item.evidence_class ?? "self_declared"] ?? "Self-reported"}</span></>
                    : refl ? <>Your private reflection of {fmtDate(refl.created_at)} <span className="text-[12px] text-gray-500">· self-reported · stays private</span></>
                    : <span className="text-gray-600">A linked record that could not be shown</span>}</span>
                  <ApiButton action="/api/individual/professional/plan-links" method="PATCH" body={{ kind: "evidence", linkId: e.id }} label="Unlink" />
                </li>
              );
            })}
          </ul>
        )}
        {((sources.evidenceItems ?? []).length > 0 || (sources.reflections ?? []).length > 0) && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {(sources.evidenceItems ?? []).length > 0 && (
              <ApiForm action="/api/individual/professional/plan-links" submitLabel="Link evidence" accent={accent} savedText="Linked.">
                <input type="hidden" name="kind" value="evidence" /><input type="hidden" name="goalId" value={g.id} />
                <Field label="An evidence item, certificate or feedback" htmlFor={`ge-${g.id}`}>
                  <select id={`ge-${g.id}`} name="evidenceId" required defaultValue="" className={inputCls}>
                    <option value="">Choose…</option>
                    {(sources.evidenceItems ?? []).map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
                  </select>
                </Field>
              </ApiForm>
            )}
            {(sources.reflections ?? []).length > 0 && (
              <ApiForm action="/api/individual/professional/plan-links" submitLabel="Link reflection" accent={accent} savedText="Linked. It stays private.">
                <input type="hidden" name="kind" value="evidence" /><input type="hidden" name="goalId" value={g.id} />
                <Field label="One of your private reflections" htmlFor={`gr-${g.id}`}>
                  <select id={`gr-${g.id}`} name="reflectionId" required defaultValue="" className={inputCls}>
                    <option value="">Choose…</option>
                    {(sources.reflections ?? []).map(x => <option key={x.id} value={x.id}>{fmtDate(x.created_at)}{x.template_label ? ` · ${x.template_label}` : ""}</option>)}
                  </select>
                </Field>
              </ApiForm>
            )}
          </div>
        )}
      </div>

      {/* Review (P6) */}
      <div className="mt-5">
        <h3 className="text-[14px] font-bold text-gray-900">Review</h3>
        <p className="text-[12.5px] text-gray-500">A short, private look back. Every question is optional.</p>
        <AddPanel label="Review this goal" accent={accent} suggestOpen={false}>
          <ApiForm action="/api/individual/professional/goal-reviews" submitLabel="Save review" accent={accent} savedText="Review saved. It is private to you.">
            <input type="hidden" name="goalId" value={g.id} />
            {policy.reviewFields.map(f => (
              <Field key={f} label={`${REVIEW_FIELD_LABEL[f]} (optional)`} htmlFor={`rv-${g.id}-${f}`}><textarea id={`rv-${g.id}-${f}`} name={f} rows={2} maxLength={2000} className={inputCls} /></Field>
            ))}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="What you decided" htmlFor={`rvd-${g.id}`}>
                <select id={`rvd-${g.id}`} name="decision" required defaultValue="continue" className={inputCls}>
                  {REVIEW_DECISIONS.filter(d => !(d === "reopened" && (goalOpen(g.status) || policy.reopen === "off" && closed)) && !(d === "reprioritise" && !policy.priorities.length)).map(d => <option key={d} value={d}>{REVIEW_DECISION_LABEL[d]}</option>)}
                </select>
              </Field>
              {policy.priorities.length > 0 && optSelect(`rvp-${g.id}`, "priority", "New priority, if you change it", policy.priorities, null, "Keep as it is")}
            </div>
            <p className="text-[12px] text-gray-500">To revise the goal itself, add or replace activities, or change its outcome, use the parts above. Their history is kept.</p>
          </ApiForm>
        </AddPanel>
        {p.reviews.length > 0 && (
          <ol className="mt-2 space-y-2 border-l-2 border-gray-200 pl-3 text-[13px]">
            {p.reviews.map(r => (
              <li key={r.id}>
                <p className="font-semibold text-gray-800">{fmtDate(r.reviewed_at)} · {REVIEW_DECISION_LABEL[r.decision as keyof typeof REVIEW_DECISION_LABEL] ?? r.decision}</p>
                {([["Done so far", r.undertaken], ["Learned", r.learned], ["Evidence", r.evidence_note], ["Changed", r.changed], ["Next", r.next_steps]] as const)
                  .filter(([, v]) => v).map(([k, v]) => <p key={k} className="text-gray-700"><span className="font-semibold">{k}:</span> {v}</p>)}
              </li>
            ))}
          </ol>
        )}
      </div>

      {policy.ai === "on" && (
        <div className="mt-5">
          <h3 className="text-[14px] font-bold text-gray-900">Help from your personal AI</h3>
          <p className="text-[12.5px] text-gray-500">Optional. It sees this goal and your own record, never your private reflections. Nothing is added unless you choose to add it.</p>
          <div className="mt-2"><PlanAssist goalId={g.id} accent={accent} /></div>
        </div>
      )}

      <details className="mt-5">
        <summary className="cursor-pointer text-[13px] font-semibold text-gray-700">History ({p.history.length})</summary>
        <ol className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3 text-[12.5px] text-gray-600">
          {p.history.map((h, i) => (
            <li key={i}><span className="font-semibold text-gray-800">{fmtDate(h.recorded_at)}</span>: {h.title}{h.status ? ` · ${GOAL_STATUS_TEXT[h.status as GoalStatus] ?? h.status}` : ""}
              {h.priority_label ? ` · ${h.priority_label}` : ""}{h.target_date ? ` · target ${fmtDate(h.target_date)}` : ""}{h.intended_outcome ? ` · outcome: ${h.intended_outcome}` : ""}</li>
          ))}
        </ol>
      </details>

      <div className="mt-4 border-t border-gray-100 pt-3">
        <ApiButton action={`/api/individual/professional/goals?id=${g.id}`} method="DELETE" label="Erase this goal" confirm="Erase this goal, its milestones, reviews and history completely? Its activities, CPD and learning are kept. To keep its history, choose Retired instead." />
      </div>
    </section>
  );
}

// ── The activity form (P2) ─────────────────────────────────────────────────────────────────────────────────

export function ActivityFields({ policy, a, idPrefix, others }: { policy: ProfessionalPlanPolicy; a?: PlanActivity; idPrefix: string; others: PlanActivity[] }) {
  const id = (f: string) => `${idPrefix}-${f}`;
  return (
    <>
      <Field label="What will you do?" htmlFor={id("title")}><input id={id("title")} name="title" required minLength={3} maxLength={200} defaultValue={a?.title ?? ""} className={inputCls} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {policy.activityTypes.length > 0 && optSelect(id("type"), "type", "Kind of activity", policy.activityTypes, a?.activity_type_code)}
        {!a && (
          <Field label="Status" htmlFor={id("status")}>
            <select id={id("status")} name="status" defaultValue="planned" className={inputCls}>
              {policy.activityStatuses.filter(s => s !== "completed").map(s => <option key={s} value={s}>{ACTIVITY_STATUS_TEXT[s]}</option>)}
            </select>
          </Field>
        )}
        {dateIn(id("ps"), "plannedStart", "Planned start", a?.planned_start)}
        {dateIn(id("pe"), "plannedEnd", "Planned end", a?.planned_end)}
        <Field label="Provider or person (optional)" htmlFor={id("prov")}><input id={id("prov")} name="provider" maxLength={160} defaultValue={a?.provider ?? ""} className={inputCls} /></Field>
        <Field label="Link (optional)" htmlFor={id("url")}><input id={id("url")} name="url" type="url" maxLength={500} placeholder="https://" defaultValue={a?.external_url ?? ""} className={inputCls} /></Field>
        {others.length > 0 && (
          <Field label="After another activity (optional)" htmlFor={id("dep")}>
            <select id={id("dep")} name="dependsOn" defaultValue={a?.depends_on_activity_id ?? ""} className={inputCls}>
              <option value="">No dependency</option>
              {others.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field label="Notes (optional)" htmlFor={id("detail")}><textarea id={id("detail")} name="detail" rows={2} maxLength={2000} defaultValue={a?.detail ?? ""} className={inputCls} /></Field>
    </>
  );
}
