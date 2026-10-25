import Link from "next/link";
import type { ProfessionalNeedsPolicy } from "@/lib/individual/policy";
import type { CatalogueCompetency } from "@/lib/individual/catalogue";
import type { CatalogueItem } from "@/lib/learning/catalogue";
import { findLearningHref } from "@/lib/individual/professional/learning";
import {
  CREATED_VIA_LABEL, DEVELOPMENT_ACTIVITIES, NEED_FIELD_LABEL, NEED_SOURCE_LABEL, NEED_STAGE_LABEL, STAGE_GROUP, type NeedStage,
} from "@/lib/individual/professional/needs-vocabulary";
import type { NeedCompetencyLink, NeedHistoryRow, NeedsWorkspace, Reflection, RuleSuggestion, StageTwoNeed, Suggestion } from "@/lib/individual/professional/needs-store";
import { Empty, fmtDate } from "./bits";
import { AddPanel, ApiButton, ApiForm, Field, inputCls } from "./forms";
import { GenerateSuggestions, SuggestionDecision, SummariseReflection } from "./NeedSuggestions";

// THE DEVELOPMENT NEEDS WORKSPACE -- COMPETEN-PROFESSIONAL-NEEDS-01 (Professional Stage 2), N1 to N9.
//
// Server-rendered pieces of "My development needs" inside Needs & plan. No new navigation: the overview, the
// filters and a need's detail are views of the same page (?view=, ?need=).
//
// ⚠ A NEED IS SOMETHING THE PERSON WANTS TO DEVELOP. Nothing here says they lack anything. Where nothing has been
// recorded about a competency, the page says "Nothing recorded" -- never "not competent", never a zero that reads
// as a measurement. Verified means an organisation assessed it, and it says which.

export const VIEWS = [
  ["all", "All"], ["active", "Identified"], ["exploring", "Exploring"], ["prioritised", "Prioritised"],
  ["in_development", "In development"], ["closed", "Addressed and deferred"], ["review", "To review"],
] as const;
export type View = (typeof VIEWS)[number][0];

const reviewDue = (n: StageTwoNeed, today: string, days: number) => STAGE_GROUP[n.stage_code] !== "closed"
  && new Date(Date.parse(n.reviewed_at ?? n.updated_at) + days * 864e5).toISOString().slice(0, 10) <= today;

export function inView(n: StageTwoNeed, view: View, today: string, days: number): boolean {
  if (view === "all") return true;
  if (view === "review") return reviewDue(n, today, days);
  return STAGE_GROUP[n.stage_code] === view;
}

// ── The form (N2): one required field, the rest configured and optional ──────────────────────────────────────

