"use client";

import {
  CONTENT_STATUS_LABEL, RECOVERY_ACTION_LABEL, RECOVERY_ORIGIN_LABEL, RECOVERY_PROMPT, RECOVERY_RETRIEVED_LABEL, RECOVERY_UNANSWERED_LABEL,
} from "@/lib/individual/scholar/config";
import type { RecoveryAction, RecoveryResult } from "@/lib/individual/scholar/evidence-recovery";
import type { RecoveryMode } from "@/lib/individual/policy";

// SCHOLAR-SQIE-02 s7 -- EVIDENCE RECOVERY, PRESENTATIONAL ONLY. What POST /api/individual/scholar/evidence/recover
// returned, grouped by where it came from and labelled by what was retrieved: Your notes / Competen library /
// External reference (abstract only, full text, or details only) / AI explanation. It never touches the student's
// attempt, holds no state and calls nothing: the page that uses it decides what each action does.
// CPR-MOB-001: one column, touch targets from pointer-coarse, --cmp-* tokens.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex items-center rounded-lg px-3 py-1.5 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

export type RecoveryView = Pick<RecoveryResult, "prompt" | "evidence" | "reading" | "sufficiency" | "actions" | "external">;

function Group({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-3 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] px-3 py-2">
      <h4 className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-900">{label}</h4>
      {note && <p className="mt-0.5 text-[12px] text-[var(--cmp-app-text-secondary)]">{note}</p>}
      <ul className="mt-1 space-y-2">{children}</ul>
    </section>
  );
}

export function EvidenceRecovery({ result, explanation = null, onAction, busy = false }: {
  result: RecoveryView;
  /** An explanation the page's own AI activity wrote from this evidence, after its own checks. Shown under its own label. */
  explanation?: { text: string } | null;
  onAction?: (action: RecoveryAction, mode?: RecoveryMode) => void;
  busy?: boolean;
}) {
  const { notes, library, external } = result.evidence;
  const nothing = !notes.length && !library.length && !external.length && !result.reading.length;
  return (
    <div role="region" aria-label="More learning resources" className="mt-3 rounded-[9px] border border-[var(--cmp-app-border)] bg-white px-3 py-3">
      <p className="text-[14px] font-semibold text-gray-900">{RECOVERY_PROMPT}</p>

      {onAction && (
        <div className="mt-2 flex flex-wrap gap-2">
          {result.actions.map((a, i) => (
            <button key={a.action} type="button" disabled={busy} onClick={() => onAction(a.action, a.mode)}
              className={`${btn} ${i === 0 ? "bg-gray-900 text-white hover:bg-gray-800" : "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50"} disabled:opacity-60`}>
              {RECOVERY_ACTION_LABEL[a.action]}
            </button>
          ))}
        </div>
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
              {l.kind === "case" && <span className="ml-1 text-[12px] text-gray-600">Library case</span>}
            </li>
          ))}
        </Group>
      )}

      {external.length > 0 && (
        <Group label={RECOVERY_ORIGIN_LABEL.external} note="Published sources Competen found. Not from your notes and not clinically reviewed. Open the source before relying on it.">
          {external.map(e => (
            <li key={e.url} className="text-[13px] text-gray-800">
              {e.tag && <span className="font-mono font-bold">[{e.tag}] </span>}
              <a href={e.url} target="_blank" rel="noopener noreferrer" className={`font-semibold underline underline-offset-2 ${focusRing}`}>{e.title}</a>
              <span className="ml-1 rounded-full border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-gray-800">{RECOVERY_ORIGIN_LABEL.external}: {RECOVERY_RETRIEVED_LABEL[e.retrieved]}</span>
              <p className="text-[12px] text-gray-600">
                {[e.authors.join(", "), e.journal, e.year, e.provider].filter(Boolean).join(" · ")}
                {e.pmid ? ` · PMID ${e.pmid}` : ""}{e.doi ? ` · DOI ${e.doi}` : ""}
              </p>
              {e.excerpt && <p className="mt-0.5 text-[12.5px] text-gray-700">{e.excerpt}</p>}
              {e.openAccess && (
                <p className="mt-0.5 text-[12px]">
                  <a href={e.openAccess.url} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${focusRing}`}>Open-access copy</a>
                  {e.openAccess.licence ? <span className="text-gray-600"> (licence: {e.openAccess.licence})</span> : null}
                </p>
              )}
            </li>
          ))}
        </Group>
      )}

      {result.reading.length > 0 && (
        <Group label="Further reading" note="Links for you to follow. Nothing was read from them.">
          {result.reading.map(r => (
            <li key={r.url} className="text-[13px]">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${focusRing}`}>{r.label}</a>
            </li>
          ))}
        </Group>
      )}

      {explanation && (
        <section className="mt-3 rounded-lg border-2 border-dashed border-[var(--cmp-app-border)] px-3 py-2">
          <h4 className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-900">{RECOVERY_ORIGIN_LABEL.ai}</h4>
          <p className="mt-1 whitespace-pre-line text-[13.5px] text-gray-900">{explanation.text}</p>
        </section>
      )}

      {nothing && <p className="mt-3 text-[13px] text-gray-700">Nothing more was found for this topic in the sources you chose.</p>}
      {result.sufficiency.unanswered.length > 0 && (
        <p className="mt-3 text-[12.5px] text-gray-700">
          <span className="font-semibold">{RECOVERY_UNANSWERED_LABEL}:</span> {result.sufficiency.unanswered.join(", ")}
        </p>
      )}
    </div>
  );
}
