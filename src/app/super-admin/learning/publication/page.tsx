import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { learningEnabled, loadLearningPolicy } from "@/lib/learning/policy";
import { listOfferings, publicationQueue } from "@/lib/learning/studio";
import { ActionButton, PolicyEditor } from "../_components/LearningControls";
import { Alert, Header, Off, when } from "../_components/Bits";

// /super-admin/learning/publication -- publication and listing approval (COMPETEN-LEARNING-01 S1, migration 461).
// Guarded by hq.learning.course.publish (the Learning Publisher position). A hosted version is published only when
// its exact version is clinically approved. An external listing is approved here as a LISTING: accurate, linked and
// dated for review, which is not clinical endorsement. The database refuses anyone who wrote the version.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Learning publication" };

export default async function LearningPublicationPage() {
  const ctx = await requireHqCapability("hq.learning.course.publish");
  if (!(await learningEnabled(ctx.admin))) return <Off />;
  const [q, offerings, policy] = await Promise.all([publicationQueue(ctx.admin), listOfferings(ctx.admin), loadLearningPolicy(ctx.admin)]);
  return (
    <div className="max-w-4xl space-y-8">
      <Header title="Learning publication" intro="Publish clinically approved learning, and approve external listings. Publishing makes a version the one learners are offered, and supersedes the one before. You cannot publish a version you wrote or edited." />
      <section className="space-y-3">
        <h2 className="text-[15px] font-bold text-gray-900">Waiting</h2>
        {q === null ? <Alert text="The queue could not be read just now." /> : q.length === 0 ? <p className="text-[13.5px] text-gray-700">Nothing is waiting.</p> : (
          <ul className="space-y-3">{q.map(v => (
            <li key={v.versionId} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[14px] font-bold text-gray-900"><Link className="text-teal-800 underline" href={`/super-admin/learning/${v.offeringId}`}>{v.code}</Link> {v.title} · version {v.versionNo}</p>
              <p className="text-[12.5px] text-gray-600">{v.route === "listing" ? "External listing: approving it approves the listing only, not its clinical content." : v.ready ? "Clinically approved for this exact version." : "Still in clinical review: it cannot be published yet."} · submitted {when(v.submittedAt)}</p>
              {(v.ready || v.route === "listing") && <div className="mt-2"><ActionButton body={{ action: "publish", versionId: v.versionId }} label={v.route === "listing" ? "Approve and publish the listing" : "Publish this version"} done="Published. Learners are offered this version now." /></div>}
            </li>))}</ul>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-[15px] font-bold text-gray-900">Retire an offering</h2>
        <p className="text-[13px] text-gray-600">Retiring stops new enrolments. Everything learners did stays in their records.</p>
        {(offerings ?? []).filter(o => o.status === "active").map(o => (
          <div key={o.id} className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-2 text-[13px]"><span>{o.code} {o.title}</span>
            <ActionButton body={{ action: "retire", offeringId: o.id }} label="Retire" done="Retired." tone="ghost" confirm={`Retire ${o.code}? It will no longer be offered.`} /></div>))}
      </section>
      <section className="space-y-3">
        <h2 className="text-[15px] font-bold text-gray-900">Learning policy</h2>
        <p className="text-[13px] text-gray-600">Offering types, formats and levels are configuration, versioned in the Workspace Configuration Engine. Nothing in them is a profession, a country or a price.</p>
        <div className="rounded-xl border border-gray-200 bg-white p-3"><PolicyEditor policy={policy} /></div>
      </section>
    </div>
  );
}
