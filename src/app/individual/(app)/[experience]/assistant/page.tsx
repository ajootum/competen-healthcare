import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { aiStatus } from "@/lib/ai/config";
import { experiencePage, gatedMetadata } from "../../../_components/shell-context";
import type { Metadata } from "next";
import { PageHeader } from "../../../_components/chrome";
import AssistantPanel from "./AssistantPanel";
import { getAiStanding } from "@/lib/ai/allowance";
import { DEFAULT_PROFILE, MODE_ACTIVITY, loadAssistantProfile } from "@/lib/ai/personal-assistant";
import { crossExperienceConsented } from "@/lib/individual/scholar/store";
import CrossExperienceConsent from "./CrossExperienceConsent";
import { availabilityFromStanding } from "@/lib/individual/ai-availability";
import { AiUnavailableNote } from "../../../_components/ai/AiAvailability";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { listMaterials } from "@/lib/individual/scholar/store";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// PERSONAL AI -- COMPETEN-IND-003 s2(6). One AI in both experiences, through the existing gateway
// (/api/individual/assistant -> generate()). The page says what it can see and that nothing is saved.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Personal AI" }); }

export default async function AssistantPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experiencePage((await params).experience);
  if (!page) return null;
  const { experience } = page;
  const x = EXPERIENCES[experience];
  const configured = aiStatus().configured;
  // HFE-01 Wave 1: say before the first question whether the Personal AI can answer, and why not. The same
  // standing the route's gate reads; the route still refuses on its own.
  const standing = await getAiStanding(page.ctx.admin, { userId: page.ctx.userId, product: experience });
  const availability = availabilityFromStanding(standing, MODE_ACTIVITY[DEFAULT_PROFILE[experience].defaultMode]);
  // Migration 700: the cross-experience choice is offered only where the product allows it and the person has Professional.
  const crossOffered = experience === "scholar" && page.ctx.live.includes("professional")
    && (await loadAssistantProfile(page.ctx.admin, "scholar")).scopes.includes("own_development");
  const crossGranted = crossOffered && await crossExperienceConsented(page.ctx.admin, page.ctx.userId);
  // SCHOLAR-PAI-EXPERIENCE-01: "Edit and save as my card" needs flashcards offered and one of the learner's own
  // materials to file the card under. Neither: no save is offered (the answer and its practice still show).
  const ownCards = experience === "scholar" && (await loadIndividualPolicy(page.ctx.admin)).scholarFlashcards === "on"
    ? await listMaterials(page.ctx.admin, page.ctx.userId).then(r => (r.ok && r.data.length ? { materials: r.data.map(m => ({ id: m.id, title: m.title })) } : null), () => null)
    : null;
  const sees = `your name, the experiences on your account, and the competencies, credentials and employment in your Passport${experience === "professional" ? ", plus your Professional record: your self-declared profession and registering body, your development needs and goals, and your CPD activity (titles, dates and hours, never documents)" : ", plus your programme, level and study progress in Scholar"}${crossGranted ? ", and, because you turned it on, your Professional development needs and plan goals" : ""}`;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your foundation" title="Personal AI"
        intro={experience === "scholar"
          ? "A study companion. Ask about a topic, how to revise, or what is on your Competen record."
          : "A development companion. Ask about CPD planning, your development, or what is on your Competen record."} />
      {/* SCHOLAR-PAI-EXPERIENCE-01 HFE: one line of the facts, the full statement one click away (unchanged words). */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13px] leading-relaxed text-gray-600">
        <p>It sees your own Competen record only, never files, courses or other people. Nothing is saved, and answers are general guidance, not clinical advice.</p>
        <details className="mt-1">
          <summary className="inline-flex min-h-[32px] cursor-pointer items-center font-semibold text-gray-800 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900">What it can see and what is kept</summary>
          <p className="mt-1"><span className="font-semibold text-gray-800">What it can see:</span> {sees}. It cannot see files, courses or other people.</p>
          <p className="mt-1"><span className="font-semibold text-gray-800">Not saved:</span> each question is answered and then forgotten. Answers are general guidance, not clinical advice.</p>
        </details>
        {/* AI-FAIR-USE-01: where the person's AI allowance stands. Only while an allowance is actually metered
            (HFE-01 F1: with metering off the allowance page has nothing to show). */}
        {standing.metered && <p className="mt-1"><a href={experienceHref(experience, "ai-allowance")} className="font-semibold underline underline-offset-2" style={{ color: x.accent }}>Your AI allowance</a></p>}
      </div>
      {crossOffered && <CrossExperienceConsent granted={crossGranted} accent={x.accent} />}
      {!availability.available && <AiUnavailableNote id="ai-unavailable" reason={availability.reason} experience={experience} className="mb-4" />}
      {configured ? <AssistantPanel experience={experience} accent={x.accent} unavailable={!availability.available} ownCards={ownCards} />
        : <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-900">Personal AI is not available yet, so it cannot answer here.</p>}
    </>
  );
}
