"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { LearningIcon, learnAction, learnBox } from "@/components/ui/scholar-learning";
import { experienceHref } from "@/lib/individual/experiences";
import { FREE_CONTEXT, IDEAS, cleanTags, type NoteContext, type NoteDraft, type NoteLink } from "@/lib/individual/scholar/personal-notebook";
import type { NotebookNote } from "@/lib/individual/scholar/store";
import type { NoteWhere, RelatedLink } from "@/lib/individual/scholar/personal-notebook-data";
import { NoteField, newClientKey, notebookHref, readDrafts, useNoteSaver } from "./note-capture";
import { NoteActions } from "./note-actions";
import { SourcePictureButton } from "./learn-visuals";
import { activeStudyId } from "./study-active";

// COMPETEN-NOTEBOOK-001 P1: THE BLANK PAGE AND THE FULL NOTE. Long-form writing with the cursor in the field at once. Title, tags and links come only
// after writing starts, and none is ever asked for. A note may be linked to a lesson, a section (a slide or page keeps its picture), a material, a
// competency or a study session, and unlinked again. Remove asks once, in place. Learner text, private. Nothing here calls a model.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const field = `mt-1 block w-full min-h-[44px] rounded-xl border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-3 text-[15px] text-gray-900 ${focusRing}`;

export type LinkOptions = {
  materials: { id: string; title: string }[];
  lessons: { id: string; title: string; connected: boolean }[];
  topics: string[];
  competencies: { id: string; title: string }[] | null;
};

// A draft chosen on My Notebook's page travels to the blank page in memory only: never in the address, which servers log.
let restored: NoteDraft | null = null;
export const rememberRestoredDraft = (d: NoteDraft) => { restored = d; };

/** A new note, with nothing to fill in first. It joins the address once it is saved, so a reload finds it. */
export function BlankPage({ userId, options, draftKey }: { userId: string; options: LinkOptions; draftKey: string | null }) {
  const [start] = useState(() => {
    const fromMemory = restored && (!draftKey || restored.clientKey === draftKey) ? restored : null;
    restored = null;
    const draft = fromMemory ?? (draftKey ? readDrafts(userId).find(d => d.clientKey === draftKey) ?? null : null);
    return { key: draft?.clientKey ?? newClientKey(), draft };
  });
  const context: NoteContext = start.draft?.context ?? { ...FREE_CONTEXT, capturedIn: "notebook", studyId: activeStudyId() };
  return <Editor key={start.key} userId={userId} clientKey={start.key} context={context} options={options} draft={start.draft} note={null} where={null} related={[]} />;
}

/** A note that exists. */
export function FullNote({ userId, note, where, options, related }: { userId: string; note: NotebookNote; where: NoteWhere; options: LinkOptions; related: RelatedLink[] }) {
  const [key] = useState(() => newClientKey());
  const context: NoteContext = { ...FREE_CONTEXT, capturedIn: "notebook" };
  return <Editor userId={userId} clientKey={key} context={context} options={options} draft={null} note={note} where={where} related={related} />;
}

