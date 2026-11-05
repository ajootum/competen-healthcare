import Link from "next/link";
import { experienceHref } from "@/lib/individual/experiences";
import type { IndividualPolicy } from "@/lib/individual/policy";
import { listEvaluations, listMappings, listMaterials, progressRows } from "@/lib/individual/scholar/store";
import { buildProgress } from "@/lib/individual/scholar/progress";
import { EVALUATION_CONFIDENCE_LABEL } from "@/lib/individual/scholar/config";
import { evaluateScope, evaluationRules, type EvaluationScope } from "@/lib/individual/scholar/evaluation-data";
import type { Evaluation, Recommendation } from "@/lib/individual/scholar/evaluation";
import { compareSnapshots, dimensionsOf, filterSnapshots, goalStatus, historyOf, needsAttention, snapshotRow, supportedCount, unprovenOf, type SnapshotRow } from "@/lib/individual/scholar/evaluate-goals";
import { loadInsights } from "@/lib/individual/scholar/plan-data";
import { planCompletion } from "@/lib/individual/scholar/plan-insights";
import { sectionMatchesTopic } from "@/lib/individual/scholar/apply-context";
import { loadCompetencyProfile } from "../../my-competencies/competency-profile-data";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { expectedMap, loadSelfSide, overviewFrom, progressFacts, verificationFacts } from "@/lib/assessment/adapters/scholar/overview-data";
import { loadStageSide } from "@/lib/assessment/adapters/scholar/progression-read";
import type { OverviewCompetency } from "@/lib/assessment/adapters/scholar/competency-overview-model";
import type { CatalogueCompetency } from "@/lib/individual/scholar/catalogue";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { PhoneFold } from "./phone-fold";
import { CompetencyTable, CountBar, GoalCard, GoalChip, OverTime, StatusChip, Tile, evaluateHref, snapshotWhen, type CompetencyRow, type GoalCardData } from "./evaluate-parts";
import { EvaluationView } from "./evaluation-view";
import { toneAction } from "./progress-parts";
import { evaluationHref, sourceHref, studyHref } from "./question-view";

// MY PROGRESS, THE DASHBOARDS -- SCHOLAR-EVALUATE-GOALS-01 (owner final alignment, 5 Nov 2026). Read only: nothing here writes, and every action is a link back to
// Evaluate. They read the same records, mappings and rules as Evaluate through evaluateScope, so there is no second scoring engine, and what a completed evaluation
// adds shows here without being repeated. Saved snapshots are read as they were kept.

