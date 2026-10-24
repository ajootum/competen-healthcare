import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { aiStatus } from "@/lib/ai/config";
import { experiencePage, gatedMetadata } from "../../../_components/shell-context";
import type { Metadata } from "next";
import { PageHeader } from "../../../_components/chrome";
import AssistantPanel from "./AssistantPanel";

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

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your foundation" title="Personal AI"
        intro={experience === "scholar"
          ? "A study companion. Ask about a topic, how to revise, or what is on your Competen record."
          : "A development companion. Ask about CPD planning, your development, or what is on your Competen record."} />
      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13px] leading-relaxed text-gray-600">
        <p><span className="font-semibold text-gray-800">What it can see:</span> your name, the experiences on your account, and the competencies, credentials and employment in your Passport. It cannot see files, courses or other people.</p>
        <p className="mt-1"><span className="font-semibold text-gray-800">Not saved:</span> each question is answered and then forgotten. Answers are general guidance, not clinical advice.</p>
        {/* AI-FAIR-USE-01: where the person's AI allowance stands, and what stays available. */}
        <p className="mt-1"><a href={experienceHref(experience, "ai-allowance")} className="font-semibold underline underline-offset-2" style={{ color: x.accent }}>Your AI allowance</a></p>
      </div>
      {configured ? <AssistantPanel experience={experience} accent={x.accent} />
        : <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-900">The personal AI is not configured on this environment, so it cannot answer here.</p>}
    </>
  );
}
