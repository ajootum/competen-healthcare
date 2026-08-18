import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadConfigMarkets } from "@/lib/hq/pd-configuration";
import { subSpec, structureScore, refusalFor } from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Fact, Panel, Absent, AbsentList, Warn, Explain, Cite, StateModel, Structure,
  Questions, ReadFailures, ReadStamp, NotThisModule,
} from "../_components/release-ui";

// CPR-PD-012G — MARKET AVAILABILITY.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE MOST DANGEROUS PAGE IN THIS MODULE, AND THE TRAP IS ONE WORD.
//
// "Markets a capability is available in" and "markets the estate is in" are the same list of country
// codes rendered identically, and they are opposite facts. The first is a governed availability
// decision with an approval, an effective date and a readiness checklist behind it. The second is a
// property of whichever practices somebody happened to provision.
//
// This product has the second and cannot have the first: nothing anywhere maps a capability to a
// market. 012G §6 is explicit — market availability is EXPLICIT and never inferred from locale or
// currency — so putting the country list under an "available in" heading would be precisely the
// inference the specification forbids, dressed as data.
//
// So the real market list is shown, because it is genuinely useful and it is where a market
// availability decision would have to land, under a heading that says what it is.

export const dynamic = "force-dynamic";

const SPEC = subSpec("markets");

const READINESS = [
  { area: "Localization", detail: "Language, formats and content for the market." },
  { area: "Communications", detail: "Message templates and delivery routes that work in the market." },
  { area: "Commercial", detail: "A plan and a price the market can actually buy." },
  { area: "Support", detail: "Cover, hours and an escalation path for the market." },
  { area: "Privacy and security", detail: "Residency, retention and consent obligations for the market." },
  { area: "Regulatory", detail: "Clinical and professional obligations that apply in the market." },
];

