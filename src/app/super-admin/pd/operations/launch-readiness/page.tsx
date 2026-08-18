import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdOperations, SUPABASE_GATE_NOTE } from "@/lib/hq/pd-operations";
import { FLAG_CONSEQUENCE, FLAG_ORDER } from "@/lib/practice/operations";
import { OpsHeader, Stat, Panel, Absent, Warn, TechnicalOpsLink } from "../_components/ops-ui";

// CPR-PD-014 build 3 — LAUNCH READINESS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does
// not constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything.
//
// ⚠ THE AUTO/MANUAL SPLIT IS THE WHOLE HONESTY OF THE GATE, so this page renders the two SEPARATELY
// rather than as one list of ticks. An item a person has to attest — somebody signing in cold, a pilot
// walkthrough — is never turned green by a page; the point of automating the rest is to shrink the human
// set, not to disguise it. A single combined "9/12" would let the manual set disappear into a ratio.
//
// ⚠ READ-ONLY. The flag toggles live on Technical Operations (PD-001 s3 retains that page), and the
// consequences below are imported from the same FLAG_CONSEQUENCE constant that page and the flags API
// use, so the warning shown at the moment of a flip and the warning shown afterwards cannot diverge.

export const dynamic = "force-dynamic";

const FLAG_LABEL: Record<string, string> = {
  practice_pilot_provisioning: "Pilot provisioning",
  practice_sign_in: "Sign-in open",
  practice_public_signup: "Public signup",
};

const STATE_TONE: Record<string, string> = {
  pass: "text-[var(--cmp-text-success)]",
  fail: "text-[var(--cmp-text-critical)]",
  pending: "text-[var(--cmp-text-warning)]",
};
const STATE_MARK: Record<string, string> = { pass: "✓", fail: "✗", pending: "•" };

export default async function Page() {
  await requireHqCapability("hq.practice.operations.view");
  const ops = await loadPdOperations(createAdminClient());

  const auto = ops.gate.filter(g => g.kind === "auto");
  const manual = ops.gate.filter(g => g.kind === "manual");
  const publiclyLive = FLAG_ORDER.filter(f => ops.flags[f] && f !== "practice_pilot_provisioning");

  return (
    <div data-wide className="space-y-4">
      <OpsHeader
        title="Launch Readiness"
        purpose="How far Competen Practice has climbed the launch ladder, and what the cutover gate still says is outstanding — with the checks a machine can run kept apart from the ones a person must attest."
        spec="CPR-PD-014 build 3 · CPR-IAM-001 §14, §14.1"
      />

      {/* STANDING STATEMENT OF WHAT IS PUBLICLY LIVE. Not a toast: whoever opens this page sees it,
          including someone who did not flip the flag and does not know it moved. */}
      {publiclyLive.length > 0 && (
        <Warn title="Live on the public site right now">
          <ul className="flex flex-col gap-1">
            {publiclyLive.map(f => (
              <li key={f}>
                <span className="font-mono font-semibold">{f}</span> — {FLAG_CONSEQUENCE[f]}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-gray-600">{SUPABASE_GATE_NOTE}</p>
        </Warn>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Launch state (§14.1)</p>
          <p className="text-xl font-bold text-gray-900">{ops.launch.state}</p>
          <p className="text-[11px] leading-snug text-gray-500">{ops.launch.detail}</p>
        </div>
        {/* ⚠ THE AUTOMATIC AND MANUAL HALVES ARE COUNTED SEPARATELY. A combined ratio would let a gate
            with every human step outstanding read as nearly complete. */}
        <Stat label="Automatic checks passing"
          value={`${ops.gateSummary.autoPass}/${ops.gateSummary.autoTotal}`}
          scope="evaluated against the live database on every load"
          tone={ops.gateSummary.fail ? "critical" : "success"} />
        <Stat label="Automatic checks failing" value={String(ops.gateSummary.fail)}
          scope="a red item here is a fact about the deployment, not an opinion"
          tone={ops.gateSummary.fail ? "critical" : "neutral"} />
        <Stat label="Human attestations outstanding"
          value={`${ops.gateSummary.manualOutstanding}/${ops.gateSummary.manualTotal}`}
          scope="never turned green by this page"
          tone={ops.gateSummary.manualOutstanding ? "warning" : "success"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Automatically evaluated"
          note="Each item carries how it is checked, because green means nothing if the check is a hard-coded true. These are re-evaluated against the database on every load and can go red.">
          <ul className="flex flex-col gap-1.5">
            {auto.map(g => (
              <li key={g.id} className="flex gap-2 text-[12px]">
                <span className={`shrink-0 font-bold ${STATE_TONE[g.state]}`}>{STATE_MARK[g.state]}</span>
                <span className="flex-1">
                  <span className="text-gray-800">{g.label}</span>
                  <span className="block text-[11px] text-gray-500">{g.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Attested by a person"
          note="No automated check stands in for somebody using the product. These items are pending until a human says otherwise, and nothing on this page can move them.">
          <ul className="flex flex-col gap-1.5">
            {manual.map(g => (
              <li key={g.id} className="flex gap-2 text-[12px]">
                <span className={`shrink-0 font-bold ${STATE_TONE[g.state]}`}>{STATE_MARK[g.state]}</span>
                <span className="flex-1">
                  <span className="text-gray-800">{g.label}</span>
                  <span className="ml-1.5 rounded bg-gray-100 px-1 py-0.5 text-[9px] font-bold text-gray-500">MANUAL</span>
                  <span className="block text-[11px] text-gray-500">{g.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="The launch ladder"
        note="Three flags, in the order they are climbed. The launch state above is derived from them on every read rather than stored, so it cannot drift from what is actually on.">
        <ul className="flex flex-col gap-2">
          {ops.flagRows.map(f => (
            <li key={f.flag} className="flex items-start gap-3 rounded-lg border border-gray-100 px-3 py-2">
              <div className="flex-1">
                <p className="text-[12px] font-semibold text-gray-900">{FLAG_LABEL[f.flag] ?? f.flag}</p>
                <p className="font-mono text-[10px] text-gray-400">{f.flag}</p>
                {f.note && <p className="text-[11px] text-gray-500">{f.note}</p>}
                {/* One copy of what the flag makes true of the public site, imported rather than retyped. */}
                {f.enabled && FLAG_CONSEQUENCE[f.flag] && (
                  <p className="mt-1 text-[11px] text-[var(--cmp-text-warning)]">{FLAG_CONSEQUENCE[f.flag]}</p>
                )}
              </div>
              <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                f.enabled
                  ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                  : "bg-gray-100 text-gray-500"}`}>
                {f.enabled ? "ON" : "OFF"}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <TechnicalOpsLink for="Flipping a flag changes what the public site does, so the toggle and its confirmation stay on" />
        </div>
      </Panel>

      <Absent
        what="Whether account creation is actually open"
        why={SUPABASE_GATE_NOTE + " The gate ledger's \"public signup is open\" line and the consequence sentences above are true of this product's own gates only; the fourth one has to be checked in the Supabase dashboard by a person."} />

      <p className="text-[11px] text-gray-400">
        Read at {ops.generatedAt.slice(0, 16).replace("T", " ")} UTC. The gate is re-evaluated on every
        load; nothing on this page is a stored verdict.
      </p>
    </div>
  );
}
