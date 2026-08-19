import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPracticeDefaults, domain, LADDER, refusalFor } from "@/lib/hq/pd-configuration";
import {
  ConfigHeader, Panel, Explain, Cite, Warn, DomainSections, RungSummary, ReadFailures, ReadStamp, NotThisModule,
} from "../_components/config-ui";

// CPR-PD-011 §7 — PRACTICE DEFAULTS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7). The await resolves before any
// JSX is returned, so an unauthorized direct URL is redirected without rendering anything.
//
// ⚠ THIS IS THE ONE DOMAIN PAGE WITH A REAL, LIVE PRODUCT DEFAULT ON IT — and it is worth saying why,
// because the reason is a rule rather than luck. The practitioner-number FORMAT is platform-owned
// configuration with a single row and no subject: prefix, digits, check digit, separator, version. It
// is on the platform-plane allowlist at `*` for exactly that reason, and it is the shape of an
// identifier rather than a fact about any person. Everything else §7 lists — onboarding steps, initial
// location behaviour, appointment and document and notification defaults — lives in
// practice_configuration and its siblings, which this plane may not read.
//
// ⚠ AND IT IS ALSO THE CLEANEST WORKED EXAMPLE OF §7's HARDEST RULE. "Changing a product default must
// explicitly state whether it affects existing Practices, future Practices only, or requires
// migration." The identifier format already answers that, in code, with a typed acknowledgement phrase
// an operator must retype: future issuance changes, issued numbers never do.

export const dynamic = "force-dynamic";

const D = domain("defaults")!;

