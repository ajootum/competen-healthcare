import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { caseIntelligence, type Measured } from "@/lib/cases/analytics";
import { windowRange } from "@/lib/cases/studio";
import { input, primary } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";

// /super-admin/cases/intelligence -- Case Intelligence (COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s11). Guarded by
// hq.quality.case.publish. Structured records only, no AI.
//
// ⚠ MEASURED IS NOT ESTIMATED. Spend is what the ledger settled. The avoided cost is an estimate, shown apart with
// its basis. Where nothing measured a figure, the page says "Not measured" and why -- never a zero.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Case intelligence" };

const cau = (n: number) => `${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })} CAU`;
const usd = (n: number) => `US$${n.toLocaleString("en-GB", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
function Spend({ m }: { m: Measured }) {
  return m.measured ? <span>{cau(m.cau)} · {usd(m.usd)} · {m.requests} request{m.requests === 1 ? "" : "s"}</span> : <span className="italic text-gray-600">Not measured: {m.reason}</span>;
}
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 py-1.5 text-[13.5px]"><dt className="text-gray-600">{k}</dt><dd className="text-right font-medium text-gray-900">{children}</dd></div>;
}

export default async function CaseIntelligencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireHqCapability("hq.quality.case.publish");
  const sp = await searchParams;
  const window = (["24h", "7d", "30d", "custom"].includes(sp.window ?? "") ? sp.window : "30d") as "24h" | "7d" | "30d" | "custom";
  const range = windowRange({ window, from: sp.from, to: sp.to });
  const ci = range ? await caseIntelligence(ctx.admin, range) : null;
  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Clinical content</p>
        <h1 className="text-xl font-bold text-gray-900">Case intelligence</h1>
        <p className="mt-1 text-sm text-gray-600">What the case pipeline produced and what its AI cost, from stored records. Measured spend and estimated savings are kept apart.</p>
      </header>
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <label className="text-[12.5px] text-gray-700">Period<select name="window" defaultValue={window} className={`${input} ml-1`}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom</option></select></label>
        <label className="text-[12.5px] text-gray-700">From<input type="date" name="from" defaultValue={sp.from ?? ""} className={`${input} ml-1`} /></label>
        <label className="text-[12.5px] text-gray-700">To<input type="date" name="to" defaultValue={sp.to ?? ""} className={`${input} ml-1`} /></label>
        <button type="submit" className={primary}>Show</button>
      </form>
      {!range ? <p className="text-[13.5px] text-gray-700">Choose both ends of the custom period (at most a year apart).</p>
        : !ci ? <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">The figures could not be read just now (or migrations 421 to 423 are not applied here). Nothing is shown rather than a partial picture.</p>
        : (
          <>
            {!ci.meteringOn && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">AI metering is off on this environment, so no AI spend is recorded. Spend below reads Not measured, not zero.</p>}
            <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="p-h">
              <h2 id="p-h" className="text-[15px] font-bold text-gray-900">Pipeline</h2>
              <dl className="mt-2">
                <Row k="Private cases generated">{ci.privateCasesGenerated.measured ? ci.privateCasesGenerated.count : <span className="italic text-gray-600">Not measured: {ci.privateCasesGenerated.reason}</span>}</Row>
                <Row k="Candidates offered, by state">{Object.keys(ci.candidates).length ? Object.entries(ci.candidates).map(([s, n]) => `${s.replace("_", " ")} ${n}`).join(" · ") : "None offered"}</Row>
                <Row k="Submitted for clinical review">{ci.library.submitted}</Row>
                <Row k="Of those, clinically approved">{ci.library.approved}</Row>
                <Row k="Published">{ci.library.published}</Row>
                <Row k="Superseded · retired">{ci.library.superseded} · {ci.library.retired}</Row>
                <Row k="Library sessions started · completed">{ci.reuse.sessionsStarted} · {ci.reuse.sessionsCompleted} (on {ci.reuse.casesUsed} case version{ci.reuse.casesUsed === 1 ? "" : "s"})</Row>
              </dl>
            </section>
            <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="s-h">
              <h2 id="s-h" className="text-[15px] font-bold text-gray-900">Measured AI spend</h2>
              <dl className="mt-2">
                <Row k="Individuals (their own learning)"><Spend m={ci.spendByOwner.individual} /></Row>
                <Row k="Platform (shared content development)"><Spend m={ci.spendByOwner.platform} /></Row>
                <Row k="Institutions"><Spend m={ci.spendByOwner.institution} /></Row>
                <Row k="Per private case generation">{ci.spendPerPrivateGeneration.measured ? `${cau(ci.spendPerPrivateGeneration.meanCau)} · ${usd(ci.spendPerPrivateGeneration.meanUsd)} mean of ${ci.spendPerPrivateGeneration.generations}` : <span className="italic text-gray-600">Not measured: {ci.spendPerPrivateGeneration.reason}</span>}</Row>
                <Row k="Per completed library session (live AI)">{ci.spendPerCompletedSession.measured ? `${cau(ci.spendPerCompletedSession.meanCau)} mean over ${ci.spendPerCompletedSession.sessions} session${ci.spendPerCompletedSession.sessions === 1 ? "" : "s"} (${ci.spendPerCompletedSession.liveAiRequests} live AI request${ci.spendPerCompletedSession.liveAiRequests === 1 ? "" : "s"})` : <span className="italic text-gray-600">Not measured: {ci.spendPerCompletedSession.reason}</span>}</Row>
              </dl>
              <h3 className="mt-3 text-[13px] font-semibold text-gray-700">Platform content development, by activity</h3>
              {Array.isArray(ci.platformDevelopment) ? (ci.platformDevelopment.length ? <dl>{ci.platformDevelopment.map(a => <Row key={a.activity} k={a.activity}>{cau(a.cau)} · {usd(a.usd)} · {a.requests}</Row>)}</dl> : <p className="text-[13px] text-gray-700">No platform AI work in this period.</p>)
                : <p className="text-[13px] italic text-gray-600">Not measured: {ci.platformDevelopment.reason}</p>}
            </section>
            <section className="rounded-xl border border-dashed border-gray-300 bg-white p-4" aria-labelledby="e-h">
              <h2 id="e-h" className="text-[15px] font-bold text-gray-900">Estimated AI generation avoided through reuse</h2>
              <p className="text-[12.5px] text-gray-600">An estimate, not a measurement.</p>
              {ci.estimatedAvoided.estimated ? <p className="mt-1 text-[13.5px] text-gray-900">About {cau(ci.estimatedAvoided.cau)} ({usd(ci.estimatedAvoided.usd)}). Basis: {ci.estimatedAvoided.basis}.</p>
                : <p className="mt-1 text-[13.5px] italic text-gray-600">Not estimated: {ci.estimatedAvoided.reason}.</p>}
            </section>
          </>
        )}
    </div>
  );
}
