import Link from "next/link";
import type { Metadata } from "next";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { casePrefill, parseCaseFrom, withStudy } from "@/lib/individual/scholar/study-carry";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { countDue, listQuestions, type QuestionRow } from "@/lib/individual/scholar/store";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice } from "../../../../../_components/chrome";
import { questionView, studyHref } from "../_components/question-view";
import StudyNav from "../_components/StudyNav";
import { ExamPapersSection } from "../_components/papers-section";
import { OsceEntry } from "../_components/osce-entry";
import { FORMATIVE_NOTICE, scholarSpace } from "@/lib/individual/scholar/spaces";
import { QuestionCard } from "../_components/client";
import { CasePlayer } from "../_components/competency-client";
import { competencyLabels, loadLearnerCatalogue, type CompetencyLabel } from "@/lib/individual/scholar/competency-view";
import { caseHistory, listMaterials, listPrivateCases, readConsent } from "@/lib/individual/scholar/store";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { ATTESTATION_TEXT, caseLibraryEnabled, loadCasePolicy } from "@/lib/cases/policy";
import { candidacyStatus, myCaseOffers } from "@/lib/cases/candidates";
import { offeringOn } from "@/lib/cases/offering-switch";
import { caseSessionView } from "@/lib/cases/library";
import { consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { CaseOfferPanel, CaseStart, ConnectedStart } from "../_components/case-client";
import { LearningSectionHead } from "@/components/ui/scholar-learning";
import { headers } from "next/headers";
import { learnerTimeZone, learnerToday } from "@/lib/individual/scholar/learning-definitions";
import { RECENT_DAYS, sectionMatchesTopic } from "@/lib/individual/scholar/apply-context";
import { connectedFor, loadLearningRecord, loadPracticeRows } from "@/lib/individual/scholar/apply-context-data";
import { PRACTICE_FORMATS, PRACTICE_FORMAT_LABEL, PRACTICE_STATUSES, PRACTICE_STATUS_LABEL, filterPractice, parsePracticeFilters, practiceGlance } from "@/lib/individual/scholar/practice-library";
import { ApplyViewNav, GlanceCard, PracticeFormats, PracticeRowView, WhyPractice, applyHref, parseApplyView } from "../_components/apply-parts";
import { toneAction } from "../_components/progress-parts";
import { osceAvailability } from "@/lib/individual/scholar/osce-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// APPLY -- COMPETEN-IND-004 s5, on SCHOLAR-APPLY-CONNECTED-01 (owner GO, 5 Nov 2026): practice drawn from the learner's whole record of
// learning, one view at a time: Today, My Priorities, Recent Learning, and All Practice & Library. Case-style questions written from the
// person's OWN material, answered with feedback that cites the source. Written from a section on a material page ("Case question").
//
// ⚠ SHARED CLINICAL CONTENT IS NOT SERVED, AND THE PAGE SAYS WHY. clinical_cases (migration 026) has a
// status and a source reference but no clinical-review record -- no reviewer, no date, no scope
// (COMPETEN-IND-002 s3.3). Scholar serves shared content only once that record exists. So this page
// reads nothing from clinical_cases, and shows the governed state below in its place.

// The title only when Individual is live: with the release gate off, a 404 must not name the route.
export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Apply" });
}