type Ctx = { admin: unknown; userId: string };
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const box = "rounded-xl bg-[var(--cmp-app-surface)] p-4 ring-1 ring-gray-200";
const sectionLink = (s: { chunkId: string | null; materialId: string | null }) => (s.materialId && s.chunkId ? sourceHref(s.materialId, s.chunkId) : studyHref(s.materialId ?? ""));
const recHref = (r: Recommendation) => r.kind === "case" ? `${studyHref("apply")}${r.chunkId ? `?section=${r.chunkId}` : ""}`
  : r.kind === "teach" ? `${studyHref("learn")}${r.chunkId ? `?section=${r.chunkId}` : ""}`
    : r.kind === "revise" || r.kind === "spaced" ? `${studyHref("revise")}${r.materialId ? `?material=${r.materialId}` : ""}` : sectionLink(r);
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A goal or priority from My Plan, read through the one evaluation engine. Shared by Evaluate, which starts from it, and Progress, which reports it. */
export async function loadGoalCards(ctx: Ctx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string }) {
  const plan = await loadInsights(ctx as never, policy, o).catch(() => null);
  const planned = plan?.ok ? plan : null;
  const settings = planned?.settings ?? null;
  const goals: { title: string; kindLabel: string; topic: string }[] = [...(settings?.priorities ?? [])].slice(0, 6).map(t => ({ title: t, kindLabel: "My Plan priority", topic: t }));
  if (!goals.length && settings?.goal) goals.push({ title: settings.goal, kindLabel: "My Plan goal", topic: settings.goal });
  const cards: GoalCardData[] = await Promise.all(goals.map(async g => {
    const r = await evaluateScope(ctx.admin, ctx.userId, policy, { kind: "topic", topic: g.topic } as EvaluationScope, { method: "existing", now: o.now.toISOString() });
    const own = planned ? planned.occurrences.filter(x => sectionMatchesTopic({ concepts: [x.title], materialTitle: "" }, g.topic)) : [];
    const done = planned && own.length ? planCompletion(own, planned.studyDays, o.today) : null;
    const plannedCount = done && done.planned ? { planned: done.planned, completed: done.completed } : null;
    const evaluateLink = evaluateHref("goals", { start: g.topic }) + "#ev-start-h";
    if (!r.ok) {
      const dims = dimensionsOf(null);
      return { key: g.topic, title: g.title, kindLabel: g.kindLabel, status: "not_assessed" as const, dims, supported: 0, unproven: unprovenOf(dims), planned: plannedCount, competencies: [], sources: [], recommendations: [], evidenceLine: "", scope: null, startHref: evaluateLink, noMatch: true };
    }
    const e = r.evaluation, dims = dimensionsOf(e as never);
    const areas = [...e.gaps, ...e.strengths, ...e.insufficientAreas].filter(a => a.chunkId);
    const c = e.evidence.counts;
    return {
      key: g.topic, title: g.title, kindLabel: g.kindLabel, status: goalStatus(dims, e.confidence.level), dims, supported: supportedCount(dims), unproven: unprovenOf(dims), planned: plannedCount,
      competencies: [...new Set((e.cfca ?? []).flatMap(d => d.units.flatMap(u => u.competencies.map(x => x.label))))],
      sources: [...new Map(areas.map(a => [sectionLink(a), { label: a.label, href: sectionLink(a) }])).values()],
      recommendations: e.recommendations.map(rec => ({ label: rec.label, reason: rec.reason, href: recHref(rec) })),
      evidenceLine: `Evidence: ${c.independentQuestions ?? 0} questions answered, ${c.reviews ?? 0} spaced recalls, ${c.independentDecisions ?? 0} clinical case decisions. Reading is not counted as an outcome.`,
      scope: { kind: "topic", topic: g.topic }, startHref: evaluateLink, noMatch: false,
    };
  }));
  return { cards, planned, settings };
}

/** Learning evidence against the competencies the learner's learning is linked to, each apart from self-assessment, stage and verification. */
export async function loadCompetencyRows(ctx: Ctx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string }) {
  const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
  const catalogue = learner.competencies ?? [];
  const live = await evaluateScope(ctx.admin, ctx.userId, policy, { kind: "all" }, { method: "existing", now: o.now.toISOString() });
  const areas = live.ok ? (live.evaluation.cfca ?? []).flatMap(d => d.units.flatMap(u => u.competencies)) : [];
  const worked = [...new Map(areas.filter(a => a.n > 0 || a.chunkId).map(a => [a.key, a])).values()].slice(0, 8);
  const facts = catalogue.length ? await competencyFacts(ctx, o.today, o.tz, catalogue) : new Map<string, ReturnType<typeof factsOf>>();
  const rows: CompetencyRow[] = await Promise.all(worked.map(async a => {
    const r = await evaluateScope(ctx.admin, ctx.userId, policy, { kind: "competency", competencyId: a.key } as EvaluationScope, { method: "existing", now: o.now.toISOString() });
    const sources = r.ok ? [...r.evaluation.gaps, ...r.evaluation.strengths, ...r.evaluation.insufficientAreas].filter(x => x.chunkId && x.kind === "section") : [];
    const f = facts.get(a.key);
    return {
      id: a.key, title: a.label, dims: dimensionsOf(r.ok ? r.evaluation as never : null), sources: [...new Map(sources.map(s => [sectionLink(s), { label: s.label, href: sectionLink(s) }])).values()],
      self: f?.self ?? null, stage: f?.stage ?? null, verified: !!f?.verified, startHref: evaluateHref("competencies", { startCompetency: a.key }) + "#ev-start-h",
    };
  }));
  return { rows, catalogue, more: areas.length > rows.length };
}

/** Pure. What one competency's overview row says of the learner's own rating, an approved stage and independent verification. Each stays its own fact. */
export function factsOf(r: { self: unknown; stages: readonly unknown[]; verification: unknown }): { self: string | null; stage: string | null; verified: boolean } {
  const self = r.self as { rating?: unknown; descriptor?: unknown; latest?: { rating?: unknown; descriptor?: unknown } } | null;
  const word = self?.descriptor ?? self?.latest?.descriptor;
  const stage = r.stages[0] as { summary?: unknown } | undefined;
  const verification = r.verification as { state?: unknown } | null;
  return { self: self ? (typeof word === "string" ? word : "Self-assessed") : null, stage: typeof stage?.summary === "string" ? stage.summary : null, verified: verification?.state === "verified" };
}

