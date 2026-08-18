import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadControls, CONTROL_TYPE_LABEL, EXECUTION_LABEL, FREQUENCY_LABEL } from "@/lib/hq/gov-control";
import { loadControlCandidates } from "@/lib/hq/gov-control-candidates";
import { EFFECTIVENESS_LABEL } from "@/lib/hq/gov-evidence";
import { Explain, Cite } from "../../_components/evidence";

// CPR-PD-010 §6 — CONTROLS & ASSURANCE.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THIS PAGE HAS TWO HALVES AND THEY MUST NOT BE ADDED TOGETHER. The governed catalogue is empty. The
// product's own enforcement surface is not — hundreds of constraints and triggers refuse wrong writes
// every day, and a couple of hundred harnesses try to break them.
//
// Presenting the second as the first would be the product certifying its own assurance. §6 says control
// existence is not proof of effectiveness, and makes testing independence configurable precisely so the
// person who built a control cannot sign it off. So the enforcement surface is shown as CANDIDATES FOR
// ADOPTION, with the governed count sitting beside it at zero — which is a far sharper thing to read
// than an empty page, and is exactly as true.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();
  const read = await loadControls(admin);
  const candidates = loadControlCandidates();

  const enforcementTotal = candidates
    ? candidates.checkConstraints + candidates.triggers + candidates.harnesses
    : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="mb-1 border-b border-gray-200 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Governance &amp; Risk</p>
        <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-gray-900">Controls &amp; Assurance</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-600">
          The control catalogue, its design and operating effectiveness, and the testing behind each.
        </p>
      </header>

      {/* ── the governed catalogue ───────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">The governed control catalogue (§6)</h2>
        {read === null ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The control store could not be read. That is not zero controls.
          </p>
        ) : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Registered controls</p>
                <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{read.assurance.total}</p>
              </div>
              <div className="rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Assessed</p>
                <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">
                  {read.assurance.assessed}
                  <span className="ml-1 text-[13px] font-medium text-gray-400">/ {read.assurance.total}</span>
                </p>
                <p className="mt-1 text-[11px] text-gray-500">Both axes answered.</p>
              </div>
              <div className="rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Not tested</p>
                <p className={`mt-0.5 text-[22px] font-bold leading-none tabular-nums ${
                  read.assurance.notTested > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>
                  {read.assurance.notTested}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">Never Effective.</p>
              </div>
              <div className="rounded-lg border border-gray-200 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Test overdue</p>
                <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{read.testOverdue}</p>
              </div>
            </div>

            {read.rows.length === 0 && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                <p className="text-[12px] font-semibold text-gray-700">No control has been registered.</p>
                <p className="mt-0.5 max-w-4xl text-[11.5px] leading-relaxed text-gray-600">
                  The catalogue was read and holds none — a measured zero. ⚠ It is not a statement that
                  this product enforces nothing: the panel below counts what it enforces today. It is a
                  statement that none of that enforcement has an owner, a stated evidence requirement or
                  a testing regime.
                </p>
              </div>
            )}

            {read.rows.length > 0 && (
              <ul className="mt-3 flex flex-col divide-y divide-gray-100">
                {read.rows.map(c => (
                  <li key={c.controlId} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 text-[12.5px] font-semibold text-gray-900">
                        <span className="font-mono text-[11px] text-gray-500">{c.reference}</span> {c.name}
                      </p>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
                          design: {EFFECTIVENESS_LABEL[c.designEffectiveness]}
                        </span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          c.operatingEffectiveness === "not_tested"
                            ? "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"
                            : "border-gray-300 bg-gray-50 text-gray-700"}`}>
                          operating: {EFFECTIVENESS_LABEL[c.operatingEffectiveness]}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-gray-600">
                      {CONTROL_TYPE_LABEL[c.controlType]} · {EXECUTION_LABEL[c.execution]} · {FREQUENCY_LABEL[c.frequency]}
                      {c.ownerName ? ` · ${c.ownerName}` : " · no owner"}
                      {c.testCount > 0 ? ` · ${c.testCount} test${c.testCount === 1 ? "" : "s"}` : " · never tested"}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3">
              <Explain summary="Why there is no single effectiveness percentage on this page">
                §6 keeps design effectiveness and operating effectiveness as two separate judgements: a
                control can be well designed and never once executed. One blended number answers neither
                question and hides the untested inside its denominator, and §22 is explicit that a
                control which has not been tested renders Not Tested and never Effective. An aggregate
                may exist only alongside a published calculation methodology stating how untested and
                unknown controls are counted.
                <Cite>controlAssurance() returns aggregateEffectivenessPct typed as null</Cite>
              </Explain>
            </div>
          </>
        )}
      </section>

      {/* ── what the product already enforces ────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <h2 className="text-[13px] font-bold text-amber-900">What this product already enforces</h2>
        {candidates === null ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The product source could not be read from this environment, so the enforcement surface is
            unavailable rather than zero. Nothing below this line is a measurement.
          </p>
        ) : (
          <>
            <p className="mt-1 max-w-4xl text-[12px] leading-relaxed text-gray-800">
              Counted from the product&apos;s own source. Every one of these refuses a wrong write, a wrong
              transition, or looks for a failure on purpose — and <strong>not one of them is a governed
              control</strong>.
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Named CHECK constraints", v: candidates.checkConstraints, note: "Preventive — the write is refused before it lands." },
                { label: "Database triggers", v: candidates.triggers, note: "Preventive or corrective, depending on what each does." },
                { label: "Append-only trails", v: candidates.appendOnlyTrails, note: "A record that cannot be edited or deleted." },
                { label: "Acceptance harnesses", v: candidates.harnesses, note: "Detective — they look for the failure." },
              ].map(s => (
                <div key={s.label} className="rounded-lg border border-amber-200 bg-white px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{s.label}</p>
                  <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{s.v}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{s.note}</p>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[12.5px] font-semibold text-amber-900">
              {enforcementTotal} enforcement mechanisms in the source. {read?.assurance.total ?? 0} registered as governed controls.
            </p>

            <Explain summary="Why these are candidates and not simply registered as controls">
              Because the product would then be certifying its own assurance. §6 states that control
              existence is not proof of effectiveness, and makes testing independence a configurable
              requirement precisely so that whoever built a control cannot sign it off. Writing several
              hundred constraints into the catalogue and marking them effective would execute that
              failure at scale and look rigorous while doing it.
              <Cite>gov_control has no effectiveness column — a control&apos;s state derives from tests recorded against it</Cite>
            </Explain>

            <div className="mt-3 border-t border-amber-200 pt-2">
              <p className="text-[11px] font-semibold text-gray-700">
                A sample, so the counts above are checkable rather than merely large
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {candidates.sample.map(s => (
                  <li key={`${s.kind}-${s.name}`}
                    className="rounded border border-amber-200 bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-gray-700">
                    {s.name}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] leading-relaxed text-gray-600">
                Scanned across {candidates.migrationsScanned} migration files.
              </p>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">What adopting one would mean (§6)</h2>
        <p className="mt-2 max-w-4xl text-[12px] leading-relaxed text-gray-700">
          Registering a control is not a copy of the constraint. §6 asks for an objective, an owner, an
          evidence requirement — what would prove it operates — a frequency, and separate judgements on
          whether it is well designed and whether it actually runs. The constraint is the mechanism; the
          control record is the accountability around it, and the second is what does not exist yet.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
          Failed and ineffective controls feed risk reassessment, which is read in{" "}
          <Link href="/super-admin/pd/governance/risks" className="font-semibold text-teal-700 hover:underline">
            the Product Risk Register
          </Link>{" "}
          — §6 is explicit that a control failing is a reason to look at the risk again.
        </p>
      </section>
    </div>
  );
}
