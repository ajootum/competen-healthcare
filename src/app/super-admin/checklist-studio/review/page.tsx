import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { nameMap, reviewOverview } from "@/lib/assessment/studio/read";
import { loadHolders } from "@/lib/assessment/studio/pathway-data";
import { standingOf } from "@/lib/assessment/studio/pathway";
import { KIND_LABEL } from "@/lib/assessment/studio/types";
import { fmtDateTime } from "@/lib/assessment/studio/vocab";
import { DefReviewQueue, type ReviewRow } from "../_components/DefReviewQueue";
import { Notice, PageHead, StudioShell } from "../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review queue" };

// The versions in review that THIS person may still decide: never one they authored, edited or submitted, and not one they already decided on.
export default async function ReviewQueuePage() {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.assessment.studio.view"));
  const canReview = ctx.capabilities.includes(CAP.review) || ctx.capabilities.includes(CAP.domainReview);
  // ASMT-PATHWAY-01: every version in review is listed, with who submitted it, what it needs, who can decide it, and whether THIS
  // person is independent of it. The ones this person may decide come first. Reading the list needs no capability; deciding does.
  const [all, holders] = await Promise.all([reviewOverview(ctx.admin, ctx.userId, ctx.capabilities), loadHolders(ctx.admin)]);
  const names = await nameMap(ctx.admin, all.map((q) => q.submittedBy));
  const rows: ReviewRow[] = all.map((q) => {
    const mineGov = q.viewer.canGovern && !q.viewer.decidedGovernance;
    const mineDom = q.viewer.canDomain && q.requiresDomainReview && !q.viewer.decidedDomain;
    const decidable = q.viewer.independent && (mineGov || mineDom);
    const standing = !q.viewer.independent ? "Not independent: you authored, edited or submitted this version or an earlier one."
      : decidable ? `Independent. You can ${[mineGov ? "record a governance decision" : "", mineDom ? "record a domain decision" : ""].filter(Boolean).join(" and ")}.`
      : !canReview ? "Independent, but you hold neither the review nor the domain review capability."
      : q.viewer.decidedGovernance || q.viewer.decidedDomain ? "Independent. You have already decided on this exact content."
      : q.requiresDomainReview && !q.viewer.canDomain && !mineGov ? "Independent, but this version needs a domain decision and you hold the governance right only." : "Independent, but nothing is left for you to decide here.";
    const reviewers = standingOf("review", { holders, involved: q.involved, decisions: [], contentHash: q.contentHash });
    const domain = standingOf("domainReview", { holders, involved: q.involved, decisions: [], contentHash: q.contentHash });
    const needs = [
      `${q.need} governance approval${q.need === 1 ? "" : "s"} (has ${q.governance})`,
      q.requiresDomainReview ? `${q.need} domain approval${q.need === 1 ? "" : "s"} (has ${q.domain})` : "",
    ].filter(Boolean).join(", ");
    const whoCan = [
      reviewers.eligible ? `Governance: ${reviewers.actors.filter((a) => a.eligible).map((a) => a.name).join(", ")}` : `Governance: ${reviewers.note ?? "nobody eligible"}`,
      q.requiresDomainReview ? (domain.eligible ? `Domain: ${domain.actors.filter((a) => a.eligible).map((a) => a.name).join(", ")}` : `Domain: ${domain.note ?? "nobody eligible"}`) : "",
    ].filter(Boolean).join(" · ");
    return {
      key: q.versionId, kind: KIND_LABEL[q.kind], code: q.code, name: q.definitionName, versionNo: q.versionNo, submittedBy: q.submittedBy ? names[q.submittedBy] ?? "a person" : "",
      submittedAt: fmtDateTime(q.submittedAt), governance: q.governance, domain: q.domain, requiresDomainReview: q.requiresDomainReview, href: q.href,
      needs, whoCan, standing, independent: q.viewer.independent, decidable,
    };
  });
  const mine = rows.filter((r) => r.decidable);
  const others = rows.filter((r) => !r.decidable);
  return (
    <StudioShell>
      <PageHead
        title="Review queue" crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { label: "Review" }]}
        lede="Every version put forward for review: who submitted it, what it still needs, who can decide it, and whether you are independent of it. A decision is recorded against the exact content you opened."
      />
      {!canReview && <Notice tone="info">You hold neither the review capability nor the domain review capability, so there is nothing for you to decide here. You can still open any version to read it.</Notice>}
      <section aria-labelledby="rq-mine" className="space-y-2">
        <h2 id="rq-mine" className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--cmp-app-text-secondary)]">Needs your decision ({mine.length})</h2>
        <DefReviewQueue rows={mine} canReview={canReview} />
      </section>
      {others.length > 0 && (
        <section aria-labelledby="rq-others" className="space-y-2">
          <h2 id="rq-others" className="text-sm font-bold uppercase tracking-[0.1em] text-[var(--cmp-app-text-secondary)]">Other versions in review ({others.length})</h2>
          <p className="text-sm text-[var(--cmp-app-text-secondary)]">Waiting on someone else: you authored them, already decided on them, or do not hold the right they need. Each row says who can decide it.</p>
          <DefReviewQueue rows={others} canReview={canReview} />
        </section>
      )}
      <p className="text-xs text-[var(--cmp-app-text-secondary)]"><Link href="/super-admin/checklist-studio" className="underline underline-offset-2">Back to the library</Link></p>
    </StudioShell>
  );
}
