/* eslint-disable @typescript-eslint/no-explicit-any */
import { UNIT_OF } from "./config";
import { displaySessionTitle } from "./learn-search";
import { locationLabel, noteAttachedTo } from "./library-organise";
import { lessonHrefPath, lessonTitleOf } from "./saved-library";
import { relatedFor, type LibraryIndex, type NoteAnchor } from "./notebook";
import { artefactsByIds, chunksByIds, listArtefacts, listNotebookNotes, sectionTopicRows, sessionsByIds, type Admin, type NotebookNote } from "./store";

import { noteHeading } from "./personal-notebook";

// COMPETEN-NOTEBOOK-001 P1: what a note is attached to, in words and a way back, and what is related to it. Database reads only, every one keyed
// on the learner. The related notes and lessons are the deterministic relatedFor of the active Notebook, plus shared tags. No AI, no other learner.

export type MaterialName = { id: string; title: string; mime?: string | null };
export type NoteWhere = {
  /** "Growth and Development · Lesson 3 · Cephalocaudal development". Null on a free-standing note. */
  where: string | null;
  /** Back to the lesson, which reopens at the learner's saved reading place, or to the material. */
  openHref: string | null; openLabel: string | null;
  /** Straight to the section's own box in the lesson. */
  sectionHref: string | null;
  /** A slide or page, with its picture. */
  picture: { materialId: string; materialTitle: string; citation: string } | null;
};
const FREE: NoteWhere = { where: null, openHref: null, openLabel: null, sectionHref: null, picture: null };

/** Each note's place, from one read of its sessions, saved lessons and sections. */
export async function describeNotes(admin: Admin, userId: string, notes: readonly NotebookNote[], materials: readonly MaterialName[]): Promise<Map<string, NoteWhere>> {
  const titles = new Map(materials.map(m => [m.id, m.title]));
  const units = new Map(materials.map(m => [m.id, m.mime ? UNIT_OF(m.mime) : ("page" as const)]));
  const [sessions, arts, chunks] = await Promise.all([
    sessionsByIds(admin, userId, notes.flatMap(n => (n.sessionId ? [n.sessionId] : []))),
    artefactsByIds(admin, userId, notes.flatMap(n => (n.artefactId ? [n.artefactId] : []))),
    chunksByIds(admin, userId, [...new Set(notes.flatMap(n => (n.chunkId ? [n.chunkId] : [])))].slice(0, 500), false),
  ]);
  const sesById = new Map(sessions.map(s => [s.id, s]));
  const artById = new Map((arts.ok ? arts.data : []).map(a => [a.id, a]));
  const chunkById = new Map((chunks.ok ? chunks.data : []).map(c => [c.id, c]));
  const out = new Map<string, NoteWhere>();
  for (const n of notes) {
    if (n.targetKind === "free") { out.set(n.id, FREE); continue; }
    if (n.targetKind === "topic") {
      out.set(n.id, { where: `Topic: ${n.topic}`, openHref: `study/notebook?topic=${encodeURIComponent(n.topic ?? "")}`, openLabel: "Notes on this topic", sectionHref: null, picture: null });
      continue;
    }
    const ses = n.sessionId ? sesById.get(n.sessionId) : undefined, art = n.artefactId ? artById.get(n.artefactId) : undefined;
    const materialId = n.materialId ?? art?.materialId ?? null;
    const chunk = n.chunkId ? chunkById.get(n.chunkId) : undefined;
    const unit = materialId ? units.get(materialId) ?? "page" : "page";
    const location = chunk ? locationLabel(chunk, unit) : null;
    const base = noteAttachedTo({
      targetKind: n.targetKind, materialTitle: materialId ? titles.get(materialId) ?? null : null, lessonTitle: art ? lessonTitleOf(art.content) || null : null,
      sessionTitle: ses ? displaySessionTitle(ses.title) : null, step: n.step, location: n.sectionLabel ? null : location,
    });
    const lesson = ses && n.step !== null ? lessonHrefPath(ses.id, n.step) : null;
    const open = art ? `study/saved?version=${encodeURIComponent(art.id)}` : lesson ? `study/learn?session=${encodeURIComponent(ses!.id)}` : materialId ? (n.chunkId ? `study/${materialId}#c-${n.chunkId}` : `study/${materialId}`) : null;
    out.set(n.id, {
      where: n.sectionLabel ? `${base} · ${n.sectionLabel}` : base,
      openHref: open, openLabel: art ? "Open saved lesson" : lesson ? "Back to the lesson" : "Open the material",
      sectionHref: noteSectionHref(lesson, n.step, n.sectionAnchor),
      picture: chunk && materialId && unit !== "section" ? { materialId, materialTitle: titles.get(materialId) ?? "Your material", citation: `${titles.get(materialId) ?? "Your material"}, ${location ?? ""}`.replace(/,\s*$/, "") } : null,
    });
  }
  return out;
}

