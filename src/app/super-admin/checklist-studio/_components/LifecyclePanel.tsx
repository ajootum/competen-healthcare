"use client";
// Checklist Studio: the lifecycle of one version of any kind (checklist, scale, scoring template, layout template, progression rules).
// The buttons are drawn from availabilities() and each disabled one says why. The DATABASE decides: a refusal comes back in plain words.
import { useState } from "react";
import { fmtDateTime } from "@/lib/assessment/studio/vocab";
import { KIND_LABEL, type DefinitionKind, type LifecycleState, type ReviewDecisionRow, type ValidationReport } from "@/lib/assessment/studio/types";
import type { ApprovalStatus, Availabilities, Availability } from "@/lib/assessment/studio/transitions";
import { Btn, IssueList, Notice, Panel, StateChip, callApi, useAction } from "./studio-ui";

export interface LifecyclePanelProps {
  kind: DefinitionKind;
  versionId: string;
  versionNo: number;
  state: LifecycleState;
  contentHash: string | null;
  availability: Availabilities;
  approval: ApprovalStatus;
  requiresDomainReview: boolean;
  decisions: ReviewDecisionRow[];
  names: Record<string, string>;
  /** where a new draft made by Duplicate is edited */
  hrefForVersion: (versionId: string) => string;
  /** where the definition lists its versions (after a delete) */
  listHref: string;
  /** The latest validation problems, shown beside Submit. */
  report?: ValidationReport | null;
}

const DECISION_WORDS: Record<string, string> = { approved: "Approved", rejected: "Rejected", changes_requested: "Asked for changes" };

function Why({ a }: { a: Availability }) {
  return a.allowed || !a.reason ? null : <span className="block text-xs text-[var(--cmp-app-text-secondary)]">{a.reason}</span>;
}

