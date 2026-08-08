import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { securityPosture, listSessions, breakGlassLog } from "@/lib/practice/security";
import SecurityConsole from "./SecurityConsole";
import OfflineCacheSwitch from "./OfflineCacheSwitch";
import { OFFLINE_PRACTICE_SWITCH } from "@/lib/practice/offline-gate";

// /practice/privacy/security -- CPR-370's security surface.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE COMP'S HEADLINE IS "SECURITY SCORE 94% — EXCELLENT, ↑12% VS LAST 30 DAYS". IT IS NOT HERE.
//
// There is no formula behind that number and there could not be one: security is not a quantity. A score
// that moves without anybody being able to say why is worse than no score, because it invites people to
// chase it — and a practice that got to 94% would stop looking at the four things that actually matter.
//
// What replaces it is the four counts, the guarantees (each one a property of the code, each asserted in
// the harness) and — the part the comp has no room for — a list of what this product CANNOT know about
// itself. "Encryption AES-256" and "Data Residency Kenya (EU)" describe a deployment the application
// does not inspect, and the compliance badges are certifications about an organisation.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Under /privacy, beside the access log it belongs with, rather than a new top-level slug the public
// marketing section could collide with.

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const canManage = hasCapability(ctx, "practice.settings.manage");
  const canReview = hasCapability(ctx, "access.review");
  const admin = createAdminClient();

  // ⚠ THE UNREAD BRANCH AND THE UNREADABLE BRANCH ARE NOT THE SAME SHAPE, on purpose. A caller without
  // `access.review` is not shown the emergency-access list, and that is a permission rather than a
  // failure -- so it is marked `readable: true` with nothing in it. A read that FAILED arrives with
  // `readable: false` from the engine and the console says so. Collapsing the two would let a database
  // fault present itself as "you are not allowed to see this", which sends somebody to ask the wrong
  // person the wrong question.
  // ⚠ ABSENT IS NOT OFF (see offline-gate.ts). A practice that has never touched the switch has not
  // refused; the platform's own rollout flag decides for it. So the switch renders "on" unless the
  // practice has explicitly stored `false`, which is exactly what the gate reads.
  const [posture, sessions, glass, offlineConfig] = await Promise.all([
    canManage ? securityPosture(admin, ctx.workspaceId) : Promise.resolve(null),
    // Everybody sees their OWN devices; the whole practice's is administration.
    listSessions(admin, ctx.workspaceId, canManage ? {} : { userId: ctx.userId }),
    canReview
      ? breakGlassLog(admin, ctx.workspaceId)
      : Promise.resolve({ readable: true, episodes: [], awaitingReview: 0, live: 0, namesReadable: true, truncated: false }),
    admin.from("practice_configuration").select("feature_flags")
      .eq("workspace_id", ctx.workspaceId).eq("is_effective", true).maybeSingle(),
  ]);

  // ⚠ A FAILED READ IS NOT "ON". Without the error check the switch would report the practice's setting
  // as on from a query that never succeeded -- the one sentence on this page that nobody could check by
  // looking.
  const offlineReadable = !offlineConfig?.error;
  const offlineOn =
    ((offlineConfig?.data?.feature_flags ?? {}) as Record<string, unknown>)[OFFLINE_PRACTICE_SWITCH] !== false;

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Security</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Devices signed in to this practice, emergency access, and what this product can and cannot
            tell you about itself.
          </p>
        </div>
        <Link href="/practice/privacy"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          Access log
        </Link>
      </div>

      <SecurityConsole
        posture={posture}
        sessions={sessions.sessions}
        sessionsReadable={sessions.readable}
        sessionNamesReadable={sessions.namesReadable}
        glass={glass}
        canManage={canManage}
        canReview={canReview}
        me={ctx.userId}
      />

      <OfflineCacheSwitch workspaceId={ctx.workspaceId} enabled={offlineOn} readable={offlineReadable}
        canManage={canManage} />
    </div>
  );
}