/** Pure. The link to a note's own section, where that section can be found on arriving. A Guide Me step's box is drawn only while that step is open, so it has none. */
export function noteSectionHref(lesson: string | null, step: number | null, anchor: string | null): string | null {
  if (!lesson || !anchor || anchor.startsWith("guide-")) return null;
  return `${lesson.split("#")[0]}#ideas-${step}-${anchor}`;
}

export type RelatedLink = { href: string; label: string; why: string };

/** Pure. Other notes sharing a tag with this one, most shared first. */
export function relatedByTags(note: Pick<NotebookNote, "id" | "tags">, others: readonly Pick<NotebookNote, "id" | "tags" | "title" | "body" | "quote">[], max = 5): { id: string; label: string; why: string }[] {
  const mine = new Set(note.tags.map(t => t.toLowerCase()));
  if (!mine.size) return [];
  return others.filter(o => o.id !== note.id)
    .map(o => ({ o, shared: o.tags.filter(t => mine.has(t.toLowerCase())) }))
    .filter(x => x.shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length || a.o.id.localeCompare(b.o.id))
    .slice(0, max)
    .map(x => ({ id: x.o.id, label: noteHeading(x.o, 70), why: `Also tagged ${x.shared[0]}` }));
}

/** What is related to one note, as paths under the experience: the same sections and topics, the same material, and shared tags. */
export async function relatedToNote(admin: Admin, userId: string, note: NotebookNote, materials: readonly MaterialName[]): Promise<RelatedLink[]> {
  const list = await listNotebookNotes(admin, userId, { limit: 300 });
  const others = list.ok ? list.data.rows : [];
  const onTopic = note.topic ? others.filter(o => o.id !== note.id && o.topic === note.topic).slice(0, 5).map(o => ({ href: `study/notebook/${o.id}`, label: noteHeading(o, 70), why: "On the same topic" })) : [];
  const tagged = [...onTopic, ...relatedByTags(note, others).map(r => ({ href: `study/notebook/${r.id}`, label: r.label, why: r.why }))];
  const anchorOf = (n: NotebookNote): NoteAnchor => ({ id: n.id, materialId: n.materialId, chunkIds: n.chunkId ? [n.chunkId] : [] });
  const anchor = anchorOf(note);
  if (!anchor.materialId && !anchor.chunkIds.length) return tagged;
  const [topics, arts] = await Promise.all([
    sectionTopicRows(admin, userId).catch(() => null),
    anchor.chunkIds.length ? listArtefacts(admin, userId, { chunkIds: anchor.chunkIds, limit: 50 }) : Promise.resolve({ ok: true as const, data: [] }),
  ]);
  const byId = new Map(others.map(o => [o.id, o]));
  const titles = new Map(materials.map(m => [m.id, m.title]));
  const index: LibraryIndex = {
    sections: topics?.ok ? topics.data : [],
    artefacts: (arts.ok ? arts.data : []).filter((a: any) => !a.supersededAt).map((a: any) => ({ id: a.id, materialId: a.materialId, sources: a.sources, title: lessonTitleOf(a.content) || "Saved lesson" })),
    notes: others.map(anchorOf), materialTitle: titles,
  };
  const found = relatedFor(anchor, index).map<RelatedLink>(r => r.kind === "saved_lesson"
    ? { href: `study/saved?version=${encodeURIComponent(r.id)}`, label: `Saved lesson: ${r.title}`, why: r.why }
    : r.kind === "section" ? { href: `study/${encodeURIComponent(r.materialId)}#c-${encodeURIComponent(r.chunkId)}`, label: r.title, why: r.why }
      : { href: `study/notebook/${encodeURIComponent(r.id)}`, label: byId.get(r.id) ? noteHeading(byId.get(r.id)!, 70) : "Your note", why: r.why });
  const seen = new Set<string>();
  return [...found, ...tagged].filter(r => (seen.has(r.href) ? false : (seen.add(r.href), true))).slice(0, 8);
}