export function LifecyclePanel(p: LifecyclePanelProps) {
  const { busy, msg, run, router } = useAction();
  const [rationale, setRationale] = useState("");
  const [reviewKind, setReviewKind] = useState<"governance" | "domain">("governance");
  const [issues, setIssues] = useState<ValidationReport | null>(null);
  const url = `/api/hq/checklist-studio/versions/${p.versionId}`;
  const transition = (action: string, okText: string, extra: Record<string, unknown> = {}) =>
    run(action, () => callApi(`${url}/transition`, "POST", { kind: p.kind, action, ...extra }), {
      ok: okText,
      onOk: (d) => { if (action === "duplicate" && typeof (d as { versionId?: string }).versionId === "string") router.push(p.hrefForVersion((d as { versionId: string }).versionId)); if (action === "delete") router.push(p.listHref); },
      onErr: (e) => { const r = e.data.report as ValidationReport | undefined; if (r) setIssues(r); },
    });
  const decide = (decision: "approved" | "rejected" | "changes_requested") =>
    run("decide", () => callApi(`${url}/decisions`, "POST", { kind: p.kind, reviewKind, decision, rationale }), { ok: "Your decision is recorded.", onOk: () => setRationale("") });
  const av = p.availability;
  const ap = p.approval;
  const canReview = av.reviewGovernance.allowed || av.reviewDomain.allowed;
  const shownIssues = issues ?? p.report ?? null;

  return (
    <Panel title={`${KIND_LABEL[p.kind]} lifecycle`} right={<StateChip state={p.state} />}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--cmp-app-text-secondary)]">
          Version {p.versionNo}. Draft, then in review, then approved, then published. A published version is frozen: to change it, duplicate it to a new draft.
          {p.contentHash && <> Content hash <code className="text-xs">{p.contentHash.slice(0, 12)}</code>.</>}
        </p>

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><Btn kind="primary" disabled={!av.submit.allowed || busy !== null} onClick={() => transition("submit", "Put forward for review.")}>{busy === "submit" ? "Checking…" : "Submit for review"}</Btn><Why a={av.submit} /></div>
          <div><Btn disabled={!av.returnToDraft.allowed || busy !== null} onClick={() => transition("return", "Returned to draft.")}>Return to draft</Btn><Why a={av.returnToDraft} /></div>
          <div><Btn disabled={!av.approve.allowed || busy !== null} onClick={() => transition("approve", "Approved.")}>Mark approved</Btn><Why a={av.approve} /></div>
          <div><Btn kind="primary" disabled={!av.publish.allowed || busy !== null} onClick={() => transition("publish", "Published.")}>Publish</Btn><Why a={av.publish} /></div>
          <div><Btn kind="danger" disabled={!av.retire.allowed || busy !== null} onClick={() => { if (window.confirm("Retire this version? New work will no longer use it.")) void transition("retire", "Retired."); }}>Retire</Btn><Why a={av.retire} /></div>
          <div><Btn disabled={!av.duplicate.allowed || busy !== null} onClick={() => transition("duplicate", "A new draft was made.")}>Duplicate to a new draft</Btn><Why a={av.duplicate} /></div>
        </div>

        {shownIssues && !shownIssues.ok && (
          <div className="space-y-2 rounded-lg border border-[var(--cmp-app-border)] p-3">
            <p className="text-sm font-semibold">What stops this being put forward</p>
            <IssueList issues={shownIssues.errors} tone="error" />
          </div>
        )}

        {p.state === "in_review" && (
          <div className="space-y-3 rounded-lg border border-[var(--cmp-app-border)] p-3">
            <p className="text-sm font-semibold">Review of this exact content</p>
            <p className="text-sm text-[var(--cmp-app-text-secondary)]">
              Governance approvals {ap.governance} of {ap.need}.
              {p.requiresDomainReview ? ` Domain approvals ${ap.domain} of ${ap.need}.` : " No domain review is required."}
              {ap.blocked && " A reviewer rejected it or asked for changes, so it cannot be approved until it is returned to draft and put forward again."}
            </p>
            {canReview ? (
              <div className="space-y-2">
                {av.reviewDomain.allowed && av.reviewGovernance.allowed && (
                  <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Kind of review
                    <select value={reviewKind} onChange={(e) => setReviewKind(e.target.value as "governance" | "domain")} className="min-h-9 rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-2 text-sm text-[var(--cmp-app-text)]">
                      <option value="governance">Governance</option><option value="domain">Domain</option>
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Rationale (needed to reject or ask for changes)
                  <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} maxLength={4000} className="rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 py-2 text-sm text-[var(--cmp-app-text)]" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Btn kind="primary" disabled={busy !== null} onClick={() => decide("approved")}>Approve</Btn>
                  <Btn disabled={busy !== null} onClick={() => decide("changes_requested")}>Ask for changes</Btn>
                  <Btn kind="danger" disabled={busy !== null} onClick={() => decide("rejected")}>Reject</Btn>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--cmp-app-text-secondary)]">{av.reviewGovernance.reason}</p>
            )}
          </div>
        )}

        {p.decisions.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-semibold">Review decisions</p>
            <ul className="space-y-1 text-sm">
              {p.decisions.map((d) => (
                <li key={d.id} className={d.content_hash === p.contentHash ? "" : "opacity-60"}>
                  <span className="font-semibold">{DECISION_WORDS[d.decision] ?? d.decision}</span> ({d.review_kind === "domain" ? "domain" : "governance"}) by {p.names[d.reviewer_id] ?? "a reviewer"}, {fmtDateTime(d.created_at)}
                  {d.content_hash === p.contentHash ? "" : " on earlier content"}
                  {d.rationale && <span className="block text-[var(--cmp-app-text-secondary)]">{d.rationale}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {p.state === "draft" && (
          <div>
            <Btn kind="danger" size="sm" disabled={busy !== null} onClick={() => { if (window.confirm("Delete this draft? This cannot be undone.")) void transition("delete", "Draft deleted."); }}>Delete this draft</Btn>
          </div>
        )}
      </div>
    </Panel>
  );
}
