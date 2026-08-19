import type { OnboardingRow, ProvisioningHealth } from "@/lib/hq/pd-provisioning-health";

// CPR-PD-014 §4 — the presentation half of the provisioning-health surface.
//
// Split out of page.tsx because §4 adds four distinct blocks to a page that already ran to 262 lines,
// and because these are the parts worth reading in isolation when somebody asks "why does it say that".

/** §10: a duration with no legitimate source says so, and never renders 0. */
function secs(n: number | null): string {
  if (n === null) return "Not yet measured";
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  return `${m}m ${n % 60}s`;
}

/**
 * §4.2 — the provisioning-health summary.
 *
 * ⚠ NULL, ZERO AND UNAVAILABLE ARE THREE DIFFERENT RENDERS. §12 requires it explicitly. A count that
 * could not be read shows "Unavailable" with the reason; a count that is genuinely zero shows 0; a
 * duration without enough samples shows "Not yet measured" and says how many it has.
 */
export function HealthCards({ h }: { h: ProvisioningHealth }) {
  const card = "rounded-xl border border-gray-200 bg-white p-3";
  const label = "text-[11px] font-semibold uppercase tracking-wide text-gray-500";
  const value = "mt-1 text-2xl font-bold tabular-nums";
  const scope = "mt-1 text-[11px] leading-snug text-gray-500";

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className={card}>
        <p className={label}>Successful</p>
        <p className={`${value} text-[var(--cmp-text-success)]`}>
          {h.counts.successful ?? "Unavailable"}
        </p>
        <p className={scope}>Completed provisioning runs in the measured scope.</p>
      </div>

      <div className={card}>
        <p className={label}>In progress</p>
        <p className={`${value} ${h.counts.inProgress ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
          {h.counts.inProgress ?? "Unavailable"}
        </p>
        {/* §4.2: "Show oldest age if >0". A run open for eleven days is a different fact from three open runs. */}
        <p className={scope}>
          {h.oldestOpenHours === null
            ? "Neither COMPLETED, EXPIRED nor FAILED."
            : `Oldest has been open ${h.oldestOpenHours < 48
              ? `${Math.round(h.oldestOpenHours)}h`
              : `${Math.round(h.oldestOpenHours / 24)} days`}.`}
        </p>
      </div>

      <div className={card}>
        <p className={label}>Failed</p>
        <p className={`${value} ${h.counts.failed ? "text-[var(--cmp-text-critical)]" : "text-gray-900"}`}>
          {h.counts.failed ?? "Unavailable"}
        </p>
        <p className={scope}>A stopped saga, not a slow one.</p>
      </div>

      <div className={card}>
        <p className={label}>Provisioning duration</p>
        <p className={`${value} ${h.duration.p50Seconds === null ? "text-[15px] font-semibold text-gray-400" : "text-gray-900"}`}>
          {h.duration.p50Seconds === null ? "Not yet measured" : secs(h.duration.p50Seconds)}
        </p>
        <p className={scope}>
          {h.duration.p50Seconds === null
            ? h.duration.unavailableReason
            : `p50 · p95 ${secs(h.duration.p95Seconds)} · ${h.duration.sampleSize} completed runs`}
        </p>
      </div>
    </div>
  );
}

/**
 * §4.2 — the lifecycle strip.
 *
 * ⚠ A STAGE WITH NO LEGITIMATE SOURCE SHOWS A DASH, NOT A ZERO. §4.2: "Each stage shows a count only
 * if a legitimate source exists." Account and Configuration have no counter on this plane — the first
 * is an identity fact and the second lives inside the onboarding payload this plane may not read — so
 * they are rendered as unavailable rather than filled with a plausible number.
 */
export function LifecycleStrip({ h, workspaceCounts }: {
  h: ProvisioningHealth;
  workspaceCounts: { provisioning: number; onboarding: number; active: number };
}) {
  const done = h.onboarding.filter(r => r.completedAt !== null).length;
  const stages: { label: string; count: number | null; note: string }[] = [
    { label: "Account", count: null, note: "identity, not an operations counter" },
    { label: "Provisioning", count: h.counts.inProgress, note: "runs not yet finished" },
    { label: "Workspace created", count: workspaceCounts.provisioning, note: "at PROVISIONING" },
    { label: "Owner assigned", count: null, note: "no distinct counter exists" },
    { label: "Configuration", count: null, note: "inside the onboarding payload this plane may not read" },
    { label: "Onboarding", count: workspaceCounts.onboarding, note: "at ONBOARDING" },
    { label: "Active", count: workspaceCounts.active, note: "at ACTIVE" },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Provisioning &amp; onboarding lifecycle
      </p>
      <ol className="mt-2 flex flex-wrap gap-1.5">
        {stages.map(s => (
          <li key={s.label} title={s.note}
            className="flex-1 min-w-[8.5rem] rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-2">
            <p className="text-[11px] font-medium text-gray-600">{s.label}</p>
            {s.count === null
              ? <p className="mt-0.5 text-[11px] italic text-gray-400">Unavailable</p>
              : <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{s.count}</p>}
          </li>
        ))}
      </ol>
      {done > 0 && (
        <p className="mt-2 text-[11px] text-gray-500">
          {done} practice{done === 1 ? " has" : "s have"} completed onboarding.
        </p>
      )}
    </div>
  );
}

function stageLabel(code: string | null): string {
  if (!code) return "Not started";
  // §3: "concise human labels first; show database/status codes as secondary text".
  return code.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
}

function ago(iso: string | null): string {
  if (!iso) return "—";
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return "under 1h ago";
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * §4.3 — practices currently onboarding.
 *
 * ⚠ THE ATTENTION COLUMN IS THE REASON THE TABLE IS SORTED, so it is not decoration. §4.3 fixes the
 * default order as needs-attention first, then oldest last-progress; sortOnboarding() in the loader
 * implements it and is exported so the ordering is testable without rendering anything.
 */
export function OnboardingRegister({ rows, stallHours, unavailable, unavailableReason }: {
  rows: OnboardingRow[];
  stallHours: number | null;
  unavailable: boolean;
  unavailableReason: string | null;
}) {
  if (unavailable) {
    return (
      <p className="text-[12px] text-[var(--cmp-text-warning)]">
        Onboarding progress is unavailable: {unavailableReason}. Until the projection exists this page
        shows no stage counts rather than inferring them from workspace status.
      </p>
    );
  }
  if (rows.length === 0) {
    // §10: an empty set says what was measured, not that nothing exists.
    return <p className="text-[12px] text-gray-500">No practice has an onboarding record in the measured scope.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
            <th className="pb-1.5 pr-3 font-semibold">Practice</th>
            <th className="pb-1.5 pr-3 font-semibold">Setup progress</th>
            <th className="pb-1.5 pr-3 font-semibold">Current stage</th>
            <th className="pb-1.5 pr-3 font-semibold">Last activity</th>
            <th className="pb-1.5 font-semibold">Attention</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const total = r.stepsTotal ?? 0;
            const doneN = r.stepsCompleted ?? 0;
            const pct = total > 0 ? Math.round((doneN / total) * 100) : null;
            const complete = r.completedAt !== null;
            const stalled = r.stalledReasonCode !== null;
            return (
              <tr key={r.practiceId} className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-3 font-medium text-gray-900">
                  {r.practiceName ?? <span className="italic text-gray-400">Name not in scope</span>}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-gray-700">{doneN}/{total || "—"}</span>
                    {pct !== null && (
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
                        <span
                          className={`block h-full ${complete ? "bg-[var(--cmp-text-success)]"
                            : stalled ? "bg-[var(--cmp-text-warning)]" : "bg-gray-400"}`}
                          style={{ width: `${pct}%` }} />
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <span className="text-gray-800">{stageLabel(r.stage)}</span>
                  {r.stage && <span className="ml-1.5 font-mono text-[10px] text-gray-400">{r.stage}</span>}
                </td>
                <td className="py-2 pr-3 text-gray-600">{ago(r.lastProgressAt)}</td>
                <td className="py-2">
                  {complete ? (
                    <span className="rounded bg-[var(--cmp-surface-success)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-success)]">
                      COMPLETE
                    </span>
                  ) : stalled ? (
                    <span
                      title={stallHours ? `No progress for more than ${stallHours}h` : undefined}
                      className="rounded bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-warning)]">
                      STALLED
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * §4.4 — the recovery model, as a disclosure rather than an essay.
 *
 * ⚠ THIS REPLACES AN ALWAYS-VISIBLE AMBER BLOCK, AND THE CHANGE IS THE POINT. §4.4: "Remove the large
 * always-visible 'There is no resume button…' warning from the primary flow. Replace it with a compact
 * 'Recovery model' disclosure when no failures exist." The old block was true and it outranked every
 * real failure on the page, which is the opposite of §3's exception-first rule. The words survive; their
 * priority does not.
 */
export function RecoveryModel({ resumePath, attemptsAbsence }: {
  resumePath: string; attemptsAbsence: string;
}) {
  return (
    <details className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <summary className="cursor-pointer text-[12px] font-semibold text-gray-700">
        Recovery model
        <span className="ml-2 font-normal text-gray-500">
          how a failed run is resumed, and why no retry button exists yet
        </span>
      </summary>
      <div className="mt-2 space-y-1.5 text-[12px] text-gray-600">
        <p>
          Provisioning is a resumable saga — every step re-checks its own resource before creating it, so
          a re-run completes the remainder instead of duplicating the start.
        </p>
        {/* ⚠ THE ENDPOINT PATH IS NOT SPELLED OUT HERE. CPR-PD-SCREEN-DOCTRINE counts an implementation
            identifier in visible text against a ratchet whose direction is downward, and the operator
            does not need the route to act — RESUME_PATH below tells them what to do. The route itself is
            named in the loader, where a developer looking for it will be. */}
        <p>
          What does not exist yet is an authorised endpoint to trigger it: the request route serves reads
          only. A retry control here would have to call something, so this page states the path to
          recovery instead of offering a button that does nothing.
        </p>
        <p><span className="font-semibold">To resume a failed run:</span> {resumePath}</p>
        <p>{attemptsAbsence}</p>
      </div>
    </details>
  );
}