async function competencyFacts(ctx: Ctx, today: string, tz: string, catalogue: readonly CatalogueCompetency[]) {
  const out = new Map<string, ReturnType<typeof factsOf>>();
  try {
    const [d, passport, side, stageSide] = await Promise.all([
      loadCompetencyProfile(ctx.admin as never, ctx.userId, today, tz, { coverage: false }), loadIndividualPassport(ctx.admin as never, ctx.userId, today).catch(() => null),
      loadSelfSide(ctx.admin as never, ctx.userId, expectedMap(catalogue as never)), loadStageSide(ctx.admin as never, ctx.userId),
    ]);
    const competencies: OverviewCompetency[] = catalogue.map(c => ({ id: c.id, code: c.code, title: c.title, domain: c.domain, expected: c.expectedLevel, contentStatus: c.contentStatus }) as OverviewCompetency);
    const model = overviewFrom({ competencies, side: side.state === "ready" ? side : null, progress: progressFacts(d.progress), activity: d.activity, verifications: verificationFacts(passport), stages: stageSide.state === "ready" ? stageSide.entries : [] } as never);
    for (const r of model.rows) out.set(r.competency.id, factsOf(r as never));
  } catch { /* Not read: each column then says nothing was decided. */ }
  return out;
}

/** The one picture of My Progress: different measures side by side, never averaged into a score. Read only: every action links back to Evaluate. */
export async function OverviewDashboard({ ctx, policy, o, due }: { ctx: Ctx; policy: IndividualPolicy; o: { now: Date; tz: string; today: string }; due: number | null }) {
  const [{ cards }, live, rows, maps, learner, materials] = await Promise.all([
    loadGoalCards(ctx, policy, o), evaluateScope(ctx.admin, ctx.userId, policy, { kind: "all" }, { method: "existing", now: o.now.toISOString() }),
    progressRows(ctx.admin, ctx.userId), listMappings(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId), listMaterials(ctx.admin, ctx.userId),
  ]);
  const e = live.ok ? live.evaluation : null;
  const dims = dimensionsOf(e as never);
  const cov = e?.coverage.state === "measured" ? e.coverage : null;
  const trend = rows.ok ? buildProgress({ ...rows.data, today: o.today }).trend : [];
  const most = Math.max(1, ...trend.map(w => w.attempts));
  const k = e?.knowledge.state === "measured" ? e.knowledge : null;
  const conf = e?.confidence ?? null;
  const catalogue = learner.competencies ?? [];
  const accepted = maps.ok ? maps.data.mappings.filter(m => m.state === "accepted") : [];
  const practised = (e?.cfca ?? []).flatMap(d => d.units.flatMap(u => u.competencies)).filter(c => c.n > 0).length;
  const need = evaluationRules(policy).minEvidence;
  return (
    <div className="space-y-4" data-progress-overview>
      <section aria-labelledby="ov-plan-h">
        <h2 id="ov-plan-h" className="text-[18px] font-bold text-gray-900">Progress against My Plan</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile label="Goals with supporting evidence" value={cards.length ? `${cards.filter(c => c.supported > 0).length} of ${cards.length}` : "No goals set"} note="Not necessarily achieved" />
          <Tile label="Sections with activity" value={cov ? `${cov.sections.worked} of ${cov.sections.total}` : "Not measured"} note="Coverage, not understanding" />
          <Tile label="Practice accuracy" value={k ? `${k.percent}%` : "Not enough yet"} note={k ? `From ${k.independent} marked answers` : "Too few marked answers to say"} />
          <Tile label="Revision cards due" value={due === null ? "Could not be read" : String(due)} note="From your own ratings" />
        </dl>
        <p className="mt-2 text-[12.5px] text-gray-700">These are different measures. They are deliberately not averaged into one competency score.</p>
      </section>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="ov-activity-h" className={box}>
          <PhoneFold summary={<h3 id="ov-activity-h" className="inline text-[15px] font-bold text-gray-900">Learning activity over time</h3>}>
          <p className="text-[12.5px] text-gray-700">Answers given each week. Study activity, not a measure of competence.</p>
          {trend.some(w => w.attempts > 0) ? (
            <ol className="mt-2 flex h-28 items-end gap-1.5" aria-label="Answers by week">
              {trend.map(w => (
                <li key={w.weekStart} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5" title={`${w.attempts} answers`}>
                  <span className="text-[11px] tabular-nums text-gray-700">{w.attempts || ""}</span>
                  <div aria-hidden className="w-full rounded-t bg-[var(--cmp-learn-next-accent)]" style={{ height: `${Math.round((w.attempts / most) * 70)}%` }} />
                  <span className="text-[10.5px] text-gray-600">{new Date(`${w.weekStart}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                </li>
              ))}
            </ol>
          ) : <p className="mt-2 text-[13px] text-gray-700">No activity recorded in the last 8 weeks.</p>}
          </PhoneFold>
        </section>
        <section aria-labelledby="ov-conf-h" className={box} data-evidence-confidence>
          <h3 id="ov-conf-h" className="text-[15px] font-bold text-gray-900">Evidence confidence</h3>
          <p className="mt-1 text-[16px] font-bold text-gray-900">{conf ? EVALUATION_CONFIDENCE_LABEL[conf.level] : "Could not be read"}</p>
          {conf && <p className="text-[13px] text-gray-800">{conf.independent} independent {conf.independent === 1 ? "piece" : "pieces"} of evidence, from {conf.sources} {conf.sources === 1 ? "section" : "sections"}.</p>}
          <p className="mt-1 text-[12.5px] text-gray-700">Insufficient evidence is not poor performance. AI-marked and self-rated answers count for less, and are shown apart under Learning.</p>
        </section>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section aria-labelledby="ov-dims-h" className={box}>
          <h3 id="ov-dims-h" className="text-[15px] font-bold text-gray-900">Knowledge, recall and application</h3>
          <div className="mt-2 space-y-2.5">{dims.map(d => <div key={d.key} data-evidence-bar={d.key}><CountBar label={`${d.label} evidence`} have={d.have} of={Math.max(d.need ?? need, d.have)} /><div className="mt-1"><StatusChip status={d.status} /></div></div>)}</div>
          <p className="mt-2 text-[12.5px] text-gray-700">These bars show how much evidence there is, not how well you did.</p>
        </section>
        <div className="space-y-3">
          <section aria-labelledby="ov-cov-h" className={box}>
            <PhoneFold summary={<h3 id="ov-cov-h" className="inline text-[15px] font-bold text-gray-900">Reading and revision coverage</h3>}>
              <div className="mt-2 space-y-2.5">
                {cov && <CountBar label="Sections with activity" have={cov.sections.worked} of={cov.sections.total} />}
                {cov && materials.ok && <CountBar label="Materials with activity" have={cov.materials} of={Math.max(materials.data.length, cov.materials)} />}
              </div>
              <p className="mt-2 text-[12.5px] text-gray-700">Activity does not establish that material was understood or retained.</p>
            </PhoneFold>
          </section>
          <section aria-labelledby="ov-fw-h" className={box} data-framework-coverage>
            <PhoneFold summary={<h3 id="ov-fw-h" className="inline text-[15px] font-bold text-gray-900">Competency framework coverage</h3>}>
            {catalogue.length ? (
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><dd className="text-[20px] font-bold tabular-nums text-gray-900">{catalogue.length}</dd><dt className="text-[12px] text-gray-700">In your framework</dt></div>
                <div><dd className="text-[20px] font-bold tabular-nums text-gray-900">{accepted.length}</dd><dt className="text-[12px] text-gray-700">Accepted material links</dt></div>
                <div><dd className="text-[20px] font-bold tabular-nums text-gray-900">{practised}</dd><dt className="text-[12px] text-gray-700">With mapped practice</dt></div>
              </dl>
            ) : <p className="mt-1 text-[13px] text-gray-800">No framework is applied yet. Your learning is still reported here.</p>}
            <p className="mt-2 text-[12.5px] text-gray-700">Framework evidence, not verified competence.</p>
            </PhoneFold>
          </section>
        </div>
      </div>
      {cards.length > 0 && (
        <section aria-labelledby="ov-pri-h">
          <h3 id="ov-pri-h" className="text-[15px] font-bold text-gray-900">Learning priorities and next actions</h3>
          <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200">
            {cards.map(c => (
              <li key={c.key} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 px-3.5 py-3" data-goal={c.title}>
                <div className="min-w-0 flex-1 basis-[16rem]">
                  <p className="break-words text-[14.5px] font-bold text-gray-900">{c.title}</p>
                  <p className="text-[13px] text-gray-700">{c.noMatch ? "Nothing in your materials matches this yet." : c.unproven.length ? `Not yet shown: ${c.unproven.join(", ")}.` : "All four outcome checks are supported by your evidence."}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2"><GoalChip status={c.status} /><Link href={c.startHref} prefetch={false} className={`text-[13.5px] ${toneAction.link}`}>Go to Evaluate</Link></div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export async function GoalsDashboard({ ctx, policy, o, sid }: { ctx: Ctx; policy: IndividualPolicy; o: { now: Date; tz: string; today: string }; sid: string | null }) {
  const [{ cards, planned, settings }, history] = await Promise.all([loadGoalCards(ctx, policy, o), listEvaluations(ctx.admin, ctx.userId, 100)]);
  const snapshots = history.ok ? history.data.map(snapshotRow) : [];
  const overall = planned?.tiles.plan ?? null;
  const titles = new Set(cards.map(c => c.key));
  const tracked = [...new Set(snapshots.map(r => r.label))].filter(l => titles.has(l)).slice(0, 3);
  const planHref = studyHref("plan");
  return (
    <div className="space-y-5" data-progress-goals>
      <section aria-labelledby="ach-h">
        <h2 id="ach-h" className="text-[18px] font-bold text-gray-900">My planned achievements</h2>
        <p className="mt-1 max-w-[70ch] text-[13.5px] text-gray-800">Plan completion, learning evidence and verified clinical competence are different things. Not assessed is never treated as failure.</p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-3">
          <Tile label="Planned activities, last 28 days" value={overall && overall.planned ? `${overall.completed} of ${overall.planned}` : "None planned"} note="An activity measure only" />
          <Tile label="Goals with supporting evidence" value={cards.length ? `${cards.filter(c => c.supported > 0).length} of ${cards.length}` : "No goals set"} note="Not necessarily achieved" />
          <Tile label="Goals needing attention" value={cards.length ? String(cards.filter(c => needsAttention(c.status)).length) : "None yet"} note="A learning gap, or evidence still to collect" />
        </dl>
      </section>
      {settings?.examDate && settings.examDate >= o.today && <p className="text-[13.5px] text-gray-800"><span className="font-semibold">{settings.examLabel ?? "Your exam or assessment"}: </span>{shortDay(settings.examDate)}</p>}
      <section aria-labelledby="progress-h">
        <h2 id="progress-h" className="text-[16px] font-bold text-gray-900">Progress against My Plan</h2>
        {cards.length === 0 ? (
          <div className={`mt-2 text-[14px] text-gray-800 ${box}`}>
            <p>You have not set goals or priorities yet, so there is nothing to compare your evidence against.</p>
            <p className="mt-1"><Link href={planHref} className={toneAction.link}>Set a goal in My Plan</Link></p>
          </div>
        ) : <ul className="mt-2 space-y-2">{cards.map(c => <GoalCard key={c.key} g={c} />)}</ul>}
        {!planned && <p className="mt-2 text-[13px] text-gray-700">My Plan could not be read just now, so goals are not shown.</p>}
        <p className="mt-2 text-[13px]"><Link href={planHref} className={toneAction.link}>Change your goals in My Plan</Link></p>
      </section>
      {tracked.length > 0 && (
        <section aria-labelledby="time-h" className={box}>
          <h2 id="time-h" className="text-[16px] font-bold text-gray-900">Development over time</h2>
          <p className="mt-0.5 text-[13px] text-gray-700">From evaluations you saved. Outcome checks supported each time: a count of evidence, not a grade.</p>
          <div className="mt-2 space-y-3">{tracked.map(l => <div key={l}><p className="text-[13.5px] font-semibold text-gray-900">{l}</p><OverTime rows={historyOf(snapshots, l)} /></div>)}</div>
        </section>
      )}
      {void sid}
    </div>
  );
}

export async function CompetenciesDashboard({ ctx, policy, o }: { ctx: Ctx; policy: IndividualPolicy; o: { now: Date; tz: string; today: string } }) {
  const { rows, catalogue, more } = await loadCompetencyRows(ctx, policy, o);
  const some = rows.filter(c => c.dims.some(d => d.status !== "not_assessed")).length;
  const verified = rows.filter(r => r.verified).length;
  return (
    <div className="space-y-4" data-progress-competencies>
      <div>
        <h2 className="text-[18px] font-bold text-gray-900">Competency development</h2>
        <p className="mt-1 max-w-[70ch] text-[13.5px] text-gray-800">Your mapped learning evidence against applicable criteria. Grey means not assessed, not failed. This is not independent clinical verification, and no percentage or stage is worked out from it.</p>
      </div>
      {!catalogue.length ? (
        <p className={`text-[14px] text-gray-800 ${box}`} data-no-framework>You have no competency framework applied yet, so competencies cannot be shown. Your learning is still reported under Learning. You can choose a programme in <Link href={experienceHref("scholar", "my-competencies")} className={toneAction.link}>My Competencies</Link>.</p>
      ) : (
        <>
          <dl className="grid gap-2 sm:grid-cols-3">
            <Tile label="Competencies with some evidence" value={`${some} of ${catalogue.length}`} note="Evidence coverage, not achievement" />
            <Tile label="With a learning gap" value={String(rows.filter(c => c.dims.some(d => d.status === "gap")).length)} note="From your marked answers" />
            <Tile label="Independently verified" value={verified ? String(verified) : "None"} note="Scholar does not assess this" />
          </dl>
          {rows.length === 0 ? <p className={`text-[14px] text-gray-800 ${box}`}>None of your learning is linked to a competency yet. Link your notes to competencies from a material, then your evidence shows here.</p> : <CompetencyTable rows={rows} />}
          {more && <p className="text-[13px] text-gray-700">Showing the first {rows.length}. <Link href={experienceHref("scholar", "my-competencies")} className={toneAction.link}>See all in My Competencies</Link></p>}
        </>
      )}
    </div>
  );
}

export async function LearningDashboard({ ctx, policy, o }: { ctx: Ctx; policy: IndividualPolicy; o: { now: Date } }) {
  const live = await evaluateScope(ctx.admin, ctx.userId, policy, { kind: "all" }, { method: "existing", now: o.now.toISOString() });
  if (!live.ok) return <p className={`text-[14px] text-gray-800 ${box}`}>{live.error}</p>;
  const e: Evaluation = live.evaluation;
  const dims = dimensionsOf(e as never), c = e.evidence.counts;
  const cov = e.coverage.state === "measured" ? e.coverage : null;
  const need = evaluationRules(policy).minEvidence;
  return (
    <div className="space-y-4" data-progress-learning>
      <h2 className="text-[18px] font-bold text-gray-900">My learning and reading</h2>
      <dl className="grid gap-2 sm:grid-cols-3">
        <Tile label="Sections worked on" value={cov ? `${cov.sections.worked} of ${cov.sections.total}` : "Not measured"} note="Coverage only, not understanding" />
        <Tile label="Independently marked questions" value={String(c.independentQuestions ?? 0)} note="Marked by the app" />
        <Tile label="Spaced recalls" value={String(c.reviews ?? 0)} note="Your own rating, after a gap" />
      </dl>
      <section aria-labelledby="bars-h" className={box}>
        <h3 id="bars-h" className="text-[15px] font-bold text-gray-900">Evidence by learning dimension</h3>
        <p className="mt-0.5 text-[13px] text-gray-700">Bars show evidence collected against the minimum Scholar needs before saying anything. They are not ability or competency scores.</p>
        <div className="mt-3 space-y-3">{dims.map(d => {
          const of = Math.max(d.need ?? need, d.have);
          return <div key={d.key} data-evidence-bar={d.key}><CountBar label={`${d.label} evidence`} have={d.have} of={of} /><div className="mt-1"><StatusChip status={d.status} /></div></div>;
        })}</div>
      </section>
      <details className={box} suppressHydrationWarning>
        <summary className={`cursor-pointer text-[14.5px] font-bold text-gray-900 pointer-coarse:py-3.5 ${focusRing}`}>All the detail, including how your evidence was marked</summary>
        <div className="mt-3"><EvaluationView r={e} confidence={e.confidence} limitations={e.limitations} cfca={e.cfca} /></div>
      </details>
    </div>
  );
}

/** Saved evaluations: search, reopen, compare. The same list from Evaluate, which owns them, and from My Progress, which reports them. */
export async function HistoryDashboard({ ctx, q, from, a, b, sid, action, hidden }: { ctx: Ctx; q?: string; from?: string; a?: string; b?: string; sid: string | null; action: string; hidden: { name: string; value: string } }) {
  const history = await listEvaluations(ctx.admin, ctx.userId, 100);
  const snapshots: SnapshotRow[] = history.ok ? history.data.map(snapshotRow) : [];
  const shown = filterSnapshots(snapshots, { q, from });
  const first = snapshots.find(r => r.id === a), second = snapshots.find(r => r.id === b);
  const compared = first && second ? compareSnapshots(first, second) : null;
  const field = `w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[14px] text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
  return (
    <section aria-labelledby="ev-hist-h" className="cmp-learn-next space-y-3" data-progress-history>
      <h2 id="ev-hist-h" className="text-[18px] font-bold text-gray-900">Evaluation history</h2>
      <form method="get" action={action} role="search" className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
        <input type="hidden" name={hidden.name} value={hidden.value} />
        {sid && <input type="hidden" name="study" value={sid} />}
        <input name="q" defaultValue={q ?? ""} aria-label="Search your evaluations" placeholder="Search by goal, topic or competency" className={field} />
        <input type="date" name="from" defaultValue={from ?? ""} aria-label="From this date" className={field} />
        <button type="submit" className={toneAction.primary}>Search</button>
      </form>
      {compared && (
        <div className={box} data-evaluate-compare>
          <p className="text-[14px] font-bold text-gray-900">{compared.older.label}: {snapshotWhen(compared.older.createdAt)} and {snapshotWhen(compared.newer.createdAt)}</p>
          <ul className="mt-2 space-y-1">{compared.changes.map(ch => <li key={ch.key} className="flex flex-wrap items-center gap-2 text-[13px]"><span className="w-24 font-semibold text-gray-800">{ch.label}</span><StatusChip status={ch.from} /><span aria-hidden>→</span><StatusChip status={ch.to} /><span className="text-gray-700">{ch.movement === "same" ? "No change" : ch.movement === "more" ? "More shown" : "Changed"}</span></li>)}</ul>
        </div>
      )}
      {first && second && !compared && <p className="text-[13px] text-gray-800">Those two evaluations are of different things, so they cannot be compared. Choose two of the same.</p>}
      {!history.ok ? <p className="text-[13px] text-gray-600">{history.notProvisioned ? "Evaluations are not kept here yet." : "Your evaluations could not be read just now."}</p>
        : snapshots.length === 0 ? <p className="text-[13px] text-gray-600">None yet. An evaluation you complete or save in <Link href={evaluateHref("goals")} className={toneAction.link}>Evaluate</Link> is listed here.</p>
          : shown.length === 0 ? <p className="text-[13px] text-gray-600">Nothing matches.</p> : (
            <form method="get" action={action}>
              <input type="hidden" name={hidden.name} value={hidden.value} />
              <ul className="space-y-2">{shown.slice(0, 30).map(h => (
                <li key={h.id} className="rounded-lg bg-[var(--cmp-app-surface)] px-3 py-2 text-[14px] ring-1 ring-[var(--learn-border)]" data-snapshot={h.id} data-review={h.review ? "1" : "0"}>
                  <Link href={evaluationHref(h.id)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>{h.label}</Link>
                  <span className="block text-[12.5px] text-gray-600">{h.methodLine} · {snapshotWhen(h.createdAt)} · {h.supported} of 4 outcome checks supported</span>
                  <span className="mt-1 flex flex-wrap gap-3 text-[12.5px] text-gray-800">
                    <label className="inline-flex items-center gap-1 pointer-coarse:min-h-[var(--cmp-touch-min)]"><input type="radio" name="a" value={h.id} defaultChecked={a === h.id} /> Compare this</label>
                    <label className="inline-flex items-center gap-1 pointer-coarse:min-h-[var(--cmp-touch-min)]"><input type="radio" name="b" value={h.id} defaultChecked={b === h.id} /> with this</label>
                  </span>
                </li>
              ))}</ul>
              {shown.length > 1 && <button type="submit" className={`mt-2 ${toneAction.secondary}`}>Compare the two</button>}
            </form>
          )}
    </section>
  );
}
