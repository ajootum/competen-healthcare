"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { withStudy } from "@/lib/individual/scholar/study-carry";
import type { FlashcardExperience, testScopeOf } from "@/lib/individual/scholar/flashcard-experience";
import { studyHref } from "./question-view";
import { flashcardsHref } from "./revise-nav";
import { carry, studyField } from "./study-active";
import { I, Icon, call, focusRing, ghost, indigo, primary } from "./flashcards-client";

// FLASHCARD LEARNING EXPERIENCE (owner GO, 1 Nov 2026). The three experiences of Flashcards and what sits in each:
//   Study cards       -- choose a deck and study it; continue an unfinished session (from the database, so on any device);
//                        cards from one lesson (?material=)
//   Test myself       -- type the answers, a multiple-choice quiz on the deck's topics, adaptive exam, apply it in a case
//   Create & manage   -- make cards, write your own, deck options, All cards, My Decks
// Studying never shows the creation form. Nothing here calls AI; the quiz is the existing Revise session.

const MODES: { key: FlashcardExperience; label: string; icon: React.ReactNode }[] = [
  { key: "study", label: "Study cards", icon: I.layers },
  { key: "test", label: "Test myself", icon: I.target },
  { key: "manage", label: "Create & manage", icon: I.pen },
];

/** The segmented control: three links, the current one marked by aria-current, a ring and a raised surface (never colour alone). */
export function FlashcardModeNav({ current, deck = null, studyId = null }: { current: FlashcardExperience; deck?: string | null; studyId?: string | null }) {
  const href = (k: FlashcardExperience) => withStudy(flashcardsHref({ view: k === "study" ? null : k, deck }), studyId);
  return (
    <nav aria-label="Ways to use flashcards" data-testid="flashcard-modes">
      <ul className="grid grid-cols-3 gap-1 rounded-2xl border border-gray-200 bg-gray-50 p-1">
        {MODES.map(m => {
          const on = m.key === current;
          return (
            <li key={m.key} className="flex">
              <Link href={href(m.key)} aria-current={on ? "page" : undefined}
                className={`flex min-h-[48px] w-full flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1.5 text-center text-[13px] font-semibold leading-tight pointer-coarse:min-h-[var(--cmp-touch-min)] md:flex-row md:gap-2 md:text-[14px] ${focusRing} ${on ? "bg-white text-[var(--cmp-role-indigo-ink)] shadow-sm ring-2 ring-[var(--cmp-role-indigo-ink)]" : "text-gray-700 hover:bg-white"}`}>
                <Icon d={m.icon} size={18} />{m.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** "Continue where you left off": the learner's newest unfinished flashcards session, read from the database (so it follows them across devices). */
export function ResumePanel({ href, title, position, total }: { href: string; title: string; position: number; total: number }) {
  return (
    <section aria-labelledby="resume-h" data-testid="resume-panel" className="rounded-3xl border border-[var(--cmp-role-indigo-soft)] bg-[color-mix(in_srgb,var(--cmp-role-indigo-soft)_45%,white)] p-4 md:p-5">
      <h2 id="resume-h" className="text-[17px] font-bold text-gray-900">Continue where you left off</h2>
      <p className="mt-0.5 text-[14px] text-gray-700">{title} · <span className="font-semibold tabular-nums">Card {position} of {total}</span></p>
      <Link href={href} className={`${primary} mt-3`} style={{ background: indigo }}><Icon d={I.play} />Continue</Link>
    </section>
  );
}

/** ?material=<id>[&section=<id>]: the cards of one lesson, studied as a session of those exact cards (their identity and history are kept). */
export function MaterialCards({ title, ids, sectionOnly, manageHref }: { title: string; ids: string[]; sectionOnly: boolean; manageHref: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function study() {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/revision/sessions", { ...studyField(), mode: "flashcards", cardIds: ids });
    setBusy(false);
    if (!r.ok || !r.json.session?.id) { setError(r.json.error ?? "Studying could not start just now."); return; }
    router.push(carry(flashcardsHref({ session: r.json.session.id })));
  }
  return (
    <section aria-labelledby="material-h" data-testid="material-cards" className="rounded-3xl border border-gray-200 bg-white p-4 md:p-5">
      <h2 id="material-h" className="text-[17px] font-bold text-gray-900">{ids.length ? `Cards from ${title}` : "No cards from this lesson yet"}</h2>
      {ids.length ? (
        <>
          <p className="mt-0.5 text-[14px] text-gray-700"><span className="font-semibold tabular-nums">{ids.length}</span> card{ids.length === 1 ? "" : "s"}{sectionOnly ? " from this section" : ""}.</p>
          <button type="button" className={`${primary} mt-3`} style={{ background: indigo }} disabled={busy} onClick={() => void study()}><Icon d={I.play} />{busy ? "Starting…" : "Study these cards"}</button>
          {error && <p role="alert" className="mt-2 text-[13.5px] font-semibold text-red-800">{error}</p>}
        </>
      ) : (
        <>
          <p className="mt-0.5 text-[14px] text-gray-700">{title} has no flashcards yet{sectionOnly ? " for this section" : ""}. You can make some from it.</p>
          <Link href={manageHref} className={`${ghost} mt-3`}><Icon d={I.plus} />Make cards in Create &amp; manage</Link>
        </>
      )}
    </section>
  );
}

/** Test myself. Three ways to be tested on a deck, none of which is a flashcard review except the typed one (a self-rated flashcard review). */
export function TestTiles({ deck, scope, adaptiveHref, applyHref }: {
  deck: { key: string; title: string; total: number };
  scope: ReturnType<typeof testScopeOf>;
  /** Present only when adaptive exams are offered. */
  adaptiveHref: string | null;
  applyHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "typed" | "quiz">("");
  const [error, setError] = useState("");
  async function typed() {
    setBusy("typed"); setError("");
    const r = await call("/api/individual/scholar/revision/sessions", { ...studyField(), mode: "flashcards", deck: deck.key });
    setBusy("");
    if (!r.ok || !r.json.session?.id) { setError(r.json.error ?? "Practice could not start just now."); return; }
    router.push(carry(flashcardsHref({ session: r.json.session.id, deck: deck.key, practice: "typed" })));
  }
  async function quiz() {
    if (!scope) return;
    setBusy("quiz"); setError("");
    // The existing Revise session (not flashcards): code-marked, kept with Revise results. excludeFlashcards keeps every card out of it.
    const r = await call("/api/individual/scholar/revision/sessions", { ...studyField(), mode: "quick", formats: ["mcq"], scope, excludeFlashcards: true });
    setBusy("");
    if (!r.ok || !r.json.session?.id) { setError(r.json.error ?? "The quiz could not start just now."); return; }
    router.push(carry(`${studyHref("revise")}?session=${r.json.session.id}`));
  }
  const none = deck.total === 0;
  const tile = "flex flex-col rounded-2xl border border-gray-200 bg-white p-4";
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3">
        <li className={tile}>
          <h3 className="inline-flex items-center gap-2 text-[15.5px] font-bold text-gray-900"><Icon d={I.pen} />Type the answers</h3>
          <p className="mt-1 flex-1 text-[13.5px] text-gray-700">Write each answer from memory, then check it against the card. You judge your own answer. This counts as a flashcard review.</p>
          <button type="button" className={`${primary} mt-3 self-start`} style={{ background: indigo }} disabled={!!busy || none} onClick={() => void typed()}>{busy === "typed" ? "Starting…" : "Start typing"}</button>
        </li>
        <li className={tile}>
          <h3 className="inline-flex items-center gap-2 text-[15.5px] font-bold text-gray-900"><Icon d={I.list} />Multiple-choice quiz on these topics</h3>
          <p className="mt-1 flex-1 text-[13.5px] text-gray-700">Questions on the topics of {deck.title}, marked by the app. Your cards and their review schedule are not touched.</p>
          <button type="button" className={`${primary} mt-3 self-start`} style={{ background: indigo }} disabled={!!busy || !scope} onClick={() => void quiz()}>{busy === "quiz" ? "Starting…" : "Start the quiz"}</button>
        </li>
        {adaptiveHref && (
          <li className={tile}>
            <h3 className="inline-flex items-center gap-2 text-[15.5px] font-bold text-gray-900"><Icon d={I.doc} />Adaptive exam</h3>
            <p className="mt-1 flex-1 text-[13.5px] text-gray-700">A longer exam that adjusts to your answers.</p>
            <Link href={adaptiveHref} className={`${ghost} mt-3 self-start`}>Open adaptive exams</Link>
          </li>
        )}
        <li className={tile}>
          <h3 className="inline-flex items-center gap-2 text-[15.5px] font-bold text-gray-900"><Icon d={I.ask} />Apply it in a case</h3>
          <p className="mt-1 flex-1 text-[13.5px] text-gray-700">Use what you remember in a short clinical case.</p>
          <Link href={applyHref} className={`${ghost} mt-3 self-start`}>Try a case</Link>
        </li>
      </ul>
      {none && <p className="text-[13.5px] text-gray-700">This deck has no cards yet, so there is nothing to test. Choose another deck, or make cards in Create &amp; manage.</p>}
      {error && <p role="alert" className="text-[13.5px] font-semibold text-red-800">{error}</p>}
      <p className="text-[12.5px] text-gray-600">Test results are marked and kept with your Revise results, apart from your flashcard reviews. Practice is formative: it is not verified competence.</p>
    </div>
  );
}
