/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { loadBudgets, loadEvaluations, loadModelRoutingView, loadPolicies, loadRates, pendingDrafts } from "@/lib/ai/fair-use-admin";
import { aiFairUseEnabled } from "@/lib/ai/allowance";
import { RISK_TIER_LABEL, type RiskTier } from "@/lib/ai/clinical-risk";
import { PolicyEditor, PublishPolicies, RateForm } from "./_components/FairUseControls";
import { BudgetCreate, BudgetPolicyEditor, BudgetStatus, RoutingEditor } from "./_components/BudgetControls";
import { ModelRoutingEditor } from "./_components/ModelRoutingControls";
import { AI_PROVIDERS, availableProviders, primaryProvider, providerModels } from "@/lib/ai/config";

// /super-admin/ai/fair-use -- COMPETEN-AI-FAIR-USE-01 s12. Holdings AI usage governance, no code.
//
// Guarded by hq.platform.ai.manage (migration 410, the Platform Director). Prices with their sources, the reference rate, the value of
// one Competen AI Allowance Unit and clinical model eligibility are versioned history rows (410, 411). Each product's AI policy -- allowance, reserve,
// renewal, rolling window, service-level thresholds, per-activity model tier, output size and count cap, and the
// messages people see -- goes through the CONFIG-002 engine: draft, publish as a version, audited.
//
// ⚠ IT DOES NOT SWITCH METERING ON. The ai_fair_use flag is the owner's. The page says which state it is in.
// ⚠ NO CREDENTIALS. Provider keys stay in the deployment environment.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI fair use" };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "open");

