import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { buildDashboard, canIdentifyWith } from "@/lib/hq/scholar-analytics/dashboard";
import EngagementDashboard from "./EngagementDashboard";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

/**
 * Competen HQ -- Learner Engagement (SCHOLAR-ENGAGEMENT-ANALYTICS-01, migration 910).
 *
 * Adoption, activity, engagement and AI expenditure of genuine Scholar learners. Anonymous View by default: pseudonymous,
 * stable rankings with no name, email or id. Named View needs hq.scholar.analytics.identifiable.read (or ownership) and
 * is decided by the same server builder the API uses, which keeps identity on the server and audits each identifiable
 * answer. The first render is the Anonymous View of the last 30 days; the controls then call the API.
 *
 * ⚠ GATED BY requireHqCapability("hq.scholar.analytics.view") -- the Individual Product Administrator and Reviewer.
 * ⚠ NO LEARNER CONTENT IS READ: src/lib/hq/scholar-analytics/load.ts reads ids, timestamps, statuses and the AI gateway's
 * figures only, each table with an allowlist entry restricted to that folder (plane-boundary.ts).
 */
export default async function LearnerEngagementPage() {
  const ctx = await requireHqCapability("hq.scholar.analytics.view");
  const caller = { userId: ctx.userId, fullName: ctx.fullName, isOwner: ctx.isOwner, capabilities: ctx.capabilities };
  const first = await buildDashboard(ctx.admin, caller, { range: "30d" });
  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Link href="/super-admin/individual" className="hover:text-teal-700">Competen Individual</Link><span>/</span><span className="text-gray-600">Learner Engagement</span>
        </div>
        <h1 className="mt-0.5 text-2xl font-bold text-gray-900">Learner Engagement</h1>
        <p className="text-sm text-gray-500">Who is using Competen Scholar, what they do, and what their AI use costs. Anonymous by default.</p>
      </div>
      <EngagementDashboard canIdentify={canIdentifyWith(caller)} initial={first.status === 200 ? first.body : null} initialError={first.status === 200 ? null : first.body.error} />
    </div>
  );
}
