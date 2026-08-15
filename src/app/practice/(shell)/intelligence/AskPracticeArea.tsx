import Link from "next/link";
import type { AskAnswer } from "@/lib/practice/ask-practice";
import { metricById } from "@/lib/practice/intelligence-registry";
import { CARD, PanelHead, ProvenanceChip } from "./Ui";

// CPR-PI-001 v2 s13 -- the GROUNDED stage of Ask Practice, rendered ABOVE the AI console.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// TWO STAGES, TWO PROVENANCES, ONE ENTRY POINT. The Ask field navigates here (its own header explains
// why it must not answer inline); this area answers DETERMINISTICALLY -- parser, registry, the same
// engines every screen uses -- and wears the DERIVED chip. The model console below keeps its consent
// gate and its AI chip for anyone who wants prose on top. The comps draw one seamless "assistant";
// the seam is the honest part, so it is drawn on purpose.
//
// THE SCOPE RENDERS BEFORE THE ANSWER (s13 stage 2): what the question was taken to mean -- period,
// condition, location -- sits above the sentence, so a misread scope is caught by the reader instead
// of silently answering a different question.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function AskPracticeArea({ answer, carried }: {
  answer: AskAnswer;
  /** Range/cohort params the page carries between tabs, replayed as hidden inputs so a refined
      question keeps the window it was asked in. */
  carried: [string, string][];
}) {
  const asked = (q: string) => {
    const p = new URLSearchParams(carried);
    p.set("tab", "assistant");
    p.set("q", q);
    return `/practice/intelligence?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <PanelHead panel="todays_brief" title="From your records, as they stand"
          note="Counted, not written by a model. The console below is the AI layer, and says so when it speaks." />

        {/* s13 stage 2: the interpreted scope, before the answer. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-700">
            You asked: &ldquo;{answer.question}&rdquo;
          </span>
          <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-700">
            Read as: {answer.scope.periodLabel} ({answer.scope.fromDay} to {answer.scope.toDay})
          </span>
          <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-700">
            {answer.scope.condition ? `Condition: ${answer.scope.condition}` : "All conditions"}
          </span>
          <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-700">
            {answer.scope.location ? `Location: ${answer.scope.location}` : "All locations"}
          </span>
          <span className="ml-auto"><ProvenanceChip kind={answer.answered ? "derived" : "refused"} /></span>
        </div>

        <p className={`mt-3 text-[13px] leading-relaxed ${answer.answered ? "text-gray-900" : "text-gray-600"}`}>
          {answer.sentence}
        </p>

        {answer.figures.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {answer.figures.map((f, i) => (
              <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{f.label}</p>
                <p className="mt-0.5 text-[15px] font-bold tabular-nums text-gray-900">{f.value}</p>
                {/* s19: the denominator travels with the figure, in the same box. */}
                {f.of && <p className="mt-0.5 text-[10px] text-gray-500">of {f.of}</p>}
                <p className="mt-1 text-[9px] text-gray-400">{f.registryId}</p>
              </div>
            ))}
          </div>
        )}

        {answer.evidence && (
          <div className="mt-3 border-t border-gray-100 pt-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              The rows behind this{answer.evidence.total > answer.evidence.rows.length && answer.evidence.rows.length > 0
                ? ` (first ${answer.evidence.rows.length} of ${answer.evidence.total})` : ""}
            </p>
            {answer.evidence.rows.length > 0 && (
              <ul className="mt-1.5 flex flex-col">
                {answer.evidence.rows.map((r, i) => (
                  <li key={i} className="flex items-baseline gap-2 border-b border-gray-50 py-1 last:border-0">
                    {r.href ? (
                      <Link href={r.href} className="min-w-0 truncate text-[12px] text-gray-800 hover:underline">{r.label}</Link>
                    ) : (
                      <span className="min-w-0 truncate text-[12px] text-gray-600">{r.label}</span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-gray-500">{r.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link href={answer.evidence.href}
                className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                Open the screen that owns these rows &rarr;
              </Link>
              <span className="text-[10px] text-gray-400">{answer.evidence.note}</span>
            </div>
          </div>
        )}

        <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-400">
          Answers count what this practice recorded in CompetenPractice. Absence of a record here is
          never a claim that care did not happen. {answer.registry.length > 0 && (
            <>Definitions: {answer.registry.map(id => {
              const m = metricById(id);
              return m ? `${m.displayName} (${id} v${m.version})` : id;
            }).join("; ")}. Each names its numerator, denominator and time field in the metric registry.</>
          )}
        </p>
      </section>

      {/* s13 stage 8: refinement keeps the range it was asked in -- a GET form, no client state. */}
      <section className={`${CARD} py-3`}>
        <form action="/practice/intelligence" method="get" className="flex items-center gap-1.5">
          <input type="hidden" name="tab" value="assistant" />
          {carried.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input name="q" defaultValue="" minLength={3} required placeholder="Ask a different question of the same records&hellip;"
            className="w-full flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-sky-400" />
          <button type="submit"
            className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
            Ask
          </button>
        </form>
        {answer.recent.length > 0 && (
          <div className="mt-2 flex flex-wrap items-baseline gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">You previously asked</span>
            {answer.recent.map((r, i) => (
              <Link key={i} href={asked(r.question)} title={`asked ${r.askedAt}`}
                className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-700 hover:bg-gray-100">
                {r.question.length > 60 ? r.question.slice(0, 57) + "…" : r.question}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
