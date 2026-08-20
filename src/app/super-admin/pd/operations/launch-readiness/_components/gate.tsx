import type { GateItem } from "@/lib/practice/operations";
import type { LaunchAttestations, AttestationStatus } from "@/lib/hq/pd-launch-attestation";
import { statusFor } from "@/lib/hq/pd-launch-attestation";
import AttestControl from "./AttestControl";

// CPR-PD-014 §6 — Launch Readiness, gate-first.
//
// !! THE DECISION COMES BEFORE THE CHECKLIST. §6.2: "The first viewport must present the decision state,
// not a long checklist." The previous build led with the ladder and the full item list, so the one
// question the screen exists to answer — may we move to the next launch state, and if not why — had to
// be reconstructed by reading everything.

/**
 * §6.3 groups. Declared explicitly rather than inferred from the control id, because a grouping derived
 * from a naming convention silently regroups itself the day somebody renames a control.
 */
const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Infrastructure & identity", ids: ["routes", "identity", "migrations", "seed"] },
  { title: "Practice operational readiness", ids: ["pathway", "provisioned", "activated", "clinical", "resumable"] },
];
const HUMAN_GROUP = "Human acceptance";

const MARK: Record<string, string> = { pass: "✓", fail: "✗", pending: "•" };
const TONE: Record<string, string> = {
  pass: "text-[var(--cmp-text-success)]",
  fail: "text-[var(--cmp-text-critical)]",
  pending: "text-[var(--cmp-text-warning)]",
};

const STATUS_TONE: Record<AttestationStatus, string> = {
  ATTESTED: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  REJECTED: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
  EXPIRED: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
  SUPERSEDED: "bg-gray-100 text-gray-600",
  AWAITING: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
};

/**
 * §6.2 — the gate, as a decision.
 *
 * !! THE PROGRESS BAR VISUALISES THE EXACT NUMERATOR AND DENOMINATOR, NOTHING ELSE. §6.2: "A progress
 * bar may be shown only as a visualisation of the exact gate numerator/denominator, not as a predictive
 * readiness score." So it is filled by satisfied/total and carries the same two numbers as text beside
 * it — there is no weighting, no confidence, and nothing to reverse-engineer.
 *
 * !! AUTOMATIC AND HUMAN ARE NEVER MERGED. §6.7 makes it an acceptance test. A combined ratio would let
 * the human set — the half no page can turn green — disappear into a number that looks nearly done.
 */
