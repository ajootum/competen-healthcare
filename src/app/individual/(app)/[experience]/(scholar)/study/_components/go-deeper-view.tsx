"use client";

import { Fragment, useState, type ReactNode } from "react";
import { AnswerOption, DisclaimerBadge, InlineNote, LearningCallout, LearningDisclosure, LearningIcon, QuestionCard, learnAction, learnBox, learnTone, type LearningIconName } from "@/components/ui/scholar-learning";
import { GO_DEEPER_COPY, GO_DEEPER_LEVELS, deeperEvidenceStatement, levelOfDepth, type DeeperBlock, type DeeperKind, type DeeperParts, type DeeperSection } from "@/lib/individual/scholar/deeper-format";
import { citedTags, questionText } from "@/lib/individual/scholar/teach-format";
import { pagesOfCitation } from "@/lib/individual/scholar/material-visuals";
import { SectionPictures } from "./learn-visuals";

// SCHOLAR-GO-DEEPER-001 (owner, 6 Nov 2026): ONE STRUCTURED GO DEEPER ROUND ON THE PAGE. "Simplify the presentation, not the science."
//
// The level control, the card, the question in its grey block, numbered sections with an icon and a thin rule, misconceptions and safety in
// the caution tone, the reasoning check, the takeaways and the sources and evidence. One major concept. Long detail folds away and is never
// cut to fit a screen. Every section says in words where it comes from. Nothing here calls AI except the learner's own choice of a new level.
// Below the md edge a table reads as stacked rows (the one responsive edge, CPR-MOB-001); nothing scrolls sideways.

type Source = { tag: string; chunkId: string; materialId: string; materialTitle: string; citation: string };
export type GoDeeperLevels = {
  /** Levels this lesson already has a round at, with where to find the newest of them. */
  saved: Partial<Record<string, string>>;
  /** Ask for a round at this depth (an AI call). Absent: the level control is not offered here. */
  onLevel?: (depth: string) => void;
  busy: boolean;
};

/** Pages a round may look for pictures on: many slides hold none, so this bounds the search and the page, not the number shown. */
const MAX_PICTURE_PAGES = 6;

const KIND_ICON: Record<DeeperKind, LearningIconName> = {
  principle: "bulb", science: "layers", compare: "list", application: "target", misconception: "warn", safety: "warn", limits: "search", advanced: "spark",
};

/** ONE place a section's note is captured. COMPETEN-NOTEBOOK-001's My Ideas & Notes (MyIdeasBox: chunkId, materialId, sectionLabel, anchor) is drawn here when it lands: nothing else changes. No second capture is built. */
function SectionNote(_: { anchor: string; label: string; chunkId: string | null; materialId: string | null }): ReactNode {
  return null;
}

const firstSource = (section: DeeperSection, sources: readonly Source[]) => {
  const text = section.blocks.map(b => (b.t === "p" ? b.text : b.t === "list" ? b.items.join(" ") : b.t === "flow" ? b.steps.join(" ") : b.rows.flat().join(" "))).join(" ");
  const tag = citedTags(text)[0];
  return tag ? sources.find(s => s.tag === `S${tag}`) ?? null : null;
};

function SourceChip({ source }: { source: DeeperSection["source"] }) {
  return source === "notes"
    ? <span className={`${learnTone("teach")} inline-flex items-center gap-1 rounded-full bg-[var(--learn-surface)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--learn-ink)] ring-1 ring-[var(--learn-border)]`}><LearningIcon name="book" className="h-3.5 w-3.5" />{GO_DEEPER_COPY.notes}</span>
    : <span className={`${learnTone("aiBeyond")} inline-flex items-center gap-1 rounded-full bg-[var(--learn-surface)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--learn-ink)] ring-1 ring-[var(--learn-border)]`} title={GO_DEEPER_COPY.scholarNote}><LearningIcon name="robot" className="h-3.5 w-3.5" />{GO_DEEPER_COPY.scholar}</span>;
}

