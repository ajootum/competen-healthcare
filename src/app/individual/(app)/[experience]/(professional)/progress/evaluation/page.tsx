import Link from "next/link";
import type { Metadata } from "next";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { compareEvaluations, evaluate, type Evaluation, type Point } from "@/lib/individual/professional/evaluation";
import { loadEvaluationInput } from "@/lib/individual/professional/evaluation-sources";
import { latestDecisions, loadEvaluationHistory, type EvaluationRow } from "@/lib/individual/professional/evaluation-store";
import { parseScope } from "@/lib/individual/professional/evaluation-form";
import { AI_LABEL } from "@/lib/individual/professional/evaluation-ai";
import {
  CONFIDENCE_LABEL, FORMATIVE_NOTICE, PROVENANCE, PROVENANCE_LABEL, SCOPE_LABEL, type Provenance,
} from "@/lib/individual/professional/evaluation-vocabulary";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing, secondaryBtn } from "../../../../../_components/chrome";
import { Empty, Section, fmtDate } from "../../../../../_components/professional/bits";
import { ApiForm, Field, inputCls } from "../../../../../_components/professional/forms";
import { ComparisonView, DimensionGrid, PointsView, RecommendationList, SourceList } from "../../../../../_components/professional/evaluation-view";
import EvaluationRecord from "../../../../../_components/professional/EvaluationRecord";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// MY PROFESSIONAL EVALUATION -- COMPETEN-PROFESSIONAL-EVALUATION-01, Professional Stage 6 (E1 to E6).
//
// Inside the Progress module (/progress/evaluation): the sidebar is unchanged, and Progress links here. A read-mostly
// workspace over the person's own records, read through their owning modules: Evaluate my development, Review existing
// evidence, Evaluate a goal, a competency (or one outcome), a topic, a CPD activity, a course or a development need,
// Strengths and evidence gaps, Recommended next steps, and Previous evaluations with comparison.
//
// ⚠ SIX SEPARATE DIMENSIONS, NO SCORE (src/lib/individual/professional/evaluation.ts). Works with no AI and no catalogue.
// ⚠ PRIVATE. Nothing here is shared unless the person ticks a recorded evaluation onto a Passport link (Share page).
// ⚠ VERIFICATION IS READ. A C5 decision is shown as it is. Nothing here makes, changes or revokes one.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "My Professional Evaluation" }); }

type SP = Record<string, string | string[] | undefined>;
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;
const TABS = [["evaluate", "Evaluate"], ["evidence", "Review existing evidence"], ["history", "Previous evaluations"]] as const;

function Tabs({ view, accent }: { view: string; accent: string }) {
  return (
    <nav aria-label="Evaluation" className="mb-5 flex flex-wrap gap-2">
      {TABS.map(([v, label]) => (
        <Link key={v} href={`?view=${v}`} aria-current={view === v ? "page" : undefined}
          className={`inline-flex min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-full border px-4 text-[13.5px] font-semibold ${focusRing} ${view === v ? "text-white" : "border-gray-300 bg-white text-gray-800"}`}
          style={view === v ? { background: accent, borderColor: accent } : undefined}>{label}</Link>
      ))}
      <Link href={experienceHref("professional", "progress")} className={`inline-flex min-h-[40px] items-center px-2 text-[13.5px] font-semibold text-gray-600 ${focusRing}`}>← Progress</Link>
    </nav>
  );
}

function Notice() {
  return <p className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-[13.5px] text-indigo-950">{FORMATIVE_NOTICE} Private to you: nothing is shared unless you choose to add a recorded evaluation to a Passport link.</p>;
}