export function NeedFields({ policy, n, idPrefix }: { policy: ProfessionalNeedsPolicy; n?: StageTwoNeed; idPrefix: string }) {
  const id = (f: string) => `${idPrefix}-${f}`;
  const sel = (name: string, opts: { code: string; label: string }[], value: string | null | undefined, label: string) => (
    <Field label={`${label} (optional)`} htmlFor={id(name)}>
      <select id={id(name)} name={name} defaultValue={value ?? ""} className={inputCls}>
        <option value="">Not now</option>
        {opts.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
      </select>
    </Field>
  );
  const fields = policy.fields.filter(f => f !== "competencies" && f !== "reflection");
  return (
    <>
      <input type="hidden" name="stage2" value="true" />
      <Field label="What would you like to develop?" htmlFor={id("title")} hint="In your own words. This is the only thing you need to fill in.">
        <input id={id("title")} name="title" required minLength={3} maxLength={200} defaultValue={n?.title ?? ""} className={inputCls} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(f => {
          if (f === "why") return <div key={f} className="sm:col-span-2"><Field label={`${NEED_FIELD_LABEL.why} (optional)`} htmlFor={id("why")}><textarea id={id("why")} name="why" rows={2} maxLength={2000} defaultValue={n?.why_it_matters ?? ""} className={inputCls} /></Field></div>;
          if (f === "source") {
            if (n && ["reflection", "aspiration", "passport_gap"].includes(n.origin)) return null;
            return (
              <Field key={f} label={`${NEED_FIELD_LABEL.source} (optional)`} htmlFor={id("source")}>
                <select id={id("source")} name="source" defaultValue={n?.origin ?? ""} className={inputCls}>
                  <option value="">My own idea</option>
                  {policy.sources.filter(s => s !== "self_identified").map(s => <option key={s} value={s}>{NEED_SOURCE_LABEL[s]}</option>)}
                </select>
              </Field>
            );
          }
          if (f === "motivation" && policy.motivations.length) return <div key={f}>{sel("motivation", policy.motivations, n?.motivation_code, NEED_FIELD_LABEL.motivation)}</div>;
          if (f === "priority" && policy.priorities.length) return <div key={f}>{sel("priority", policy.priorities, n?.priority_code, NEED_FIELD_LABEL.priority)}</div>;
          if (f === "category" && policy.categories.length) return <div key={f}>{sel("category", policy.categories, n?.category_code, NEED_FIELD_LABEL.category)}</div>;
          if (f === "context") return <Field key={f} label={`${NEED_FIELD_LABEL.context} (optional)`} htmlFor={id("context")}><input id={id("context")} name="context" maxLength={1000} defaultValue={n?.professional_context ?? ""} className={inputCls} /></Field>;
          if (f === "interests") return <Field key={f} label={`${NEED_FIELD_LABEL.interests} (optional)`} htmlFor={id("interests")}><input id={id("interests")} name="interests" maxLength={1000} defaultValue={n?.development_interests ?? ""} className={inputCls} /></Field>;
          return null;
        })}
      </div>
      {n && <Field label="Notes (optional)" htmlFor={id("detail")}><textarea id={id("detail")} name="detail" rows={3} maxLength={2000} defaultValue={n.detail ?? ""} className={inputCls} /></Field>}
    </>
  );
}

// ── The list (N1) ─────────────────────────────────────────────────────────────────────────────────────────────

