"use client";

import { useEffect, useRef, useState } from "react";
import {
  CONTENT_STATUS_LABEL, RECOVERY_ACTION_LABEL, RECOVERY_EXPLANATION_LABEL, RECOVERY_NOT_USED_LABEL, RECOVERY_ORIGIN_LABEL,
  RECOVERY_RETRIEVED_LABEL, RECOVERY_STILL_WITHHELD, RECOVERY_UNANSWERED_LABEL,
} from "@/lib/individual/scholar/config";
import type { ReadingLink, RecoveryAction, RecoveryResult } from "@/lib/individual/scholar/evidence-recovery";
import type { RecoveryMode } from "@/lib/individual/policy";
import { recoveryPromptText } from "@/lib/individual/scholar/guided-learn";

// SCHOLAR-SQIE-02 s7 -- EVIDENCE RECOVERY. What POST /api/individual/scholar/evidence/recover returned, grouped by where
// it came from and labelled by what was retrieved: Your notes / Competen library / External reference (abstract only,
// full text, or details only) / AI explanation.
//   EvidenceRecovery  presentational: holds no state and calls nothing.
//   RecoveryFlow      the panel under a withheld answer: asks for the resources, and runs the three actions --
//                     Continue with my notes (closes it), Find learning resources (shows the reading; no AI), and
//                     Explain using approved references (the page's own `explain`, which re-runs the SAME request the
//                     learner made with only the recovery's id, mode and question; the server finds the evidence again).
// Neither ever touches the student's attempt: it stays exactly where the page keeps it.
// CPR-MOB-001: one column, touch targets from pointer-coarse, --cmp-* tokens.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex items-center rounded-lg px-3 py-1.5 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

export type RecoveryView = Pick<RecoveryResult, "prompt" | "evidence" | "reading" | "sufficiency" | "actions" | "external">;
/** What the page's explain call came to. `text`: when the page shows the explanation here rather than in its own view. */
/**
 * SCHOLAR-GUIDED-LEARNING-01: a wider Learn-from mode the LEARNER may choose (the page's own, policy-offered), shown as
 * a button here. Choosing one is the learner's act: recovery itself never widens.
 */
export type Expansion = { label: string; onChoose: () => void };
export type ExplainOutcome = { shown: boolean; text?: string | null; message?: string | null; unanswered?: string[]; reading?: ReadingLink[] } | { error: string };

function Group({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-3 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] px-3 py-2">
      <h4 className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-900">{label}</h4>
      {note && <p className="mt-0.5 text-[12px] text-[var(--cmp-app-text-secondary)]">{note}</p>}
      <ul className="mt-1 space-y-2">{children}</ul>
    </section>
  );
}

/** External references, one list. Evidence carries its [E n] tag; reading never does, and says why it was not used. */
function ExternalList({ items }: { items: RecoveryView["evidence"]["external"] }) {
  return <>{items.map(e => (
    <li key={e.url} className="text-[13px] text-gray-800">
      {e.tag && <span className="font-mono font-bold">[{e.tag}] </span>}
      <a href={e.url} target="_blank" rel="noopener noreferrer" className={`font-semibold underline underline-offset-2 ${focusRing}`}>{e.title}</a>
      <span className="ml-1 rounded-full border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-gray-800">{RECOVERY_ORIGIN_LABEL.external}: {RECOVERY_RETRIEVED_LABEL[e.retrieved]}</span>
      <p className="text-[12px] text-gray-600">
        {[e.authors.join(", "), e.journal, e.year, e.provider].filter(Boolean).join(" · ")}
        {e.pmid ? ` · PMID ${e.pmid}` : ""}{e.doi ? ` · DOI ${e.doi}` : ""}
      </p>
      {e.notUsed && <p className="text-[12px] text-gray-700">Reading only: {RECOVERY_NOT_USED_LABEL[e.notUsed]}.</p>}
      {e.excerpt && <p className="mt-0.5 text-[12.5px] text-gray-700">{e.excerpt}</p>}
      {e.openAccess && (
        <p className="mt-0.5 text-[12px]">
          <a href={e.openAccess.url} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${focusRing}`}>Open-access copy</a>
          {e.openAccess.licence ? <span className="text-gray-600"> (licence: {e.openAccess.licence})</span> : null}
          {/* PMC Cloud Service terms: acknowledge NLM as the data source, clearly. No PMC logo, no implied endorsement. */}
          <span className="block text-[11.5px] text-gray-600">Open-access status from PubMed Central, US National Library of Medicine.</span>
        </p>
      )}
    </li>
  ))}</>;
}

function ReadingList({ reading }: { reading: readonly ReadingLink[] }) {
  if (!reading.length) return null;
  return (
    <Group label="Further reading" note="Links for you to follow. Nothing was read from them.">
      {reading.map(r => (
        <li key={r.url} className="text-[13px]">
          <a href={r.url} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${focusRing}`}>{r.label}</a>
        </li>
      ))}
    </Group>
  );
}

