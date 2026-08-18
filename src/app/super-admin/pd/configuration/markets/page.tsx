import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadConfigMarkets, domain, LADDER, refusalFor } from "@/lib/hq/pd-configuration";
import { absenceSentence } from "@/lib/hq/pd-metric-registry";
import {
  ConfigHeader, Panel, Absent, Warn, Explain, Cite, DomainSections, RungSummary,
  ReadFailures, ReadStamp, NotThisModule,
} from "../_components/config-ui";

// CPR-PD-011 §14 — MARKET & LOCALIZATION.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE MOST DANGEROUS PAGE IN THIS MODULE, AND THE TRAP IS ONE WORD.
//
// "Markets configured" and "markets that exist" are the same list rendered identically and opposite
// facts. The first claims a governed override layer with approved country-specific behaviour and an
// effective date. The second is a property of the practices somebody provisioned. This product has the
// second and cannot have the first: `market` is not a legal value of workspace_config_overrides.
// scope_type (migration 076:20-21) and applies() has no branch that could match one, so no market
// override has ever been written and none could be evaluated if it were.
//
// So this page shows the real market list — it is genuinely useful, and it is where a market
// configuration would have to land — under a heading that says what it is, with the configured-markets
// tile refused outright rather than filled with this figure under a better-sounding label.

export const dynamic = "force-dynamic";

const D = domain("markets")!;

export default async function Page() {
  await requireHqCapability("hq.practice.configuration.view");
  const m = await loadConfigMarkets(createAdminClient());

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="Market & Localization"
        purpose="Country and market, locale, timezone and formats — the markets Competen Practice is actually in, and the market-override layer this product does not have."
        spec="CPR-PD-011 §14"
      />

      <ReadFailures problems={m.problems} />

      <Warn title="No market override exists, and none could">
        <p>
          §14 asks for approved, effective-dated, market-specific behaviour with deterministic fallback.
          The configuration engine recognises exactly six scopes — platform, tenant, hospital, unit, role
          and user.{" "}
          <span className="font-semibold">
            Market is not one of them, so nothing can write a market override and nothing could evaluate
            one.
          </span>{" "}
          Everything below is the market a practice IS in — its country and timezone — which is a fact
          about the estate and not a configured layer.
        </p>
        <Cite>
          workspace_config_overrides.scope_type is constrained to those six by migration 076:20-21, and
          applies() at src/lib/config/workspace-config.ts:16-24 has no branch that could match a market.
          The estate figures below are read from practice_workspace.country and .timezone.
        </Cite>
      </Warn>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Markets the estate is in"
          note="Distinct country values across every Practice workspace. The same scan the Practices register derives its market filter from, so the two lists cannot disagree.">
          {m.markets.length === 0 ? (
            <p className="text-[12px] text-gray-500">
              {m.problems.length > 0
                ? "The market scan did not complete — see the read failures above. That is not \"no markets\"."
                : "The scan answered and found no country value on any practice. With "
                  + (m.estateTotal === null ? "an unreadable estate count" : `${m.estateTotal.toLocaleString()} practice(s) in the estate`)
                  + ", that is a measured empty set."}
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
                {m.markets.length} market{m.markets.length === 1 ? "" : "s"} across{" "}
                {m.estateTotal === null ? "an estate whose total could not be read" : `${m.estateTotal.toLocaleString()} practice(s)`}.
                {m.truncated && " ⚠ The scan hit its 1,000-row ceiling, so this is a page of the estate and a market beyond it would not appear."}
              </p>
              <Explain summary="Why there is no practice count beside each market">
                The Practices register already counts practices per market, server-side, with its own
                filters. Recounting them here would eventually print a different number from the same
                database and leave a reader with no way to tell which was wrong. Each market above links
                to that register, filtered.
              </Explain>
            </>
          )}
        </Panel>

        <Panel title="Timezones in use"
          note={`IANA zones seen on the ${m.pageSize} most recent practices — a sample of the estate, not a scan of it.`}>
          {m.timezonesOnPage.length === 0 ? (
            <p className="text-[12px] text-gray-500">No timezone value appeared on the practices this page read.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {m.timezonesOnPage.map(t => (
                <li key={t} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-mono text-[11px] text-gray-700">{t}</li>
              ))}
            </ul>
          )}
          <Explain summary="Why this is a sample and the market list is not">
            The market list comes from a dedicated column scan across the estate. The timezone set is
            derived from the page of practices the register returned, because no separate timezone scan
            exists — so a zone used only by an older practice would not appear here. Saying so is the
            difference between a sample and a wrong answer.
          </Explain>
        </Panel>
      </div>

      <Panel title="Not shown, and why"
        note="§6's posture row asks for 'markets configured'. It is refused, and the reason is the one above rather than a missing query.">
        <Absent what="Markets configured" why={absenceSentence("cfg.markets_configured")} />
      </Panel>

      <Panel title="Locale, currency and format (§14)"
        note="The canonical identifiers §14 requires, and where each one actually lives.">
        <ul className="flex flex-col gap-1.5 text-[12px] leading-relaxed text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">Country (ISO)</span> — on{" "}
            <span className="font-mono text-[11px]">practice_workspace.country</span>, readable here, shown above.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Timezone (IANA)</span> — on{" "}
            <span className="font-mono text-[11px]">practice_workspace.timezone</span>, readable here, sampled above.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Locale and date format</span> — on{" "}
            <span className="font-mono text-[11px]">practice_configuration</span>, per workspace, outside this plane.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Currency display</span> — ⚠ there is no currency
            column on any Practice plan or price record, and no currency appears in this schema for the
            landlord relationship at all. §14&apos;s currency-display setting has nothing to display.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Legal and regulatory applicability</span> — §14 is
            explicit that it must NOT be inferred from locale. Compliance &amp; Obligations remains
            authoritative and this page infers nothing.
          </li>
        </ul>
      </Panel>

      <RungSummary rungs={LADDER} />
      <DomainSections domain={D} refusalWhy={refusalFor("cfg.practice_domain_settings").why} />

      <NotThisModule>
        §23: whether a feature is available in a market at all is Releases &amp; Capabilities&apos;
        answer. §24: market-level product metrics are Product Intelligence&apos;s.
      </NotThisModule>

      <ReadStamp at={m.generatedAt} />
    </div>
  );
}
