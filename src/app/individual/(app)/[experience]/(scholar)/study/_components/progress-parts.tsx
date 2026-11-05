import Link from "next/link";
import { ProgressMark, type ProgressState } from "@/components/ui/scholar-learning";
import type { EvidenceWord } from "@/lib/individual/scholar/learning-state";
import { focusRing } from "../../../../../_components/chrome";

// PROGRESS, SIMPLER (My Plan correction CE-03). The three small pieces the page uses so a figure is said once: a fold-away list with its summary
// line always visible and the one line for what is not measured yet (the one "Your learning activity" block sits in progress-view.tsx with its honesty labels). Server components, no state.

// Scholar learning design system (DS rollout, Progress). These read --learn-* from the tone of the section they sit in. They are plain class
// strings because this page renders on the server, where a client module's values cannot be read.
const action = `inline-flex min-h-[40px] items-center justify-center rounded-xl border px-4 py-1.5 text-[13.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
export const toneAction = {
  primary: `${action} border-[var(--learn-ink)] bg-[var(--learn-ink)] text-[var(--learn-surface)] hover:opacity-90`,
  secondary: `${action} border-[var(--learn-border)] bg-[var(--cmp-app-surface)] text-gray-900 hover:bg-[var(--learn-surface)]`,
  link: `inline-flex items-center rounded font-semibold text-[var(--learn-ink)] underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`,
} as const;
/** The line under a section's heading: what the section is. */
export const sectionLead = "mt-2 max-w-[68ch] text-[13.5px] leading-relaxed text-gray-800";

const CHIP_TONE = {
  strong: "border-[var(--cmp-learn-check-border)] bg-[var(--cmp-learn-check-surface)] text-[var(--cmp-learn-check-ink)]",
  developing: "border-[var(--cmp-role-revision-accent)] bg-[var(--cmp-role-revision-soft)] text-[var(--cmp-role-revision-ink)]",
  needs_work: "border-[var(--cmp-role-revision-strong)] bg-[var(--cmp-role-revision-soft)] text-[var(--cmp-role-revision-ink)]",
  neutral: "border-gray-300 bg-[var(--cmp-app-surface)] text-gray-700",
} as const;
export type ChipLook = { tone: keyof typeof CHIP_TONE; mark: ProgressState };

/** A state in words with a shape: formative, never red and never a reassuring green. The colours are the ones Evaluate's bands use. */
export function StateChip({ tone, mark, children }: ChipLook & { children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${CHIP_TONE[tone]}`}><ProgressMark state={mark} />{children}</span>;
}

/** How strong the evidence is, in one look wherever it is said (What your evidence shows, Applying what you learned). */
export const EVIDENCE_WORD_LOOK: Record<EvidenceWord, ChipLook> = {
  none: { tone: "neutral", mark: "none" },
  thin: { tone: "developing", mark: "none" },
  some: { tone: "strong", mark: "read" },
  stronger: { tone: "strong", mark: "checked" },
};

/**
 * A list folded away behind its summary line: the line (what the list holds) is always visible and is the control; the list opens on tap.
 * The disclosure is native, so it works without script and keeps the focus doctrine of the page.
 */
export function Fold({ summary, children, open = false, label }: { summary: string; children: React.ReactNode; open?: boolean; label?: string }) {
  return (
    // SALE-2026-11 R1: the browser may restore a native disclosure's open state before hydration (back / revisit): not a content mismatch.
    <details open={open} suppressHydrationWarning className="rounded-2xl border border-gray-200 bg-white">
      <summary className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-4 py-2 text-[13.5px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
        <span className="min-w-0">{summary}</span>
        <span className="shrink-0 text-[12.5px] font-normal text-gray-600">{label ?? "Show"}</span>
      </summary>
      <div className="border-t border-gray-100">{children}</div>
    </details>
  );
}

/** One concise line for what is not measured yet (or for a section where nothing is), with a way to the evidence. */
export function NotMeasuredLine({ text, href }: { text: string; href?: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-3 text-[13.5px] text-gray-700" data-testid="not-measured">
      {text}{href ? <> <Link href={href} className={`font-semibold underline underline-offset-2 ${focusRing}`}>See the evidence</Link></> : null}
    </p>
  );
}