export function EvidenceRecovery({ result, explanation = null, onAction, busy = false, showReading = true, unanswered = null, note = null, expansions = [] }: {
  result: RecoveryView;
  /** An explanation the page's own AI activity wrote from this evidence, after its own checks. Shown under its own label. */
  explanation?: { text: string } | null;
  onAction?: (action: RecoveryAction, mode?: RecoveryMode) => void;
  busy?: boolean;
  /** The reading list, once the learner asked for learning resources. */
  showReading?: boolean;
  /** What remains unanswered, when it differs from the first search (after an explanation was still not possible). */
  unanswered?: readonly string[] | null;
  note?: string | null;
  expansions?: readonly Expansion[];
}) {
  const { notes, library, external } = result.evidence;
  const nothing = !notes.length && !library.length && !external.length && !(showReading && result.reading.length);
  const left = unanswered ?? result.sufficiency.unanswered;
  return (
    <div role="region" aria-label="More learning resources" className="mt-3 rounded-[9px] border border-[var(--cmp-app-border)] bg-white px-3 py-3">
      {/* A question only when it can be answered here (owner screenshot 31 Oct); otherwise what the learner can do, plainly. */}
      <p className="text-[14px] font-semibold text-gray-900">{recoveryPromptText(onAction ? result.actions : [], expansions.length)}</p>
      {expansions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Learn from wider sources">
          {expansions.map(x => (
            <button key={x.label} type="button" disabled={busy} onClick={x.onChoose}
              className={`${btn} border border-gray-900 bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-60`}>{x.label}</button>
          ))}
        </div>
      )}

      {onAction && result.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {result.actions.map((a, i) => (
            <button key={a.action} type="button" disabled={busy} onClick={() => onAction(a.action, a.mode)}
              className={`${btn} ${i === 0 ? "bg-gray-900 text-white hover:bg-gray-800" : "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50"} disabled:opacity-60`}>
              {RECOVERY_ACTION_LABEL[a.action]}
            </button>
          ))}
        </div>
      )}
      {note && <p role="status" className="mt-2 rounded-lg bg-[var(--cmp-app-surface)] px-3 py-2 text-[13px] text-gray-800">{note}</p>}

      {explanation && (
        <section className="mt-3 rounded-lg border-2 border-dashed border-[var(--cmp-app-border)] px-3 py-2">
          <h4 className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-900">{RECOVERY_EXPLANATION_LABEL}</h4>
          <p className="mt-1 whitespace-pre-line text-[13.5px] text-gray-900">{explanation.text}</p>
        </section>
      )}

      {notes.length > 0 && (
        <Group label={RECOVERY_ORIGIN_LABEL.notes}>
          {notes.map(n => (
            <li key={n.chunkId} className="text-[13px] text-gray-800">
              <span className="font-mono font-bold">[{n.tag}] </span><span className="font-semibold">{n.citation}</span>
              <p className="mt-0.5 line-clamp-3 text-[12.5px] text-gray-700">{n.excerpt}</p>
            </li>
          ))}
        </Group>
      )}

      {library.length > 0 && (
        <Group label={RECOVERY_ORIGIN_LABEL.library}>
          {library.map(l => (
            <li key={`${l.kind}:${l.itemId}`} className="text-[13px] text-gray-800">
              <span className="font-mono font-bold">[{l.tag}] </span>{l.code ? `${l.code} ` : ""}{l.title}{l.outcome ? ` -- ${l.outcome}` : ""}{" "}
              {l.approved
                ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-900"><span aria-hidden>✓</span>{CONTENT_STATUS_LABEL.approved}</span>
                : <span className="text-gray-600">({l.status || CONTENT_STATUS_LABEL.unreviewed})</span>}
              {l.kind === "case" && <span className="ml-1 text-[12px] text-gray-600">Library case to practise with</span>}
            </li>
          ))}
        </Group>
      )}

      {/* SCHOLAR-SOURCE-QUALITY-01: only references that passed every source-quality rule are shown as evidence. */}
      {external.some(e => e.evidence) && (
        <Group label={RECOVERY_ORIGIN_LABEL.external} note="Published sources Competen found. Not from your notes and not clinically reviewed. Open the source before relying on it.">
          <ExternalList items={external.filter(e => e.evidence)} />
        </Group>
      )}
      {external.some(e => !e.evidence) && (
        <Group label="Published sources to read" note="For you to read. Not used to explain this topic. Open the source before relying on it.">
          <ExternalList items={external.filter(e => !e.evidence)} />
        </Group>
      )}

      {showReading && <ReadingList reading={result.reading} />}

      {nothing && <p className="mt-3 text-[13px] text-gray-700">Nothing more was found for this topic in the sources you chose.</p>}
      {left.length > 0 && (
        <p className="mt-3 text-[12.5px] text-gray-700">
          <span className="font-semibold">{RECOVERY_UNANSWERED_LABEL}:</span> {left.join(", ")}
        </p>
      )}
    </div>
  );
}

