import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { domain, LADDER, refusalFor } from "@/lib/hq/pd-configuration";
import {
  ConfigHeader, Panel, Warn, Explain, DomainSections, RungSummary, NoReadNote, NotThisModule,
} from "../_components/config-ui";

// CPR-PD-011 §15 — AI CONFIGURATION.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE ONE DOMAIN WITH RICH TELEMETRY AND NO CONFIGURATION STORE AT ALL, WHICH IS AN EASY PAIR TO
// CONFUSE. plat_ai_requests records latency, status, model, provider, operation, tokens and an
// estimated cost for every generation — the most metric-dense honest surface in the whole Product
// Director set. It records what AI DID. Nothing anywhere records what AI is CONFIGURED to do: there is
// no model-routing table, no timeout setting, no fallback rule, no confidence or guardrail threshold
// and no per-feature availability switch. Routing and model choice live in code and environment, not in
// a governed setting.
//
// So a screen that put the request ledger under an "AI Configuration" heading would show a busy,
// credible page about a subject it is not about. The ledger belongs to Product Health 008H. This page
// says what §15 asks for and which of it exists, which is almost none of it.
//
// ⚠ AND §15's FIRST LINE IS A GATE: "render only for enabled AI capabilities". That gate is answered by
// Releases & Capabilities, not by this module — and not by counting AI requests, because "no request
// has been made" and "AI is not enabled" are the same empty result.

export const dynamic = "force-dynamic";

const D = domain("ai")!;

const ASKED: { setting: string; exists: boolean; where: string }[] = [
  { setting: "Feature-level AI availability", exists: false, where: "No per-feature AI switch exists as a setting. Whether an AI capability is available at all is Releases & Capabilities' answer." },
  { setting: "Model / provider routing", exists: false, where: "Routing is decided in code at the shared generate() choke point. plat_ai_requests RECORDS the model and provider a call used; nothing declares which it should use." },
  { setting: "Approved model and provider references", exists: false, where: "No approved-model register exists. There is no list a change could be validated against, which is what §19's 'references must point to valid canonical entities' would need." },
  { setting: "Timeout", exists: false, where: "A timeout lands in the ledger as status 'error' with an error string. The threshold that produced it is not a stored setting." },
  { setting: "Fallback behaviour", exists: false, where: "No fallback event is recorded and no fallback rule is stored. The ledger's 'not_configured' status is a configuration STATE — AI is off — and not a fallback." },
  { setting: "Confidence / guardrail thresholds", exists: false, where: "No guardrail layer records a decision, so no threshold governs one. The ledger's 'refusal' status is the model declining, which is a different event from a guardrail trip." },
  { setting: "User-facing AI preference defaults", exists: false, where: "Practitioner preferences live in practice_user_preference on the Practice plane; no AI default among them is expressed as a product setting." },
];

