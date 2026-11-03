import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { listAssessableInstruments, listGrantsIMade } from "@/lib/assessment/assessor/grants";
import { GrantsAdmin } from "../_components/GrantsAdmin";

// /super-admin/checklist-assessments/grants -- the assessment coordinator's page (Checklist Studio S4). Guarded by
// hq.assessment.assessor.assign. A grant is the authority for one assessor to assess one person with one checklist. The person
// accepts it in their own product before the assessor can start, and can end it. The coordinator never assesses from here.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assessor grants" };

export default async function GrantsPage() {
  const ctx = await requireHqCapability("hq.assessment.assessor.assign");
  const [grants, instruments] = await Promise.all([listGrantsIMade(ctx.admin, ctx.userId), listAssessableInstruments(ctx.admin)]);
  return (
    <div data-cmp-theme="platform" className="max-w-4xl space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--cmp-theme-ink)]">Competen Holdings</p>
        <h1 className="text-xl font-bold text-[var(--cmp-app-text)]">Assessor grants</h1>
        <p className="mt-1 text-sm text-[var(--cmp-app-text-secondary)]">Give an authorised assessor the authority to assess one person with one checklist. The person must accept it before the assessment can start, and can end it at any time.</p>
        <p className="mt-1 text-xs text-[var(--cmp-app-text-secondary)]">You cannot grant authority over yourself or to yourself. <Link href="/super-admin/checklist-assessments" className="underline">Assessor workspace</Link></p>
      </header>
      {!grants.ok ? <p role="alert" className="rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 text-sm text-[var(--cmp-app-text)]">{grants.error}</p>
        : !instruments.ok ? <p role="alert" className="rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 text-sm text-[var(--cmp-app-text)]">{instruments.error}</p>
        : <GrantsAdmin initialGrants={grants.value} instruments={instruments.value} />}
    </div>
  );
}
