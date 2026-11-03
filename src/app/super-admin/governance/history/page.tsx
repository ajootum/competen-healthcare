import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { listGovernedVersions, nameMap, recentDefinitionTrail } from "@/lib/assessment/studio/read";
import { loadClinicalDecisions, loadFrameworkPublications, loadOrganisationChanges } from "@/lib/competency/governance-history";
import { HISTORY_LIMIT, buildHistory, type HistoryType } from "../unified";
import HistoryView from "./HistoryView";

// UNIFIED-GOVERNANCE-V1 section 7 -- Governance History. One reverse-chronological list over the trails that already exist:
// Studio definition events and review decisions, clinical review decisions, framework publications, and organisation changes.
// Each source appears only for a person who may see it. A source that cannot be read says so in one line, never as an empty list.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Governance history" };

const CLINICAL_CAPS = ["hq.quality.clinical.approve", "hq.quality.competency.author", "hq.quality.competency.publish"];

export default async function GovernanceHistoryPage() {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.platform.home.view"));
  const has = (c: string) => ctx.capabilities.includes(c);
  const studioOk = ctx.isOwner || has("hq.assessment.studio.view");
  const clinicalOk = ctx.isOwner || CLINICAL_CAPS.some(has);
  const orgOk = ctx.isOwner || has("hq.platform.users.view");

  const notices: string[] = [];
  const types: HistoryType[] = [];
  const [trail, versions, clinical, publications, organisation] = await Promise.all([
    studioOk ? recentDefinitionTrail(ctx.admin, HISTORY_LIMIT).catch(() => null) : Promise.resolve(undefined),
    studioOk ? listGovernedVersions(ctx.admin).catch(() => null) : Promise.resolve(undefined),
    clinicalOk ? loadClinicalDecisions(ctx.admin, HISTORY_LIMIT) : Promise.resolve(undefined),
    clinicalOk ? loadFrameworkPublications(ctx.admin, HISTORY_LIMIT) : Promise.resolve(undefined),
    orgOk ? loadOrganisationChanges(ctx.admin, HISTORY_LIMIT) : Promise.resolve(undefined),
  ]);

  if (studioOk) {
    types.push("checklist");
    if (trail === null) notices.push("Checklist and Studio history could not be read just now.");
    else if (versions === null) notices.push("Checklist and Studio history was read, but the definitions could not be named just now.");
  }
  if (clinicalOk) {
    types.push("clinical", "framework");
    if (clinical === null) notices.push("Clinical review history could not be read just now.");
    if (publications === null) notices.push("Framework publication history could not be read just now.");
  }
  if (orgOk) {
    types.push("organisation");
    if (organisation === null) notices.push("Organisation change history could not be read just now.");
  }

  const names = await nameMap(ctx.admin, [...(trail ?? []).map((t) => t.actorId), ...(clinical ?? []).map((c) => c.reviewerId)]);
  const items = buildHistory({
    trail: trail ?? [], versions: versions ?? [], clinical: clinical ?? [], publications: publications ?? [], organisation: organisation ?? [], names, limit: HISTORY_LIMIT,
  });

  return <HistoryView items={items} notices={notices} types={types} />;
}
