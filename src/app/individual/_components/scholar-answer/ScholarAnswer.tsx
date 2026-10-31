"use client";

// SCHOLAR-PERSONAL-AI-EXPERIENCE-01: renders a Personal AI reply as structured React text (answer-format.ts parses it).
// No HTML is ever injected: every string below is a React text child, so markup in the model's text stays literal text.

import { Fragment, createContext, useContext, useMemo, type ReactNode } from "react";
import { inlineSegments, parseAnswer, type AnswerBlock, type CalloutKind } from "@/lib/individual/scholar/answer-format";
import { LEARN_NOT_COVERED_LABEL, LEARN_NOT_COVERED_NOTE } from "@/lib/individual/scholar/config";
import type { PersonalAiSourceRef } from "@/lib/individual/personal-ai-options";
import { Diagram } from "./Diagram";
import { PracticeCard } from "./PracticeCard";

type Save = (card: { front: string; back: string }) => Promise<string | null>;

const CITE: Record<string, { word: string; cls: string }> = {
  S: { word: "your notes", cls: "border-[var(--cmp-theme-border)] bg-[var(--cmp-theme-soft)] text-[var(--cmp-theme-ink)]" },
  R: { word: "reference", cls: "border-gray-400 bg-gray-100 text-gray-900" },
  E: { word: "research", cls: "border-sky-700 bg-sky-50 text-sky-900" },
};

// SCHOLAR-PAI-RESEARCH-01: the numbered notes an answer may cite (the Learn-step Personal AI). When given, a note tag that
// names none of them is not drawn as a chip, and a chip's title names its note. Absent (the Personal AI page): as before.
const SourcesContext = createContext<readonly PersonalAiSourceRef[] | undefined>(undefined);

function Inline({ text }: { text: string }): ReactNode {
  const sources = useContext(SourcesContext);
  return (
    <>
      {inlineSegments(text).map((s, i) => {
        if (s.t === "bold") return <strong key={i} className="font-semibold text-gray-900">{s.v}</strong>;
        if (s.t === "cite") {
          const c = CITE[s.tag ?? "S"] ?? CITE.S;
          const note = s.tag === "S" ? sources?.find(x => x.tag === `S${Number(s.v)}`) : undefined;
          if (s.tag === "S" && sources && !note) return null;
          const title = note ? `Source: your notes, ${note.citation}` : `Source: ${c.word} ${s.v}`;
          return (
            <span key={i} role="note" aria-label={title} title={title}
              className={`mx-0.5 inline-block rounded-full border px-1.5 align-baseline text-[12px] font-bold leading-[1.5] ${c.cls}`}>
              {s.tag}{s.v}
            </span>
          );
        }
        return <Fragment key={i}>{s.v}</Fragment>;
      })}
    </>
  );
}

const ICON: Record<CalloutKind, ReactNode> = {
  caution: <path d="M10 3l8 14H2L10 3zm0 5v4m0 2.5v.01" />,
  key: <path d="M10 2.5l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.8l5-.7L10 2.5z" />,
  summary: <path d="M4 5h12M4 10h12M4 15h8" />,
  memory: <path d="M7 14.5h6M8 17h4M10 2.5a5 5 0 00-3 9v1.5h6V11.5a5 5 0 00-3-9z" />,
  example: <path d="M3 4h14v9H8l-4 3.5V13H3V4z" />,
  record: <path d="M5 2.5h7l3 3v12H5v-15zM8 9h5M8 12.5h5" />,
  background: <path d="M10 2.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15zM2.5 10h15M10 2.5c2.2 2.1 3.3 4.6 3.3 7.5s-1.1 5.4-3.3 7.5c-2.2-2.1-3.3-4.6-3.3-7.5S7.8 4.6 10 2.5z" />,
};
const CALLOUT: Record<CalloutKind, { label: string; box: string; ink: string }> = {
  caution: { label: "Clinical caution", box: "border-amber-700 bg-amber-50", ink: "text-amber-900" },
  key: { label: "Key concept", box: "border-l-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-soft)]", ink: "text-[var(--cmp-theme-ink)]" },
  summary: { label: "Summary", box: "border-gray-500 bg-gray-50", ink: "text-gray-900" },
  memory: { label: "Memory aid", box: "border-indigo-700 bg-indigo-50", ink: "text-indigo-900" },
  example: { label: "Example", box: "border-emerald-700 bg-emerald-50", ink: "text-emerald-900" },
  record: { label: "From your record", box: "border-sky-700 bg-sky-50", ink: "text-sky-900" },
  // SCHOLAR-PAI-RESEARCH-01: AI explanation that is NOT from the learner's notes -- apart from them, in its own colour.
  background: { label: "General background \u2014 not from your notes", box: "border-violet-700 bg-violet-50", ink: "text-violet-900" },
};

function Callout({ kind, lines }: { kind: CalloutKind; lines: string[] }) {
  const c = CALLOUT[kind];
  // Consecutive "- " lines inside a callout read as a list; the rest are short paragraphs.
  const groups: Array<{ list: boolean; items: string[] }> = [];
  for (const l of lines) {
    const m = /^[-*]\s+(.*)$/.exec(l);
    const list = !!m, text = m ? m[1] : l;
    const last = groups[groups.length - 1];
    if (last && last.list === list && list) last.items.push(text); else groups.push({ list, items: [text] });
  }
  return (
    <aside role="note" aria-label={c.label} className={`rounded-lg border-l-4 px-3.5 py-3 ${c.box}`}>
      <p className={`flex items-center gap-1.5 text-[12.5px] font-bold uppercase tracking-[0.08em] ${c.ink}`}>
        <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{ICON[kind]}</svg>
        {c.label}
      </p>
      <div className="mt-1.5 space-y-1.5 text-[15px] leading-[1.6] text-gray-900">
        {groups.map((g, i) => g.list
          ? <ul key={i} className="ml-5 list-disc space-y-1">{g.items.map((t, j) => <li key={j} className="break-words"><Inline text={t} /></li>)}</ul>
          : <p key={i} className="break-words"><Inline text={g.items[0]} /></p>)}
      </div>
    </aside>
  );
}

