import type { Metadata } from "next";
import Link from "next/link";
import { requireAnyHqCapability, holdsHqCapability } from "@/lib/hq/context";
import { loadGovernanceModel } from "@/lib/competency/governance-workspace";
import GovernanceWorkspace from "../_components/GovernanceWorkspace";

// /super-admin/competencies/governance/[frameworkId] -- FRAMEWORK-GOVERNANCE-WORKSPACE-01: the workspace for one framework.
//
// One page, three audiences. The door admits anyone holding the author, clinical review or publication right; what is
// DRAWN follows the capabilities the person actually holds (probed here) and the lifecycle state of what they select.
// Every action posts to the existing gated route for that action: putting content forward and authoring go to
// /api/hq/competency/authoring (author), decisions to /api/hq/clinical-review (reviewer, one decision per version, the
// 395 trigger refusing anything the reviewer wrote, edited or submitted), publication to /api/hq/competency/publication
// (publisher, 580, never the submitter or a contributor). Approval here is never publication. Readiness is read fresh on
// every render, so a recorded approval moves the count and the pathway without any resubmission.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Framework governance workspace" };

const CAPABILITIES = ["hq.quality.competency.author", "hq.quality.clinical.approve", "hq.quality.competency.publish"];

export default async function GovernanceWorkspacePage({ params, searchParams }: { params: Promise<{ frameworkId: string }>; searchParams: Promise<{ c?: string; q?: string; mode?: string }> }) {
  const ctx = await requireAnyHqCapability(CAPABILITIES);
  const [{ frameworkId }, sp] = await Promise.all([params, searchParams]);
  const [canAuthor, canReview, canPublish] = await Promise.all(CAPABILITIES.map(c => holdsHqCapability(c)));
  const me = { canAuthor, canReview, canPublish };
  const model = await loadGovernanceModel(ctx.admin, ctx.userId, frameworkId, me);
  if (!model) {
    return (
      <div className="max-w-3xl space-y-3">
        <p className="text-[13px]"><Link href="/super-admin/competencies/governance" className="font-semibold text-teal-800 underline">Framework governance</Link></p>
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">That framework is not a shared framework, or it could not be read just now.</p>
      </div>
    );
  }
  return <GovernanceWorkspace model={model} initialId={sp.c ?? null} initialFilter={sp.q ?? null} initialMode={sp.mode === "review"} />;
}
