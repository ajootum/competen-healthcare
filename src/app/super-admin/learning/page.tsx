import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { learningEnabled, loadLearningPolicy } from "@/lib/learning/policy";
import { listOfferings, listProviders } from "@/lib/learning/studio";
import { CreateOffering, CreateProvider } from "./_components/LearningControls";
import { Alert, Off } from "./_components/Bits";

// /super-admin/learning -- the Learning Studio (COMPETEN-LEARNING-01 S1, migrations 460-461). Guarded by
// hq.learning.course.author (the Learning Course Author position). Providers, offerings, drafts and external listings.
// Clinical review, publication, prices and certificates are separate pages behind separate authorities (D8).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Learning studio" };

const STATE: Record<string, string> = { draft: "Draft", submitted: "Submitted (in review, or approved and not yet published)", published: "Published", superseded: "Superseded", retired: "Retired" };
const SOURCE: Record<string, string> = { competen: "Competen", partner: "Partner", external: "External link" };

export default async function LearningStudioPage() {
  const ctx = await requireHqCapability("hq.learning.course.author");
  if (!(await learningEnabled(ctx.admin))) return <Off />;
  const [policy, providers, offerings] = await Promise.all([loadLearningPolicy(ctx.admin), listProviders(ctx.admin), listOfferings(ctx.admin)]);
  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Competen Learning</p>
        <h1 className="text-xl font-bold text-gray-900">Learning studio</h1>
        <p className="mt-1 text-sm text-gray-600">Build Competen and partner courses, and list external courses, for one shared catalogue. Hosted learning is clinically reviewed for its exact version before anyone else publishes it. An external listing is approved as a listing, never as clinical endorsement.</p>
      </header>

      <section aria-labelledby="prov-h" className="space-y-3">
        <h2 id="prov-h" className="text-[15px] font-bold text-gray-900">Providers</h2>
        <div className="rounded-xl border border-gray-200 bg-white p-3"><CreateProvider /></div>
        {providers === null ? <Alert text="The providers could not be read just now." /> : providers.length === 0 ? <p className="text-[13.5px] text-gray-700">No provider yet. Add Competen Holdings, a partner or an external provider before creating learning.</p> : (
          <ul className="flex flex-wrap gap-2 text-[13px]">{providers.map(p => <li key={p.id} className="rounded-full border border-gray-200 bg-white px-3 py-1">{p.name} <span className="text-gray-500">· {p.code} · {p.kind}{p.status === "retired" ? " · retired" : ""}</span></li>)}</ul>
        )}
      </section>

      <section aria-labelledby="off-h" className="space-y-3">
        <h2 id="off-h" className="text-[15px] font-bold text-gray-900">Offerings</h2>
        <div className="rounded-xl border border-gray-200 bg-white p-3"><CreateOffering types={policy.offeringTypes} providers={(providers ?? []).filter(p => p.status === "active")} /></div>
        {offerings === null ? <Alert text="The offerings could not be read just now." /> : offerings.length === 0 ? <p className="text-[13.5px] text-gray-700">No offering yet.</p> : (
          <table className="w-full text-left text-[13px]">
            <thead><tr className="text-[12px] text-gray-500"><th className="py-1">Offering</th><th>Source</th><th>Type</th><th>Latest version</th><th>Published</th><th>Status</th></tr></thead>
            <tbody>{offerings.map(o => (
              <tr key={o.id} className="border-t border-gray-100">
                <td className="py-2"><Link className="font-semibold text-teal-800 underline" href={`/super-admin/learning/${o.id}`}>{o.code}</Link> {o.title}</td>
                <td>{SOURCE[o.source] ?? o.source}{o.delivery === "external" ? " (external delivery)" : ""}</td>
                <td>{o.offeringType.replace(/_/g, " ")}</td>
                <td>{o.latest ? `v${o.latest.versionNo}: ${STATE[o.latest.state] ?? o.latest.state}` : "None"}</td>
                <td>{o.published ? "Yes" : "No"}</td>
                <td>{o.status === "active" ? "Active" : "Retired"}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}

