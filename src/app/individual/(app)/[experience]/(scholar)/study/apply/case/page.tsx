import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { countDue } from "@/lib/individual/scholar/store";
import { isPlayKind, viewPlay } from "@/lib/individual/scholar/clinical-routes";
import { PageHeader, StatePanel, focusRing } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { CasePlayer, type Play } from "../../_components/case-client";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// ONE CLINICAL CASE -- COMPETEN-SCHOLAR-CLINICAL-REASONING-01 CR2-CR5. ?kind=private|library&session=<id>[&hints=1].
// The student's own session, resumed where they left it: the learner view only (clinical-routes.ts viewPlay -- a
// private case on Scholar's engine, a library case on the shared delivery). No AI to open it, so it stays available
// whatever the student's AI allowance. Another person's session is "not found".

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Clinical case" });
}

export default async function CasePage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ kind?: string; session?: string; hints?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const q = await searchParams;
  const due = await countDue(ctx.admin, ctx.userId);
  const hints = q.hints === "1" || q.kind === "private";
  const play = isPlayKind(q.kind) && q.session ? await viewPlay(ctx.admin, ctx.userId, q.kind, q.session, hints) : null;
  return (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="My Learning" title="Clinical case"
        intro="Assess, interpret, prioritise, decide and explain. The case shows you what you have reached; ask for what you need to know." />
      <StudyNav dueCount={due} />
      {play ? <CasePlayer initial={play as unknown as Play} hints={hints} /> : (
        <StatePanel title="That case could not be found" actions={<Link href={experienceHref("scholar", "study/apply")} className={focusRing}>Back to Apply</Link>}>
          <p>It may have been removed with the materials it was written from, or it is not available here.</p>
        </StatePanel>
      )}
    </>
  );
}
