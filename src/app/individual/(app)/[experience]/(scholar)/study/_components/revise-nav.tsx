import Link from "next/link";
import { studyHref } from "./question-view";

// THE REVISE SUB-NAVIGATION -- SCHOLAR-FLASHCARDS-01 (owner mock-up, 31 Oct 2026), within the Scholar shell.
// Practice Questions, Flashcards, Adaptive Exams, Revision History, My Decks. It sits INSIDE the Revise space: the
// global sidebar and the Learning spaces tabs (StudyNav) are unchanged. A vertical list in its own column from md up;
// below md (the CPR-MOB-001 single edge) one row that scrolls sideways, so the card stays near the top of the screen.

export type ReviseNavKey = "practice" | "flashcards" | "adaptive" | "history" | "decks";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
export const flashcardsHref = (params: Record<string, string | null | undefined> = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const s = q.toString();
  return `${studyHref("revise/flashcards")}${s ? `?${s}` : ""}`;
};

const ICON: Record<ReviseNavKey, React.ReactNode> = {
  practice: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 12l3 3 5-6" /></>,
  flashcards: <><rect x="3" y="6" width="14" height="13" rx="2" /><path d="M7 3h12a2 2 0 0 1 2 2v12" /></>,
  adaptive: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h5M8 16h3" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  decks: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 14l2 2 4-4" /></>,
};

/** `row`: one row at every width (the Revise and Adaptive pages, whose own layout has no side column for it). */
export function ReviseNav({ current, adaptive, row = false }: { current: ReviseNavKey; adaptive: boolean; row?: boolean }) {
  const items: { key: ReviseNavKey; label: string; href: string }[] = [
    { key: "practice", label: "Practice Questions", href: studyHref("revise") },
    { key: "flashcards", label: "Flashcards", href: flashcardsHref() },
    ...(adaptive ? [{ key: "adaptive" as const, label: "Adaptive Exams", href: studyHref("revise/adaptive") }] : []),
    { key: "history", label: "Revision History", href: flashcardsHref({ view: "history" }) },
    { key: "decks", label: "My Decks", href: flashcardsHref({ view: "decks" }) },
  ];
  return (
    <nav aria-label="Revise" className={row ? "-mx-4 mb-4 overflow-x-auto px-4" : "-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0"}>
      {!row && <p className="hidden px-3 pb-2 text-[18px] font-bold text-gray-900 md:block">Revise</p>}
      <ul className={row ? "flex min-w-max gap-1.5" : "flex min-w-max gap-1.5 md:min-w-0 md:flex-col md:gap-1"}>
        {items.map(i => {
          const on = i.key === current;
          return (
            <li key={i.key}>
              <Link href={i.href} aria-current={on ? "page" : undefined}
                className={`inline-flex min-h-[40px] w-full items-center gap-2.5 rounded-xl px-3 text-[14px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${on ? "bg-[var(--cmp-role-indigo-soft)] text-[var(--cmp-role-indigo-ink)]" : "text-gray-700 hover:bg-gray-100"}`}>
                <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON[i.key]}</svg>
                <span className="whitespace-nowrap">{i.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
