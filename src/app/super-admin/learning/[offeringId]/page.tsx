import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { classificationOptions, competencyOptions } from "@/lib/cases/studio";
import { RELATION_LABEL } from "@/lib/learning/blueprint";
import { learningEnabled, loadLearningPolicy } from "@/lib/learning/policy";
import { listProviders, offeringDetail } from "@/lib/learning/studio";
import { ActionButton, ProposePrice } from "../_components/LearningControls";
import { LearningEditor } from "../_components/LearningEditor";
import { Alert, Off, money, when } from "../_components/Bits";

// /super-admin/learning/[offeringId] -- one offering in the studio (COMPETEN-LEARNING-01 S1). Guarded by
// hq.learning.course.author. Every version with its review state (never "approved" unless the 395 record says so,
// and never for a listing), the editor for the open draft, price proposals and the audit trail.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Learning offering" };

const REVIEW: Record<string, string> = {
  draft: "Draft", in_review: "In independent clinical review", changes_requested: "Changes requested by a clinical reviewer", approved: "Clinically approved, waiting for publication",
  listing_pending: "Waiting for listing approval (not clinical review)", published: "Published", superseded: "Superseded", retired: "Retired",
};

export default async function OfferingPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const ctx = await requireHqCapability("hq.learning.course.author");
  if (!(await learningEnabled(ctx.admin))) return <Off />;
  const { offeringId } = await params;
  const d = await offeringDetail(ctx.admin, offeringId);
  if (!d) notFound();
  const [policy, providers, comps, classes] = await Promise.all([loadLearningPolicy(ctx.admin), listProviders(ctx.admin), competencyOptions(ctx.admin), classificationOptions(ctx.admin)]);
  const o = d.offering;
  const draft = d.versions.find(v => v.state === "draft");
  const prov = new Map((providers ?? []).map(p => [p.id, p.name]));
  const compName = new Map(comps.map(c => [c.id, c.label]));

  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800"><Link href="/super-admin/learning" className="underline">Learning studio</Link> · {o.code}</p>
        <h1 className="text-xl font-bold text-gray-900">{o.title}</h1>
        <p className="mt-1 text-sm text-gray-600">{o.source === "external" ? "External linked course" : o.source === "partner" ? "Partner-developed" : "Competen-developed"} · {o.delivery === "hosted" ? "delivered on Competen" : "delivered by the provider"} · {o.offering_type.replace(/_/g, " ")} · {o.status === "active" ? "active" : "retired"}</p>
      </header>

      <section aria-labelledby="v-h" className="space-y-3">
        <h2 id="v-h" className="text-[15px] font-bold text-gray-900">Versions</h2>
        {!draft && o.status === "active" && <ActionButton body={{ action: "new_draft", offeringId: o.id }} label="Start a new draft from the latest version" done="Draft started." />}
        <ul className="space-y-3">{d.versions.map(v => (
          <li key={v.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[14.5px] font-bold text-gray-900">Version {v.versionNo}: {v.content.title}</h3>
              <span className="rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11.5px] font-semibold text-gray-800">{REVIEW[v.review] ?? v.review}{v.route === "clinical" && v.required ? ` · ${v.approvals} of ${v.required} approval${v.required === 1 ? "" : "s"}` : ""}</span>
            </div>
            <p className="text-[12.5px] text-gray-600">{v.authors.length} author{v.authors.length === 1 ? "" : "s"} · {v.risk} risk · submitted {when(v.submittedAt) || "not yet"} · published {when(v.publishedAt) || "not yet"}</p>
            <p className="text-[12.5px] text-gray-600">Content owner: {prov.get(v.responsibilities.contentOwnerId ?? "") ?? "not named"} · delivery: {prov.get(v.responsibilities.deliveryProviderId ?? "") ?? "not named"} · certificate issuer: {prov.get(v.responsibilities.certificateIssuerId ?? "") ?? "none"} · commercial: {prov.get(v.responsibilities.commercialProviderId ?? "") ?? "none"}</p>
            {v.content.objectives.some(x => x.outcomeRefs.length) && <p className="text-[12.5px] text-gray-600">CFCA: {v.content.objectives.flatMap(x => x.outcomeRefs.map(r => `${compName.get(r.competencyId) ?? "a competency"} (${RELATION_LABEL[r.relation]})`)).join("; ")}</p>}
            {v.certificate.filter(c => !c.withdrawnAt).map(c => <p key={c.id} className="text-[12.5px] text-gray-600">Certificates authorised for: {c.outcomes.join(", ").replace(/_/g, " ")} ({when(c.authorisedAt)})</p>)}
            {v.comments.filter(c => c.comment).map((c, i) => <p key={i} className="mt-1 rounded bg-amber-50 px-2 py-1 text-[12.5px] text-amber-950">Reviewer ({c.decision}): {c.comment}</p>)}
            {v.state === "draft" && (
              <div className="mt-4 space-y-3">
                <LearningEditor versionId={v.id} delivery={o.delivery} initial={v.content} responsibilities={v.responsibilities} risk={v.risk}
                  providers={(providers ?? []).filter(p => p.status === "active")} competencies={comps}
                  professions={classes?.professions ?? []} specialties={classes?.specialties ?? []} levels={policy.levels} formats={policy.formats} />
                <ActionButton body={{ action: "delete_draft", versionId: v.id }} label="Delete this draft" done="Draft deleted." tone="ghost" confirm="Delete this unsubmitted draft?" />
              </div>
            )}
          </li>))}</ul>
      </section>

      {o.delivery === "hosted" && (
        <section aria-labelledby="p-h" className="space-y-3">
          <h2 id="p-h" className="text-[15px] font-bold text-gray-900">Prices</h2>
          <p className="text-[13px] text-gray-600">A price is proposed here and approved by a different person (a Learning Price Approver). It is copied, with its terms, onto every checkout. No real charging is authorised on this environment.</p>
          <div className="rounded-xl border border-gray-200 bg-white p-3"><ProposePrice offeringId={o.id} /></div>
          {d.prices.length === 0 ? <p className="text-[13.5px] text-gray-700">No price yet. Without an approved price, a paid course can be reached only by an HQ access grant.</p> : (
            <table className="w-full text-left text-[13px]"><thead><tr className="text-[12px] text-gray-500"><th className="py-1">Price</th><th>Access</th><th>Terms</th><th>State</th><th>Proposed</th></tr></thead>
              <tbody>{d.prices.map(p => <tr key={p.id} className="border-t border-gray-100"><td className="py-2">{money(p.amountMinor, p.currency)}</td><td>{p.accessDays ? `${p.accessDays} days` : "As long as the terms allow"}</td><td>{p.termsVersion}</td><td>{p.state}{p.decisionNote ? ` (${p.decisionNote})` : ""}</td><td>{when(p.proposedAt)}</td></tr>)}</tbody></table>
          )}
        </section>
      )}

      {o.status === "active" && <section className="space-y-2"><h2 className="text-[15px] font-bold text-gray-900">Retire</h2><p className="text-[13px] text-gray-600">Retiring stops it being offered. Every version, review record and learner record stays. A Learning Publisher retires it from the publication page.</p></section>}

      <section aria-labelledby="a-h" className="space-y-2">
        <h2 id="a-h" className="text-[15px] font-bold text-gray-900">History</h2>
        {d.audit.length === 0 ? <p className="text-[13px] text-gray-600">No recorded action yet.</p> : <ul className="text-[12.5px] text-gray-700">{d.audit.map((a, i) => <li key={i}>{when(a.at)} · {a.actor ?? "Someone"} · {a.action.replace(/_/g, " ")}</li>)}</ul>}
      </section>
      {providers === null && <Alert text="The providers could not be read just now." />}
    </div>
  );
}