export type RecoveryRequestBody = {
  question?: string; paperQuestionId?: string; mode: RecoveryMode; materialId?: string | null; sectionId?: string | null; withheldReason?: string | null;
  /** SCHOLAR-LEARN-FIX-01: a Learn session's selected materials (recorded: its id; held in the browser: its material ids). */
  sessionId?: string | null; materialIds?: string[];
};
type Loaded = RecoveryView & { recoveryId: string; mode: RecoveryMode; question: string };

async function post(body: RecoveryRequestBody): Promise<Loaded | { error: string }> {
  try {
    const res = await fetch("/api/individual/scholar/evidence/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    return res.ok ? json as Loaded : { error: typeof json?.error === "string" ? json.error : "More learning resources could not be found just now." };
  } catch {
    return { error: "Competen could not be reached. Check your connection and try again." };
  }
}

/**
 * The panel under a withheld answer. `explain` re-runs the page's own request with { recovery: { id, mode, question } }
 * and says what it came to; without it, Explain using approved references is not offered.
 */
export function RecoveryFlow({ request, explain, onDismiss, expansions = [] }: {
  request: RecoveryRequestBody;
  explain?: (recovery: { id: string; mode: RecoveryMode; question: string }) => Promise<ExplainOutcome>;
  onDismiss?: () => void;
  expansions?: readonly Expansion[];
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [outcome, setOutcome] = useState<Exclude<ExplainOutcome, { error: string }> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void (async () => {
      const r = await post(request);
      setBusy(false);
      if ("error" in r) setError(r.error); else setLoaded(r);
    })();
  }, [request]);

  if (dismissed) return null;
  if (busy && !loaded) return <p role="status" className="mt-3 text-[13px] text-gray-600">Looking for more learning resources…</p>;
  if (error && !loaded) return <p role="status" className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] text-gray-800">{error}</p>;
  if (!loaded) return null;

  async function onAction(action: RecoveryAction, wider?: RecoveryMode) {
    if (!loaded) return;
    if (action === "continue_with_notes") { setDismissed(true); onDismiss?.(); return; }
    if (action === "find_resources") {
      // Reading only: no AI. A wider search the learner may choose is looked up the same way, still without AI.
      if (wider) {
        setBusy(true);
        const r = await post({ ...request, mode: wider });
        setBusy(false);
        if (!("error" in r)) setLoaded(r);
      }
      setShowReading(true);
      return;
    }
    if (!explain) return;
    setBusy(true); setNote(null);
    const r = await explain({ id: loaded.recoveryId, mode: loaded.mode, question: loaded.question });
    setBusy(false);
    if ("error" in r) { setNote(r.error); return; }
    setOutcome(r);
    if (!r.shown) { setShowReading(true); setNote(r.message || RECOVERY_STILL_WITHHELD); }
    else if (!r.text) setNote(`${RECOVERY_EXPLANATION_LABEL}: shown with your answer.`);
  }

  const actions = loaded.actions.filter(a => (a.action === "explain_with_references" ? !!explain && !(outcome && outcome.shown) : true))
    .filter(a => !(a.action === "find_resources" && showReading && !a.mode))
    .filter(a => !(a.action === "explain_with_references" && outcome && !outcome.shown));
  const view: RecoveryView = { ...loaded, actions, reading: outcome?.reading?.length ? outcome.reading : loaded.reading };
  return (
    <EvidenceRecovery result={view} onAction={onAction} busy={busy} showReading={showReading} note={note} expansions={expansions}
      explanation={outcome?.shown && outcome.text ? { text: outcome.text } : null}
      unanswered={outcome && !outcome.shown ? outcome.unanswered ?? null : null} />
  );
}
