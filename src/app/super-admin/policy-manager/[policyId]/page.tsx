import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { POLICY_CAP } from "@/lib/assessment/studio/transitions";
import { buildTimeline, loadPolicy, loadTrail, nameMap } from "@/lib/assessment/studio/read";
import { isUuid } from "@/lib/assessment/studio/api";
import { loadHolders, pathwayModel } from "@/lib/assessment/studio/pathway-data";
import { validateOther } from "@/lib/assessment/studio/service";
import type { PathwayModel } from "@/lib/assessment/studio/pathway";
import { PageHead, StudioShell } from "../../checklist-studio/_components/studio-ui";
import { PolicyVersionsView } from "../_components/PolicyVersionsView";
import { POLICY_SCOPE_LABEL, POLICY_TYPE_LABEL } from "../policy-options";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Policy versions" };

// /super-admin/policy-manager/[policyId] -- a governed policy (942): its versions, the pathway of the latest, and its history.
export default async function PolicyPage({ params }: { params: Promise<{ policyId: string }> }) {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.quality.policy.view"));
  const { policyId } = await params;
  if (!isUuid(policyId)) notFound();
  const data = await loadPolicy(ctx.admin, policyId);
  if (!data) notFound();
  const { policy, versions } = data;
  const versionIds = versions.map((v) => v.id);
  const versionNos = Object.fromEntries(versions.map((v) => [v.id, v.version_no]));
  const trail = await loadTrail(ctx.admin, "policy", versionIds);
  const timeline = buildTimeline(trail.events, trail.decisions, versionNos);
  const names = await nameMap(ctx.admin, [...versions.flatMap((v) => [...v.authored_by, v.published_by, v.submitted_by]), ...timeline.map((t) => t.actorId)]);
  const holders = await loadHolders(ctx.admin, "policy");
  const latest = versions[0] ?? null;
  const latestErrors = latest && latest.state === "draft" ? (await validateOther(ctx.admin, "policy", latest.id)).errors : [];
  const pathways: Record<string, PathwayModel> = Object.fromEntries(await Promise.all(versions.map(async (v) => [v.id, await pathwayModel(ctx.admin, {
    kind: "policy", version: v, actorId: ctx.userId, caps: ctx.capabilities, holders, versionNos, validation: v.id === latest?.id ? latestErrors : [],
  })])));
  const identityPathway = versions.length ? null : await pathwayModel(ctx.admin, { kind: "policy", version: null, actorId: ctx.userId, caps: ctx.capabilities, holders });
  return (
    <StudioShell>
      <PageHead kicker="Competen Holdings, Policy Manager"
        title={`${policy.code}, ${latest?.title ?? policy.title}`}
        crumbs={[{ href: "/super-admin/policy-manager", label: "Policy Manager" }, { label: policy.code }]}
        lede={`${POLICY_TYPE_LABEL[policy.policy_type] ?? policy.policy_type} · ${POLICY_SCOPE_LABEL[policy.scope] ?? policy.scope}${policy.description ? ` · ${policy.description}` : ""}`}
      />
      <PolicyVersionsView
        policyId={policy.id}
        versions={versions.map((v) => ({ id: v.id, version_no: v.version_no, state: v.state, authored_by: v.authored_by, published_at: v.published_at }))}
        timeline={timeline} names={names} canAuthor={ctx.capabilities.includes(POLICY_CAP.author)} pathways={pathways} identityPathway={identityPathway}
      />
    </StudioShell>
  );
}
