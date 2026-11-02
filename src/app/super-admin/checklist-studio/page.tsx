import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { listLibrary, loadRegistries } from "@/lib/assessment/studio/read";
import { LibraryTable } from "./_components/LibraryTable";
import { PageHead, StudioShell, linkBtn } from "./_components/studio-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checklist Studio" };

// /super-admin/checklist-studio -- Checklist Studio (S2), the library. One right (hq.assessment.studio.view) opens every Studio page and
// reads; each action inside re-checks its own capability, held through a Checklist Studio appointment. A platform owner without one can
// look but not change. Reads definition tables only: never an instance, response, evidence or outcome.
export default async function ChecklistStudioPage() {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.assessment.studio.view"));
  const [rows, registries] = await Promise.all([listLibrary(ctx.admin), loadRegistries(ctx.admin)]);
  const canAuthor = ctx.capabilities.includes(CAP.author);
  return (
    <StudioShell>
      <PageHead
        title="Checklist Studio"
        lede="Author checklists and assessments once, with their scoring and layout, then review and publish them through independent people. Published versions are frozen: a change is a new draft."
        right={
          <>
            <Link href="/super-admin/checklist-studio/scales" className={linkBtn}>Scales</Link>
            <Link href="/super-admin/checklist-studio/scoring-templates" className={linkBtn}>Scoring templates</Link>
            <Link href="/super-admin/checklist-studio/layout-templates" className={linkBtn}>Layout templates</Link>
            <Link href="/super-admin/checklist-studio/progression" className={linkBtn}>Progression rules</Link>
            <Link href="/super-admin/checklist-studio/review" className={linkBtn}>Review queue</Link>
          </>
        }
      />
      <LibraryTable rows={rows} registries={registries} canAuthor={canAuthor} />
    </StudioShell>
  );
}