export default async function Page() {
  await requireHqCapability("hq.practice.releases.view");
  const m = await loadConfigMarkets(createAdminClient());

  const score = structureScore(SPEC);

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Market Availability"
        purpose="The markets Competen Practice is actually operating in, and the per-market availability decision this product cannot currently express."
        spec="CPR-PD-012G · CPR-PD-012 §12"
      />

      <Warn title="There is no per-market availability store, so a capability cannot be switched on for one market and not another">
        <p>
          §12 asks for capability availability held per approved market, with effective dates, a state,
          a readiness checklist and a governed suspension or withdrawal.{" "}
          <span className="font-semibold">
            Nothing in this product connects a capability to a market at all.
          </span>{" "}
          Every practice gets the same twelve capabilities wherever it is, and the only way to withdraw
          any of them from a country would be to withdraw them from everybody.
        </p>
        <p className="mt-1.5">
          The country list below is real and is a property of the PRACTICES — where they are, not where
          anything is permitted. §12 is explicit that market availability must never be inferred from
          locale or currency, so it is not presented as an availability decision here.
        </p>
        <Cite>
          practice_workspace.country (migration 191:41) and practice_location.country describe the
          practice. No migration creates a market_availability, market_readiness, market_rollout or
          market_suspension table. plat_feature_flag_assignments has a `country` scope (042:101) — on
          the hospital estate plane, for estate flags, reaching no Practice capability.
        </Cite>
      </Warn>

      <ReadFailures problems={m.problems} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Markets the estate is in"
          value={m.markets.length === 0 && m.problems.length > 0 ? "Could not be read" : String(m.markets.length)}
          note={
            m.problems.length > 0
              ? "The market scan did not complete. That is not \"no markets\"."
              : m.estateTotal === null
                ? "distinct countries across the practices; the estate total could not be read"
                : `distinct countries across ${m.estateTotal.toLocaleString()} practice(s)`
          } />
        <Fact label="Markets with an availability decision" value="None"
          note="A measured statement about the schema: there is nowhere for such a decision to be recorded, so none exists for any market." />
        <Fact label="Prescribed elements on this page" value={`${score.yes + score.partial} of ${score.total}`}
          note={`${score.yes} in full, ${score.partial} in part, ${score.no} not shown — scored against 012G §3 below`} />
      </div>

      {/* ── THE REAL MARKETS ─────────────────────────────────────────────────────────────────────── */}
      <Panel title="Markets the estate is in"
        note="Distinct country values across every Practice workspace — the same scan the Practices register derives its market filter from, so the two lists cannot disagree. This is where a market availability decision would have to land.">
        {m.markets.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-500">
            {m.problems.length > 0
              ? "The market scan did not complete — see the read failures above. That is not \"no markets\"."
              : "The scan answered and found no country on any practice. "
                + (m.estateTotal === null
                  ? "The estate total could not be read."
                  : `With ${m.estateTotal.toLocaleString()} practice(s) in the estate, that is a measured empty set.`)}
          </p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2">
              {m.markets.map(c => (
                <li key={c}>
                  <Link href={`/super-admin/pd/practices?market=${encodeURIComponent(c)}`}
                    className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-mono text-[12px] font-semibold text-gray-800 transition hover:border-teal-600 hover:bg-teal-50/30">
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
              {m.markets.length} market{m.markets.length === 1 ? "" : "s"}. Every capability is available
              in all of them, because none of them can be treated differently.
              {m.truncated && " ⚠ The scan hit its row ceiling, so a market beyond it would not appear."}
            </p>
          </>
        )}
        <Explain summary="Why there is no capability column beside each market">
          A column of ticks would be the clearest possible statement that a per-market decision exists.
          Twelve identical ticks in every row would be true today and would teach a reader that the
          matrix is real and currently uniform — so the day somebody needed to withdraw a capability
          from one country, they would look for a control that was never there.
        </Explain>
      </Panel>

      {/* ── THE READINESS §12 ASKS FOR ──────────────────────────────────────────────────────────── */}
      <Panel title="Market launch readiness (§12), and what is recorded for each"
        note="§12 links market readiness to localization, communications, commercial, support, privacy and regulatory obligations. Each is a real obligation; none has an evidence record per market.">
        <ul className="flex flex-col">
          {READINESS.map(r => (
            <li key={r.area} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-gray-100 py-1.5 first:pt-0 last:border-0 last:pb-0">
              <span className="text-[12px] font-semibold text-gray-900">{r.area}</span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-[var(--cmp-text-critical)]">
                <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--cmp-text-critical)]" />
                No evidence per market
              </span>
              <span className="w-full text-[12px] leading-relaxed text-gray-600">{r.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
          ⚠ §10 of 012G: stale market evidence must make readiness Unknown or Blocked. With no evidence
          at all, every market&apos;s readiness is Unknown — and Unknown is never promoted to Ready
          anywhere in this module.
        </p>
      </Panel>

      {/* ── THE STATE MODEL ──────────────────────────────────────────────────────────────────────── */}
      <Panel title="The market availability states 012G prescribes"
        note="Six states, and what in this product could hold each of them.">
        <StateModel rows={SPEC.states} holdLabel="Can a market hold this state?" />
      </Panel>

      <Absent {...(() => { const x = refusalFor("rel.market_availability"); return { what: x.label, why: x.why }; })()} />

      <Panel title="What 012G §3 asks this screen to show"
        note="Eight prescribed elements, scored against what is on the page.">
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "Every capability is available in every market the estate operates in, because no capability can be limited to a market. The countries are listed above.",
        "All of it, for every market: none of the six readiness obligations has a per-market evidence record.",
        "Nothing is effective-dated, because nothing is decided. There is no date to show.",
        "No. A market cannot be suspended or withdrawn separately from the product as a whole — the only reversal available closes the product's front door for everybody.",
      ]} />

      <Panel title="Not shown, and why">
        <AbsentList items={["rel.market_availability", "rel.availability_decision", "rel.rollout_stage"].map(refusalFor)} />
      </Panel>

      <NotThisModule>
        Which markets the estate is in, as an analytical question, belongs to{" "}
        <Link href="/super-admin/pd/intelligence/markets" className="font-semibold text-teal-700 hover:underline">Product Intelligence</Link>;
        the locale, timezone and format SETTINGS for a market belong to Product Configuration. This page
        answers only where a capability is permitted — and today the answer is everywhere or nowhere.
      </NotThisModule>

      <ReadStamp at={m.generatedAt}
        note="The market list is counted from the live database at request time. Everything else on this page is a statement about the schema." />
    </div>
  );
}
