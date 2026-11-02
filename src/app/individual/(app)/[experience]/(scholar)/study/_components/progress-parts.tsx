import Link from "next/link";
import { focusRing } from "../../../../../_components/chrome";

// PROGRESS, SIMPLER (My Plan correction CE-03). The three small pieces the page uses so a figure is said once: a fold-away list with its summary
// line always visible and the one line for what is not measured yet (the one "Your learning activity" block sits in progress-view.tsx with its honesty labels). Server components, no state.

/**
 * A list folded away behind its summary line: the line (what the list holds) is always visible and is the control; the list opens on tap.
 * The disclosure is native, so it works without script and keeps the focus doctrine of the page.
 */
export function Fold({ summary, children, open = false, label }: { summary: string; children: React.ReactNode; open?: boolean; label?: string }) {
  return (
    <details open={open} className="rounded-2xl border border-gray-200 bg-white">
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
