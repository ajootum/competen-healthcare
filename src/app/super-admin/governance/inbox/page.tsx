import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { loadInbox } from "@/lib/hq/governance-inbox";
import InboxView from "./InboxView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Governance Inbox" };

// /super-admin/governance/inbox -- UNIFIED-GOVERNANCE-V1 section 4: the Governance landing page and My Governance Inbox.
// Open to every HQ appointee (hq.platform.home.view); what it lists is decided by the capabilities the person's own
// appointments hold (withOwnAppointments resolves an owner the same way the database does). Every action is taken on
// the governed item behind the same gated route and database guard; nothing is decided here.
export default async function GovernanceInboxPage() {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.platform.home.view"));
  const model = await loadInbox(ctx.admin, { userId: ctx.userId, caps: ctx.capabilities, isOwner: ctx.isOwner });
  return <InboxView model={model} viewerName={ctx.fullName} />;
}