function Editor({ userId, clientKey, context, options, draft, note, where, related }: {
  userId: string; clientKey: string; context: NoteContext; options: LinkOptions; draft: NoteDraft | null; note: NotebookNote | null; where: NoteWhere | null; related: RelatedLink[];
}) {
  const uid = useId();
  const { saver, snap } = useNoteSaver({
    userId, clientKey, context,
    ...(draft ? { id: draft.noteId, revision: draft.revision, body: draft.body, title: draft.title, tags: draft.tags, dirtyFromDraft: true } : {}),
    ...(note ? { id: note.id, revision: note.revision, body: note.body ?? "", title: note.title ?? "", tags: note.tags, allowBlank: note.kind === "highlight" } : {}),
  });
  const [tagText, setTagText] = useState((note?.tags ?? draft?.tags ?? []).join(", "));
  const [pinned, setPinned] = useState(!!note?.pinnedAt);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const started = !!snap.body.trim() || !!note;
  const isHighlight = note?.kind === "highlight";

  // Saved for the first time: the address becomes the note's own, without a navigation, so writing carries on undisturbed.
  useEffect(() => {
    if (!note && snap.id && window.location.pathname.endsWith("/study/notebook/new")) window.history.replaceState(null, "", notebookHref(snap.id));
  }, [note, snap.id]);

  const remove = async () => {
    // Nothing waiting may save after this, and a save on its way is removed with the rest.
    const id = (await saver.discard()) ?? note?.id;
    if (!id) { window.location.assign(notebookHref()); return; }
    const res = await fetch(`/api/individual/scholar/notebook/notes/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 404) { window.location.assign(notebookHref()); return; }
    saver.resume();
    setMsg("That could not be removed just now. It is still here.");
  };

  return (
    <div className={`${learnBox("ideas")} p-4 sm:p-5`} data-testid="note-editor">
      <div className="flex flex-wrap items-center gap-2">
        <span className="cmp-learn-accent"><LearningIcon name="bulb" className="h-5 w-5" /></span>
        <h2 className="cmp-learn-ink min-w-0 flex-1 text-[15px] font-bold">{IDEAS.title}</h2>
        <span className="cmp-learn-ink text-[12px]">{IDEAS.privacy}</span>
      </div>
      <p className="mt-1 text-[12.5px] text-gray-700">{IDEAS.never} {IDEAS.patientWarning}</p>
      {note?.quote && <p className="mt-2 break-words border-l-4 border-[var(--learn-border)] pl-3 text-[14px] italic text-gray-900"><span className="sr-only">You highlighted: </span>{note.quote}</p>}
      <div className="mt-2.5">
        {started && (
          <>
            <label htmlFor={`${uid}-t`} className="text-[12.5px] font-semibold text-gray-800">Title (optional)</label>
            <input id={`${uid}-t`} value={snap.title} maxLength={200} onChange={e => saver.setTitle(e.target.value)} className={`${field} mb-2.5 font-semibold`} data-testid="note-title" />
          </>
        )}
        <NoteField saver={saver} snap={snap} autoFocus={!note} tall label={isHighlight ? "Your comment on the highlight" : "Your note"} />
      </div>

      {started && (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label htmlFor={`${uid}-g`} className="text-[12.5px] font-semibold text-gray-800">Tags, separated by commas (optional)
              <input id={`${uid}-g`} value={tagText} onChange={e => setTagText(e.target.value)} onBlur={() => saver.setTags(cleanTags(tagText))} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saver.setTags(cleanTags(tagText)); } }} className={field} data-testid="note-tags" />
            </label>
            <div className="flex items-end">
              <button type="button" aria-pressed={pinned} className={learnAction.secondary} data-testid="note-pin" onClick={() => { const next = !pinned; setPinned(next); saver.patch({ pinned: next }); }}>{pinned ? "Pinned to the top" : "Pin to the top"}</button>
            </div>
          </div>

          <NoteLinks saver={saver} note={note} draftContext={context} where={where} options={options} />

          <NoteActions title={snap.title} body={snap.body} chunkIds={note?.chunkId ? [note.chunkId] : []} materialId={note?.materialId ?? null} sessionId={note?.sessionId ?? null} step={note?.step ?? null} />

          {related.length > 0 && (
            <section aria-label="Related" className="mt-4" data-testid="note-related">
              <h3 className="cmp-learn-ink text-[12.5px] font-bold uppercase tracking-[0.08em]">Related</h3>
              <ul className="mt-1 space-y-1 text-[13.5px]">
                {related.map(r => <li key={r.href}><Link href={experienceHref("scholar", r.href)} className={learnAction.link}>{r.label}</Link> <span className="text-gray-700">· {r.why}</span></li>)}
              </ul>
            </section>
          )}

          <p className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-gray-700">
            {note && <span>Written {new Date(note.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}. Last changed {new Date(note.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}.</span>}
            {confirming ? (
              <span role="group" aria-label="Remove this note?" className="inline-flex items-center gap-3">
                <button type="button" className={`${learnAction.link} font-bold`} onClick={() => void remove()} data-testid="note-remove-yes">Yes, remove it</button>
                <button type="button" className={learnAction.link} onClick={() => setConfirming(false)}>Keep it</button>
              </span>
            ) : <button type="button" className={learnAction.link} onClick={() => setConfirming(true)} data-testid="note-remove">Remove this note</button>}
          </p>
          {msg && <p role="status" className="mt-1 text-[13px] text-gray-900">{msg}</p>}
        </>
      )}
    </div>
  );
}

/** Optional links. Each change saves in the same queue as the words. */
function NoteLinks({ saver, note, draftContext, where, options }: { saver: ReturnType<typeof useNoteSaver>["saver"]; note: NotebookNote | null; draftContext: NoteContext; where: NoteWhere | null; options: LinkOptions }) {
  const uid = useId();
  const initial = note ?? null;
  const [kind, setKind] = useState<"none" | "lesson" | "section" | "topic">(initial?.targetKind === "lesson" ? "lesson" : initial?.targetKind === "section" || initial?.targetKind === "material" ? "section" : initial?.targetKind === "topic" ? "topic" : "none");
  const [topic, setTopic] = useState(initial?.topic ?? "");
  const [sessionId, setSessionId] = useState(initial?.sessionId ?? "");
  const [steps, setSteps] = useState<{ step: number; title: string }[] | null>(null);
  const [step, setStep] = useState(initial?.step !== null && initial?.step !== undefined ? String(initial.step) : "");
  const [materialId, setMaterialId] = useState(initial?.materialId ?? "");
  const [sections, setSections] = useState<{ id: string; label: string }[] | null>(null);
  const [chunkId, setChunkId] = useState(initial?.chunkId ?? "");
  const [competencyId, setCompetencyId] = useState(initial?.competencyId ?? "");
  const [studyId, setStudyId] = useState(initial?.studyId ?? "");
  const [linked, setLinked] = useState<string | null>(where?.where ?? null);
  const [open, setOpen] = useState(false);
  const canFree = !note || note.viaNotebook;
  const fixedTarget = !!note && (note.kind !== "note" || note.targetKind === "artefact");

  useEffect(() => {
    if (!open || kind !== "lesson" || !sessionId) return;
    let live = true;
    void fetch(`/api/individual/scholar/learn/sessions/${encodeURIComponent(sessionId)}`).then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => {
      if (!live) return;
      const list = (j?.session?.steps ?? j?.steps ?? []) as { step: number; title?: string }[];
      setSteps(list.map((s, i) => ({ step: s.step, title: s.title?.trim() || `Lesson ${i + 1}` })));
    });
    return () => { live = false; };
  }, [open, kind, sessionId]);
  useEffect(() => {
    if (!open || kind !== "section" || !materialId) return;
    let live = true;
    void fetch(`/api/individual/scholar/library/notes?sections=${encodeURIComponent(materialId)}`).then(r => (r.ok ? r.json() : null)).catch(() => null).then(j => { if (live) setSections((j?.sections ?? []) as { id: string; label: string }[]); });
    return () => { live = false; };
  }, [open, kind, materialId]);

  const startKey = useState(() => JSON.stringify([kind, sessionId, step, materialId, chunkId, topic]))[0];
  const apply = () => {
    // Only what changed: adding a competency must not take the note off its section.
    const linkChanged = !fixedTarget && JSON.stringify([kind, sessionId, step, materialId, chunkId, topic]) !== startKey;
    let link: NoteLink | null = null;
    let label: string | null = null;
    if (kind === "none") { if (canFree) link = { targetKind: "free" }; }
    else if (kind === "topic") {
      const words = topic.replace(/\s+/g, " ").trim();
      if (words.length >= 2 && words.length <= 120 && canFree) { link = { targetKind: "topic", topic: words }; label = `Topic: ${words}`; }
    }
    else if (kind === "lesson" && sessionId && step !== "") {
      link = { targetKind: "lesson", sessionId, step: Number(step), materialId: null, chunkId: null };
      label = `${options.lessons.find(l => l.id === sessionId)?.title ?? "Your lesson"} · Lesson ${Number(step) + 1}`;
    } else if (kind === "section" && materialId) {
      link = chunkId ? { targetKind: "section", materialId, chunkId } : { targetKind: "material", materialId };
      label = options.materials.find(m => m.id === materialId)?.title ?? "Your material";
      if (chunkId) label = `${label}, ${sections?.find(s => s.id === chunkId)?.label ?? "one section"}`;
    }
    if (link && linkChanged) {
      saver.setContext({ ...draftContext, link, sectionLabel: null, sectionAnchor: null });
      saver.patch({ link, sectionLabel: null, sectionAnchor: null });
      setLinked(label);
    }
    if (competencyId !== (initial?.competencyId ?? "")) saver.patch({ competencyId: competencyId || null });
    if (studyId !== (initial?.studyId ?? "")) saver.patch({ studyId: studyId || null });
    setOpen(false);
  };

  return (
    <section aria-label="Links" className="mt-3 rounded-xl bg-[var(--cmp-app-surface)] p-3 ring-1 ring-[var(--learn-border)]" data-testid="note-links">
      <p className="text-[13.5px] text-gray-900">
        {linked ? <>Linked to <strong>{linked}</strong></> : note?.wasOn ? <>Free-standing. Was linked to {note.wasOn}, since removed.</> : "Not linked to anything. That is fine."}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {where?.openHref && <Link href={experienceHref("scholar", where.openHref)} className={learnAction.primary} data-testid="note-back-to-lesson">{where.openLabel}</Link>}
        {where?.sectionHref && <Link href={experienceHref("scholar", where.sectionHref)} className={learnAction.secondary}>Go to this section</Link>}
        {where?.picture && <SourcePictureButton materialId={where.picture.materialId} materialTitle={where.picture.materialTitle} citation={where.picture.citation} className={learnAction.secondary} />}
        <button type="button" aria-expanded={open} className={learnAction.secondary} onClick={() => setOpen(o => !o)} data-testid="note-link-open">{linked ? "Change link" : "Add a link"}</button>
      </div>
      {open && (
        <div className="mt-2.5 space-y-2.5">
          {!fixedTarget && (
            <fieldset>
              <legend className="text-[12.5px] font-semibold text-gray-800">Link this note to</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {canFree && <label className="inline-flex min-h-[40px] items-center gap-2 text-[14px] text-gray-900"><input type="radio" className="h-5 w-5" name={`${uid}-k`} checked={kind === "none"} onChange={() => setKind("none")} />Nothing</label>}
                {canFree && <label className="inline-flex min-h-[40px] items-center gap-2 text-[14px] text-gray-900"><input type="radio" className="h-5 w-5" name={`${uid}-k`} checked={kind === "topic"} onChange={() => setKind("topic")} data-testid="note-link-topic" />A topic</label>}
                <label className="inline-flex min-h-[40px] items-center gap-2 text-[14px] text-gray-900"><input type="radio" className="h-5 w-5" name={`${uid}-k`} checked={kind === "lesson"} onChange={() => setKind("lesson")} data-testid="note-link-lesson" />A lesson</label>
                <label className="inline-flex min-h-[40px] items-center gap-2 text-[14px] text-gray-900"><input type="radio" className="h-5 w-5" name={`${uid}-k`} checked={kind === "section"} onChange={() => setKind("section")} data-testid="note-link-section" />A material, section, slide or picture</label>
              </div>
            </fieldset>
          )}
          {kind === "topic" && !fixedTarget && (
            <label className="block text-[12.5px] font-semibold text-gray-800">Topic: choose one of yours, or type your own
              <input value={topic} maxLength={120} list={`${uid}-topics`} onChange={e => setTopic(e.target.value)} className={field} data-testid="note-link-topic-input" />
              <datalist id={`${uid}-topics`}>{options.topics.map(t => <option key={t} value={t} />)}</datalist>
            </label>
          )}
          {kind === "lesson" && !fixedTarget && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[12.5px] font-semibold text-gray-800">Study session
                <select value={sessionId} onChange={e => { setSessionId(e.target.value); setStep(""); setSteps(null); }} className={field} data-testid="note-link-session">
                  <option value="">Choose</option>{options.lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </label>
              <label className="text-[12.5px] font-semibold text-gray-800">Lesson
                <select value={step} onChange={e => setStep(e.target.value)} disabled={!sessionId || steps === null} className={field} data-testid="note-link-step">
                  <option value="">{!sessionId ? "Choose a session first" : steps === null ? "Reading its lessons…" : "Choose"}</option>
                  {(steps ?? []).map((s, i) => <option key={s.step} value={s.step}>Lesson {i + 1}: {s.title}</option>)}
                </select>
              </label>
            </div>
          )}
          {kind === "section" && !fixedTarget && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[12.5px] font-semibold text-gray-800">Material
                <select value={materialId} onChange={e => { setMaterialId(e.target.value); setChunkId(""); setSections(null); }} className={field}>
                  <option value="">Choose</option>{options.materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </label>
              <label className="text-[12.5px] font-semibold text-gray-800">Section, slide or page (optional)
                <select value={chunkId} onChange={e => setChunkId(e.target.value)} disabled={!materialId || sections === null} className={field}>
                  <option value="">{!materialId ? "Choose a material first" : sections === null ? "Reading its sections…" : "The whole material"}</option>
                  {(sections ?? []).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {options.competencies && (
              <label className="text-[12.5px] font-semibold text-gray-800">Competency (optional)
                <select value={competencyId} onChange={e => setCompetencyId(e.target.value)} className={field}>
                  <option value="">None</option>{options.competencies.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
            )}
            {options.lessons.some(l => l.connected) && (
              <label className="text-[12.5px] font-semibold text-gray-800">Study session it belongs to (optional)
                <select value={studyId} onChange={e => setStudyId(e.target.value)} className={field}>
                  <option value="">None</option>{options.lessons.filter(l => l.connected).map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={learnAction.primary} onClick={apply} data-testid="note-link-apply">Save link</button>
            <button type="button" className={learnAction.secondary} onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="text-[12px] text-gray-700">A link is for finding your way back. It never counts as practice or as evidence of competence.</p>
        </div>
      )}
    </section>
  );
}
