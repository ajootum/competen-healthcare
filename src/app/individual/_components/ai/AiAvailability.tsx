/* eslint-disable @typescript-eslint/no-explicit-any */
import { aiReasonCopy, refusalCopy, type AiAvailability, type AiUnavailableReason } from "@/lib/individual/ai-availability";
import type { ExperienceKey } from "@/lib/individual/experiences";

// HFE-01 Wave 1: the one way an Individual surface shows that AI is not available, before or after a click.
// The words come from src/lib/individual/ai-availability.ts. These pieces only present: the server refusal is
// always the control, and an action disabled here is still refused if it is sent.

function Next({ next }: { next: { label: string; href: string } | null }) {
  return next ? <> <a href={next.href} className="font-semibold underline underline-offset-2">{next.label}</a></> : null;
}

/** Shown beside or under an AI action that is not available now. Give the action aria-describedby={id}. */
export function AiUnavailableNote({ id, reason, experience, className = "" }: { id?: string; reason: AiUnavailableReason; experience: ExperienceKey; className?: string }) {
  const c = aiReasonCopy(reason, experience);
  return (
    <p id={id} className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-700 ${className}`}>
      <span aria-hidden className="mr-1">✦</span>{c.text}<Next next={c.next} />
    </p>
  );
}

/** Props for an AI action button: disabled with the reason attached when AI is not available. */
export function aiActionProps(availability: AiAvailability | null | undefined, noteId: string) {
  return availability && !availability.available ? { disabled: true, "aria-describedby": noteId } : {};
}

/**
 * What a failed AI request shows. An AI refusal (the engine's code) gets the shared words and next step; anything
 * else (validation, network) shows its own message.
 */
export function AiRefusalNotice({ body, fallback, experience, className = "" }: { body: any; fallback: string; experience: ExperienceKey; className?: string }) {
  const c = refusalCopy(body, experience);
  if (c) {
    return <p role="alert" className={`text-[13.5px] font-medium text-red-700 ${className}`}>{c.text}<Next next={c.next} /></p>;
  }
  const text = typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
  return <p role="alert" className={`text-[13.5px] font-medium text-red-700 ${className}`}>{text}</p>;
}
