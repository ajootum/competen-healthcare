import Link from "next/link";
import { EVALUATE_VIEWS, EVALUATE_VIEW_LABEL, EVIDENCE_STATUS_LABEL, GOAL_STATUS_LABEL, PROGRESS_TABS, PROGRESS_TAB_LABEL, WORKFLOW_STEPS, type DimensionView, type EvaluateView, type EvidenceStatus, type GoalStatus, type ProgressTab, type SnapshotRow } from "@/lib/individual/scholar/evaluate-goals";
import { studyHref } from "./question-view";
import { toneAction } from "./progress-parts";

// EVALUATE AND MY PROGRESS -- SCHOLAR-EVALUATE-GOALS-01 (owner GO and final alignment, 5 Nov 2026), on the owner's Evaluate mock-up, in Scholar's own tones. Server-rendered parts.
// Every figure is a count from the learner's records. A bar shows evidence collected or planned work done, never ability. Grey is not assessed, not failed.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
export const evaluateHref = (view: EvaluateView, extra: Record<string, string | null | undefined> = {}) => {
  const params: Record<string, string | null | undefined> = { ...(view === "goals" ? {} : { view }), ...extra };
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  const s = q.toString();
  return `${studyHref("evaluate")}${s ? `?${s}` : ""}`;
};

export function EvaluateViewNav({ current, study }: { current: EvaluateView; study?: string | null }) {
  return (
    <nav aria-label="Evaluate views" className="cmp-learn-next -mx-4 mb-3 overflow-x-auto px-4">
      <div className="flex min-w-max items-center gap-1.5">
        {EVALUATE_VIEWS.filter(v => v !== "history").map(v => (
          <Link key={v} href={evaluateHref(v, { study })} prefetch={false} aria-current={current === v ? "page" : undefined}
            className={`inline-flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[14px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${current === v ? "border-[var(--learn-ink)] bg-[var(--learn-ink)] text-[var(--learn-surface)]" : "border-[var(--learn-border)] bg-[var(--cmp-app-surface)] text-gray-900 hover:bg-[var(--learn-surface)]"}`}>{EVALUATE_VIEW_LABEL[v]}</Link>
        ))}
      </div>
    </nav>
  );
}

export function ProgressTabsNav({ current, study }: { current: ProgressTab; study?: string | null }) {
  return (
    <nav aria-label="Progress views" className="cmp-learn-summary -mx-4 mb-4 overflow-x-auto px-4">
      <div className="flex min-w-max items-center gap-1.5">
        {PROGRESS_TABS.map(t => (
          <Link key={t} href={`${studyHref("progress")}?tab=${t}${study ? `&study=${study}` : ""}`} prefetch={false} aria-current={current === t ? "page" : undefined}
            className={`inline-flex min-h-[40px] shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[14px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${current === t ? "border-[var(--learn-ink)] bg-[var(--learn-ink)] text-[var(--learn-surface)]" : "border-[var(--learn-border)] bg-[var(--cmp-app-surface)] text-gray-900 hover:bg-[var(--learn-surface)]"}`}>{PROGRESS_TAB_LABEL[t]}</Link>
        ))}
      </div>
    </nav>
  );
}

/** Where the learner is in an evaluation: the one flow every way of evaluating follows. */
export const WorkflowLine = () => <span className="text-[12.5px] text-gray-700" data-workflow>{WORKFLOW_STEPS.join(" → ")}</span>;

export function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-gray-200">
      <dt className="text-[12.5px] font-semibold text-gray-700">{label}</dt>
      <dd className="cmp-learn-ink mt-0.5 text-[22px] font-bold tabular-nums">{value}</dd>
      <dd className="text-[12.5px] text-gray-700">{note}</dd>
    </div>
  );
}

