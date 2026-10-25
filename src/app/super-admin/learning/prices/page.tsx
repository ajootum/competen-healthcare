import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { learningEnabled } from "@/lib/learning/policy";
import { listOfferings, listPrices } from "@/lib/learning/studio";
import { ActionButton, DecidePrice } from "../_components/LearningControls";
import { Alert, Header, Off, money, when } from "../_components/Bits";

// /super-admin/learning/prices -- course price approval (COMPETEN-LEARNING-01 S3, migration 463, owner D7 and D8).
// Guarded by hq.learning.price.approve (the Learning Price Approver position). The database refuses the proposer and
// anyone without an active appointment holding the capability. Approving a price retires the previous one in that
// currency, and what was already bought keeps its own copy. No real charging is authorised.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Course prices" };

export default async function CoursePricesPage() {
  const ctx = await requireHqCapability("hq.learning.price.approve");
  if (!(await learningEnabled(ctx.admin))) return <Off />;
  const [prices, offerings] = await Promise.all([listPrices(ctx.admin), listOfferings(ctx.admin)]);
  const name = new Map((offerings ?? []).map(o => [o.id, `${o.code} ${o.title}`]));
  const row = (p: NonNullable<typeof prices>[number]) => <p className="text-[13.5px] text-gray-900"><span className="font-semibold">{name.get(p.offeringId) ?? "A course"}</span> · {money(p.amountMinor, p.currency)} · {p.accessDays ? `${p.accessDays} days` : "as long as the terms allow"} · {p.termsVersion} · proposed {when(p.proposedAt)}{p.proposalNote ? ` · "${p.proposalNote}"` : ""}</p>;
  if (prices === null) return <div className="max-w-4xl"><Alert text="The prices could not be read just now." /></div>;
  return (
    <div className="max-w-4xl space-y-8">
      <Header title="Course prices" intro="Approve or reject course prices someone else proposed. A price is data: changing it means proposing a new one. You cannot decide a price you proposed." />
      <section className="space-y-3"><h2 className="text-[15px] font-bold text-gray-900">Proposed</h2>
        {prices.filter(p => p.state === "proposed").length === 0 ? <p className="text-[13.5px] text-gray-700">No proposal is waiting.</p>
          : prices.filter(p => p.state === "proposed").map(p => <div key={p.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">{row(p)}<DecidePrice priceId={p.id} /></div>)}
      </section>
      <section className="space-y-3"><h2 className="text-[15px] font-bold text-gray-900">Current (approved)</h2>
        {prices.filter(p => p.state === "approved").length === 0 ? <p className="text-[13.5px] text-gray-700">No approved price.</p>
          : prices.filter(p => p.state === "approved").map(p => <div key={p.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">{row(p)}<ActionButton body={{ action: "retire_price", priceId: p.id }} label="Retire this price" done="Retired. No new checkout can use it." tone="ghost" /></div>)}
      </section>
      <section className="space-y-2"><h2 className="text-[15px] font-bold text-gray-900">Closed</h2>
        {prices.filter(p => p.state === "rejected" || p.state === "retired").map(p => <div key={p.id} className="border-t border-gray-100 pt-2">{row(p)}<p className="text-[12.5px] text-gray-600">{p.state}{p.decisionNote ? `: ${p.decisionNote}` : ""}</p></div>)}
      </section>
    </div>
  );
}
