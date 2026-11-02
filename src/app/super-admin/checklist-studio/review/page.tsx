import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { CAP } from "@/lib/assessment/studio/transitions";
import { nameMap, reviewQueue } from "@/lib/assessment/studio/read";
import { KIND_LABEL } from "@/lib/assessment/studio/types";
import { fmtDateTime } from "@/lib/assessment/studio/vocab";
import { DefReviewQueue } from "../_components/DefReviewQueue";
import { Notice, PageHead, StudioShell } from "../_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review queue" };

// The versions in review that THIS person may still decide: never one they authored, edited or submitted, and not one they already decided on.
export default async function ReviewQueuePage() {
  const ctx = await requireHqCapability("hq.assessment.studio.view");
  const canReview = ctx.capabilities.includes(CAP.review) || ctx.capabilities.includes(CAP.domainReview);
  const queue = canReview ? await reviewQueue(ctx.admin, ctx.userId, ctx.capabilities) : [];
  const names = await nameMap(ctx.admin, queue.map((q) => q.submittedBy));
  return (
    <StudioShell>
      <PageHead
        title="Review queue" crumbs={[{ href: "/super-admin/checklist-studio", label: "Checklist Studio" }, { label: "Review" }]}
        lede="Versions put forward for review that you may decide. The decision is recorded against the exact content you opened."
      />
      {!canReview && <Notice tone="info">You hold neither the review capability nor the domain review capability, so there is nothing for you to decide here. You can still open any version to read it.</Notice>}
      <DefReviewQueue
        rows={queue.map((q) => ({
          key: q.versionId, kind: KIND_LABEL[q.kind], code: q.code, name: q.definitionName, versionNo: q.versionNo, submittedBy: q.submittedBy ? names[q.submittedBy] ?? "a person" : "",
          submittedAt: fmtDateTime(q.submittedAt), governance: q.governance, domain: q.domain, requiresDomainReview: q.requiresDomainReview, href: q.href,
        }))}
        canReview={canReview}
      />
      <p className="text-xs text-[var(--cmp-app-text-secondary)]"><Link href="/super-admin/checklist-studio" className="underline underline-offset-2">Back to the library</Link></p>
    </StudioShell>
  );
}