function Blocks({ blocks, cite }: { blocks: readonly DeeperBlock[]; cite: (text: string) => ReactNode }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === "p") return <p key={i} className="mt-2 first:mt-0">{cite(b.text)}</p>;
        if (b.t === "list") return <ul key={i} className="mt-2 list-disc space-y-1 pl-5 marker:text-[var(--learn-accent)]">{b.items.map((x, k) => <li key={k}>{cite(x)}</li>)}</ul>;
        if (b.t === "flow") return (
          <ol key={i} aria-label="How one leads to the next" className="mt-3 flex flex-col gap-1.5 md:flex-row md:flex-wrap md:items-stretch">
            {b.steps.map((step, k) => (
              <li key={k} className="flex items-center gap-1.5 md:min-w-0 md:flex-1">
                <span className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-[var(--cmp-app-surface)] px-2.5 py-1.5 text-[14px] leading-snug text-gray-900">{cite(step)}</span>
                {k < b.steps.length - 1 && <span aria-hidden="true" className="shrink-0 text-gray-500"><span className="md:hidden">↓</span><span className="hidden md:inline">→</span></span>}
              </li>
            ))}
          </ol>
        );
        const [head, ...rows] = b.rows;
        return (
          <div key={i} className="mt-3">
            {/* From the md edge: a real table. Below it: each row as its own labelled block, so nothing is cut or scrolled sideways. */}
            <table className="hidden w-full border-collapse text-left text-[14px] md:table">
              <thead><tr>{head.map((h, k) => <th key={k} scope="col" className="border-b-2 border-gray-300 px-2.5 py-1.5 font-semibold text-gray-900">{cite(h)}</th>)}</tr></thead>
              <tbody>{rows.map((r, k) => <tr key={k}>{r.map((c, n) => (n === 0 ? <th key={n} scope="row" className="border-b border-gray-200 px-2.5 py-1.5 align-top font-semibold text-gray-900">{cite(c)}</th> : <td key={n} className="border-b border-gray-200 px-2.5 py-1.5 align-top text-gray-800">{cite(c)}</td>))}</tr>)}</tbody>
            </table>
            <dl className="space-y-2 md:hidden">
              {rows.map((r, k) => (
                <div key={k} className="rounded-lg border border-gray-200 bg-[var(--cmp-app-surface)] px-3 py-2 text-[14px]">
                  {r.map((c, n) => (n === 0
                    ? <dt key={n} className="font-semibold text-gray-900">{cite(c)}</dt>
                    : <dd key={n} className="mt-1 text-gray-800"><span className="font-semibold text-gray-700">{cite(head[n] ?? "")}: </span>{cite(c)}</dd>))}
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </>
  );
}

function NumberMark({ n }: { n: number }) {
  return <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[12.5px] font-bold text-white">{n}</span>;
}

/** Explore at your level: real radio buttons drawn as three segments. A level with a saved round goes to it, with no AI. A new one is asked for by name, never by moving the control. */
function LevelControl({ current, levels }: { current: string; levels: GoDeeperLevels }) {
  const [picked, setPicked] = useState(current);
  const level = levelOfDepth(picked);
  const saved = levels.saved[level.depth];
  return (
    <div className={`${learnTone("explain")} rounded-2xl border border-gray-200 bg-[var(--cmp-app-surface)] p-3 sm:p-4`}>
      <fieldset>
        <legend className="text-[13.5px] font-bold text-gray-900">{GO_DEEPER_COPY.levels}</legend>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
          {GO_DEEPER_LEVELS.map(l => (
            <label key={l.key} className={`flex min-h-[40px] cursor-pointer items-center justify-center rounded-lg px-1 text-center text-[13.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-gray-900 ${l.depth === picked ? "bg-gray-900 text-white" : "text-gray-900 hover:bg-gray-200"}`}>
              <input type="radio" name="go-deeper-level" className="sr-only" checked={l.depth === picked} onChange={() => setPicked(l.depth)} />{l.label}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-2 text-[13.5px] leading-snug text-gray-700">{level.hint}</p>
      {picked !== current && (saved
        ? <a href={`#${saved}`} className={`${learnAction.secondary} mt-2`}>Read your {level.label} round</a>
        : levels.onLevel && <button type="button" disabled={levels.busy} onClick={() => levels.onLevel!(level.depth)} className={`${learnAction.primary} mt-2`}>Go deeper at {level.label}</button>)}
    </div>
  );
}

export function GoDeeperCard({ parts, depth, anchorId, sources, cite, levels, onAnswer, onChoose, canAnswer, renderCheck, answered, research, hasResearch, tools, salvage, sourcesAndMore }: {
  parts: DeeperParts; depth: string | null | undefined; anchorId?: string; sources: readonly Source[]; cite: (text: string) => ReactNode;
  levels: GoDeeperLevels | null;
  onAnswer?: (q: string) => void; onChoose?: (q: string, option: string) => void; canAnswer?: (q: string) => boolean; renderCheck?: (q: string) => ReactNode; answered?: (q: string) => string | null;
  /** The research part (ResearchBlock), placed in the sequence after the science. Null: no research in this round. */
  research: ReactNode; hasResearch: boolean;
  tools?: ReactNode; salvage?: ReactNode; sourcesAndMore?: ReactNode;
}) {
  const level = levelOfDepth(depth);
  const prefix = anchorId ?? "go-deeper";
  const usedPages = new Set<string>();
  const hasScholar = parts.sections.some(s => s.source === "scholar");
  const firstAfterScience = parts.sections.findIndex(s => s.kind !== "principle" && s.kind !== "science" && s.kind !== "compare");
  const researchAt = hasResearch ? (firstAfterScience < 0 ? parts.sections.length : firstAfterScience) : -1;
  let n = 0;
  const sectionView = (s: DeeperSection, i: number) => {
    const source = firstSource(s, sources);
    const anchor = `${prefix}-s${i}`;
    // One original picture per page per round, under the section that cites it (SCHOLAR-VISUAL-001). Scholar's own sections cite nothing, so they show none.
    const pages = source ? pagesOfCitation(source.citation) : null;
    const pageKey = pages && source ? `${source.materialId}:${pages.from}` : null;
    const picture = pages && source && pageKey && s.source === "notes" && !usedPages.has(pageKey) && usedPages.size < MAX_PICTURE_PAGES && s.kind !== "safety"
      ? <SectionPictures materialId={source.materialId} materialTitle={source.materialTitle} from={pages.from} to={pages.to} first last={false} /> : null;
    if (picture && pageKey) usedPages.add(pageKey);
    const note = <SectionNote anchor={anchor} label={s.title} chunkId={source?.chunkId ?? null} materialId={source?.materialId ?? null} />;
    const body = <Blocks blocks={s.blocks} cite={cite} />;
    if (s.kind === "advanced") {
      return (
        <div key={i} id={anchor} className="mt-4 scroll-mt-20">
          <LearningDisclosure tone="sources" icon={KIND_ICON.advanced} title={`Go further: ${s.title}`}>
            <p className="mb-2"><SourceChip source={s.source} /></p>
            <div className="text-[15px] leading-relaxed text-gray-800">{body}</div>
            {note}
          </LearningDisclosure>
        </div>
      );
    }
    const number = ++n;
    if (s.kind === "misconception" || s.kind === "safety") {
      return (
        <div key={i} id={anchor} className="mt-4 scroll-mt-20">
          <LearningCallout tone="caution" icon="warn" emphasis={s.kind === "safety" ? "safety" : "standard"} label={`${number}. ${s.kind === "safety" ? `Safety: ${s.title}` : s.title}`}>
            <p><SourceChip source={s.source} /></p>
            {body}
          </LearningCallout>
          {note}
        </div>
      );
    }
    return (
      <section key={i} id={anchor} aria-labelledby={`${anchor}-h`} className="mt-4 scroll-mt-20 border-t border-gray-200 pt-4 first:mt-0 first:border-t-0 first:pt-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <NumberMark n={number} />
          <span className="cmp-learn-accent"><LearningIcon name={KIND_ICON[s.kind]} className="h-[18px] w-[18px]" /></span>
          <h4 id={`${anchor}-h`} className="min-w-0 text-[16px] font-bold text-gray-900"><span className="sr-only">{number}. </span>{s.title}</h4>
          <SourceChip source={s.source} />
        </div>
        <div className="mt-2 text-[15.5px] leading-relaxed text-gray-800">{body}</div>
        {picture}
        {note}
      </section>
    );
  };
  return (
    <article id={anchorId} data-testid="go-deeper-round" data-level={level.key} className={`${anchorId ? "scroll-mt-4 " : ""}space-y-3`}>
      {levels && <LevelControl key={level.depth} current={level.depth} levels={levels} />}
      <div className={`${learnBox("explain")} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div>
            <h3 className="cmp-learn-ink text-[18px] font-bold">{GO_DEEPER_COPY.card}</h3>
            <p className="text-[13px] text-gray-700">{GO_DEEPER_COPY.subtitle}</p>
          </div>
          <span className="rounded-full border border-gray-300 bg-[var(--cmp-app-surface)] px-2.5 py-0.5 text-[12px] font-semibold text-gray-800">{level.label}</span>
        </div>
        <div className="mt-3 rounded-xl bg-gray-100 px-4 py-3.5">
          <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-gray-700">{GO_DEEPER_COPY.focus}</p>
          <p className="mt-1 break-words text-[20px] font-bold leading-snug text-gray-900">{parts.focus}</p>
          {parts.covers && <p className="mt-1 text-[14px] text-gray-700">{parts.covers}</p>}
        </div>
        {/* Not the usual "from your notes" badge: part of a round is, deliberately, not. */}
        <div className="mt-3"><DisclaimerBadge>{GO_DEEPER_COPY.ai}</DisclaimerBadge></div>
        {tools && <div className="mt-2">{tools}</div>}
        <div className="mt-4 break-words">
          {parts.sections.map((s, i) => (
            <Fragment key={i}>
              {i === researchAt && <div className="mt-4">{research}</div>}
              {sectionView(s, i)}
            </Fragment>
          ))}
          {researchAt === parts.sections.length && <div className="mt-4">{research}</div>}
        </div>
        {salvage}
      </div>
      {parts.questions.length > 0 && (
        <section aria-labelledby={`${prefix}-check`} className={`${learnBox("check")} p-4 sm:p-5`}>
          <h4 id={`${prefix}-check`} className="cmp-learn-ink flex items-center gap-2 text-[16px] font-bold"><NumberMark n={n + 1} /><LearningIcon name="question" className="cmp-learn-accent h-[18px] w-[18px]" />{GO_DEEPER_COPY.check}</h4>
          <ul className="mt-3 space-y-2.5">
            {parts.questions.map((q, i) => (
              <QuestionView key={i} index={i} prefix={prefix} text={q.text} options={q.options} cite={cite}
                answered={answered?.(q.text) ?? null} canAnswer={!!canAnswer?.(q.text)} onAnswer={onAnswer} onChoose={onChoose} renderCheck={renderCheck} />
            ))}
          </ul>
          <p className="mt-2.5 text-[12.5px] text-gray-700">Scholar&rsquo;s feedback on your answer is for your own learning, not a mark.</p>
        </section>
      )}
      {parts.takeaways.length > 0 && (
        <section aria-labelledby={`${prefix}-take`} className="rounded-2xl border border-gray-200 bg-[var(--cmp-app-surface)] p-4 sm:p-5">
          <h4 id={`${prefix}-take`} className="flex items-center gap-2 text-[15px] font-bold text-gray-900"><LearningIcon name="key" className="h-[18px] w-[18px] text-gray-700" />{GO_DEEPER_COPY.takeaways}</h4>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-gray-800">
            {parts.takeaways.map((t, i) => <li key={i}>{cite(t)}{!citedTags(t).length && <span className="ml-1.5 whitespace-nowrap text-[12px] font-semibold text-gray-700">({GO_DEEPER_COPY.scholar})</span>}</li>)}
          </ul>
        </section>
      )}
      <section aria-labelledby={`${prefix}-evidence`} className={`${learnTone("sources")} rounded-2xl border border-gray-200 bg-[var(--cmp-app-surface)] p-4 sm:p-5`}>
        <h4 id={`${prefix}-evidence`} className="flex items-center gap-2 text-[15px] font-bold text-gray-900"><LearningIcon name="library" className="h-[18px] w-[18px] text-gray-700" />{GO_DEEPER_COPY.footer}</h4>
        <InlineNote className="mt-2 text-[13.5px]">{deeperEvidenceStatement({ research: hasResearch, scholar: hasScholar })}</InlineNote>
        {sourcesAndMore}
      </section>
    </article>
  );
}

function QuestionView({ index, prefix, text, options, cite, answered, canAnswer, onAnswer, onChoose, renderCheck }: {
  index: number; prefix: string; text: string; options: readonly string[]; cite: (t: string) => ReactNode; answered: string | null; canAnswer: boolean;
  onAnswer?: (q: string) => void; onChoose?: (q: string, option: string) => void; renderCheck?: (q: string) => ReactNode;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const offered = options.length >= 2 && canAnswer && !!onChoose;
  return (
    <QuestionCard question={cite(text)} answered={answered} action={!offered && onAnswer && canAnswer ? { label: "Answer this", onClick: () => onAnswer(text) } : null}>
      {options.length >= 2 && (
        <div className="w-full">
          <div role="radiogroup" aria-label={questionText(text)} className="mt-1 space-y-2">
            {options.map((o, i) => (
              <AnswerOption key={i} name={`${prefix}-q${index}`} checked={chosen === i} mark="" onChange={() => { setChosen(i); if (offered) onChoose!(text, o); }}>{o}</AnswerOption>
            ))}
          </div>
          {offered && <p className="mt-1.5 text-[12.5px] text-gray-700">Choose one, then say why. Your reasons are what Scholar looks at.</p>}
        </div>
      )}
      {renderCheck && <div className="w-full">{renderCheck(text)}</div>}
    </QuestionCard>
  );
}