export function NeedsOverview({ needs, view, today, policy, accent }: { needs: StageTwoNeed[]; view: View; today: string; policy: ProfessionalNeedsPolicy; accent: string }) {
  const count = (v: View) => needs.filter(n => inView(n, v, today, policy.reviewDays)).length;
  return (
    <nav aria-label="Filter development needs" className="mb-3 flex flex-wrap gap-2">
      {VIEWS.map(([v, label]) => (
        <Link key={v} href={`?view=${v}#needs-h`} aria-current={view === v ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${view === v ? "text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
          style={view === v ? { background: accent, borderColor: accent } : undefined}>
          {label} <span className="font-normal">({count(v)})</span>
        </Link>
      ))}
    </nav>
  );
}

export function NeedRow({ n, today, policy, accent, competencies, goals }: { n: StageTwoNeed; today: string; policy: ProfessionalNeedsPolicy; accent: string; competencies: number; goals: number }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link href={`?need=${n.id}#need-detail`} className="text-[14.5px] font-semibold text-gray-900 underline-offset-2 hover:underline">{n.title}</Link>
        <p className="text-[12.5px] text-gray-500">
          {NEED_STAGE_LABEL[n.stage_code]}{n.priority_label ? ` · ${n.priority_label} priority` : ""}{n.category_label ? ` · ${n.category_label}` : ""}
          {` · ${NEED_SOURCE_LABEL[n.origin] ?? n.origin}`}{n.created_via !== "person" ? ` · ${CREATED_VIA_LABEL[n.created_via]}` : ""}
          {competencies ? ` · ${competencies} ${competencies === 1 ? "competency" : "competencies"}` : ""}{goals ? ` · ${goals} ${goals === 1 ? "goal" : "goals"}` : ""}
        </p>
        {reviewDue(n, today, policy.reviewDays) && <p className="text-[12px] font-semibold text-amber-800">Time to review: not looked at since {fmtDate(n.reviewed_at ?? n.updated_at)}.</p>}
      </div>
      <Link href={`?need=${n.id}#need-detail`} className="text-[13px] font-semibold" style={{ color: accent }}>Open →</Link>
    </li>
  );
}

// ── The detail (N1, N5, N6, N8, N9) ───────────────────────────────────────────────────────────────────────────

export type CompetencyView = { link: NeedCompetencyLink; name: string; expected: string | null; observed: string; verified: string | null };

export function NeedDetail(p: {
  n: StageTwoNeed; policy: ProfessionalNeedsPolicy; accent: string; today: string;
  history: NeedHistoryRow[]; competencies: CompetencyView[]; formerCompetencies: CompetencyView[];
  offered: CatalogueCompetency[] | null; goals: { id: string; title: string; status: string; viaJoin: boolean }[]; otherGoals: { id: string; title: string }[];
  reflection: Reflection | null; learning: { enabled: boolean; items: CatalogueItem[] | null };
}) {
  const { n, policy, accent } = p;
  const closed = STAGE_GROUP[n.stage_code] === "closed";
  const stages = policy.stages.filter(s => s !== n.stage_code && !(policy.reopen === "off" && (n.stage_code === "addressed" || n.stage_code === "retired") && STAGE_GROUP[s] !== "closed"));
  const linkedIds = new Set(p.competencies.map(c => c.link.framework_competency_id));
  return (
    <section id="need-detail" aria-labelledby="need-detail-h" className="mb-5 rounded-2xl border-2 bg-white p-5 sm:p-6" style={{ borderColor: accent }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Development need</p>
          <h2 id="need-detail-h" className="text-[18px] font-bold text-gray-900">{n.title}</h2>
          <p className="text-[12.5px] text-gray-600">{NEED_STAGE_LABEL[n.stage_code]} · {NEED_SOURCE_LABEL[n.origin] ?? n.origin} · {CREATED_VIA_LABEL[n.created_via] ?? ""} · recorded {fmtDate(n.created_at)}</p>
        </div>
        <Link href="?#needs-h" className="text-[13px] font-semibold text-gray-700 underline">Close</Link>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-2">
        {([["Why it matters", n.why_it_matters], ["Priority", n.priority_label], ["Category", n.category_label], ["Motivation", n.motivation_label],
          ["Professional context", n.professional_context], ["Development interests", n.development_interests], ["Notes", n.detail]] as const)
          .map(([k, v]) => <div key={k}><dt className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{k}</dt><dd className="whitespace-pre-wrap text-gray-900">{v ?? <span className="text-gray-500">Not recorded</span>}</dd></div>)}
      </dl>
      {p.reflection && (
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700">
          Came from your private reflection of {fmtDate(p.reflection.created_at)}. It stays private: it is not part of this need unless you copied its words in, and it is never shared.
        </p>
      )}

      <div className="mt-4">
        <p className="text-[12.5px] font-semibold text-gray-700">Stage (any order)</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {stages.map(s => <ApiButton key={s} action="/api/individual/professional/needs" method="PATCH" body={{ id: n.id, stage: s }} label={NEED_STAGE_LABEL[s as NeedStage]} />)}
          <ApiButton action="/api/individual/professional/needs" method="PATCH" body={{ id: n.id, reviewed: "true" }} label="Mark reviewed" />
        </div>
        {closed && policy.reopen === "off" && (n.stage_code === "addressed" || n.stage_code === "retired") && <p className="mt-1 text-[12px] text-gray-500">Reopening is turned off. Record a new need if you want to work on it again.</p>}
      </div>

      <AddPanel label="Revise this need" accent={accent} suggestOpen={false}>
        <ApiForm action={`/api/individual/professional/needs?id=${n.id}`} method="PUT" submitLabel="Save changes" accent={accent} reset={false} savedText="Saved. The earlier wording is kept in its history.">
          <NeedFields policy={policy} n={n} idPrefix={`edit-${n.id}`} />
        </ApiForm>
      </AddPanel>

      {policy.fields.includes("competencies") && policy.competencyLinks === "offered" && (
        <div className="mt-5">
          <h3 className="text-[14px] font-bold text-gray-900">Relevant competencies</h3>
          <p className="text-[12.5px] text-gray-500">Optional. A link says you want to develop towards it, never that you lack it. Where nothing is recorded, nothing is assumed.</p>
          {p.competencies.length === 0 ? <Empty>No competencies linked.</Empty> : (
            <ul className="mt-2 divide-y divide-gray-100">
              {p.competencies.map(c => (
                <li key={c.link.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0 text-[13.5px]">
                    <p className="font-semibold text-gray-900">{c.name} <span className="text-[12px] font-normal text-gray-500">({c.link.framework_version ?? "version not recorded"}, linked {fmtDate(c.link.linked_at)})</span></p>
                    {c.link.learning_outcome && <p className="text-[12.5px] text-gray-700">Outcome: {c.link.learning_outcome}</p>}
                    <p className="text-[12.5px] text-gray-600">Expected level: {c.expected ?? "Not set in the catalogue"} · Your recorded evidence: {c.observed} · Independently verified: {c.verified ?? "Nothing recorded"}</p>
                    {policy.learning === "on" && p.learning.enabled && <Link href={findLearningHref(c.link.framework_competency_id)} className="text-[12.5px] font-semibold" style={{ color: accent }}>Find learning for this competency →</Link>}
                  </div>
                  <ApiButton action="/api/individual/professional/need-links" method="PATCH" body={{ kind: "competency", linkId: c.link.id }} label="Unlink" />
                </li>
              ))}
            </ul>
          )}
          {p.formerCompetencies.length > 0 && (
            <details className="mt-1"><summary className="cursor-pointer text-[12px] font-semibold text-gray-600">Earlier links ({p.formerCompetencies.length})</summary>
              <ul className="mt-1 text-[12px] text-gray-600">{p.formerCompetencies.map(c => <li key={c.link.id}>{c.name} ({c.link.framework_version ?? "version not recorded"}), linked {fmtDate(c.link.linked_at)}, unlinked {fmtDate(c.link.unlinked_at)}</li>)}</ul>
            </details>
          )}
          {p.offered === null ? <p className="mt-2 text-[12.5px] text-gray-600">The competencies could not be read just now.</p>
            : p.offered.length === 0 ? <p className="mt-2 text-[12.5px] text-gray-600">No competency catalogue is offered yet. Your need works without one.</p> : (
              <ApiForm action="/api/individual/professional/need-links" submitLabel="Link competency" accent={accent} savedText="Linked.">
                <input type="hidden" name="needId" value={n.id} />
                <input type="hidden" name="kind" value="competency" />
                <Field label="Competency" htmlFor={`comp-${n.id}`}>
                  <select id={`comp-${n.id}`} name="competencyId" required className={inputCls} defaultValue="">
                    <option value="">Choose…</option>
                    {p.offered.filter(c => !linkedIds.has(c.competencyId)).slice(0, 400).map(c => <option key={c.competencyId} value={c.competencyId}>{c.title} · {c.catalogue.name}</option>)}
                  </select>
                </Field>
              </ApiForm>
            )}
        </div>
      )}

      {policy.learning === "on" && (
        <div className="mt-5">
          <h3 className="text-[14px] font-bold text-gray-900">Ways to develop it</h3>
          <p className="text-[12.5px] text-gray-500">Ideas only. Nothing here is required, and nothing needs buying or enrolling in.</p>
          {p.learning.enabled && p.learning.items !== null && p.learning.items.length > 0 && (
            <ul className="mt-2 space-y-1 text-[13.5px]">
              {p.learning.items.slice(0, 6).map(i => (
                <li key={i.offeringId}>
                  <Link href={`/individual/learning/${encodeURIComponent(i.code)}`} className="font-semibold" style={{ color: accent }}>{i.title}</Link>
                  <span className="text-[12px] text-gray-500"> · {i.provider?.name ?? i.source}{i.access === "free" ? " · free" : i.access === "external" ? " · external" : ""}</span>
                </li>
              ))}
            </ul>
          )}
          {p.learning.enabled && p.learning.items === null && <p className="mt-2 text-[12.5px] text-gray-600">Learning could not be searched just now.</p>}
          <ul className="mt-2 list-disc pl-5 text-[13px] text-gray-700">{DEVELOPMENT_ACTIVITIES.map(a => <li key={a}>{a}</li>)}</ul>
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-[14px] font-bold text-gray-900">Goals for this need</h3>
        <p className="text-[12.5px] text-gray-500">A need can have several goals, and a goal can serve several needs. Planning the detail comes later.</p>
        {p.goals.length === 0 ? <Empty>No goals linked yet. You can start developing without one.</Empty> : (
          <ul className="mt-2 divide-y divide-gray-100">
            {p.goals.map(g => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13.5px]">
                <span>{g.title} <span className="text-[12px] text-gray-500">· {g.status.replace("_", " ")}</span></span>
                {g.viaJoin && <ApiButton action="/api/individual/professional/need-links" method="PATCH" body={{ kind: "goal", goalId: g.id, needId: n.id }} label="Unlink" />}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {p.otherGoals.length > 0 && (
            <ApiForm action="/api/individual/professional/need-links" submitLabel="Link goal" accent={accent} savedText="Linked.">
              <input type="hidden" name="needId" value={n.id} />
              <input type="hidden" name="kind" value="goal" />
              <Field label="An existing goal" htmlFor={`goal-${n.id}`}>
                <select id={`goal-${n.id}`} name="goalId" required className={inputCls} defaultValue="">
                  <option value="">Choose…</option>
                  {p.otherGoals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              </Field>
            </ApiForm>
          )}
          <ApiForm action="/api/individual/professional/goals" submitLabel="Add goal for this need" accent={accent} savedText="Goal added and linked.">
            <input type="hidden" name="needId" value={n.id} />
            <Field label="A new goal" htmlFor={`newgoal-${n.id}`}><input id={`newgoal-${n.id}`} name="title" required minLength={3} maxLength={200} className={inputCls} /></Field>
            <Field label="Target date" htmlFor={`newgoal-date-${n.id}`}><input id={`newgoal-date-${n.id}`} name="targetDate" type="date" required className={inputCls} /></Field>
          </ApiForm>
        </div>
      </div>

      <details className="mt-5">
        <summary className="cursor-pointer text-[13px] font-semibold text-gray-700">History ({p.history.length})</summary>
        <ol className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3 text-[12.5px] text-gray-600">
          {p.history.map((h, i) => (
            <li key={i}><span className="font-semibold text-gray-800">{fmtDate(h.recorded_at)}</span>: {h.title}{h.stage_code ? ` · ${NEED_STAGE_LABEL[h.stage_code as NeedStage] ?? h.stage_code}` : ""}{h.priority_label ? ` · ${h.priority_label}` : ""}{h.category_label ? ` · ${h.category_label}` : ""}</li>
          ))}
        </ol>
      </details>

      <div className="mt-4 border-t border-gray-100 pt-3">
        <ApiButton action={`/api/individual/professional/needs?id=${n.id}`} method="DELETE" label="Erase this need" confirm="Erase this need and its history completely? To keep its history, choose Retired instead." />
      </div>
    </section>
  );
}

// ── Reflections (N4) ─────────────────────────────────────────────────────────────────────────────────────────

export function Reflections({ reflections, policy, accent }: { reflections: Reflection[] | null; policy: ProfessionalNeedsPolicy; accent: string }) {
  return (
    <>
      <p className="text-[12.5px] text-gray-500">Private to you. A reflection is never shared, never added to a plan or your Passport, and reaches the AI only when you ask it to summarise that one. Leave out anything that could identify a patient.</p>
      {reflections === null ? <p className="mt-2 text-[13px] text-gray-600">Your reflections could not be read just now.</p> : reflections.length === 0 ? <Empty>No reflections yet.</Empty> : (
        <ul className="mt-2 divide-y divide-gray-100">
          {reflections.map(r => (
            <li key={r.id} className="py-3">
              <p className="text-[12px] text-gray-500">{fmtDate(r.created_at)}{r.updated_at !== r.created_at ? ` · edited ${fmtDate(r.updated_at)}` : ""}{r.template_label ? ` · ${r.template_label}` : ""} · <span className="font-semibold">Private</span></p>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-gray-800">{r.body}</p>
              {policy.reflectionAi === "on" && <SummariseReflection id={r.id} accent={accent} />}
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <details className="rounded-xl border border-gray-200 p-3">
                  <summary className="cursor-pointer text-[13px] font-semibold" style={{ color: accent }}>Create a development need from this</summary>
                  <div className="mt-2">
                    <ApiForm action="/api/individual/professional/needs" submitLabel="Create need" accent={accent} savedText="Need created. The reflection stays private.">
                      <input type="hidden" name="stage2" value="true" />
                      <input type="hidden" name="reflectionId" value={r.id} />
                      <Field label="What would you like to develop?" htmlFor={`rn-${r.id}`}><input id={`rn-${r.id}`} name="title" required minLength={3} maxLength={200} className={inputCls} /></Field>
                      <label className="flex items-start gap-2 text-[13px] text-gray-700">
                        <input type="checkbox" name="includeReflection" value="true" className="mt-1 h-4 w-4" />
                        <span>Copy the reflection&apos;s words into the need&apos;s notes. Leave this unticked to keep them only in the private reflection.</span>
                      </label>
                    </ApiForm>
                  </div>
                </details>
                <details className="rounded-xl border border-gray-200 p-3">
                  <summary className="cursor-pointer text-[13px] font-semibold text-gray-700">Edit the reflection</summary>
                  <div className="mt-2">
                    <ApiForm action={`/api/individual/professional/reflections?id=${r.id}`} method="PUT" submitLabel="Save" accent={accent} reset={false}>
                      <Field label="Reflection" htmlFor={`re-${r.id}`}><textarea id={`re-${r.id}`} name="body" rows={4} maxLength={5000} defaultValue={r.body} className={inputCls} /></Field>
                    </ApiForm>
                  </div>
                </details>
              </div>
            </li>
          ))}
        </ul>
      )}
      <AddPanel label="Write a private reflection" accent={accent} suggestOpen={false}>
        <ApiForm action="/api/individual/professional/reflections" submitLabel="Save reflection" accent={accent} savedText="Saved. It is private to you.">
          {policy.templates.length > 0 && (
            <Field label="Start from a prompt (optional)" htmlFor="ref-template">
              <select id="ref-template" name="template" defaultValue="" className={inputCls}>
                <option value="">No prompt</option>
                {policy.templates.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </Field>
          )}
          <Field label="Your reflection" htmlFor="ref-body"><textarea id="ref-body" name="body" rows={5} required minLength={3} maxLength={5000} className={inputCls} /></Field>
        </ApiForm>
      </AddPanel>
    </>
  );
}

// ── Suggestions (N7) ─────────────────────────────────────────────────────────────────────────────────────────

export function Suggestions({ rules, ai, policy, accent }: { rules: RuleSuggestion[]; ai: Suggestion[]; policy: ProfessionalNeedsPolicy; accent: string }) {
  const any = rules.length + ai.length;
  return (
    <>
      <p className="text-[12.5px] text-gray-500">Private suggestions, each saying why it was made. None becomes a need unless you accept it, and you can edit it first.</p>
      {any === 0 && <Empty>No suggestions right now.</Empty>}
      <ul className="mt-2 divide-y divide-gray-100">
        {rules.map(r => (
          <li key={r.key} className="py-3">
            <p className="text-[14px] font-semibold text-gray-900">{r.title}</p>
            <p className="text-[12.5px] text-gray-600">Why: {r.basis} <span className="text-gray-500">(from your own record, not AI)</span></p>
            <SuggestionDecision ruleKey={r.key} title={r.title} accent={accent} />
          </li>
        ))}
        {ai.map(s => (
          <li key={s.id} className="py-3">
            <p className="text-[14px] font-semibold text-gray-900">{s.title}</p>
            <p className="text-[12.5px] text-gray-600">Why: {s.basis} <span className="text-gray-500">(AI suggestion, {fmtDate(s.created_at)})</span></p>
            <SuggestionDecision suggestionId={s.id} title={s.title} accent={accent} />
          </li>
        ))}
      </ul>
      {policy.aiSuggestions === "on" && <div className="mt-3"><GenerateSuggestions accent={accent} /></div>}
    </>
  );
}

export type { NeedsWorkspace };