export function GateDecision({ launchState, satisfied, total, blockers, autoPass, autoTotal, humanAttested, humanTotal, nextTransition }: {
  launchState: string;
  satisfied: number; total: number;
  blockers: string[];
  autoPass: number; autoTotal: number;
  humanAttested: number; humanTotal: number;
  nextTransition: string | null;
}) {
  const pct = total > 0 ? Math.round((satisfied / total) * 100) : 0;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Current launch state</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">{launchState}</p>
        {nextTransition && (
          <p className="mt-2 text-[12px] text-gray-600">
            <span className="font-semibold">Next transition:</span> {nextTransition}
            {blockers.length > 0 && (
              <> — blocked by {blockers.length} outstanding control{blockers.length === 1 ? "" : "s"}.</>
            )}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Launch controls satisfied</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{satisfied} / {total}</p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
          role="img" aria-label={`${satisfied} of ${total} launch controls satisfied`}>
          <span className="block h-full bg-[var(--cmp-text-success)]" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Automatic {autoPass}/{autoTotal} passed · Human {humanAttested}/{humanTotal} attested. Counted
          separately, because no page can attest a human control.
        </p>
      </div>
    </div>
  );
}

/** §6.2 — the blockers, named. This is the answer to "what is stopping us", so it is not behind a toggle. */
export function Blockers({ items }: { items: GateItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--cmp-text-success)]/30 bg-[var(--cmp-surface-success)] px-3 py-2 text-[12px] text-[var(--cmp-text-success)]">
        No control is blocking the next transition.
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--cmp-text-warning)]/40 bg-[var(--cmp-surface-warning)] px-3 py-2">
      <p className="text-[12px] font-semibold text-[var(--cmp-text-warning)]">
        Blocking the next transition ({items.length})
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map(i => (
          <li key={i.id} className="text-[12px] text-gray-700">
            <span className="font-medium">{i.label}</span>
            <span className="ml-1.5 text-gray-500">— {i.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * §6.3 — grouped controls, "collapsed by default when fully passing; groups containing blockers open by
 * default". A passing group is still present and still countable; it just stops competing for attention
 * with the one that is not.
 */
export function ControlGroup({ title, items }: { title: string; items: GateItem[] }) {
  if (items.length === 0) return null;
  const passing = items.filter(i => i.state === "pass").length;
  const allPass = passing === items.length;
  return (
    <details open={!allPass} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <summary className="cursor-pointer text-[12px] font-semibold text-gray-700">
        {title}
        <span className={`ml-2 font-normal tabular-nums ${allPass ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"}`}>
          {passing}/{items.length}
        </span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map(i => (
          <li key={i.id} className="flex gap-2 text-[12px]">
            <span className={`mt-0.5 font-bold ${TONE[i.state]}`} aria-hidden>{MARK[i.state]}</span>
            <span>
              <span className="font-medium text-gray-800">{i.label}</span>
              <span className="ml-1.5 text-gray-500">{i.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export { GROUPS, HUMAN_GROUP };

/**
 * §6.4 — human attestation rows.
 *
 * !! A CONTROL WITH NO LEDGER ROW READS AWAITING, NOT FAILED. Nobody has said no; nobody has said
 * anything. §10 draws exactly this distinction, and conflating them would report a product as rejected
 * because a person has not got to it yet.
 */
export function AttestationRows({ items, attestations, recordingUnavailableReason, canAttest }: {
  items: GateItem[];
  attestations: LaunchAttestations;
  /**
   * Whether THIS caller holds hq.practice.launch.attest (migration 344). The control is drawn only when
   * true -- s13 forbids a placeholder that does nothing, and a disabled button with a tooltip is one.
   */
  canAttest: boolean;
  /**
   * Why no "Record attestation" control is drawn, when none is. §13: "Do not create placeholder controls
   * that do nothing." A disabled button with a tooltip is still a control that does nothing, so the page
   * says the reason in words and offers nothing to click.
   */
  recordingUnavailableReason: string | null;
}) {
  if (attestations.unavailable) {
    return (
      <p className="text-[12px] text-[var(--cmp-text-warning)]">
        Attestations are unavailable: {attestations.unavailableReason}. Until the ledger exists these
        controls carry no owner, evidence or audit trail, and this page will not imply otherwise.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
        <table className="w-full min-w-[44rem] text-left text-[12px]">
          <thead>
            <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
              <th className="pb-1.5 pr-3 font-semibold">Control</th>
              <th className="pb-1.5 pr-3 font-semibold">Status</th>
              <th className="pb-1.5 pr-3 font-semibold">Evidence</th>
              <th className="pb-1.5 pr-3 font-semibold">Attested by</th>
              <th className="pb-1.5 pr-3 font-semibold">Attested at</th>
              {canAttest && <th className="pb-1.5 font-semibold">Record</th>}
            </tr>
          </thead>
          <tbody>
            {items.map(i => {
              const status = statusFor(i.id, attestations);
              const row = attestations.rows.find(r => r.controlId === i.id);
              return (
                <tr key={i.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-gray-900">{i.label}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-gray-500">{i.id}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[status]}`}>
                      {status}
                    </span>
                  </td>
                  {/* §6.4: "no invented evidence". An absent reference renders as an em dash. */}
                  <td className="py-2 pr-3 text-gray-600">{row?.evidenceRef ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-gray-500">
                    {row ? `${row.attestedBy.slice(0, 8)}…` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-gray-600">
                    {row ? String(row.attestedAt).slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  {canAttest && (
                    <td className="py-2 align-top">
                      <AttestControl controlId={i.id} controlLabel={i.label}
                        alreadyAttested={status === "ATTESTED"} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        {attestations.releaseRef
          ? <>Attestations shown are those recorded against <span className="font-mono">{attestations.releaseRef}</span>. A different build carries no attestation until one is recorded against it.</>
          : <>No attestation has been recorded against any build yet, so every control above is awaiting one.</>}
      </p>
      {recordingUnavailableReason && (
        <p className="mt-1 text-[11px] text-gray-500">{recordingUnavailableReason}</p>
      )}
    </>
  );
}

/**
 * §6.5 — the ladder, compressed to one line.
 *
 * The previous build gave each rung a card the height of a paragraph, which made three booleans occupy
 * the same space as the decision itself.
 */
export function LadderCompact({ rungs, nextTransition, blockerCount }: {
  rungs: { label: string; on: boolean }[];
  nextTransition: string | null;
  blockerCount: number;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {rungs.map((r, n) => (
          <li key={r.label} className="flex items-center gap-1.5">
            <span className={r.on ? "text-[var(--cmp-text-success)]" : "text-gray-500"} aria-hidden>
              {r.on ? "✓" : "○"}
            </span>
            <span className={r.on ? "font-medium text-gray-800" : "text-gray-500"}>{r.label}</span>
            <span className="font-mono text-[10px] text-gray-500">{r.on ? "ON" : "OFF"}</span>
            {n < rungs.length - 1 && <span className="ml-1 text-gray-300" aria-hidden>&rarr;</span>}
          </li>
        ))}
      </ol>
      {nextTransition && (
        <p className="mt-1.5 text-[11px] text-gray-600">
          <span className="font-semibold">Next transition:</span> {nextTransition}
          {blockerCount > 0 && <> — blocked by {blockerCount} outstanding control{blockerCount === 1 ? "" : "s"}.</>}
        </p>
      )}
    </div>
  );
}

/**
 * §6.6 — the project-level signup switch.
 *
 * !! THIS IS AN EXTERNAL CONTROL, NOT A FOOTNOTE. §6.6 is explicit that repository code cannot read the
 * Supabase Auth project setting, so it must be represented as an attestation-style external dependency
 * rather than as a line of small print that could be mistaken for a verified automatic fact. It is drawn
 * with the same status vocabulary as every other human control precisely so it cannot read as green.
 */
export function ExternalGate({ note }: { note: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-warning)]">
          EXTERNAL
        </span>
        <span className="text-[12px] font-medium text-gray-800">
          Project-level signup switch
        </span>
        <span className="text-[11px] text-gray-500">
          not readable by this application
        </span>
      </div>
      <p className="mt-1 text-[12px] text-gray-600">{note}</p>
    </div>
  );
}