export default async function EvaluationPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<SP> }) {
  const page = await experienceModulePage((await params).experience, "progress");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  const sp = await searchParams;
  const policy = (await loadIndividualPolicy(ctx.admin)).professionalEvaluation;
  const [{ input, catalogueOffered }, history] = await Promise.all([
    loadEvaluationInput(ctx.admin, ctx.userId, today), loadEvaluationHistory(ctx.admin, ctx.userId, policy.historyShown),
  ]);
  const evaluations = history.evaluations ?? [];
  const evalId = one(sp.eval);
  const compare = one(sp.compare) ? one(sp.compare)!.split(",").filter(Boolean) : one(sp.a) && one(sp.b) ? [one(sp.a)!, one(sp.b)!] : [];
  const view = evalId ? "snapshot" : compare.length === 2 ? "compare" : (TABS.some(([v]) => v === one(sp.view)) ? one(sp.view)! : "evaluate");
  const createdHref = (kind: string, id: string) => kind === "need" ? input.hrefs.need(id) : kind === "goal" ? input.hrefs.goal(id) : input.hrefs.development;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your development" title="My Professional Evaluation"
        intro="See what your development records support, dimension by dimension, where the evidence is thin, and what you might do next. It uses your own goals and records, with or without a competency catalogue, and with or without AI." />
      <Notice />
      <Tabs view={view === "snapshot" || view === "compare" ? "history" : view} accent={x.accent} />
      {!history.provisioned && (
        <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          Recording evaluations is not set up here yet. You can still evaluate your records here; nothing can be saved.
        </p>
      )}
      {view === "evaluate" && <EvaluateView sp={sp} />}
      {view === "evidence" && <EvidenceView sp={sp} />}
      {view === "history" && <HistoryView />}
      {view === "snapshot" && <SnapshotView id={evalId!} />}
      {view === "compare" && <CompareView ids={compare} />}
    </>
  );

  // ── E1: choose what to evaluate, then the live evaluation ──
  function EvaluateView({ sp }: { sp: SP }) {
    const parsed = parseScope(sp, policy);
    const scope = parsed.ok ? parsed.value : { kind: "development" as const, ref: null };
    const ev = evaluate(input, scope, policy);
    const correcting = one(sp.correct) ? evaluations.find(e => e.id === one(sp.correct)) ?? null : null;
    return (
      <>
        <ScopePicker current={scope.kind} />
        {!parsed.ok && one(sp.scope) && <p role="alert" className="mb-4 text-[13.5px] font-semibold text-red-700">{parsed.error}</p>}
        {!ev ? <Section title="Not found"><Empty>That is not on your record, or it has been removed. Choose something else to evaluate.</Empty></Section> : (
          <>
            <EvaluationBody ev={ev} />
            <Section id="next-h" title="Recommended next steps" note="Each says why it is offered and opens the module that owns the work. Record the evaluation to accept, edit, defer or dismiss them.">
              <RecommendationList recs={ev.recommendations} evaluationId={null} accent={x.accent} />
            </Section>
            {history.provisioned && (
              <Section title={correcting ? "Record a corrected evaluation" : "Record this evaluation"} note="A recorded evaluation is a snapshot: it keeps references to your records and these findings, never copies of your evidence, and it never changes. A later evaluation is a new one.">
                <EvaluationRecord accent={x.accent} aiOn={policy.ai === "on"} aiLabel={AI_LABEL}
                  scope={{ scope: ev.scope.kind, ref: ev.scope.ref, outcome: ev.scope.outcome ?? null, from: ev.scope.from ?? null, to: ev.scope.to ?? null }}
                  correcting={correcting && policy.corrections === "linked" && correcting.scope_kind === ev.scope.kind && (correcting.scope_ref ?? null) === (ev.scope.ref ?? null)
                    ? { id: correcting.id, label: `${correcting.scope_label}, ${fmtDate(correcting.evaluated_at)}` } : null} />
              </Section>
            )}
          </>
        )}
      </>
    );
  }

  function ScopePicker({ current }: { current: string }) {
    const goals = (input.goals ?? []).filter(g => g.status !== "dropped");
    const entries = (input.stage5.entries ?? []).filter(e => !e.removed_at);
    const linked = [...new Set([...(input.planCompetencies ?? []), ...(input.needCompetencies ?? [])].filter(l => !l.unlinked_at).map(l => l.framework_competency_id))]
      .filter(id => !entries.some(e => e.framework_competency_id === id) && input.names.has(id));
    const offered = (k: string) => policy.scopes.includes(k as never);
    const pick = (k: string, label: string, opts: { value: string; label: string }[], hint?: string) => offered(k) && (
      <form method="get" className="rounded-xl border border-gray-200 p-3">
        <input type="hidden" name="scope" value={k} />
        <Field label={label} htmlFor={`pick-${k}`} hint={hint}>
          <select id={`pick-${k}`} name="ref" required className={inputCls} defaultValue="">
            <option value="" disabled>{opts.length ? "Choose…" : "Nothing to choose yet"}</option>
            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <button type="submit" disabled={!opts.length} className={`mt-2 ${secondaryBtn}`} style={{ color: x.accent }}>Evaluate</button>
      </form>
    );
    return (
      <Section id="scope-h" title="What would you like to evaluate?" note={`Now: ${SCOPE_LABEL[current as keyof typeof SCOPE_LABEL] ?? current}.`}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-gray-200 p-3">
            <p className="text-[13.5px] font-semibold text-gray-800">Evaluate my development</p>
            <p className="text-[12.5px] text-gray-500">Everything in your record, together.</p>
            <Link href="?scope=development" className={`mt-2 ${secondaryBtn}`} style={{ color: x.accent }}>Evaluate my development</Link>
          </div>
          {pick("goal", "Evaluate a development goal", goals.map(g => ({ value: g.id, label: g.title })))}
          {pick("competency", "Evaluate a competency", [
            ...entries.map(e => ({ value: e.id, label: `${e.title}${e.kind === "personal" ? " (your own words)" : e.framework_version ? ` (${e.framework_version})` : ""}` })),
            ...linked.map(id => ({ value: id, label: `${input.names.get(id)} (linked to a goal or need)` })),
          ], catalogueOffered || entries.length ? undefined : "No catalogue is offered. Personal competencies you add in My Competencies appear here.")}
          {pick("area", "Evaluate a development need", (input.needs ?? []).map(n => ({ value: n.id, label: n.title })))}
          {pick("cpd", "Review a CPD activity", (input.cpd ?? []).slice(0, 200).map(c => ({ value: c.id, label: `${c.title} (${fmtDate(c.activity_date)})` })))}
          {input.learning.enabled && pick("learning", "Review a Competen Learning course", (input.learning.refs ?? []).map(r => ({ value: r.recordId, label: `${r.title} (${fmtDate(r.completedOn)})` })))}
          {offered("topic") && (
            <form method="get" className="rounded-xl border border-gray-200 p-3">
              <input type="hidden" name="scope" value="topic" />
              <Field label="Evaluate a topic" htmlFor="pick-topic" hint="Words that appear in your goals, CPD, courses or evidence, for example ECG interpretation.">
                <input id="pick-topic" name="ref" required minLength={2} maxLength={80} className={inputCls} />
              </Field>
              <button type="submit" className={`mt-2 ${secondaryBtn}`} style={{ color: x.accent }}>Evaluate</button>
            </form>
          )}
        </div>
      </Section>
    );
  }

  function EvaluationBody({ ev, ai }: { ev: Evaluation | (Pick<Evaluation, "scope" | "sources" | "findings" | "limitations" | "frameworkVersions"> & { strengths: Point[]; development: Point[]; competencies: Evaluation["competencies"] }); ai?: { text: string; model: string | null } | null }) {
    return (
      <>
        <Section id="dims-h" title={ev.scope.label} note={`${SCOPE_LABEL[ev.scope.kind]}${ev.scope.from ? ` · from ${fmtDate(ev.scope.from)}` : " · your whole record"}${ev.scope.to ? ` to ${fmtDate(ev.scope.to)}` : ""} · six separate dimensions, never combined into a score.`}>
          <DimensionGrid findings={ev.findings} sources={ev.sources} />
        </Section>
        {ai && (
          <Section title="AI interpretation" note={AI_LABEL}>
            <p className="whitespace-pre-wrap text-[13.5px] text-gray-800">{ai.text}</p>
            {ai.model && <p className="mt-1 text-[12px] text-gray-500">Model: {ai.model}</p>}
          </Section>
        )}
        <Section id="gaps-h" title="Strengths and evidence gaps">
          <PointsView strengths={ev.strengths} development={ev.development} limitations={ev.limitations} />
        </Section>
        <Section title="Competencies and outcomes in scope" note="With the framework version each was linked under. None is needed: evaluation works from your goals and records.">
          {ev.competencies.length === 0 ? <Empty>No competency is linked to this. That is fine: the findings above come from your goals and records.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {ev.competencies.map(c => (
                <li key={`${c.id}-${c.name}`} className="py-2">
                  <p className="text-[14px] font-semibold text-gray-900">{c.name}</p>
                  <p className="text-[12.5px] text-gray-600">{[c.personal ? "Personal competency, in your own words (never verified)" : c.version ? `Framework ${c.version}` : "Framework version not recorded", c.outcomes.length ? `Outcomes: ${c.outcomes.join("; ")}` : null].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </>
    );
  }

  // ── Review existing evidence: every record, by provenance ──
  function EvidenceView({ sp }: { sp: SP }) {
    const ev = evaluate(input, { kind: "development", ref: null, from: null }, { ...policy, periodDays: 0 });
    const prov = PROVENANCE.find(p => p === one(sp.prov)) as Provenance | undefined;
    const list = (ev?.sources ?? []).filter(s => !prov || s.provenance === prov);
    return (
      <Section title="Review existing evidence" note="Every record Professional, Competen Learning and your Passport hold for you, with where it came from. Nothing here is copied: each opens in the module that owns it.">
        <nav aria-label="Filter by provenance" className="mb-3 flex flex-wrap gap-2 text-[12.5px]">
          <Link href="?view=evidence" aria-current={!prov ? "true" : undefined} className={`rounded-full border px-3 py-1 font-semibold ${focusRing} ${!prov ? "border-gray-900" : "border-gray-300"}`}>All ({ev?.sources.length ?? 0})</Link>
          {PROVENANCE.map(p => (
            <Link key={p} href={`?view=evidence&prov=${p}`} aria-current={prov === p ? "true" : undefined} className={`rounded-full border px-3 py-1 font-semibold ${focusRing} ${prov === p ? "border-gray-900" : "border-gray-300"}`}>
              {PROVENANCE_LABEL[p]} ({(ev?.sources ?? []).filter(s => s.provenance === p).length})
            </Link>
          ))}
        </nav>
        <SourceList sources={list} empty="No records of this kind yet." />
        {ev && ev.findings.evidence_confidence.limitations.length > 0 && <ul className="mt-3 space-y-0.5 text-[12.5px] text-amber-900">{ev.findings.evidence_confidence.limitations.map(l => <li key={l}>{l}</li>)}</ul>}
      </Section>
    );
  }

  // ── E5: previous evaluations ──
  function HistoryView() {
    if (history.evaluations === null) return <Unreadable what="previous evaluations" />;
    const correctedBy = (id: string) => evaluations.filter(e => e.supersedes_id === id);
    return (
      <Section id="history-h" title="Previous evaluations" note="Each is kept exactly as it was recorded. A later evaluation or a correction is a new one.">
        {evaluations.length === 0 ? <Empty>No evaluations recorded yet. Evaluate something, then record it.</Empty> : (
          <>
            <ul className="divide-y divide-gray-100">
              {evaluations.map(e => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <div>
                    <Link href={`?eval=${e.id}`} className={`text-[14px] font-semibold text-gray-900 underline-offset-2 hover:underline ${focusRing}`}>{e.scope_label}</Link>
                    <p className="text-[12.5px] text-gray-600">
                      {[SCOPE_LABEL[e.scope_kind], fmtDate(e.evaluated_at), e.findings?.evidence_confidence?.confidence ? `${CONFIDENCE_LABEL[e.findings.evidence_confidence.confidence]} evidence confidence` : null,
                        e.interpretation === "deterministic_and_ai" ? "with a labelled AI summary" : "no AI", e.supersedes_id ? "a correction" : null,
                        correctedBy(e.id).length ? "corrected later" : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {evaluations.length >= 2 && (
              <form method="get" className="mt-4 grid gap-3 rounded-xl border border-gray-200 p-3 md:grid-cols-3">
                <Field label="Compare" htmlFor="cmp-a"><select id="cmp-a" name="a" className={inputCls} defaultValue={evaluations[1].id}>{evaluations.map(e => <option key={e.id} value={e.id}>{e.scope_label}, {fmtDate(e.evaluated_at)}</option>)}</select></Field>
                <Field label="with" htmlFor="cmp-b"><select id="cmp-b" name="b" className={inputCls} defaultValue={evaluations[0].id}>{evaluations.map(e => <option key={e.id} value={e.id}>{e.scope_label}, {fmtDate(e.evaluated_at)}</option>)}</select></Field>
                <div className="flex items-end"><button type="submit" className={secondaryBtn} style={{ color: x.accent }}>Compare</button></div>
              </form>
            )}
          </>
        )}
      </Section>
    );
  }

  function SnapshotView({ id }: { id: string }) {
    const e = evaluations.find(v => v.id === id);
    if (!e) return <Section title="Not found"><Empty>That evaluation is not on your record.</Empty></Section>;
    const points = (e.findings as unknown as { points?: { strengths: Point[]; development: Point[]; competencies: Evaluation["competencies"]; outcome: string | null } }).points;
    const decisions = latestDecisions(history.decisions ?? [], e.id);
    const notes = (history.annotations ?? []).filter(a => a.evaluation_id === e.id);
    const corrects = e.supersedes_id ? evaluations.find(v => v.id === e.supersedes_id) : null;
    const correctedBy = evaluations.filter(v => v.supersedes_id === e.id);
    const sameScope = evaluations.filter(v => v.id !== e.id && v.scope_kind === e.scope_kind && (v.scope_ref ?? null) === (e.scope_ref ?? null));
    const scopeQuery = `scope=${e.scope_kind}${e.scope_ref ? `&ref=${encodeURIComponent(e.scope_ref)}` : ""}${points?.outcome ? `&outcome=${encodeURIComponent(points.outcome)}` : ""}`;
    return (
      <>
        <Section title={`Recorded ${fmtDate(e.evaluated_at)}`} note="This snapshot never changes. Its sources are references: each opens your record as it is today.">
          <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
            <div><dt className="inline font-semibold text-gray-800">Interpretation: </dt><dd className="inline text-gray-700">{e.interpretation === "deterministic_and_ai" ? "Deterministic findings, with a labelled AI summary" : "Deterministic findings only (no AI)"}</dd></div>
            <div><dt className="inline font-semibold text-gray-800">Configuration version: </dt><dd className="inline text-gray-700">{e.config_version ?? "Defaults (no published version)"}</dd></div>
            <div><dt className="inline font-semibold text-gray-800">Framework versions: </dt><dd className="inline text-gray-700">{e.framework_versions?.length ? e.framework_versions.join(", ") : "None: evaluated without a catalogue"}</dd></div>
            <div><dt className="inline font-semibold text-gray-800">Context: </dt><dd className="inline text-gray-700">{[e.context?.profession, e.context?.role, e.context?.specialty, e.context?.setting].filter(Boolean).join(", ") || "Not recorded"}</dd></div>
            {e.ai_model && <div><dt className="inline font-semibold text-gray-800">AI model and policy: </dt><dd className="inline text-gray-700">{e.ai_model} · {e.ai_policy_version}</dd></div>}
          </dl>
          {corrects && <p className="mt-2 text-[13px] text-gray-800">This corrects <Link href={`?eval=${corrects.id}`} className="font-semibold underline">{fmtDate(corrects.evaluated_at)}</Link>: {e.correction_note}</p>}
          {correctedBy.map(c => <p key={c.id} className="mt-2 text-[13px] font-semibold text-amber-900">Corrected by a later evaluation: <Link href={`?eval=${c.id}`} className="underline">{fmtDate(c.evaluated_at)}</Link> ({c.correction_note})</p>)}
          <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
            <Link href={`?${scopeQuery}`} className={`font-semibold ${focusRing}`} style={{ color: x.accent }}>Evaluate this again now →</Link>
            {policy.corrections === "linked" && <Link href={`?${scopeQuery}&correct=${e.id}`} className={`font-semibold ${focusRing}`} style={{ color: x.accent }}>Record a corrected evaluation →</Link>}
            {sameScope.length > 0 && <Link href={`?compare=${sameScope[0].id},${e.id}`} className={`font-semibold ${focusRing}`} style={{ color: x.accent }}>Compare with {fmtDate(sameScope[0].evaluated_at)} →</Link>}
          </div>
        </Section>
        <EvaluationBody ev={{ scope: { kind: e.scope_kind, ref: e.scope_ref, label: e.scope_label, from: e.period_from, to: e.period_to }, sources: e.sources, findings: e.findings,
          limitations: e.limitations, frameworkVersions: e.framework_versions, strengths: points?.strengths ?? [], development: points?.development ?? [], competencies: points?.competencies ?? [] }}
          ai={e.ai_text ? { text: e.ai_text, model: e.ai_model } : null} />
        <Section id="next-h" title="Recommended next steps" note="Accepting one that adds a need, goal or activity adds it through Needs & plan, where you can edit it. Nothing is added unless you accept.">
          <RecommendationList recs={e.recommendations ?? []} evaluationId={e.id} decisions={decisions} accent={x.accent} createdHref={createdHref} />
        </Section>
        <Section id="notes-h" title="Your notes on this evaluation" note="Optional and private. A revised note is added beside the earlier one.">
          {history.annotations === null ? <Unreadable what="notes" /> : notes.length === 0 ? <Empty>No notes yet.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {notes.map(n => (
                <li key={n.id} className="py-2">
                  <p className="text-[12px] text-gray-500">{fmtDate(n.created_at)}{n.template_label ? ` · ${n.template_label.split(":")[0]}` : ""}{n.supersedes_id ? " · revises an earlier note" : ""}{notes.some(m => m.supersedes_id === n.id) ? " · revised later" : ""}</p>
                  <p className="whitespace-pre-wrap text-[13.5px] text-gray-800">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <ApiForm action="/api/individual/professional/evaluation-annotations" submitLabel="Add note" accent={x.accent} savedText="Note added.">
              <input type="hidden" name="evaluationId" value={e.id} />
              {policy.templates.length > 0 && (
                <Field label="Template (optional)" htmlFor="note-template" hint={policy.templates.map(t => t.label).join(" · ")}>
                  <select id="note-template" name="templateCode" className={inputCls} defaultValue="">
                    <option value="">No template</option>
                    {policy.templates.map(t => <option key={t.code} value={t.code}>{t.label.split(":")[0]}</option>)}
                  </select>
                </Field>
              )}
              {notes.length > 0 && (
                <Field label="Revising an earlier note? (optional)" htmlFor="note-revises">
                  <select id="note-revises" name="supersedesId" className={inputCls} defaultValue="">
                    <option value="">A new note</option>
                    {notes.map(n => <option key={n.id} value={n.id}>{fmtDate(n.created_at)}: {n.body.slice(0, 60)}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Your note" htmlFor="note-body"><textarea id="note-body" name="body" rows={4} required minLength={3} maxLength={5000} className={inputCls} /></Field>
            </ApiForm>
          </div>
        </Section>
        <p className="mb-5 text-[12.5px] text-gray-600">
          {policy.sharing === "offer" ? <>Private to you. To show it to someone, add it to a link on the <Link href={experienceHref("professional", "share")} className="font-semibold underline">Share your Passport</Link> page, where it is shown as formative with its sources and limitations.</> : "Private to you. Evaluations are not shared on Passport links."}
        </p>
      </>
    );
  }

  function CompareView({ ids }: { ids: string[] }) {
    const [a, b] = ids.map(id => evaluations.find(e => e.id === id));
    if (!a || !b) return <Section title="Not found"><Empty>One of those evaluations is not on your record.</Empty></Section>;
    return (
      <Section id="compare-h" title="Compare evaluations" note={`${a.scope_label} (${fmtDate(a.evaluated_at)}) and ${b.scope_label} (${fmtDate(b.evaluated_at)}).`}>
        <ComparisonView cmp={compareEvaluations(a as EvaluationRow, b as EvaluationRow)} />
      </Section>
    );
  }
}
