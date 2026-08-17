import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { followUpWorkspace } from "@/lib/practice/follow-ups";
import { recallQueue } from "@/lib/practice/follow-up-plans";
import { workspaceClock } from "@/lib/practice/practice-time";
import { periodFromParams, allDatesTarget } from "@/lib/practice/period-range";
import FollowUpsWorkspace from "./FollowUpsWorkspace";
import FollowUpsNavigator from "./FollowUpsNavigator";
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "followup.view")) redirect("/practice/home");

  const raw = await searchParams;
  const one = (k: string) => { const v = raw[k]; return Array.isArray(v) ? v[0] : v; };
  const sp = { view: one("view"), q: one("q"), priority: one("priority"), source: one("source"), type: one("type") };
  const admin = createAdminClient();
  const clock = await workspaceClock(admin, shell.ctx.workspaceId);

  // ⚠ THE DEFAULT IS "All dates" AND IT HAS TO BE. See FollowUpsNavigator: a default period on a work
  // queue would hide the longest-overdue people first, which is the opposite of what this board is for.
  const period = periodFromParams(one, clock.today, allDatesTarget(clock.today));

  const [workspace, recall] = await Promise.all([
    followUpWorkspace(admin, shell.ctx.workspaceId, {
      view: sp.view ?? null,
      search: sp.q ?? null,
      priority: sp.priority ?? null,
      source: sp.source ?? null,
      followUpType: sp.type ?? null,
      // ⚠ THE READ IS BOUNDED, NOT JUST THE URL. Every card below is counted from this same narrowed
      // read, so no figure can disagree with the list it opens.
      dueFrom: period.bounded ? period.fromDate : null,
      dueTo: period.bounded ? period.toDate : null,
    }),
    recallQueue(admin, shell.ctx.workspaceId),
  ]);

  return (
    <div className="max-w-[1400px]">
      <div className="mb-4">
        {/* The door to plan authoring. Without it the templates screen is a URL nobody was told about,
            which is the built-but-unreachable class this codebase keeps finding the hard way. */}
        <div className="mb-1.5 flex justify-end">
          {/* CPR-MOB-001 s4: 44px below md. A door that only a mouse can hit is the same unreachable
              screen this link exists to prevent, one input device further along. */}
          <Link href="/practice/follow-ups/templates"
            className="text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline max-md:inline-flex max-md:min-h-[var(--cp-touch)] max-md:items-center">
            Plan templates &rarr;
          </Link>
        </div>
        <FollowUpsNavigator
          period={period} todayDate={clock.today} timezone={clock.timezone}
          keep={{
            view: sp.view ?? null, q: sp.q ?? null,
            priority: sp.priority ?? null, source: sp.source ?? null, type: sp.type ?? null,
          }}
        />
        {/* ⚠ THE THREE STATES. A narrowed queue that could not be read must not look like a period with
            nobody in it, and a period with genuinely nobody in it must not look like a fault. */}
        {workspace.unavailable ? (
          <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
            <strong>The follow-up queue could not be read.</strong> {workspace.detail}{" "}
            Nothing below is a statement that nobody is waiting.
          </p>
        ) : period.bounded && workspace.readCount === 0 ? (
          <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
            Nothing is due between <strong>{period.fromDate}</strong> and <strong>{period.toDate}</strong>.
            The read succeeded &mdash; this period is genuinely empty. Obligations due outside it are not
            counted here.
          </p>
        ) : null}
      </div>

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
        initialType={sp.type ?? ""}
        recall={<RecallQueue recall={recall} />}
      />
    </div>
  );
}
