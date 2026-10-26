import type { Metadata } from "next";
import { EXPERIENCES } from "@/lib/individual/experiences";
import { getAiStanding } from "@/lib/ai/allowance";
import type { AiServiceLevel } from "@/lib/ai/fair-use-policy";
import { experiencePage, gatedMetadata } from "../../../_components/shell-context";
import { AiUnavailableNote } from "../../../_components/ai/AiAvailability";
import { PageHeader } from "../../../_components/chrome";

// Request-time only: it reads the release gate, the session and the allowance, never prerendered.
export const dynamic = "force-dynamic";

// YOUR AI ALLOWANCE -- COMPETEN-AI-FAIR-USE-01 s10. One page for every Individual experience, from the Holdings
// standing (src/lib/ai/allowance.ts getAiStanding). It shows where the person stands in plain words -- a band,
// never a token count -- when the allowance renews, which AI activities are available now, and, always, that
// everything already saved stays available. Nothing here can change an allowance: the page only reads.
//
// ⚠ LEARNING CONTINUITY, NOT AN ERROR. When the allowance is used, the page says what remains available and
// when AI help returns. It never implies that saved materials, questions, flashcards or progress are locked.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "AI allowance" }); }

const LEVEL_LABEL: Record<AiServiceLevel, string> = {
  full: "Available",
  optimised: "Available, in efficient mode",
  essential: "Essential help only",
  continuity: "Paused until your allowance renews",
};
const BAND_LABEL = { plenty: "Plenty left", some: "Some left", low: "A little left", none: "Used for this period" } as const;
const KEEPS: Record<"scholar" | "professional", string[]> = {
  scholar: ["Your uploaded documents and what was extracted from them", "Saved summaries and explanations", "Flashcards and revision", "Practice questions you already have, with their answers", "Stored clinical cases", "Your learning history, competency progress and Passport"],
  professional: ["Your profile, registration and credentials", "Development needs and goals", "Your CPD log and evidence", "Progress and your Passport"],
};

export default async function AiAllowancePage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experiencePage((await params).experience);
  if (!page) return null;
  const { ctx, experience } = page;
  const x = EXPERIENCES[experience];
  const standing = await getAiStanding(ctx.admin, { userId: ctx.userId, product: experience });
  const renew = standing.resetsAt ? new Date(standing.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your foundation" title="AI allowance"
        intro={standing.metered
          ? "Your subscription includes AI help, with fair use. Everything you have already saved stays available whatever your allowance."
          : "AI help comes with fair use. Everything you have already saved stays available whatever happens to AI help."} />

      {/* HFE-01 Wave 1 (F13): an unpublished AI policy is said plainly, in the shared words. */}
      {standing.policyPublished === false && <AiUnavailableNote reason="policy_unpublished" experience={experience} className="mb-4" />}

      {!standing.metered ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-[14px] text-gray-700">There is no monthly AI allowance yet. AI help follows a fair-use limit per hour instead.</p>
      ) : !standing.readable ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[14px] text-amber-900">
          Your AI allowance could not be checked just now, so new AI help is paused for the moment. Everything you have saved is still here.
        </p>
      ) : (
        <>
          <section aria-labelledby="now-h" className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
            <h2 id="now-h" className="text-[16px] font-bold text-gray-900">{LEVEL_LABEL[standing.level]}</h2>
            <p className="mt-1 text-[14px] text-gray-700">{standing.message}</p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-200 p-4">
                <dt className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Included allowance</dt>
                <dd className="mt-1 text-[18px] font-bold text-gray-900">{BAND_LABEL[standing.remaining.band]}</dd>
              </div>
              <div className="rounded-xl border border-gray-200 p-4">
                <dt className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Renews</dt>
                <dd className="mt-1 text-[18px] font-bold text-gray-900">{renew ?? "When your subscription renews"}</dd>
              </div>
            </dl>
            <details className="mt-3 text-[13px] text-gray-600">
              <summary className="cursor-pointer font-semibold text-gray-700">Detailed usage</summary>
              <p className="mt-1">{standing.remaining.percent === null ? "No allowance is set for this period." : `About ${standing.remaining.percent}% of this period's included AI allowance remains.`}</p>
            </details>
          </section>

          <section aria-labelledby="act-h" className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
            <h2 id="act-h" className="text-[16px] font-bold text-gray-900">AI activities</h2>
            <ul className="mt-2 divide-y divide-gray-100">
              {Object.entries(standing.activities).map(([code, a]) => (
                <li key={code} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <span className="text-[14px] text-gray-900">{a.label}</span>
                  <span className={`text-[13px] font-semibold ${a.available ? "text-gray-800" : "text-amber-900"}`}>
                    {a.available ? (a.via === "reserve" ? "Available from your essential-learning reserve" : "Available") : (a.reason ?? "Not available right now")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section aria-labelledby="keep-h" className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <h2 id="keep-h" className="text-[16px] font-bold text-gray-900">Always available</h2>
        <p className="mt-1 text-[13px] text-gray-600">These never depend on your AI allowance.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-gray-800">
          {KEEPS[experience].map(k => <li key={k}>{k}</li>)}
        </ul>
      </section>
    </>
  );
}
