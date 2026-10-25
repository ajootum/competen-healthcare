/* eslint-disable @typescript-eslint/no-explicit-any */
import { experienceHref } from "@/lib/individual/experiences";

// The words a Professional AI action shows when the AI is not available -- the server's own refusal
// (src/lib/ai/allowance.ts meteredRefusalBody: error, continuity, standing), never a bare "try again". When the
// allowance for the period is used (continuity), it says what still works and where to see the allowance.

export type AiNotice = { text: string; continuity: boolean };

/** Pure: a failed AI response's JSON, read as a notice. */
export function aiNotice(j: any, fallback: string): AiNotice {
  const continuity = j?.continuity === true || j?.standing?.level === "continuity";
  const text = typeof j?.error === "string" && j.error.trim() ? j.error : fallback;
  return { text: continuity ? `${text} Your goals, CPD and evidence stay available and can still be edited by hand.` : text, continuity };
}

/** The notice, with a link to the person's AI allowance whenever the refusal is about the allowance. */
export function AiNoticeText({ notice, className = "" }: { notice: AiNotice; className?: string }) {
  return (
    <p role="alert" className={`text-[13.5px] text-red-700 ${className}`}>
      {notice.text}{" "}
      {notice.continuity && <a href={experienceHref("professional", "ai-allowance")} className="font-semibold underline underline-offset-2">See your AI allowance</a>}
    </p>
  );
}
