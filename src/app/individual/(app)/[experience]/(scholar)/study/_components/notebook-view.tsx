import Link from "next/link";
import { experienceHref } from "@/lib/individual/experiences";
import {
  artefactsByIds, chunksByIds, getLearningSession, listArtefacts, listCheckAttempts, listNotes, sectionTopicRows, sessionsByIds, type Admin, type NoteRow,
} from "@/lib/individual/scholar/store";
import { UNIT_OF } from "@/lib/individual/scholar/config";
import { displaySessionTitle } from "@/lib/individual/scholar/learn-search";
import { locationLabel, noteAttachedTo } from "@/lib/individual/scholar/library-organise";
import { lessonHrefPath, lessonTitleOf } from "@/lib/individual/scholar/saved-library";
import { outcomeOf } from "@/lib/individual/scholar/learning-need";
import { NOTEBOOK_KINDS, pastMisconceptions, practicePath, relatedFor, withNotebook, type LibraryIndex, type NoteAnchor } from "@/lib/individual/scholar/notebook";
import { StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import { NewNoteForm } from "./library-notes-client";
import { NotebookList, type NotebookItem } from "./notebook-client";

// SALE-2026-11 R3 / SALE-12 -- THE ACTIVE NOTEBOOK (policy scholar_active_notebook, default off): a view of the learning library (820),
// never a second store. The learner's annotations, highlights and personal summaries (975), each with its source cited, the related
// materials of their own library, practice from the notes they choose (the existing Revise builder, its SQIE generation and routing),
// and the misconceptions from their own kept checks to revisit. Every link out carries `nb`, so the lesson, revision or question page
// offers the way back here. Database reads only, every one keyed on the learner. NO AI on this page.

const href = (seg: string) => experienceHref("scholar", seg);
const ukDay = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
const linkCls = `inline-flex min-h-[40px] items-center px-1 font-semibold text-gray-900 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const NOTES_READ = 300;

export async function NotebookView({ admin, userId, materials, summariesOn }: {
  admin: Admin; userId: string; materials: { id: string; title: string; mime?: string | null }[]; summariesOn: boolean;
}) {
  const titles = new Map(materials.map(m => [m.id, m.title]));
  const units = new Map(materials.map(m => [m.id, m.mime ? UNIT_OF(m.mime) : ("page" as const)]));
  const [notesR, kept, topicsR] = await Promise.all([
    listNotes(admin, userId, { kinds: summariesOn ? [...NOTEBOOK_KINDS] : ["note", "highlight"], limit: NOTES_READ }),
    listCheckAttempts(admin, userId, { limit: 200 }).catch(() => null),
    sectionTopicRows(admin, userId).catch(() => null),
  ]);
  if (!notesR.ok) return notesR.notProvisioned ? <StatePanel title="The Notebook is not available here yet"><p>Your saved lessons are still here.</p></StatePanel> : <div className="mt-3"><Unreadable what="your notebook" /></div>;
  const rows = notesR.data.rows;

  // where each note sits: its own section, its saved lesson's sections, or its lesson step's sections
  const [arts, sessions] = await Promise.all([
    artefactsByIds(admin, userId, rows.flatMap(n => (n.artefactId ? [n.artefactId] : []))),
    sessionsByIds(admin, userId, rows.flatMap(n => (n.sessionId ? [n.sessionId] : []))),
  ]);
  const artById = new Map((arts.ok ? arts.data : []).map(a => [a.id, a]));
  const sesById = new Map(sessions.map(s => [s.id, s]));
  const lessonSessions = [...new Set(rows.filter(n => n.targetKind === "lesson" && !n.chunkId && n.sessionId).map(n => n.sessionId!))].slice(0, 20);
  const stepsBy = new Map<string, Map<number, { chunkIds: string[]; materialId: string | null }>>();
  for (const s of await Promise.all(lessonSessions.map(id => getLearningSession(admin, userId, id).catch(() => null)))) {
    if (!s?.ok || !s.data) continue;
    stepsBy.set(s.data.session.id, new Map(s.data.steps.map(st => [st.step, { chunkIds: st.sections.map(x => x.chunkId), materialId: st.sections[0]?.materialId ?? null }])));
  }
  const anchorOf = (n: NoteRow): NoteAnchor => {
    const art = n.artefactId ? artById.get(n.artefactId) : undefined;
    const step = n.sessionId !== null && n.step !== null ? stepsBy.get(n.sessionId)?.get(n.step) : undefined;
    const chunkIds = n.chunkId ? [n.chunkId] : art ? art.sources.slice(0, 24) : step ? step.chunkIds.slice(0, 24) : [];
    return { id: n.id, materialId: n.materialId ?? art?.materialId ?? step?.materialId ?? null, chunkIds };
  };
  const anchors = new Map(rows.map(n => [n.id, anchorOf(n)]));
  const allChunks = [...new Set([...anchors.values()].flatMap(a => a.chunkIds))];
  const [chunks, related] = await Promise.all([
    chunksByIds(admin, userId, allChunks.slice(0, 1000), false),
    allChunks.length ? listArtefacts(admin, userId, { chunkIds: allChunks.slice(0, 500), limit: 200 }) : Promise.resolve({ ok: true as const, data: [] }),
  ]);
  const chunkById = new Map((chunks.ok ? chunks.data : []).map(c => [c.id, c]));
  const index: LibraryIndex = {
    sections: topicsR?.ok ? topicsR.data : [],
    artefacts: (related.ok ? related.data : []).filter(a => !a.supersededAt).map(a => ({ id: a.id, materialId: a.materialId, sources: a.sources, title: lessonTitleOf(a.content) || "Saved lesson" })),
    notes: [...anchors.values()],
    materialTitle: titles,
  };

  const items: NotebookItem[] = rows.map(n => {
    const a = anchors.get(n.id)!;
    const art = n.artefactId ? artById.get(n.artefactId) : undefined, ses = n.sessionId ? sesById.get(n.sessionId) : undefined;
    const ch = a.chunkIds[0] ? chunkById.get(a.chunkIds[0]) : undefined;
    const unit = a.materialId ? units.get(a.materialId) ?? "page" : "page";
    const location = ch ? locationLabel(ch, unit) : null;
    const back = n.id;
    const title = art ? lessonTitleOf(art.content) || "Saved lesson" : ses && n.step !== null ? `${displaySessionTitle(ses.title)} · Lesson ${n.step + 1}` : a.materialId ? titles.get(a.materialId) ?? "Your material" : "Your note";
    const open = art ? `study/saved?version=${encodeURIComponent(art.id)}` : ses && n.step !== null ? lessonHrefPath(ses.id, n.step) : null;
    return {
      id: n.id, kind: n.kind as NotebookItem["kind"], body: n.body, quote: n.quote, createdAt: n.createdAt, updatedAt: n.updatedAt, step: n.step, artefactId: n.artefactId,
      title, materialId: a.materialId, chunkIds: [...a.chunkIds],
      attached: noteAttachedTo({ targetKind: n.targetKind, materialTitle: a.materialId ? titles.get(a.materialId) ?? null : null, lessonTitle: art ? lessonTitleOf(art.content) || null : null,
        sessionTitle: ses ? displaySessionTitle(ses.title) : null, step: n.step, location }),
      openHref: open ? href(withNotebook(open, back)) : null,
      source: a.materialId && a.chunkIds[0] ? { href: href(withNotebook(`study/${encodeURIComponent(a.materialId)}#c-${encodeURIComponent(a.chunkIds[0])}`, back)), label: `${titles.get(a.materialId) ?? "Your material"}${location ? `, ${location}` : ""}` } : null,
      related: relatedFor(a, index).map(r => r.kind === "saved_lesson"
        ? { href: href(withNotebook(`study/saved?version=${encodeURIComponent(r.id)}`, back)), label: `Saved lesson: ${r.title}`, why: r.why }
        : r.kind === "section"
          ? { href: href(withNotebook(`study/${encodeURIComponent(r.materialId)}#c-${encodeURIComponent(r.chunkId)}`, back)), label: `${r.title}${chunkById.get(r.chunkId) ? `, ${locationLabel(chunkById.get(r.chunkId)!, units.get(r.materialId) ?? "page")}` : ""}`, why: r.why }
          : { href: `#n-${r.id}`, label: r.title, why: r.why }),
    };
  });

  const checks = kept?.ok ? kept.data : [];
  const mis = pastMisconceptions(checks.map(c => ({
    attemptId: c.attemptId, questionId: c.questionId, question: c.question, at: c.answeredAt, sessionId: c.sessionId, step: c.step, materialId: c.materialId, chunkId: c.chunkId,
    outcome: outcomeOf({ verdict: c.response.verdict, selfGrade: c.response.selfGrade }),
    adaptiveMisconception: c.response.adaptive?.misconception ?? null, feedbackMisconceptions: c.response.feedback?.misconceptions ?? [],
  })), 10);
  const misTitles = new Map((await sessionsByIds(admin, userId, mis.flatMap(m => (m.latest.sessionId ? [m.latest.sessionId] : [])))).map(s => [s.id, displaySessionTitle(s.title)]));

  return (
    <div className="mt-4 space-y-4" data-testid="notebook">
      <p className="text-[13.5px] text-gray-700">Your own notes, highlights and summaries, with where each came from. Choose some to make practice from them, open what is related, or revisit a past misconception. Written by you and private to you.</p>

      {summariesOn
        ? <NewNoteForm materials={materials.map(m => ({ id: m.id, title: m.title }))} kind="summary" />
        : <p className="text-[12.5px] text-gray-600">Personal summaries are not available here yet. Your notes and highlights are.</p>}

      <section aria-labelledby="nb-mis-h" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" data-testid="notebook-misconceptions">
        <h3 id="nb-mis-h" className="text-[15px] font-bold text-gray-900">Misconceptions to revisit</h3>
        <p className="mt-0.5 text-[12.5px] text-gray-600">From the feedback on your own lesson checks. A record for your learning, not an assessment.</p>
        {mis.length === 0 ? <p className="mt-2 text-[13.5px] text-gray-700">None in your kept checks.</p> : (
          <ul className="mt-2 divide-y divide-gray-100">
            {mis.map(m => {
              const l = m.latest;
              return (
                <li key={`${m.text}-${l.attemptId}`} className="py-2.5">
                  <p className="break-words text-[14px] font-semibold text-gray-900">&ldquo;{m.text}&rdquo;</p>
                  <p className="mt-0.5 text-[12.5px] text-gray-600">
                    On {m.questions} question{m.questions === 1 ? "" : "s"}, last {ukDay(m.lastAt)}{l.sessionId ? ` in ${misTitles.get(l.sessionId) ?? "your lesson"}${l.step !== null ? `, lesson ${l.step + 1}` : ""}` : ""}
                    {m.answeredWellSince ? " · since answered well in that lesson" : ""}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[13px]">
                    {l.sessionId && l.step !== null && <Link href={href(withNotebook(lessonHrefPath(l.sessionId, l.step), "1"))} className={linkCls}>Open the lesson</Link>}
                    <Link href={href(withNotebook(`study/saved/history?q=${encodeURIComponent(l.questionId)}`, "1"))} className={linkCls}>Its question history</Link>
                    <Link href={href(practicePath({ materialId: l.materialId, chunkIds: [l.chunkId], notes: 0 }, "1"))} className={linkCls}>Practise this section</Link>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <NotebookList items={items} more={!!notesR.data.next} />
    </div>
  );
}
