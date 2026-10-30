/* eslint-disable @typescript-eslint/no-explicit-any */
import { experienceHref } from "@/lib/individual/experiences";
import { reasonFromRefusal, refusalCopy } from "@/lib/individual/ai-availability";

// The words a Professional AI action shows when the AI is not available -- the server's own refusal
// (src/lib/ai/allowance.ts meteredRefusalBody: error, code, continuity, standing), never a bare "try again".
// HFE-01 Wave 1: an AI refusal (the engine's code) is shown in the shared Individual words with its next step
// (src/lib/individual/ai-availability.ts), so every Professional surface explains it the same way. Anything else
// (validation, network) keeps its own message.

export type AiNotice = { text: string; continuity: boolean; next?: { label: string; href: string } | null };

/** Pure: a failed AI response's JSON, read as a notice. */
export function aiNotice(j: any, fallback: string): AiNotice {
  const continuity = j?.continuity === true || j?.standing?.level === "continuity";
  const reason = reasonFromRefusal(j);
  // The allowance words are the published policy's own (they can say when it renews), so they are kept.
  if (reason && reason !== "allowance_exhausted" && reason !== "level_insufficient") {
    const c = refusalCopy(j, "professional")!;
    return { text: c.text, continuity, next: c.next };
  }
  const text = typeof j?.error === "string" && j.error.trim() ? j.error : fallback;
  return { text: continuity ? `${text} Your goals, CPD and evidence stay available and can still be edited by hand.` : text, continuity };
}

/** The notice, with its next step (or, for an allowance refusal without one, a link to the person's AI allowance). */
export function AiNoticeText({ notice, className = "" }: { notice: AiNotice; className?: string }) {
  const next = notice.next ?? (notice.continuity ? { label: "See your AI allowance", href: experienceHref("professional", "ai-allowance") } : null);
  return (
    <p role="alert" className={`text-[13.5px] text-red-700 ${className}`}>
      {notice.text}{" "}
      {next && <a href={next.href} className="font-semibold underline underline-offset-2">{next.label}</a>}
    </p>
  );
}
