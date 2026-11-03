"use client";
// ASMT-PATHWAY-01 -- the pathway to publication on every Studio version page: the five-stage tracker, the one next action with
// who can act, the blockers and their fixes, and the appointed holders by name with their independence for THIS content. The
// visual language is the Framework Governance Workspace's. The next-action button posts to the SAME transition route the
// LifecyclePanel uses: this panel decides nothing, the database refuses what is not allowed and the refusal comes back in words.
import { useState } from "react";
import Link from "next/link";
import type { PathwayModel, PathwayStage } from "@/lib/assessment/studio/pathway";
import { KIND_LABEL } from "@/lib/assessment/studio/types";
import { Btn, Notice, callApi, useAction } from "./studio-ui";

const STAGE_TONE: Record<PathwayStage["status"], string> = {
  done: "border-l-[var(--cmp-text-success)] bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  current: "border-l-[var(--cmp-text-information)] bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]",
  waiting: "border-l-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  blocked: "border-l-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]",
  not_started: "border-l-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] text-[var(--cmp-app-text-secondary)]",
};
const STAGE_WORD: Record<PathwayStage["status"], string> = { done: "Done", current: "Current", waiting: "Waiting", blocked: "Blocked", not_started: "Not yet" };

export interface PathwayPanelProps {
  model: PathwayModel;
  /** the version this pathway is about; null for an identity with no version */
  versionId: string | null;
  /** where the lifecycle actions live on this page (an anchor id), for "Record your decision" and the like */
  lifecycleAnchor?: string;
  /** the version page, for "Open the content" */
  editHref?: string | null;
  /** the catalogue page of the instrument, for "Open in the catalogue" */
  catalogueHref?: string | null;
  /** where a new draft made by Duplicate is edited: `${versionHrefBase}/${versionId}` */
  versionHrefBase?: string;
  /** compact: one row of stages and the next action, for a version list */
  compact?: boolean;
  /** called when the first-version action is chosen (the instrument page owns that form) */
  onFirstVersion?: () => void;
  /** when the lifecycle actions sit on another tab of the same page: switch to it instead of following the anchor */
  onGoToLifecycle?: () => void;
}

export function PathwayTracker({ stages, compact = false }: { stages: PathwayStage[]; compact?: boolean }) {
  return (
    <ol className={`grid gap-2 ${compact ? "grid-cols-5" : "sm:grid-cols-3 lg:grid-cols-5"}`} aria-label="Pathway to publication">
      {stages.map((s, i) => (
        <li key={s.key} className={`rounded-lg border border-[var(--cmp-app-border)] border-l-4 ${compact ? "px-2 py-1" : "p-3"} ${STAGE_TONE[s.status]}`}>
          <p className={`${compact ? "text-[10px]" : "text-[11px]"} font-bold uppercase tracking-wide`}>{i + 1}. {s.label}</p>
          <p className={`${compact ? "text-[11px]" : "text-xs"} font-semibold`}>{STAGE_WORD[s.status]}{!compact && s.role ? ` · ${s.role}` : ""}</p>
          {!compact && s.note && <p className="mt-1 text-xs text-[var(--cmp-app-text)]">{s.note}</p>}
        </li>
      ))}
    </ol>
  );
}

