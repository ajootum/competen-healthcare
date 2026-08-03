import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listActivities, portfolioSummary } from "@/lib/practice/clinical-activity";
import { listLocations } from "@/lib/practice/configuration";
import ActivityConsole from "./ActivityConsole";

// /practice/activity -- CPR-150's CLINICAL ACTIVITY half.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE MODULE IS CALLED "PROCEDURE AND CLINICAL ACTIVITY MANAGEMENT". ONLY THE PROCEDURE HALF EXISTED.
//
// Procedures are recorded inside a consultation, where the patient is -- that is right and unchanged. An
// ACTIVITY has no patient: a ward round, a teaching session, a mortality meeting. It belongs to the
// clinician, so it gets its own page rather than being wedged into a consultation it has nothing to do
// with.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// `activity`, NOT `activities` OR `procedures`: the public marketing section shares this URL space and a
// static route here shadows it silently. The slugs it owns are listed in navigation.ts, and
// practice-content-harness.ts is what catches a mistake -- it caught CPR-310 shipping at /practice/team.

export const dynamic = "force-dynamic";

export default async function ActivityPage({ searchParams }: {
  searchParams: Promise<{ mine?: string; kind?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "procedure.record")) redirect("/practice/home");

  const { mine, kind } = await searchParams;
  const admin = createAdminClient();
  const onlyMine = mine !== "0";

  const [activities, portfolio, locations] = await Promise.all([
    listActivities(admin, shell.ctx.workspaceId, {
      performedBy: onlyMine ? shell.ctx.userId : undefined,
      kind: kind || undefined,
    }),
    portfolioSummary(admin, shell.ctx.workspaceId, shell.ctx.userId),
    listLocations(admin, shell.ctx.workspaceId),
  ]);

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900">Clinical activity</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        What you did that was not a procedure &mdash; ward rounds, teaching, meetings, training. Recorded
        against you, not against a patient.
      </p>

      <ActivityConsole
        activities={activities}
        portfolio={portfolio}
        locations={locations}
        onlyMine={onlyMine}
        kind={kind ?? ""}
        me={shell.ctx.userId}
      />
    </div>
  );
}
