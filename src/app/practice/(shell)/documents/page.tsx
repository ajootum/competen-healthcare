import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { documentsOverview } from "@/lib/practice/documents-workspace";
import { practiceToday } from "@/lib/practice/practice-time";
import { periodFromParams, allDatesTarget, periodLabel } from "@/lib/practice/period-range";
import WorkspaceHeader from "./_workspace/WorkspaceHeader";
import OverviewBoard from "./_workspace/OverviewBoard";
import DocumentsNavigator from "./DocumentsNavigator";
import type { Metadata } from "next";

/** The tab name, so a practitioner with several open can tell which is which. */
export const metadata: Metadata = { title: "Documents" };

// /practice/documents -- CPR-DOC-002 s4, THE OVERVIEW DASHBOARD.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS REPLACED, AND WHY (s22, "Documents landing page shows an empty library -> Replace with
// Overview dashboard and operational queues"). The previous page was CPR-130's document REGISTER: two
// lists of practitioner-authored documents, split by whether they had been signed. It was correct and it
// answered one question. It could not answer "what needs me", it could not see anything that ARRIVED,
// and its empty state was the words "No documents yet" -- which s4.1 forbids by name.
//
// The register itself is not lost. It is Patient Documents and My Documents, with the arrivals and the
// patient files merged into it, which is what s3 asks for.
//
// PHASE 1 ONLY (s20). No editor, no PDF render, no signature or sharing surface, no review queue, no AI
// drafting, no saved views. Where the comp draws one of those, it is not drawn here -- see the note in
// OverviewBoard.tsx about why "not drawn" rather than "drawn disabled".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function DocumentsOverviewPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  // The same gate the sidebar entry uses. document.view, which migration 195 grants the practitioner and
  // deliberately withholds from the practice owner -- the owner of a practice is a business role.
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const admin = createAdminClient();
  const clock = { timezone: shell.ctx.workspaceTimezone, today: practiceToday(shell.ctx.workspaceTimezone) };

  // ⚠ DEFAULT "All dates" -- this dashboard's existing behaviour, unchanged. See DocumentsNavigator.
  const period = periodFromParams(one, clock.today, allDatesTarget(clock.today));

  const overview = await documentsOverview(admin, shell.ctx.workspaceId, {
    userId: shell.ctx.userId, capabilities: shell.ctx.capabilities,
    // ⚠ THE RANGE REACHES THE QUERIES, not just applyFilter over the newest 500. See documentRegister.
    from: period.bounded ? period.fromDate : undefined,
    to: period.bounded ? period.toDate : undefined,
  });

  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <WorkspaceHeader active="overview" capabilities={shell.ctx.capabilities} />
      <DocumentsNavigator period={period} todayDate={clock.today} timezone={clock.timezone} />

      {/* ── THE THREE STATES, SAID ON THE PAGE ─────────────────────────────────────────────────────
          The board itself already distinguishes an unreadable source from an empty one, card by card.
          What it could not know until now is the difference between "this practice has no documents"
          and "this PERIOD has none" -- and s4.1's cheerful "here is how to get started" printed over the
          second would be a new way for an empty screen to mislead. */}
      {period.bounded && overview.register.rows.length === 0 && overview.register.unreadable.length === 0 && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          No document is dated in <strong>{periodLabel(period)}</strong> ({period.fromDate} to{" "}
          {period.toDate}). The three registers were all read successfully &mdash; this period is
          genuinely empty, and the practice may hold plenty outside it.
        </p>
      )}
      {overview.register.truncated.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <strong>{overview.register.truncated.join(" and ")} returned the maximum this page reads</strong>,
          so there is more in {period.bounded ? "this period" : "the register"} than is counted above.
          Narrow the period to see the rest.
        </p>
      )}

      <OverviewBoard overview={overview} capabilities={shell.ctx.capabilities} />
    </div>
  );
}
