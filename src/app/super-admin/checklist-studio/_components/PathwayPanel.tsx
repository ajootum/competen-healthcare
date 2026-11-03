"use client";
// ASMT-PATHWAY-01 -- the pathway to publication on every Studio version page: the five-stage tracker, the one next action with
// who can act, the blockers and their fixes, and the appointed holders by name with their independence for THIS content. The
// visual language is the Framework Governance Workspace's. The next-action button posts to the SAME transition route the
// LifecyclePanel uses: this panel decides nothing, the database refuses what is not allowed and the refusal comes back in words.
import { useState } from "react";
import Link from "next/link";
import type { PathwayModel, PathwayStage } from "@/lib/assessment/studio/pathway";
import { KIND_LABEL } from "@/lib/assessment/studio/types";
import { DELIVERY_MODE_SUGGESTIONS } from "@/lib/assessment/studio/vocab";
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
    <ol className={`grid gap-2 ${compact ? "grid-cols-3" : "sm:grid-cols-3"}`} aria-label="Pathway to publication">
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
  const [changes, setChanges] = useState<string | null>(null);   // the note while asking for changes
  const next = m.next;
  const anchor = p.lifecycleAnchor ?? "lifecycle";
  // Owner GO 3 Nov 2026: the delivery-mode blocker is settled in one click, through the same settings route as the Settings tab.
  const chooseDelivery = (code: string) => {
    if (!p.versionId) return;
    void run("delivery", () => callApi(`/api/hq/checklist-studio/versions/${p.versionId}/settings`, "PUT", { settings: { delivery_modes: [code] } }), { ok: `Delivery mode set: ${code.replace(/_/g, " ")}.`, onOk: () => router.refresh() });
  };
  const deliveryBlocked = m.kind === "instrument" && m.state === "draft" && !!p.versionId && m.blockers.some((b) => /delivery mode/i.test(b.text));
  const transition = (action: string, okText: string) => {
    if (!p.versionId) return;
    void run(action, () => callApi<{ versionId?: string }>(`/api/hq/checklist-studio/versions/${p.versionId}/transition`, "POST", { kind: m.kind, action }), {
      ok: okText, onOk: (d) => { if (action === "duplicate" && d.versionId && p.versionHrefBase) router.push(`${p.versionHrefBase}/${d.versionId}`); },
    });
  };
  // UNIFIED-GOVERNANCE-V1: review and approval in one interaction. The decision is recorded, then the version is marked
  // approved when the independent approvals reach the required number. A request for changes needs a note.
  const decide = (decision: "approved" | "changes_requested", rationale: string) => {
    if (!p.versionId) return;
    void run("decide", () => callApi<{ approved?: boolean; note?: string }>(`/api/hq/checklist-studio/versions/${p.versionId}/decisions`, "POST", { kind: m.kind, reviewKind: "governance", decision, rationale, andApprove: decision === "approved" }), {
      ok: decision === "approved" ? "Your approval is recorded." : "Changes requested; the author sees your note.",
      onOk: (d) => { setChanges(null); if (d.note) router.refresh(); },
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
      case "review": return (
        <div className="flex flex-wrap items-center gap-2">
          <Btn kind="primary" disabled={disabled} onClick={() => decide("approved", "")}>{busy === "decide" ? "Recording…" : "Review & approve"}</Btn>
          <Btn disabled={disabled} onClick={() => setChanges((c) => (c === null ? "" : null))}>Request changes</Btn>
          {p.onGoToLifecycle ? <Btn kind="ghost" onClick={p.onGoToLifecycle}>Full review panel</Btn> : <a href={`#${anchor}`} className="text-sm font-semibold underline underline-offset-2">Full review panel</a>}
        </div>
      );
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
        <h2 id="pathway-h" className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--cmp-app-text-secondary)]">Pathway to publication{m.versionNo ? `, ${KIND_LABEL[m.kind].toLowerCase()} v${m.versionNo}` : ""} <span className="normal-case tracking-normal text-[var(--cmp-app-text)]">· {m.stateLabel}</span></h2>
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
      {changes !== null && next.action?.kind === "review" && (
        <div className="space-y-2 rounded-lg border border-[var(--cmp-app-border)] p-3" aria-label="Request changes">
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">What must change (the author sees this note)
            <textarea value={changes} onChange={(e) => setChanges(e.target.value)} rows={3} maxLength={4000} className="rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 py-2 text-sm text-[var(--cmp-app-text)]" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Btn kind="primary" disabled={busy !== null || changes.trim().length < 3} onClick={() => decide("changes_requested", changes)}>Send back with this note</Btn>
            <Btn kind="ghost" onClick={() => setChanges(null)}>Cancel</Btn>
          </div>
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <p role="status" className="rounded-lg border border-[var(--cmp-app-border)] px-3 py-2 text-sm text-[var(--cmp-app-text)]" data-testid="pathway-prompt">{m.prompt.text}</p>

      {m.blockers.length > 0 && (
        <div className="rounded-lg border border-[var(--cmp-app-border)] p-3">
          <p className="text-sm font-semibold text-[var(--cmp-text-error)]">What blocks the next step</p>
          <ul className="mt-1 space-y-1 text-sm">
            {m.blockers.map((b, i) => <li key={i}><span className="font-semibold">{b.text}</span>{b.fix && <span className="block text-xs text-[var(--cmp-app-text-secondary)]">Fix: {b.fix}</span>}</li>)}
          </ul>
          {deliveryBlocked && (
            <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="Choose a delivery mode">
              <span className="text-xs text-[var(--cmp-app-text-secondary)]">Choose one now:</span>
              {DELIVERY_MODE_SUGGESTIONS.map((d) => <Btn key={d.code} size="sm" disabled={busy !== null} onClick={() => chooseDelivery(d.code)}>{d.label}</Btn>)}
            </div>
          )}
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