export default async function Apply({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ section?: string; from?: string; study?: string; view?: string; build?: string; q?: string; format?: string; status?: string; gap?: string; page?: string; scenarios?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const sp = await searchParams;
  const [questions, due] = await Promise.all([listQuestions(ctx.admin, ctx.userId, { kind: "case" }), countDue(ctx.admin, ctx.userId)]);
  // ── CLINICAL REASONING (CLINICAL-REASONING-01): starting a case, the student's own cases, history, and the library ──
  const [policy, materials, learner, privateCases, history, libraryOn, consent] = await Promise.all([
    loadIndividualPolicy(ctx.admin), listMaterials(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId),
    listPrivateCases(ctx.admin, ctx.userId), caseHistory(ctx.admin, ctx.userId, 10), caseLibraryEnabled(ctx.admin), readConsent(ctx.admin, ctx.userId),
  ]);
  const consentOn = consent.ok && consentStatus(consent.data, consentDocuments().published) === "on";
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "case_steps");
  // Where the case library is OFF nothing here names it: the student's own stored cases are what stays playable.
  const stored = libraryOn ? "Your stored cases and library cases are still playable." : "Your stored cases are still playable.";
  const aiNote = policy.scholarCaseGeneration === "stored_only" ? `New cases are not written here: play your stored cases${libraryOn ? " or a library case" : ""}.`
    : !consentOn ? `AI help is off, so new cases are not written. ${stored}`
      : !standing.available ? `${standing.message ?? "New AI help is limited right now."} ${stored}` : null;
  const [candidacy, offers, casePolicy] = libraryOn ? await Promise.all([candidacyStatus(ctx.admin, ctx.userId), myCaseOffers(ctx.admin, ctx.userId), loadCasePolicy(ctx.admin)]) : [null, null, null];
  // A library play's title from the student's own learner-facing view (library.ts caseSessionView), never the blueprint.
  const libTitles = new Map<string, string>();
  for (const h of history.ok ? history.data.filter(r => r.kind === "library") : []) {
    const v = await caseSessionView(ctx.admin, ctx.userId, h.id);
    if (v) libTitles.set(h.id, v.view.title);
  }
  // SCHOLAR-SESSION-AI-02: the open study session (database reads only). Without a ?section= of its own, the case
  // start opens on the session's focus: Apply from its section, else its competency, else its first material.
  const study = await loadStudy(ctx.admin, ctx.userId, sp.study, "apply", policy);
  const sid = study?.session.id ?? null;
  const preset = sp.section && /^[0-9a-f-]{36}$/i.test(sp.section) ? { chunkId: sp.section, from: parseCaseFrom(sp.from) }
    : casePrefill(study?.scope ?? null, { materialIds: (materials.ok ? materials.data : []).filter(m => m.chunkCount > 0).map(m => m.id), competencyIds: (learner.competencies ?? []).map(c => c.id) });

  // COMPETEN-SCHOLAR-01 S4: steps of one case play together, in order. Where 388 is absent no question has
  // a case_id, and the page is the MVP page.
  const cases = new Map<string, QuestionRow[]>();
  const singles: QuestionRow[] = [];
  if (questions.ok) {
    for (const q of questions.data) {
      if (q.caseId) cases.set(q.caseId, [...(cases.get(q.caseId) ?? []), q]);
      else singles.push(q);
    }
  }
  const caseList = [...cases.values()].map(steps => steps.sort((a, b) => (a.caseStep ?? 0) - (b.caseStep ?? 0)));
  const competencyIds = caseList.map(s => s[0].competencyId).filter((x): x is string => !!x);
  const labels = competencyIds.length
    ? await competencyLabels(ctx.admin, (await loadLearnerCatalogue(ctx.admin, ctx.userId)).competencies, competencyIds, new Map())
    : new Map<string, CompetencyLabel>();

  // ── SCHOLAR-APPLY-CONNECTED-01: one view at a time. Everything below comes from the learner's own records, with no AI to read it ──
  const hdrs = await headers();
  const today = learnerToday(hdrs), tz = learnerTimeZone(hdrs);
  const view = parseApplyView(sp.view);
  const catalogue = learner.competencies ?? [];
  const compTitle = (id: string) => catalogue.find(c => c.id === id)?.title ?? null;
  const record = await loadLearningRecord(ctx, tz);
  const practice = await loadPracticeRows(ctx, { competencyTitle: compTitle }).catch(() => null);
  const glance = practiceGlance(practice ?? []);
  const canWrite = !aiNote;
  const buildHref = applyHref("today", { build: "1", study: sid }) + "#case-start-h";
  const header = (
    <>
      <PageHeader accent={x.accent} eyebrow={scholarSpace("apply").eyebrow} title="Apply" intro="Turn what you have learned into meaningful practice." />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      <ApplyViewNav current={view} study={sid} />
    </>
  );
  const notice = <div className="mt-5"><BoundaryNotice notice={FORMATIVE_NOTICE} detail="Practice cases are formative simulation, not assessment, and never verified clinical competence. Your practice is private to you." /></div>;
  const start = (draw: { from: string; topic?: string | null; sessionId?: string | null }, label: string, cls: string) => <ConnectedStart draw={draw} label={label} mode={policy.scholarCaseMode} className={cls} buildHref={buildHref} />;

  // ── Today: the recommendation, what is unfinished, and the ways in ──
  if (view === "today") {
    const picked = connectedFor(record, { from: "all", topic: null, sessionId: null, materialIds: [], competencyId: null }, today);
    const pick = picked.ok ? picked.pick : null;
    const unfinished = (practice ?? []).flatMap(r => r.attempts.filter(a => a.status === "active").map(a => ({ r, a }))).slice(0, 3);
    const osce = await osceAvailability(ctx.admin, ctx.userId);
    const formats = [
      { icon: "question" as const, title: "Clinical reasoning", text: "Interpret findings and make decisions in unfolding cases.", action: "Start a case", href: buildHref },
      ...(osce.state === "on" ? [{ icon: "record" as const, title: "OSCE station", text: "Practise structured assessment and communication.", action: "Explore stations", href: withStudy(experienceHref("scholar", "study/apply/osce"), sid) }] : []),
      ...(policy.scholarExams.enabled ? [{ icon: "notes" as const, title: "Practice paper", text: "Work through your uploaded exam questions.", action: "Open papers", href: applyHref("library", { format: "paper", study: sid }) }] : []),
      { icon: "library" as const, title: "Saved practice", text: "Revisit earlier scenarios and attempts without writing anything new.", action: "Open library", href: applyHref("library", { study: sid }) },
    ];
    return (
      <>
        {header}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {pick ? (
              <section aria-labelledby="rec-h" className={`cmp-learn-next cmp-learn-box p-4 sm:p-5`} data-apply-recommended>
                <p className="cmp-learn-ink text-[12.5px] font-bold">Recommended for you</p>
                <h2 id="rec-h" className="mt-1 break-words text-[19px] font-bold leading-snug text-gray-900">{pick.title}</h2>
                <p className="mt-1 text-[14px] text-gray-800">{pick.why}</p>
                <p className="mt-2 text-[12.5px] font-semibold text-gray-800">{pick.areas.length} connected learning {pick.areas.length === 1 ? "area" : "areas"} · Clinical reasoning</p>
                {canWrite ? <div className="mt-3">{start({ from: "all" }, "Start integrated case", toneAction.primary)}</div> : <p className="mt-2 text-[13px] text-gray-800">{aiNote}</p>}
              </section>
            ) : (
              <section aria-labelledby="rec-h" className={`cmp-learn-next cmp-learn-box p-4 sm:p-5`} data-apply-recommended-empty>
                <h2 id="rec-h" className="text-[17px] font-bold text-gray-900">Nothing to connect yet</h2>
                <p className="mt-1 text-[14px] text-gray-800">{picked.ok ? "" : picked.message}</p>
                <Link href={withStudy(studyHref("learn"), sid)} className={`mt-2 ${toneAction.secondary}`}>Go to Learn</Link>
              </section>
            )}
            {unfinished.length > 0 && (
              <section aria-labelledby="carry-h">
                <h2 id="carry-h" className="text-[16px] font-bold text-gray-900">Continue where you left off</h2>
                <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200">
                  {unfinished.map(({ r, a }) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-2.5">
                      <span className="min-w-0 flex-1 basis-[14rem] text-[14px]"><span className="break-words font-semibold text-gray-900">{r.title}</span><span className="block text-[12.5px] text-gray-700">{PRACTICE_FORMAT_LABEL[r.format]} · Saved progress</span></span>
                      <Link href={withStudy(a.href, sid)} prefetch={false} className={toneAction.secondary}>Resume</Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <PracticeFormats items={formats} />
            <details id="build" open={!!sp.build || !!preset} className={`cmp-learn-practice rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-gray-200`} suppressHydrationWarning data-apply-build>
              <summary className={`cursor-pointer text-[14.5px] font-bold text-gray-900 pointer-coarse:py-3.5 ${focusRing}`}>Build a practice activity</summary>
              <div className="mt-3">
                <CaseStart entries={policy.scholarCaseEntries} contexts={policy.scholarCaseContexts} mode={policy.scholarCaseMode} libraryOn={libraryOn} connected heading="Clinical reasoning case"
                  materials={(materials.ok ? materials.data : []).filter(m => m.chunkCount > 0).map(m => ({ id: m.id, title: m.title }))}
                  competencies={catalogue.map(c => ({ id: c.id, title: c.title }))} aiNote={aiNote} preset={preset} />
              </div>
            </details>
          </div>
          <aside className="space-y-4">
            {pick && <WhyPractice why="These come from your own records. You can choose a different focus in Build a practice activity." areas={pick.areas} allStudied={pick.allStudied} />}
            <GlanceCard saved={glance.saved} attempts={glance.attempts} revisit={glance.revisit} unreadable={practice === null} />
          </aside>
        </div>
        {notice}
      </>
    );
  }

  // ── My Priorities: the learner's own, from My Plan. Read here, changed only there ──
  if (view === "priorities") {
    const planHref = withStudy(studyHref("plan"), sid);
    return (
      <>
        {header}
        <section aria-labelledby="pri-h" className={`cmp-learn-next space-y-3`} data-apply-priorities>
          <div>
            <h2 id="pri-h" className="text-[18px] font-bold text-gray-900">My Plan priorities</h2>
            <p className="mt-1 max-w-[68ch] text-[13.5px] text-gray-800">Practise what matters to your current goals. Your priorities stay yours to change, in <Link href={planHref} className={toneAction.link}>My Plan</Link>.{record.goal ? ` Your goal: ${record.goal}.` : ""}</p>
          </div>
          {record.priorities.length === 0 ? <p className={`rounded-xl bg-[var(--cmp-app-surface)] p-4 text-[14px] text-gray-800 ring-1 ring-gray-200`}>You have not set any priorities yet. Add them in <Link href={planHref} className={toneAction.link}>My Plan</Link>, or practise from all your previous learning on Today.</p> : (
            <ol className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200">
              {record.priorities.map((p, n) => {
                const studied = record.sections.filter(s => sectionMatchesTopic(s, p));
                return (
                  <li key={p} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3.5 py-3" data-apply-priority={p}>
                    <div className="min-w-0 flex-1 basis-[16rem]">
                      <p className="break-words text-[14.5px] font-bold text-gray-900">{n + 1}. {p}</p>
                      <p className="text-[13px] text-gray-700">{studied.length ? `${studied.length} ${studied.length === 1 ? "section" : "sections"} you have studied connect to this.` : "You have not studied this yet, so there is nothing to practise from."}</p>
                    </div>
                    {studied.length && canWrite ? start({ from: "plan", topic: p }, "Practise this priority", toneAction.secondary)
                      : !studied.length ? <Link href={`${studyHref("learn")}?q=${encodeURIComponent(p)}`} prefetch={false} className={toneAction.secondary}>Learn this first</Link> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
        {notice}
      </>
    );
  }

  // ── Recent Learning: grouped by what was actually studied, never by upload date ──
  if (view === "recent") {
    const recent = record.lessons.filter(l => daysBetweenDays(l.day, today) <= RECENT_DAYS).slice(0, 12);
    const answered = record.sections.filter(s => daysBetweenDays(s.lastDay, today) <= RECENT_DAYS && !s.signals.some(x => x.kind === "lesson"));
    const byMaterial = [...new Set(answered.map(s => s.materialTitle))];
    return (
      <>
        {header}
        <section aria-labelledby="recent-h" className={`cmp-learn-record space-y-3`} data-apply-recent>
          <div>
            <h2 id="recent-h" className="text-[18px] font-bold text-gray-900">Recently studied, ready to apply</h2>
            <p className="mt-1 text-[13.5px] text-gray-800">From your lessons and revision in the last {RECENT_DAYS} days. Uploading a material does not count as studying it.</p>
          </div>
          {recent.length === 0 && byMaterial.length === 0 && <p className="rounded-xl bg-[var(--cmp-app-surface)] p-4 text-[14px] text-gray-800 ring-1 ring-gray-200">Nothing studied in the last {RECENT_DAYS} days.</p>}
          {recent.length > 0 && (
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200">
              {recent.map(l => (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3.5 py-3" data-apply-lesson={l.id}>
                  <div className="min-w-0 flex-1 basis-[16rem]">
                    <p className="break-words text-[14.5px] font-bold text-gray-900">{l.title}</p>
                    <p className="text-[13px] text-gray-700">Studied {shortDay(l.day)}{l.materialTitles.length ? ` · ${l.materialTitles.slice(0, 2).join(", ")}` : ""}</p>
                  </div>
                  {canWrite && start({ from: "session", sessionId: l.id }, "Apply this learning", toneAction.secondary)}
                </li>
              ))}
            </ul>
          )}
          {byMaterial.length > 0 && <p className="text-[13.5px] text-gray-800">Also revised recently: {byMaterial.slice(0, 5).join(", ")}{canWrite ? <> · <span className="inline-block align-middle">{start({ from: "recent" }, "Practise from recent learning", toneAction.link)}</span></> : null}</p>}
        </section>
        {notice}
      </>
    );
  }

  // ── All Practice & Library: My Practice Library, then the governed and saved parts ──
  const f = parsePracticeFilters(sp as Record<string, string | undefined>);
  const shown = filterPractice(practice ?? [], f);
  const field = `w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[14px] text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
  const pageHref = (n: number) => applyHref("library", { q: f.q, format: f.format, status: f.status, from: f.from, gap: f.gap ? "1" : null, page: n > 1 ? String(n) : null, study: sid });
  return (
    <>
      {header}
      <section aria-labelledby="practice-lib-h" className={`cmp-learn-sources space-y-3`} data-practice-library>
        <div>
          <h2 id="practice-lib-h" className="text-[18px] font-bold text-gray-900">My Practice Library</h2>
          <p className="mt-1 text-[13.5px] text-gray-800">Search, reopen and compare your cases, OSCEs, papers and attempts. Private to you. Opening them uses no AI.</p>
        </div>
        <form method="get" action={studyHref("apply")} role="search" className="space-y-2">
          <input type="hidden" name="view" value="library" />
          {sid && <input type="hidden" name="study" value={sid} />}
          <div className="flex gap-2">
            <input name="q" defaultValue={f.q} aria-label="Search your practice" placeholder="Title, topic, clinical concept, competency or source" className={field} />
            <button type="submit" className={`${toneAction.primary} shrink-0`}>Search</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-[12.5px] font-semibold text-gray-700">Format<select name="format" defaultValue={f.format ?? ""} className={`${field} mt-0.5 font-normal`}><option value="">All formats</option>{PRACTICE_FORMATS.map(x => <option key={x} value={x}>{PRACTICE_FORMAT_LABEL[x]}</option>)}</select></label>
            <label className="block text-[12.5px] font-semibold text-gray-700">Status<select name="status" defaultValue={f.status ?? ""} className={`${field} mt-0.5 font-normal`}><option value="">All statuses</option>{PRACTICE_STATUSES.map(x => <option key={x} value={x}>{PRACTICE_STATUS_LABEL[x]}</option>)}</select></label>
            <label className="block text-[12.5px] font-semibold text-gray-700">Since<input type="date" name="from" defaultValue={f.from ?? ""} className={`${field} mt-0.5 font-normal`} /></label>
            <label className="flex items-end gap-2 pb-2 text-[13.5px] font-semibold text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]"><input type="checkbox" name="gap" value="1" defaultChecked={f.gap} /> Has a learning gap</label>
          </div>
          <button type="submit" className={toneAction.secondary}>Apply filters</button>
        </form>
        {practice === null ? <Unreadable what="your practice library" /> : (
          <>
            <p role="status" className="text-[13px] text-gray-700">{shown.total} of {practice.length}</p>
            {shown.rows.length === 0
              ? <p className="rounded-xl bg-[var(--cmp-app-surface)] p-4 text-[14px] text-gray-800 ring-1 ring-gray-200">{practice.length ? "Nothing matches. Try fewer words or clear the filters." : "Nothing here yet. A case you start is kept here, with every attempt."}</p>
              : <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200">{shown.rows.map(r => <PracticeRowView key={r.key} r={r} />)}</ul>}
            {shown.pages > 1 && <nav aria-label="Pages" className="flex items-center justify-between text-[13.5px]">{shown.page > 1 ? <Link href={pageHref(shown.page - 1)} className={toneAction.link}>Previous</Link> : <span />}<span className="text-gray-700">Page {shown.page} of {shown.pages}</span>{shown.page < shown.pages ? <Link href={pageHref(shown.page + 1)} className={toneAction.link}>Next</Link> : <span />}</nav>}
          </>
        )}
      </section>

      <div className="mt-6 space-y-5">
        <ExamPapersSection admin={ctx.admin} userId={ctx.userId} variant="apply" />
        <OsceEntry admin={ctx.admin} userId={ctx.userId} studyId={sid} />
        {libraryOn && candidacy && casePolicy && (
          <CaseOfferPanel libraryOn={libraryOn} offering={offeringOn(libraryOn, policy)} granted={candidacy.granted && candidacy.current} attestationVersion={casePolicy.attestationVersion}
            text={ATTESTATION_TEXT[casePolicy.attestationVersion] ?? null} cases={privateCases.ok ? privateCases.data.map(c => ({ id: c.id, title: c.title })) : []}
            offers={(offers ?? []).map(o => ({ sourceKey: o.sourceKey, status: o.status, reasons: o.reasons }))} />
        )}
      </div>

      <details open={!!sp.scenarios} className="mt-6 rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-gray-200" suppressHydrationWarning>
        <summary className={`cursor-pointer text-[14.5px] font-bold text-gray-900 pointer-coarse:py-3.5 ${focusRing}`}>Open your saved scenarios</summary>
        <section aria-labelledby="own-cases-h" className="cmp-learn-practice mt-3">
          <LearningSectionHead icon="layers" level={2} id="own-cases-h" caps={false} title="Your practice scenarios" />
          <p className="mt-1.5 text-[13.5px] text-gray-700">Written by AI from your own notes. They are practice, not clinically reviewed cases, and each one says so.</p>
          <div className="mt-3">
            {!questions.ok ? (questions.notProvisioned
              ? <StatePanel title="Case practice is not set up here yet"><p>The study store it needs has not been installed here.</p></StatePanel>
              : <Unreadable what="case questions" />)
              : questions.data.length === 0 ? (
                <StatePanel title="No case questions yet">
                  <p>Open one of your materials and choose <span className="font-semibold">Step-by-step case</span> or <span className="font-semibold">Case question</span> on a section that describes a condition, an assessment or its management.</p>
                  <p><Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Go to your materials</Link></p>
                </StatePanel>
              ) : (
                <div className="space-y-4">
                  {caseList.map(steps => {
                    const l = steps[0].competencyId ? labels.get(steps[0].competencyId) : undefined;
                    return (
                      <CasePlayer key={steps[0].caseId} title={steps[0].caseTitle ?? "Practice case"}
                        competency={l ? { title: `${l.code ? `${l.code} ` : ""}${l.title}`, layer: l.layer, contentStatus: l.contentStatus ?? null } : null}
                        steps={steps.map(q => ({ q: questionView(q), chunkId: q.chunkId, answered: q.latest !== null }))} />
                    );
                  })}
                  {singles.map((q, i) => <QuestionCard key={q.id} q={questionView(q)} index={i + 1} chunkId={q.chunkId} />)}
                </div>
              )}
          </div>
        </section>
      </details>

      <section aria-labelledby="shared-h" className="mt-6">
        <LearningSectionHead icon="library" level={2} id="shared-h" caps={false} title="Clinically approved cases" />
        <div className="cmp-learn-sources cmp-learn-box mt-3 p-5 sm:p-6">
          {libraryOn ? (
            <p className="text-[14px] leading-relaxed text-gray-700">
              The case library holds cases an independent clinical reviewer approved, each for its exact version. Choose <span className="font-semibold">Choose an existing case</span> in <Link href={buildHref} className={toneAction.link}>Build a practice activity</Link> to play one: it uses no AI.
              Cases written from your notes are practice, not clinically reviewed, and each one says so.
            </p>
          ) : (
            <>
              <p className="text-[15px] font-semibold text-gray-900">Not available yet</p>
              <p className="mt-1 text-[14px] leading-relaxed text-gray-700">The case library is not switched on yet. Your own cases are practice, not clinically reviewed, and are labelled as such.</p>
            </>
          )}
        </div>
      </section>
      {notice}
    </>
  );
}

const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const daysBetweenDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