export default async function Page() {
  await requireHqCapability("hq.practice.configuration.view");

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="AI Configuration"
        purpose="AI feature behaviour, routing, timeout, fallback and guardrail thresholds — what §15 asks to be governable, and what this product currently decides in code instead."
        spec="CPR-PD-011 §15"
      />

      <Warn title="AI is instrumented. AI is not configured.">
        <p>
          Every AI generation is recorded with its latency, status, model, provider, operation and an
          estimated cost — genuinely the best-instrumented corner of this product.{" "}
          <span className="font-semibold">
            None of that is configuration: it records what AI did, never what AI was told to do.
          </span>{" "}
          There is no routing table, no timeout setting, no fallback rule and no threshold store, so
          every setting §15 names is decided in code and environment. Putting the request ledger under
          this heading would produce a busy, credible page about a different subject —{" "}
          <Link href="/super-admin/pd/health/ai" className="font-semibold text-teal-700 hover:underline">
            AI Health
          </Link>{" "}
          is where it belongs.
        </p>
      </Warn>

      <Panel title="What §15 asks to be governable, and what exists"
        note="Seven settings. Each row says where the decision is actually made today.">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[600px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-500">
                <th className="py-1.5 pr-3 font-semibold">Setting</th>
                <th className="py-1.5 pr-3 font-semibold">Governed</th>
                <th className="py-1.5 font-semibold">Where the decision is made</th>
              </tr>
            </thead>
            <tbody>
              {ASKED.map(a => (
                <tr key={a.setting} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-3 font-semibold text-gray-900">{a.setting}</td>
                  {/* ⚠ READ FROM THE ROW, NOT HARD-CODED. Every row answers "no" today; typing the
                      word instead of reading the field would let the table and its data drift apart
                      the moment one of them became true, and the drift would read as a governed
                      setting that is not governed. */}
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${a.exists ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>
                      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${a.exists ? "bg-[var(--cmp-text-success)]" : "bg-[var(--cmp-text-critical)]"}`} />
                      {a.exists ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="py-2 leading-relaxed text-gray-700">{a.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="§15's own gate, and why a request count cannot answer it"
        note='"Render only for enabled AI capabilities."'>
        <p className="text-[12px] leading-relaxed text-gray-700">
          The obvious implementation is to count AI requests and hide the page when there are none. That
          is wrong in the ordinary way absences are wrong here:{" "}
          <span className="font-semibold">
            &quot;AI is not enabled&quot; and &quot;nobody has used AI yet&quot; produce the same empty
            result and are opposite facts
          </span>
          . Whether an AI capability is available at all is Releases &amp; Capabilities&apos; answer, and
          this page therefore renders for anyone who may view configuration and states its emptiness
          rather than hiding itself and implying a decision.
        </p>
        <Explain summary="The one enablement signal that does exist, and what it can and cannot say">
          The request ledger carries a <span className="font-mono text-[11px]">not_configured</span>{" "}
          status, which distinguishes &quot;AI is off&quot; from &quot;AI is broken&quot; for a call that
          was actually attempted. That is a real and useful distinction — and it is a property of an
          attempt, so it says nothing at all until somebody tries. It also attributes to platform
          tenancy rather than to a Practice workspace, so it could not tell you whether AI is enabled for
          a particular Practice even if the counts were here.
        </Explain>
      </Panel>

      <Panel title="What §15 requires of a change, if any of this became editable"
        note="Two of the four are about behaviour under failure, which is where AI configuration is most likely to hurt.">
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
          <li><span className="font-semibold text-gray-900">Never expose provider secrets or unrestricted prompt internals.</span> §31 puts the first as a hard non-goal; a routing setting that named a key would breach it.</li>
          <li><span className="font-semibold text-gray-900">Safety-critical AI behaviour may need specialist or governance approval.</span> The registry has the sensitivity vocabulary and no approval class, so the requirement has half a mechanism.</li>
          <li><span className="font-semibold text-gray-900">Changes must be observable through AI Health and auditable.</span> The ledger would show the effect of a routing change; nothing would record the change itself, because no AI setting has an audit trail.</li>
          <li><span className="font-semibold text-gray-900">AI must degrade gracefully without destabilizing core non-AI workflows.</span> This is a property of the code path, not of a setting — and the setting most able to break it is a timeout, which is exactly the one with no store.</li>
        </ul>
      </Panel>

      <RungSummary rungs={LADDER} />
      <DomainSections domain={D} refusalWhy={refusalFor("cfg.practice_domain_settings").why} />

      <NotThisModule>
        §23 and §24: AI latency, error and refusal rates, per-feature health and cost are Product
        Health&apos;s (008H). Whether an AI capability is deployed and entitled is Releases &amp;
        Capabilities&apos;. AI governance and risk acceptance are Governance &amp; Risk&apos;s.
      </NotThisModule>

      <NoReadNote why="No AI configuration store exists to read, and the AI request ledger is Product Health's subject rather than this module's." />
    </div>
  );
}