export function PathwayPanel(p: PathwayPanelProps) {
  const { model: m } = p;
  const { busy, msg, run, router } = useAction();
  const [who, setWho] = useState(false);
  const next = m.next;
  const anchor = p.lifecycleAnchor ?? "lifecycle";
  const transition = (action: string, okText: string) => {
    if (!p.versionId) return;
    void run(action, () => callApi<{ versionId?: string }>(`/api/hq/checklist-studio/versions/${p.versionId}/transition`, "POST", { kind: m.kind, action }), {
      ok: okText, onOk: (d) => { if (action === "duplicate" && d.versionId && p.versionHrefBase) router.push(`${p.versionHrefBase}/${d.versionId}`); },
    });
  };
  const button = (() => {
    const a = next.action;
    if (!a) return null;
    const disabled = busy !== null;
    switch (a.kind) {
      case "submit": return <Btn kind="primary" disabled={disabled} onClick={() => transition("submit", "Put forward for review.")}>{busy === "submit" ? "Checking…" : a.label}</Btn>;
      case "approve": return <Btn kind="primary" disabled={disabled} onClick={() => transition("approve", "Approved.")}>{a.label}</Btn>;
      case "publish": return <Btn kind="primary" disabled={disabled} onClick={() => transition("publish", "Published.")}>{a.label}</Btn>;
      case "duplicate": return <Btn disabled={disabled} onClick={() => transition("duplicate", "A new draft was made.")}>{a.label}</Btn>;
      case "review": return p.onGoToLifecycle ? <Btn kind="primary" onClick={p.onGoToLifecycle}>{a.label}</Btn> : <a href={`#${anchor}`} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-accent)] px-3 text-sm font-semibold text-[var(--cmp-theme-on-accent)] hover:bg-[var(--cmp-theme-strong)] pointer-coarse:min-h-[var(--cmp-touch-min)]">{a.label}</a>;
      case "edit": return a.label === "Return to draft"
        ? <Btn disabled={disabled} onClick={() => transition("return", "Returned to draft.")}>{a.label}</Btn>
        : p.editHref ? <Link href={p.editHref} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--cmp-app-control-border)] px-3 text-sm font-semibold hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)]">{a.label}</Link> : null;
      case "catalogue": return p.catalogueHref ? <Link href={p.catalogueHref} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-accent)] px-3 text-sm font-semibold text-[var(--cmp-theme-on-accent)] hover:bg-[var(--cmp-theme-strong)] pointer-coarse:min-h-[var(--cmp-touch-min)]">{a.label}</Link> : null;
      case "first_version": return p.onFirstVersion ? <Btn kind="primary" onClick={p.onFirstVersion}>{a.label}</Btn> : null;
      default: return null;
    }
  })();

  if (p.compact) {
    return (
      <div className="space-y-2" data-testid="pathway-compact">
        <PathwayTracker stages={m.stages} compact />
        <p className="text-sm"><span className="font-semibold">Next: {next.headline}</span> {next.responsible && <span className="text-[var(--cmp-app-text-secondary)]">{next.responsible}.</span>}</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="pathway-h" className="space-y-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4" data-testid="pathway-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pathway-h" className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--cmp-app-text-secondary)]">Pathway to publication{m.versionNo ? `, ${KIND_LABEL[m.kind].toLowerCase()} v${m.versionNo}` : ""}</h2>
        <button type="button" onClick={() => setWho((w) => !w)} aria-expanded={who} className="min-h-9 rounded-lg border border-[var(--cmp-app-control-border)] px-3 text-sm font-semibold hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)]">Who can act?</button>
      </div>

      <PathwayTracker stages={m.stages} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--cmp-theme-border)] bg-[var(--cmp-surface-information)] p-4" aria-label="Next action">
        <div className="min-w-0 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--cmp-text-information)]">Next action</p>
          <p className="text-base font-bold text-[var(--cmp-app-text)]">{next.headline}</p>
          {next.detail && <p className="text-sm text-[var(--cmp-app-text)]">{next.detail}</p>}
          <p className="mt-1 text-xs text-[var(--cmp-app-text-secondary)]">
            {next.responsible ? `Responsible: ${next.responsible}. ` : ""}
            {next.viewer.canAct ? (next.action ? "You can act on this." : "") : <span className="font-semibold text-[var(--cmp-text-warning)]">You: {next.viewer.reason ?? "cannot act on this step."}</span>}
          </p>
        </div>
        {button}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <p role="status" className="rounded-lg border border-[var(--cmp-app-border)] px-3 py-2 text-sm text-[var(--cmp-app-text)]" data-testid="pathway-prompt">{m.prompt.text}</p>

      {m.blockers.length > 0 && (
        <div className="rounded-lg border border-[var(--cmp-app-border)] p-3">
          <p className="text-sm font-semibold text-[var(--cmp-text-error)]">What blocks the next step</p>
          <ul className="mt-1 space-y-1 text-sm">
            {m.blockers.map((b, i) => <li key={i}><span className="font-semibold">{b.text}</span>{b.fix && <span className="block text-xs text-[var(--cmp-app-text-secondary)]">Fix: {b.fix}</span>}</li>)}
          </ul>
        </div>
      )}

      {who && (
        <div className="grid gap-3 rounded-lg border border-[var(--cmp-app-border)] p-3 md:grid-cols-2 lg:grid-cols-3" aria-label="Who can act">
          {m.who.map((g) => (
            <div key={g.capability}>
              <p className="text-sm font-bold">{g.role}</p>
              <p className="text-xs text-[var(--cmp-app-text-secondary)]">Needs {g.capabilityLabel} · {g.positions.length ? g.positions.join(", ") : "no position"} · {g.eligible} eligible of {g.actors.length} appointed</p>
              {g.note && <p className="mt-1 text-xs font-semibold text-[var(--cmp-text-warning)]">{g.note}</p>}
              <ul className="mt-1 space-y-1 text-sm">
                {g.actors.map((a) => (
                  <li key={a.personId + a.position}>
                    <span className="font-semibold">{a.name}</span> <span className="text-[var(--cmp-app-text-secondary)]">({a.position})</span>
                    <span className={`block text-xs ${a.eligible ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{a.eligible ? "Can act" : `Cannot act: ${a.conflict}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-[var(--cmp-app-text-secondary)] md:col-span-2 lg:col-span-3">Independence is content-specific: nobody approves, reviews or publishes a version they authored, edited or submitted, this one or an earlier one. The database refuses it regardless of what is drawn here.</p>
        </div>
      )}
    </section>
  );
}