const STATUS_CLASS: Record<EvidenceStatus, string> = {
  supported: "border-[var(--cmp-learn-check-border)] bg-[var(--cmp-learn-check-surface)] text-[var(--cmp-learn-check-ink)]",
  developing: "border-[var(--cmp-role-revision-accent)] bg-[var(--cmp-role-revision-soft)] text-[var(--cmp-role-revision-ink)]",
  gap: "border-[var(--cmp-role-revision-strong)] bg-[var(--cmp-role-revision-soft)] text-[var(--cmp-role-revision-ink)] font-bold",
  thin: "border-gray-300 border-dashed bg-[var(--cmp-app-surface)] text-gray-800",
  not_assessed: "border-gray-200 bg-gray-50 text-gray-700",
};
export const StatusChip = ({ status }: { status: EvidenceStatus }) => <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-semibold ${STATUS_CLASS[status]}`}>{EVIDENCE_STATUS_LABEL[status]}</span>;

const GOAL_CLASS: Record<GoalStatus, string> = { outcome_supported: STATUS_CLASS.supported, learning_gap: STATUS_CLASS.gap, insufficient_evidence: STATUS_CLASS.thin, not_assessed: STATUS_CLASS.not_assessed };
export const GoalChip = ({ status }: { status: GoalStatus }) => <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold ${GOAL_CLASS[status]}`} data-goal-status={status}>{GOAL_STATUS_LABEL[status]}</span>;

/** A bar of how much was done: planned work, or evidence against the minimum. It is labelled, and never reads as a score. */
export function CountBar({ label, have, of, note }: { label: string; have: number; of: number; note?: string }) {
  const width = of > 0 ? Math.min(100, Math.round((have / of) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]"><span className="font-semibold text-gray-800">{label}</span><span className="tabular-nums text-gray-700">{have} of {of}</span></div>
      <div aria-hidden className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-[var(--cmp-learn-next-accent)]" style={{ width: `${width}%` }} /></div>
      {note && <p className="mt-0.5 text-[12px] text-gray-600">{note}</p>}
    </div>
  );
}

/** The four dimensions, each with its own status and how much evidence stands behind it. */
export function DimensionRow({ dims }: { dims: readonly DimensionView[] }) {
  return (
    <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" aria-label="Evidence by learning dimension">
      {dims.map(d => (
        <li key={d.key} className="rounded-lg bg-[var(--cmp-app-surface)] p-2 ring-1 ring-gray-200" data-dimension={d.key} data-status={d.status}>
          <p className="text-[12.5px] font-semibold text-gray-800">{d.label}</p>
          <div className="mt-0.5"><StatusChip status={d.status} /></div>
        </li>
      ))}
    </ul>
  );
}

export type GoalCardData = {
  key: string; title: string; kindLabel: string; status: GoalStatus; dims: DimensionView[]; supported: number; unproven: string[];
  planned: { planned: number; completed: number } | null;
  competencies: string[]; sources: { label: string; href: string }[];
  recommendations: { label: string; reason: string; href: string }[];
  evidenceLine: string; scope: Record<string, unknown> | null; startHref: string; noMatch: boolean;
};

