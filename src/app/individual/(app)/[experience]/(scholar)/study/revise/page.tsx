import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage } from "../../../../../_components/shell-context";
import { dueCards, countDue } from "@/lib/individual/scholar/store";
import { citeChunk } from "@/lib/individual/scholar/extract";
import { PageHeader, StatePanel, Unreadable } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { CardReview, sourceHref, type CardView } from "../_components/client";

// REVISE -- COMPETEN-IND-004 s4. The person's due review cards: every question they missed becomes one,
// scheduled by SM-2 (src/lib/delivery/reinforcement.ts). They read the question, reveal the answer with
// its source in their notes, and grade their own recall. The grade reschedules the card.

export const metadata: Metadata = { title: "Revise" };

export default async function Revise({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [cards, due] = await Promise.all([dueCards(ctx.admin, ctx.userId), countDue(ctx.admin, ctx.userId)]);

  const views: CardView[] = cards.ok ? cards.data.map(c => {
    const q = c.question;
    return {
      id: c.id, stem: q.stem, answer: q.options[q.correctIndex], rationale: q.rationale, quote: q.sourceQuote,
      citation: `${q.materialTitle}, ${q.ordinal !== null ? citeChunk({ ordinal: q.ordinal, pageFrom: q.pageFrom, pageTo: q.pageTo }) : "source section"}`,
      href: sourceHref(q.materialId, q.chunkId),
    };
  }) : [];

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Learning" title="Revise"
        intro="Questions you got wrong come back here on a spaced schedule: soon after you miss them, then further apart as you remember them." />
      <StudyNav dueCount={due} />
      {!cards.ok ? (cards.notProvisioned
        ? <StatePanel title="Revision is not set up on this environment yet"><p>The study store it needs has not been installed here.</p></StatePanel>
        : <Unreadable what="review cards" />)
        : cards.data.length === 0 ? (
          <StatePanel title="Nothing is due for review">
            <p>Cards appear here when you get a practice or case question wrong. Answer some questions on one of your materials to start.</p>
          </StatePanel>
        ) : <CardReview cards={views} />}
    </>
  );
}