export default async function FairUsePage() {
  const ctx = await requireHqCapability("hq.platform.ai.manage");
  const [rates, policies, on, evaluations, budgets, drafts, modelRouting] = await Promise.all([loadRates(ctx.admin), loadPolicies(ctx.admin), aiFairUseEnabled(ctx.admin), loadEvaluations(ctx.admin), loadBudgets(ctx.admin), pendingDrafts(ctx.admin), loadModelRoutingView(ctx.admin)]);
  // Whether each provider's key is present in this deployment: a yes or no, never the key.
  const keyed = Object.fromEntries(AI_PROVIDERS.map(p => [p, availableProviders().includes(p)])) as Record<(typeof AI_PROVIDERS)[number], boolean>;
  const primary = primaryProvider();
  // Every pending draft in the scope -- product policies, assistant profiles, budgets, routing -- publishes together.
  const pending = drafts ?? (policies ?? []).filter(p => p.pending).length;

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings</p>
        <h1 className="text-xl font-bold text-gray-900">AI fair use</h1>
        <p className="mt-1 text-sm text-gray-600">
          What AI costs, in one unit for every product, and how much each product includes. A person keeps access to everything they have
          saved whatever their allowance. Provisional figures stay provisional until pilot evidence calibrates them.
        </p>
        <p className={`mt-2 rounded-lg border px-3 py-2 text-[13px] ${on ? "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "border-[var(--cmp-color-information)] bg-[var(--cmp-surface-information)] text-blue-900"}`}>
          Metering is {on ? "ON on this environment: AI requests reserve and settle against these policies." : "OFF on this environment: the existing hourly limits apply, and nothing here affects anyone yet."}
        </p>
      </header>

      {rates === null || policies === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          AI fair-use configuration could not be read just now (or migrations 410 and 411 are not applied on this environment).
        </p>
      ) : (
        <>
          <section aria-labelledby="pr-h" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="pr-h" className="text-[16px] font-bold text-gray-900">Provider prices</h2>
            <p className="text-[13px] text-gray-600">USD per million tokens, with where each price comes from. A model with no price in force cannot be used while metering is on.</p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[720px] text-left text-[13px]">
                <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500"><th scope="col" className="py-1.5">Provider · model</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Other / request</th><th scope="col">Price</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Source</th></tr></thead>
                <tbody>{rates.price.map((r: any) => (
                  <tr key={r.id} className={`border-b border-gray-100 ${r.effective_to ? "text-gray-500" : "text-gray-900"}`}>
                    <th scope="row" className="py-1.5 font-normal">{r.provider} · {r.model_prefix}</th><td>{Number(r.input_per_mtok_usd)}</td><td>{Number(r.output_per_mtok_usd)}</td><td>{Number(r.extra_per_request_usd)}</td>
                    <td>{r.source_kind === "negotiated" ? "Negotiated" : "List"}{r.price_version ? ` · ${r.price_version}` : ""}</td><td>{fmt(r.effective_from)}</td><td>{fmt(r.effective_to)}</td>
                    <td className="break-all">{r.source_ref ?? <span className="text-amber-900">No source recorded</span>}{r.note ? ` · ${r.note}` : ""}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <div className="mt-3"><RateForm kind="price" /></div>
          </section>

          <section aria-labelledby="cu-h" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="cu-h" className="text-[16px] font-bold text-gray-900">Allowance unit and reference rate</h2>
            <p className="text-[13px] text-gray-600">What one allowance unit is worth, and the reference rate that turns a provider&apos;s USD charge into it. A request keeps the rate in force when it was reserved.</p>
            <ul className="mt-2 space-y-1 text-[13px] text-gray-800">
              {rates.basis.map((r: any) => <li key={r.id} className={r.effective_to ? "text-gray-500" : ""}>1 CAU = {Number(r.currency_per_cau)} {r.currency} · from {fmt(r.effective_from)} to {fmt(r.effective_to)}{r.note ? ` · ${r.note}` : ""}</li>)}
              {rates.fx.map((r: any) => (
                <li key={r.id} className={r.effective_to ? "text-gray-500" : ""}>
                  1 USD = {Number(r.per_usd)} {r.currency} · {r.update_kind === "placeholder" || (!r.published_on && !r.source_ref)
                    ? <span className="font-semibold text-amber-900">placeholder, not an official rate</span>
                    : <>published {r.published_on} ({r.update_kind === "exceptional" ? "exceptional update" : "monthly"}) at <span className="break-all">{r.source_ref}</span></>}
                  {" "}· in force from {fmt(r.effective_from)} to {fmt(r.effective_to)}{r.note ? ` · ${r.note}` : ""}
                </li>))}
              {rates.basis.length === 0 && <li className="text-amber-900">No allowance-unit value is set: nothing can be reserved while metering is on.</li>}
              {rates.fx.length === 0 && <li className="text-amber-900">No reference rate is set: nothing can be reserved while metering is on.</li>}
            </ul>
            <div className="mt-3 space-y-2"><RateForm kind="basis" /><RateForm kind="fx" /></div>
          </section>

          <section aria-labelledby="ev-h" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="ev-h" className="text-[16px] font-bold text-gray-900">Model evaluations</h2>
            <p className="text-[13px] text-gray-600">
              Evidence for the reviewer: each candidate model answered a focused clinical and educational set with the production prompt. A score
              screens the answers, it does not judge them, and a proposal is not a decision. Read the answers, then record your decision under Clinical
              model eligibility, citing the run as its evidence.
            </p>
            {evaluations === null ? (
              <p className="mt-2 text-[13px] text-amber-900">Evaluations could not be read just now (or migration 419 is not applied on this environment).</p>
            ) : evaluations.length === 0 ? (
              <p className="mt-2 text-[13px] text-gray-700">No evaluation has been recorded.</p>
            ) : evaluations.map(run => (
              <div key={run.id} className="mt-3 rounded-lg border border-gray-100 p-3">
                <p className="text-[13px] font-semibold text-gray-900">{run.label ?? "Evaluation"} · set {run.version} · {fmt(run.createdAt)}</p>
                <p className="text-[12.5px] text-gray-600">Cite as evidence: <span className="font-mono">eval-run:{run.id}</span>{run.note ? ` · ${run.note}` : ""}</p>
                <div className="overflow-x-auto">
                  <table className="mt-2 w-full min-w-[640px] text-left text-[13px]">
                    <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500"><th scope="col" className="py-1.5">Model (version returned)</th><th scope="col">Items passed</th><th scope="col">Cost (USD)</th><th scope="col">Proposed, not decided</th></tr></thead>
                    <tbody>{run.models.map(m => (
                      <tr key={m.model} className="border-b border-gray-100 align-top">
                        <th scope="row" className="py-1.5 font-normal">{m.provider} · {m.model}{m.returned.length ? <span className="block text-[12px] text-gray-500">{m.returned.join(", ")}</span> : null}</th>
                        <td>{m.passed} of {m.of}</td><td>{m.costUsd.toFixed(4)}</td>
                        <td>{m.proposed ? `Up to ${RISK_TIER_LABEL[m.proposed as RiskTier]?.toLowerCase()}` : <span className="text-amber-900">No clinical tier</span>}{m.rationale ? <span className="block text-[12px] text-gray-600">{m.rationale}</span> : null}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
                {run.models.map(m => (
                  <details key={m.model} className="mt-2 text-[13px]">
                    <summary className="cursor-pointer font-semibold text-gray-800">Read {m.model}&apos;s answers</summary>
                    <ul className="mt-1 space-y-2">
                      {m.items.map(it => (
                        <li key={it.code} className="rounded-lg border border-gray-100 p-2">
                          <p className="font-mono text-[12px] text-gray-600">{it.code} · {RISK_TIER_LABEL[it.tier as RiskTier] ?? it.tier} · {it.status} · {it.passed ? "rubric passed" : "rubric not passed"}{it.score === null ? "" : ` (${Math.round(it.score * 100)}%)`}</p>
                          {Array.isArray(it.rubric?.required) && (
                            <p className="text-[12px] text-gray-600">
                              {it.rubric.required.filter((r: any) => !r.met).map((r: any) => `missing: ${r.label}`).concat((it.rubric.forbidden ?? []).filter((f: any) => f.found).map((f: any) => `flagged: ${f.label}`)).join(" · ") || "every rubric element present"}
                            </p>
                          )}
                          <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-gray-900">{it.output ?? "No answer was returned."}</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            ))}
          </section>

          <section aria-labelledby="el-h" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="el-h" className="text-[16px] font-bold text-gray-900">Clinical model eligibility</h2>
            <p className="text-[13px] text-gray-600">
              Which model may serve each activity, and up to which clinical risk tier. Eligibility rests on a recorded evaluation decision, never on price
              or tier. A clinical request whose tier no eligible model covers is refused. Standard educational requests need no decision.
            </p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[680px] text-left text-[13px]">
                <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500"><th scope="col" className="py-1.5">Product · activity</th><th scope="col">Provider · model</th><th scope="col">Decision</th><th scope="col">Evidence</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
                <tbody>{rates.eligibility.map((r: any) => (
                  <tr key={r.id} className={`border-b border-gray-100 ${r.effective_to ? "text-gray-500" : "text-gray-900"}`}>
                    <th scope="row" className="py-1.5 font-normal">{r.product} · <span className="font-mono">{r.activity}</span></th><td>{r.provider} · {r.model_prefix}</td>
                    <td>{r.eligible ? `Eligible up to ${RISK_TIER_LABEL[r.max_risk_tier as RiskTier]?.toLowerCase() ?? "clinical educational"}` : <span className="text-amber-900">Not eligible</span>}</td>
                    <td className="break-all">{r.evidence_ref ?? r.note ?? "Evaluation pending"}</td><td>{fmt(r.effective_from)}</td><td>{fmt(r.effective_to)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            {rates.eligibility.length === 0 && <p className="mt-2 text-[13px] text-amber-900">No eligibility is recorded: every clinically sensitive activity is refused while metering is on.</p>}
            <div className="mt-3"><RateForm kind="eligibility" /></div>
          </section>

          {policies.map(p => (
            <section key={p.product} aria-labelledby={`po-${p.product}`} className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 id={`po-${p.product}`} className="text-[16px] font-bold capitalize text-gray-900">{p.product} AI policy</h2>
              <p className="text-[13px] text-gray-600">In force: {p.publishedAt ? `published ${fmt(p.publishedAt)}` : "the default, which allows nothing"}{p.pending ? " · an unpublished draft is waiting" : ""}.</p>
              <div className="mt-3"><PolicyEditor product={p.product} initial={(p.draft ?? p.published) as any} /></div>
            </section>
          ))}

          <section aria-labelledby="bu-h" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="bu-h" className="text-[16px] font-bold text-gray-900">Budgets: who pays</h2>
            <p className="text-[13px] text-gray-600">
              One AI ledger, three owners. A person&apos;s own learning is charged to their allowance. Shared content work -- screening, refining and
              developing shared cases -- is charged to a platform budget, or to an institution budget where an authorised institution funds it. The
              server decides which from the workflow, never the browser. A budget running out pauses only its own work: students&apos; learning is
              unaffected.
            </p>
            {budgets === null ? (
              <p className="mt-2 text-[13px] text-amber-900">Budgets could not be read just now (or migration 421 is not applied on this environment).</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="mt-2 w-full min-w-[640px] text-left text-[13px]">
                    <caption className="sr-only">AI spend this month by owner</caption>
                    <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500"><th scope="col" className="py-1.5">Owner (since {budgets.report.since.slice(0, 10)})</th><th scope="col">Requests</th><th scope="col">Provider spend (USD, measured)</th><th scope="col">Allowance used (CAU)</th><th scope="col">Awaiting reconciliation</th></tr></thead>
                    <tbody>{budgets.report.byOwner.map(o => (
                      <tr key={o.ownerType} className="border-b border-gray-100"><th scope="row" className="py-1.5 font-normal capitalize">{o.ownerType}</th><td>{o.requests}</td><td>{o.costUsd.toFixed(4)}</td><td>{o.cau.toFixed(2)}</td><td>{o.unreconciled}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                {budgets.budgets.length === 0 && <p className="mt-2 text-[13px] text-gray-700">No budget exists. Platform and institution AI work is refused until one is created, funded by a published policy, and assigned to the work.</p>}
                {budgets.budgets.map(b => (
                  <div key={b.id} className="mt-3 rounded-lg border border-gray-100 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[13.5px] font-semibold text-gray-900">{b.label} <span className="font-mono text-[12px] text-gray-500">{b.code}</span></p>
                      <BudgetStatus id={b.id} status={b.status} />
                    </div>
                    <p className="text-[12.5px] text-gray-600">
                      {b.ownerType === "institution" ? `Institution ${b.institutionRef} · funding: ${b.fundingRef}` : "Platform"} · funds {b.product} · {b.status}
                      {" · "}this month: {b.month ? `${b.month.used.toFixed(2)} used + ${b.month.reserved.toFixed(2)} held of ${b.month.included.toFixed(2)} CAU` : "no request yet"}
                      {b.month?.pct !== null && b.month?.pct !== undefined && b.month.pct >= b.policy.alertAtPct ? <span className="ml-1 font-semibold text-amber-900">· alert: {b.month.pct}% used</span> : null}
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[13px] font-semibold text-gray-800">Policy{b.draft ? " (an unpublished draft is waiting)" : ""}</summary>
                      <div className="mt-2"><BudgetPolicyEditor code={b.code} initial={(b.draft ?? b.policy) as any} /></div>
                    </details>
                  </div>
                ))}
                <div className="mt-4"><p className="text-[13px] font-semibold text-gray-800">Create a budget</p><div className="mt-1"><BudgetCreate /></div></div>
                <div className="mt-4">
                  <p className="text-[13px] font-semibold text-gray-800">Which budget funds which work{budgets.routingDraft ? " (an unpublished draft is waiting)" : ""}</p>
                  <div className="mt-1"><RoutingEditor initial={(budgets.routingDraft ?? budgets.routing) as Record<string, string>} budgets={budgets.budgets} /></div>
                </div>
              </>
            )}
          </section>

          <section aria-labelledby="route-h" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="route-h" className="text-[16px] font-bold text-gray-900">Providers and model routing</h2>
            <p className="mt-1 text-[13px] text-gray-600">Which AI provider and model serve each tier and activity, with the alternatives used when the primary is unavailable. Anthropic, OpenAI and Gemini run through the same gateway and the same fair-use engine. Keys stay in the deployment.</p>
            {modelRouting === null ? (
              <p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">The routing could not be read just now.</p>
            ) : (
              <div className="mt-3">
                {!modelRouting.published.published && <p className="mb-2 text-[13px] text-gray-700">Not published: requests use the deployment&apos;s primary provider ({primary ?? "none"}).</p>}
                {modelRouting.draft && <p className="mb-2 text-[13px] text-amber-900">An unpublished draft is waiting.</p>}
                <ModelRoutingEditor initial={(modelRouting.draft ?? modelRouting.published) as never} keyed={keyed} primary={{ provider: primary, models: primary ? providerModels(primary) : null }} />
              </div>
            )}
          </section>

          <section aria-labelledby="pub-h" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="pub-h" className="text-[16px] font-bold text-gray-900">Publish</h2>
            <PublishPolicies pending={pending} />
          </section>
        </>
      )}
    </div>
  );
}