export default async function Page() {
  await requireHqCapability("hq.practice.configuration.view");
  const d = await loadPracticeDefaults(createAdminClient());

  const fmt = d.format;
  const example = `${fmt.prefix}${fmt.separator}${"0".repeat(Math.max(0, fmt.digits - 6))}${"123456".slice(0, Math.min(6, fmt.digits))}`;
  const formatMeasured = d.formatRows !== null && d.formatRows > 0;

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="Practice Defaults"
        purpose="The behaviour a new Practice workspace starts with, and which of those defaults a Practice is permitted to change."
        spec="CPR-PD-011 §7"
      />

      <ReadFailures problems={d.problems} />

      {/* ── THE ONE LIVE PRODUCT DEFAULT ─────────────────────────────────────────────────────── */}
      <Panel
        title="Practitioner number format — a live, governed product default"
        note="Platform-owned, one row, no subject — which is why the whole of practice_identifier_format is readable from this plane and nothing else on this page is.">
        {!formatMeasured ? (
          <Warn title="The shape below is code, not configuration">
            <p>
              {d.formatRows === null
                ? "The stored format row could not be read."
                : "The format table answered and holds no row."}{" "}
              What is shown is the built-in default in code, which the reader returns when the table
              cannot answer. It matches the seeded shape exactly — so it is probably right — but nobody
              measured it, and this page will not present a fallback as a reading.
            </p>
          </Warn>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Prefix", fmt.prefix],
              ["Digits", String(fmt.digits)],
              ["Check digit", fmt.checkDigit ? "Damm, appended" : "None"],
              ["Version", `v${fmt.version}${fmt.locked ? " · locked" : ""}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">{k}</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{v}</p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-gray-700">
          A number issued under this shape looks like{" "}
          <span className="font-mono font-semibold text-gray-900">{example}</span>.{" "}
          {fmt.locked
            ? "The format is LOCKED, which means at least one number has been issued under it."
            : "The format is not yet locked: no number has been issued, so a change costs nothing."}
        </p>
        <Explain summary="§7's hardest rule, already answered by this setting">
          §7 requires a product-default change to state whether it affects existing Practices, future
          Practices only, or requires a migration. This one is explicit about it in code: changing the
          shape changes FUTURE issuance and never rewrites an issued number, because an issued number is
          on printed cards and in QR codes and rewriting it would mean it was never permanent. Each
          identity records the version it was issued under, so old numbers keep resolving forever. The
          operator has to retype an acknowledgement phrase — deliberately not &quot;yes&quot; — before
          the change is accepted, and the engine refuses a change that would strand the sequence.
        </Explain>
        <Cite>practice_identifier_format, migration 220:39. The built-in fallback is at src/lib/practice/identifier-format.ts:115-120.</Cite>
      </Panel>

      {/* ── VERSION HISTORY OF THAT DEFAULT ──────────────────────────────────────────────────── */}
      <Panel title="How that default has changed (§22)"
        note="practice_identifier_format_history — the effective-dated value history §4 asks for, existing for exactly one setting in the whole product.">
        {d.history.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            {d.historyRead
              ? "The history table answered and holds no row: the format has never been changed since it was seeded."
              : "The history could not be read. That is not \"never changed\"."}
          </p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="w-full min-w-[520px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="py-1.5 pr-3 font-semibold">Version</th>
                  <th className="py-1.5 pr-3 font-semibold">Shape</th>
                  <th className="py-1.5 pr-3 font-semibold">Reason</th>
                  <th className="py-1.5 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map(h => (
                  <tr key={h.version} className="border-b border-gray-100 align-top">
                    <td className="py-2 pr-3 font-bold tabular-nums text-gray-900">v{h.version}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-gray-700">
                      {h.prefix}{h.separator}{"#".repeat(h.digits)}{h.checkDigit ? " + check" : ""}
                    </td>
                    <td className="py-2 pr-3 text-gray-700">{h.reason ?? "—"}</td>
                    <td className="py-2 whitespace-nowrap text-gray-500">{h.at ? h.at.slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Cite>practice_identifier_format_history, migration 220:63.</Cite>
      </Panel>

      {/* ── THE PROVISIONING-TIME DEFAULTS THAT ARE COUNTABLE ────────────────────────────────── */}
      <Panel title="What a new Practice is given at provisioning"
        note="Two of §7's stores permit a row count from this plane and nothing more. A count proves the catalogue is seeded; it says nothing about what is in it.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Onboarding steps in the catalogue</p>
            {d.onboardingSteps === null ? (
              <p className="mt-1 text-[12px] text-[var(--cmp-text-warning)]">Could not be read. That is not an empty catalogue.</p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{d.onboardingSteps.toLocaleString()}</p>
                <p className="text-[11px] text-gray-500">rows in practice_onboarding_step_catalog — the steps a new Practice is taken through</p>
              </>
            )}
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Plan codes available at provisioning</p>
            {d.plans === null ? (
              <p className="mt-1 text-[12px] text-[var(--cmp-text-warning)]">Could not be read. That is not zero plans.</p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{d.plans.toLocaleString()}</p>
                <p className="text-[11px] text-gray-500">rows in practice_plans — codes only; the table carries no price and no currency</p>
              </>
            )}
          </div>
        </div>
        <Explain summary="Why these are counts and not lists">
          Both tables are on the platform-plane allowlist as <em>row count only</em>: no column is
          selected, so this page can prove the catalogue is seeded and cannot show what a step says or
          what a plan permits. The step LABELS and the plan CONTENTS are Practice-plane configuration.
        </Explain>
      </Panel>

      <Warn title="Copied at provisioning, or inherited dynamically? This build cannot tell you.">
        <p>
          §7 requires the two to be distinguished, because they behave in opposite ways when a default
          changes: a copied value keeps the old behaviour and an inherited one moves. The provisioning
          saga WRITES a configuration row per workspace (practice_configuration), which is the copied
          shape — but this plane cannot read that row, so it cannot compare a Practice&apos;s value with
          the default it came from, and cannot tell you which of §7&apos;s three answers — existing
          Practices, future only, or migration — applies to any setting except the identifier format
          above.
        </p>
      </Warn>

      <RungSummary rungs={LADDER} />
      <DomainSections domain={D} refusalWhy={refusalFor("cfg.practice_domain_settings").why} />

      <NotThisModule>
        §23: whether a capability is deployed at all is Releases &amp; Capabilities&apos; answer, not
        this module&apos;s. Provisioning runs and what a failed one left behind are Product
        Operations&apos;.
      </NotThisModule>

      <ReadStamp at={d.generatedAt} />
    </div>
  );
}
