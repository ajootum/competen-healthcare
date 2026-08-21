import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import {
  paymentsOverview, listInvoices, outstandingBalances, listFees, uninvoicedCharges,
  facilityReceivables, listSettlements,
} from "@/lib/practice/billing";
import { listLocations } from "@/lib/practice/configuration";
import { practiceToday } from "@/lib/practice/practice-time";
import { periodFromParams, allDatesTarget, periodLabel } from "@/lib/practice/period-range";
import PaymentsConsole from "./PaymentsConsole";
import PaymentsNavigator from "./PaymentsNavigator";
import type { Metadata } from "next";

/** The tab name, so a practitioner with several open can tell which is which. */
export const metadata: Metadata = { title: "Payments" };

// /practice/payments -- CPR-PAY-001 s11, the practitioner's money workspace, under HFE-001 v1.1's
// PRACTICE section. Internal navigation: Overview | Transactions | Outstanding | Settlements | Fees.
//
// Settlements became a tab the day migration 304 was applied (Phase 2, 2026-08-15) -- it spent
// Phase 1 deliberately absent rather than drawn-and-dead, and the money it moves is the money the
// collector column has been keeping honest since 303.
//
// ⚠ NO PERCENTAGES. The comp prints "79% of invoiced" and a revenue donut; the standing honesty rule
// (one owner-approved exception, which is attendance, not this) renders every figure here as a count
// or a sum with its scope said in words.

export const dynamic = "force-dynamic";

export default async function PaymentsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "billing.view")) redirect("/practice/home");

  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const tab = ["overview", "transactions", "outstanding", "settlements", "fees"].includes(one("tab") ?? "")
    ? one("tab")! : "overview";
  const encounterId = one("encounter") ?? null;
  const patientId = one("patientId") ?? null;

  const admin = createAdminClient();
  // The practice's zone, handed to the client console below -- a client component has no workspace
  // clock of its own, and the browser's zone is the READER's, not the practice's.
  const timezone = shell.ctx.workspaceTimezone;
  const clock = { timezone, today: practiceToday(timezone) };
  // Money answers "over what period" -- but the default is everything, the same protective default
  // the activity portfolio chose: a this-month default would hide every older balance on day one.
  const period = periodFromParams(one, clock.today, allDatesTarget(clock.today));
  const bounds = period.bounded ? { fromDay: period.fromDate, toDay: period.toDate } : {};

  const [overview, invoices, outstanding, fees, locations, encounterCharges, receivables, settlements] = await Promise.all([
    paymentsOverview(admin, shell.ctx, bounds),
    listInvoices(admin, shell.ctx, { ...bounds, patientId: patientId ?? undefined }),
    outstandingBalances(admin, shell.ctx),
    listFees(admin, shell.ctx),
    listLocations(admin, shell.ctx.workspaceId),
    encounterId ? uninvoicedCharges(admin, shell.ctx, { encounterId }) : Promise.resolve(null),
    facilityReceivables(admin, shell.ctx),
    listSettlements(admin, shell.ctx),
  ]);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Payments</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Charges, payments and balances for your own work &mdash; {periodLabel(period)}. This
            records money; it never moves it.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <PaymentsNavigator period={period} todayDate={clock.today} timezone={clock.timezone}
          keep={{ tab, patientId, encounter: encounterId }} />
      </div>

      {overview.unavailable && (
        <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
          <strong>The money figures could not be read.</strong> {overview.detail}{" "}
          Nothing below is a statement that nothing is owed.
        </p>
      )}

      <PaymentsConsole
        timezone={timezone}
        tab={tab}
        overview={overview}
        invoices={invoices}
        outstanding={outstanding}
        fees={fees}
        locations={locations}
        encounterId={encounterId}
        encounterCharges={encounterCharges}
        patientId={patientId}
        canManageFees={hasCapability(shell.ctx, "fee.manage")}
        canDraft={hasCapability(shell.ctx, "invoice.draft")}
        canIssue={hasCapability(shell.ctx, "invoice.issue")}
        canRecordPayment={hasCapability(shell.ctx, "payment.record")}
        canAdjust={hasCapability(shell.ctx, "billing.adjust")}
        receivables={receivables}
        settlements={settlements}
      />

      <p className="mt-4 rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 text-[11px] text-gray-500">
        <strong className="text-gray-600">Collected is not received.</strong> Money a hospital or
        clinic took on your behalf shows as collected by them, and joins your received figure only
        when a settlement is recorded under Settlements &mdash; where your share, what has arrived and
        any difference are all visible. Every figure is a count or a sum in its own currency; nothing
        here is a rate.
      </p>
    </div>
  );
}