/** One goal: what was planned, what the evidence shows and what remains unproven, with the detail opened on request. */
export function GoalCard({ g }: { g: GoalCardData }) {
  return (
    <li className="cmp-learn-next rounded-xl bg-[var(--cmp-app-surface)] p-4 ring-1 ring-gray-200" data-goal={g.title}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-[16rem]">
          <p className="text-[12px] font-semibold text-gray-600">{g.kindLabel}</p>
          <h3 className="break-words text-[16px] font-bold leading-snug text-gray-900">{g.title}</h3>
        </div>
        <GoalChip status={g.status} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {g.planned ? <CountBar label="Planned activities done" have={g.planned.completed} of={g.planned.planned} note="Activity only, not learning shown" /> : <p className="text-[12.5px] text-gray-700"><span className="font-semibold text-gray-800">Planned activities: </span>none scheduled for this in the last 28 days.</p>}
        <CountBar label="Outcome checks supported" have={g.supported} of={g.dims.length} note={g.unproven.length ? `Not yet shown: ${g.unproven.join(", ")}` : "All four supported by your evidence"} />
      </div>
      <details className="mt-2" suppressHydrationWarning>
        <summary className={`cursor-pointer text-[13px] font-semibold text-gray-800 pointer-coarse:py-3.5 ${focusRing}`}>View evidence and next action</summary>
        <div className="mt-2 space-y-3 text-[13.5px] text-gray-800">
          <DimensionRow dims={g.dims} />
          <p>{g.noMatch ? "Nothing in your materials matches this yet, so there is nothing to evaluate. This is not a failure." : g.evidenceLine}</p>
          {g.competencies.length > 0
            ? <p><span className="font-semibold">Linked competencies: </span>{g.competencies.slice(0, 6).join(", ")}</p>
            : <p className="text-gray-700">No competency is linked to this yet. Your learning can still be evaluated without one.</p>}
          {g.sources.length > 0 && (
            <p><span className="font-semibold">From: </span>{g.sources.slice(0, 5).map((s, i) => <span key={s.href}>{i > 0 ? ", " : ""}<Link href={s.href} prefetch={false} className={toneAction.link}>{s.label}</Link></span>)}</p>
          )}
          {g.recommendations.length > 0 && (
            <ul className="space-y-1">{g.recommendations.slice(0, 3).map(r => <li key={r.label}><Link href={r.href} prefetch={false} className={toneAction.link}>{r.label}</Link><span className="block text-[12.5px] text-gray-700">{r.reason}</span></li>)}</ul>
          )}
          <p><Link href={g.startHref} prefetch={false} className={toneAction.link}>Evaluate this</Link></p>
        </div>
      </details>
    </li>
  );
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The saved evaluations of one thing, oldest first: how many dimensions each showed as supported. A count of evidence, not a grade. */
export function OverTime({ rows }: { rows: readonly SnapshotRow[] }) {
  return (
    <ol className="flex items-end gap-2 overflow-x-auto pb-1" aria-label="Saved evaluations over time">
      {rows.map(r => (
        <li key={r.id} className="w-16 shrink-0 text-center">
          <div aria-hidden className="mx-auto flex h-16 w-6 items-end overflow-hidden rounded bg-gray-100"><div className="w-full bg-[var(--cmp-learn-next-accent)]" style={{ height: `${(r.supported / 4) * 100}%` }} /></div>
          <p className="mt-1 text-[12px] tabular-nums text-gray-800">{r.supported} of 4</p>
          <p className="text-[11.5px] text-gray-600">{new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
        </li>
      ))}
    </ol>
  );
}

export const snapshotWhen = when;

export type CompetencyRow = { id: string; title: string; dims: DimensionView[]; sources: { label: string; href: string }[]; self: string | null; stage: string | null; verified: boolean; startHref: string };

/** Learning evidence against a framework's competencies. Self-assessment, approved stage and independent verification keep their own columns. */
export function CompetencyTable({ rows }: { rows: readonly CompetencyRow[] }) {
  return (
    <ul className="space-y-2" data-competency-map>
      {rows.map(c => (
        <li key={c.id} className="rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-gray-200" data-competency={c.title}>
          <h3 className="break-words text-[14.5px] font-bold text-gray-900">{c.title}</h3>
          <div className="mt-2"><DimensionRow dims={c.dims} /></div>
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-3">
            <div><dt className="font-semibold text-gray-800">Self-assessment</dt><dd className="text-gray-700">{c.self ?? "None yet"}</dd></div>
            <div><dt className="font-semibold text-gray-800">Approved stage</dt><dd className="text-gray-700">{c.stage ?? "None decided"}</dd></div>
            <div><dt className="font-semibold text-gray-800">Independently verified</dt><dd className="text-gray-700">{c.verified ? "Yes, on your Passport" : "Not assessed in Scholar"}</dd></div>
          </dl>
          <details className="mt-1" suppressHydrationWarning>
            <summary className={`cursor-pointer text-[12.5px] font-semibold text-gray-700 pointer-coarse:py-3.5 ${focusRing}`}>Evidence and sources</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-800">{c.dims.map(d => <li key={d.key}><span className="font-semibold">{d.label}:</span> {d.note}</li>)}</ul>
            {c.sources.length > 0 && <p className="mt-1 text-[12.5px]"><span className="font-semibold">From: </span>{c.sources.slice(0, 5).map((s, i) => <span key={s.href}>{i > 0 ? ", " : ""}<Link href={s.href} prefetch={false} className={toneAction.link}>{s.label}</Link></span>)}</p>}
            <p className="mt-1 text-[13px]"><Link href={c.startHref} prefetch={false} className={toneAction.link}>Evaluate this competency</Link></p>
          </details>
        </li>
      ))}
    </ul>
  );
}