function Block({ b }: { b: AnswerBlock }) {
  switch (b.type) {
    case "heading":
      return b.level === 2
        ? <h3 className="pt-2 text-[17px] font-semibold leading-[1.35] text-gray-900"><Inline text={b.text} /></h3>
        : <h4 className="pt-1 text-[15px] font-semibold leading-[1.4] text-gray-900"><Inline text={b.text} /></h4>;
    case "paragraph":
      return <p className="max-w-[70ch] whitespace-pre-line break-words text-[15px] leading-[1.6] text-gray-900"><Inline text={b.text} /></p>;
    case "list": {
      const L = b.ordered ? "ol" : "ul";
      return (
        <L className={`max-w-[70ch] space-y-1.5 pl-6 text-[15px] leading-[1.6] text-gray-900 marker:font-semibold marker:text-gray-700 ${b.ordered ? "list-decimal" : "list-disc"}`}>
          {b.items.map((t, i) => <li key={i} className="break-words pl-1"><Inline text={t} /></li>)}
        </L>
      );
    }
    case "table":
      return (
        <div role="region" aria-label="Comparison table" tabIndex={0}
          className="max-w-full overflow-x-auto rounded-lg border border-gray-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900">
          <table className="min-w-full border-collapse text-left text-[14px] leading-[1.5] text-gray-900">
            <thead className="bg-gray-100">
              <tr>{b.header.map((h, i) => <th key={i} scope="col" className="border-b border-gray-300 px-3 py-2 align-bottom font-semibold"><Inline text={h} /></th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="odd:bg-white even:bg-gray-50">
                  {r.map((c, j) => <td key={j} className="border-t border-gray-200 px-3 py-2 align-top"><Inline text={c} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return <Callout kind={b.kind} lines={b.lines} />;
    case "flow":
    case "map":
    case "timeline":
      return <Diagram block={b} />;
  }
}

/** The cited notes, listed under a finished answer: "S1  Material title, page 3". */
function SourceList({ sources }: { sources: readonly PersonalAiSourceRef[] }) {
  if (!sources.length) return null;
  return (
    <section aria-label="Sources from your notes" className="rounded-lg border border-gray-300 bg-white px-3.5 py-3">
      <p className="text-[12.5px] font-bold uppercase tracking-[0.08em] text-gray-700">Sources from your notes</p>
      <ul className="mt-1.5 space-y-1 text-[14px] leading-[1.5] text-gray-900">
        {sources.map(s => (
          <li key={s.tag} className="flex gap-2 break-words">
            <span className={`mt-0.5 inline-block h-fit shrink-0 rounded-full border px-1.5 text-[12px] font-bold leading-[1.5] ${CITE.S.cls}`}>{s.tag}</span>
            <span className="min-w-0">{s.citation}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the notes did not cover, named (the model's NOT COVERED line), with an optional way on (`action`). */
function NotCovered({ items, action }: { items: readonly string[]; action?: ReactNode }) {
  return (
    <section aria-label={LEARN_NOT_COVERED_LABEL} className="rounded-lg border border-amber-700 bg-amber-50 px-3.5 py-3">
      <p className="text-[12.5px] font-bold uppercase tracking-[0.08em] text-amber-900">{LEARN_NOT_COVERED_LABEL}</p>
      <ul className="mt-1.5 ml-5 list-disc space-y-1 text-[15px] leading-[1.5] text-gray-900">{items.map((t, i) => <li key={i} className="break-words">{t}</li>)}</ul>
      <p className="mt-1.5 text-[13.5px] leading-[1.5] text-gray-800">{LEARN_NOT_COVERED_NOTE}</p>
      {action && <div className="mt-2">{action}</div>}
    </section>
  );
}

export function ScholarAnswer({ text, streaming = false, label, onSaveFlashcard, sources, notCoveredAction }: {
  text: string; streaming?: boolean; label?: string; onSaveFlashcard?: Save;
  /** The numbered notes the answer cites (Learn-step Personal AI only). Given: unknown note tags are not drawn, and the cited notes are listed. */
  sources?: readonly PersonalAiSourceRef[];
  /** Shown inside the "Not covered in your notes" block, when the answer names something the notes did not cover. */
  notCoveredAction?: ReactNode;
}) {
  const { blocks, practice, practicePending, diagramPending, notCovered } = useMemo(() => parseAnswer(text, { streaming }), [text, streaming]);
  return (
    <SourcesContext.Provider value={sources}>
    <div aria-busy={streaming} className="min-w-0 max-w-full space-y-4">
      {blocks.map((b, i) => <Block key={i} b={b} />)}
      {streaming && <p className="text-[13px] text-gray-700 motion-safe:animate-pulse" aria-hidden="true">Writing…<span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-gray-700" /></p>}
      {diagramPending && <p className="text-[13px] text-gray-700">Preparing diagram…</p>}
      {practicePending && <p className="text-[13px] text-gray-700">Preparing practice…</p>}
      {practice && <PracticeCard practice={practice} onSaveFlashcard={onSaveFlashcard} />}
      {!streaming && notCovered.length > 0 && <NotCovered items={notCovered} action={notCoveredAction} />}
      {!streaming && sources && <SourceList sources={sources} />}
      {label && <p className="pt-1 text-[12.5px] leading-[1.5] text-gray-600">{label}</p>}
    </div>
    </SourcesContext.Provider>
  );
}
