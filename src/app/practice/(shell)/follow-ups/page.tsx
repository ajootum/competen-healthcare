import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { followUpWorkspace } from "@/lib/practice/follow-ups";
import { recallQueue } from "@/lib/practice/follow-up-plans";
import FollowUpsWorkspace from "./FollowUpsWorkspace";
import RecallQueue from "./RecallQueue";

// /practice/follow-ups -- CPR-FUP-001, the continuity-of-care workspace.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS IS A WORK QUEUE, NOT A DOCUMENTATION SCREEN (s2, s5). Nothing clinical is written here: the row
// actions open the consultation or the patient, move a date, or settle an obligation. "Avoid duplicate
// clinical entry" is s7's rule and it is the reason this page has no note field on it.
//
// ⚠ OVERDUE IS DERIVED, AND SO IS EVERY OTHER FIGURE ON THE PAGE. Nothing runs; nothing is stored. The
// due date is compared against the PRACTICE's today (migration 196's header, and CPR-FUP-002 s11 in its
// own words). A practice that has not opened this app for a fortnight sees the whole backlog the moment
// it does, which is exactly the case a stored status would get wrong.
//
// ⚠ EVERY CARD'S FIGURE IS THE LENGTH OF THE LIST THAT CARD OPENS. The engine returns the card's own
// row ids alongside its count, and the tab renders those rows. See followUpWorkspace.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function FollowUpsPage({ searchParams }: {
  searchParams: Promise<{ view?: string; q?: string; priority?: string; source?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "followup.view")) redirect("/practice/home");

  const sp = await searchParams;
  const admin = createAdminClient();

  const [workspace, recall] = await Promise.all([
    followUpWorkspace(admin, shell.ctx.workspaceId, {
      view: sp.view ?? null,
      search: sp.q ?? null,
      priority: sp.priority ?? null,
      source: sp.source ?? null,
    }),
    recallQueue(admin, shell.ctx.workspaceId),
  ]);

  return (
    <div className="max-w-[1400px]">
      {/* ⚠ initialView IS THE ENGINE'S RESOLVED KEY, NOT THE RAW QUERY STRING. `?view=nonsense` made the
          engine fall back to "all" and show that list while this prop still said "nonsense" -- so the
          rows were the All tab's and no tab was lit. The fallback is one rule and it lives in the
          engine; the client had been quietly keeping a second copy of it. */}
      <FollowUpsWorkspace
        workspace={workspace}
        canManage={hasCapability(shell.ctx, "followup.manage")}
        initialView={workspace.view}
        initialSearch={sp.q ?? ""}
        initialPriority={sp.priority ?? ""}
        initialSource={sp.source ?? ""}
        recall={<RecallQueue recall={recall} />}
      />
    </div>
  );
}
