import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { describeNotes } from "@/lib/individual/scholar/personal-notebook-data";
import { listNotebookNotes, notebookOffered, notebookSchema, notebookTags, searchNotebook } from "@/lib/individual/scholar/personal-notebook-store";
import { NOTEBOOK_PAGE } from "@/lib/individual/scholar/personal-notebook";
import { countDue, isUuid, listLearningSessions, listMaterials } from "@/lib/individual/scholar/store";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { NoteCard, NotebookSearch, NotebookSection, StartWriting, practiseHref, type NotebookCard } from "../_components/notebook-home";
import type { NotebookNote } from "@/lib/individual/scholar/personal-notebook-store";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// COMPETEN-NOTEBOOK-001 P1: MY NOTEBOOK (policy scholar_personal_notebook, default off, and migration 1000). Start writing first, then search, pinned,
// what relates to the lesson being studied, and recent. All the learner's own notes, highlights and summaries from the same 820 table, whichever page
// they were written on. Database reads only, every one keyed on the learner. NO AI on this page. Never read by Professional or by an employer.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "My Notebook" });
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NotebookPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const search = await searchParams;
  const policy = await loadIndividualPolicy(ctx.admin);
  const [study, due, offered] = await Promise.all([loadStudy(ctx.admin, ctx.userId, search.study, null), countDue(ctx.admin, ctx.userId), notebookSchema(ctx.admin)]);
  const header = (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="Private to you" title="My Notebook" intro="Your own ideas, questions and notes, from anywhere in Scholar. Nothing is required but your words." />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
    </>
  );
  if (!notebookOffered(policy, offered)) {
    return <>{header}<StatePanel title="My Notebook is not available here yet"><p>Your notes and highlights are still in your learning library.</p></StatePanel></>;
  }

  const q = one(search.q).replace(/\s+/g, " ").trim().slice(0, 200);
  const tag = one(search.tag).trim().slice(0, 40) || null;
  const material = isUuid(one(search.material)) ? one(search.material) : null;
  const rawPage = Number(one(search.page));
  const pageNo = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 200 ? rawPage : 1;
  const offset = (pageNo - 1) * NOTEBOOK_PAGE;
  const filtered = !!(q || tag || material);

  const [materialsR, tags] = await Promise.all([listMaterials(ctx.admin, ctx.userId), notebookTags(ctx.admin, ctx.userId)]);
  const materials = (materialsR.ok ? materialsR.data : []).map(m => ({ id: m.id, title: m.title, mime: m.mimeType }));

  let pinned: NotebookNote[] = [], recent: NotebookNote[] = [], relatedNow: NotebookNote[] = [], more = false, unreadable = false, relatedTitle = "";
  let hits: { note: NotebookNote; headline: string }[] = [], total = 0;
  if (q) {
    const r = await searchNotebook(ctx.admin, ctx.userId, q, NOTEBOOK_PAGE, offset);
    if (!r.ok) unreadable = true;
    else {
      hits = r.data.hits.filter(h => (!tag || h.note.tags.includes(tag)) && (!material || h.note.materialId === material));
      total = tag || material ? hits.length : r.data.total;
      more = !(tag || material) && offset + r.data.hits.length < r.data.total;
    }
  } else {
    const [recentR, pinnedR, sessions] = await Promise.all([
      listNotebookNotes(ctx.admin, ctx.userId, { tag, materialId: material, limit: NOTEBOOK_PAGE, offset }),
      filtered || pageNo > 1 ? Promise.resolve(null) : listNotebookNotes(ctx.admin, ctx.userId, { pinned: true, limit: 12 }),
      filtered || pageNo > 1 ? Promise.resolve(null) : listLearningSessions(ctx.admin, ctx.userId, 1),
    ]);
    if (!recentR.ok) unreadable = true;
    else {
      recent = recentR.data.rows; more = recentR.data.more;
      pinned = pinnedR?.ok ? pinnedR.data.rows : [];
      // Related: what they wrote on the lesson they most recently studied. Deterministic, and only their own notes.
      const last = sessions?.ok ? sessions.data[0] : null;
      if (last) {
        const all = await listNotebookNotes(ctx.admin, ctx.userId, { limit: 100 });
        relatedNow = (all.ok ? all.data.rows : []).filter(n => n.sessionId === last.id).slice(0, 5);
        relatedTitle = last.title;
      }
    }
  }
  const shownPinned = new Set(pinned.map(n => n.id));
  const shownRelated = new Set(relatedNow.map(n => n.id));
  const rest = recent.filter(n => !shownPinned.has(n.id) && !shownRelated.has(n.id));
  const where = await describeNotes(ctx.admin, ctx.userId, [...pinned, ...recent, ...relatedNow, ...hits.map(h => h.note)], materials);
  const card = (note: NotebookNote, headline?: string): NotebookCard => ({ note, where: where.get(note.id)?.where ?? null, headline: headline ?? null });
  const pageHref = (n: number) => { const u = new URLSearchParams(); if (q) u.set("q", q); if (tag) u.set("tag", tag); if (material) u.set("material", material); u.set("page", String(n)); return `?${u}`; };
  const nothing = !pinned.length && !recent.length && !hits.length;

  return (
    <>
      {header}
      <div data-testid="my-notebook">
        <StartWriting userId={ctx.userId} />
        <NotebookSearch q={q} tags={tags} tag={tag} material={material} materials={materials} />
        {unreadable && <div className="mt-4"><Unreadable what="your notes" /></div>}
        {q && !unreadable && <p role="status" className="mt-3 text-[13.5px] text-gray-700" data-testid="notebook-results">{total === 0 ? <>Nothing in your notes matches &ldquo;{q}&rdquo;.</> : <>{total} note{total === 1 ? "" : "s"} match &ldquo;{q}&rdquo;.</>}</p>}
        {hits.length > 0 && <NotebookSection title="Search results">{hits.map(h => <NoteCard key={h.note.id} card={card(h.note, h.headline)} />)}</NotebookSection>}
        {pinned.length > 0 && <NotebookSection title="Pinned" count={pinned.length}>{pinned.map(n => <NoteCard key={n.id} card={card(n)} />)}</NotebookSection>}
        {relatedNow.length > 0 && <NotebookSection title={`Related to your last lesson: ${relatedTitle}`}>{relatedNow.filter(n => !shownPinned.has(n.id)).map(n => <NoteCard key={n.id} card={card(n)} />)}</NotebookSection>}
        {rest.length > 0 && <NotebookSection title={filtered ? "Your notes" : "Recent"}>{rest.map(n => <NoteCard key={n.id} card={card(n)} />)}</NotebookSection>}
        {nothing && !q && !unreadable && <p className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-700">{filtered ? "No notes match this." : "No notes yet. Your first idea starts above, or from Quick note at the top of any Scholar page."}</p>}
        {(pageNo > 1 || more) && (
          <p className="mt-4 flex flex-wrap gap-3 text-[14px]">
            {pageNo > 1 && <Link href={pageHref(pageNo - 1)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Newer</Link>}
            {more && <Link href={pageHref(pageNo + 1)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Older</Link>}
          </p>
        )}
        <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px]">
          <a href="/api/individual/scholar/notebook/export" className={`inline-flex min-h-[40px] items-center font-semibold text-gray-900 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`} data-testid="notebook-export">Download all my notes</a>
          {policy.scholarActiveNotebook === "on" && <Link href={practiseHref()} className={`inline-flex min-h-[40px] items-center font-semibold text-gray-900 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Make practice from my notes</Link>}
        </p>
      </div>
    </>
  );
}
