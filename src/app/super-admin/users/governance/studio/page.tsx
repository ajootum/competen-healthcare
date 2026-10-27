import { requireHqCapability } from "@/lib/hq/context";
import { loadStudio } from "@/lib/hq/governance-studio";
import StudioBoard from "./StudioBoard";

/**
 * Competen HQ — Organisation & Governance Studio (COMPETEN-SCHOLAR-GOV-IMPLEMENT-01, Addendum V1.2, migration 620).
 *
 * ⚠ ITS OWN RIGHT, DECLARED IN HQ_ROUTE_INTENT ABOVE /super-admin/users. hq.platform.governance.manage is granted to
 * no position, so today only a platform owner opens this page. requireHqCapability refuses regardless of
 * hq_config.mode, and /api/hq/governance/studio checks again. Approve and publish are owner-only in the route and
 * the database. The published history is readable by hq.platform.users.view on /super-admin/users/governance/history.
 */
export default async function GovernanceStudioPage({ searchParams }: { searchParams: Promise<{ structure?: string; version?: string }> }) {
  const ctx = await requireHqCapability("hq.platform.governance.manage");
  const sp = await searchParams;
  const load = await loadStudio(ctx.admin, { structure: sp.structure ?? null, version: sp.version ?? null });
  return <StudioBoard load={load} isOwner={ctx.isOwner} />;
}
