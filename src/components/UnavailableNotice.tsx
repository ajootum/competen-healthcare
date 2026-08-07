// The one place the platform says "this could not be read".
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS AT ALL. ~300 reads in src/lib do `const { data } = await …` and then `data ?? []`, so a
// failed read renders as an empty list — and an empty list is drawn as "No open escalations", "0 compliance
// issues", "no expiring competencies". The sentence for "nobody needs you" and the sentence for "we could
// not look" were the same sentence, sometimes with a green tick on it.
//
// Loaders now carry an `unavailable: string[]` naming the sources that failed. THIS COMPONENT IS WHAT MAKES
// THAT WORTH CARRYING: a flag no page renders is the flag-beside-a-broken-value antipattern, not a fix. If
// you add `unavailable` to a loader, add this to its page in the same change.
//
// IT RENDERS NOTHING WHEN THERE IS NOTHING TO SAY, so it is safe to place unconditionally at the top of any
// page whose loader reports one — no `&&` at the call site to forget.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function UnavailableNotice({ sources, what = "figures on this page", className = "" }: {
  /** Named sources that could not be read. Empty or undefined renders nothing. */
  sources?: string[] | null;
  /** What the missing sources feed, e.g. "the escalation queue". Kept plain — a nurse reads this. */
  what?: string;
  className?: string;
}) {
  if (!sources?.length) return null;
  const list = sources.length === 1
    ? sources[0]
    : `${sources.slice(0, -1).join(", ")} and ${sources[sources.length - 1]}`;

  return (
    <div
      role="status"
      className={`rounded-xl border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] px-4 py-3 text-sm text-rose-800 ${className}`}
    >
      <strong>Some {what} could not be read.</strong>{" "}
      The {list} {sources.length === 1 ? "source" : "sources"} did not load, so anything held there is not
      shown. <strong>Do not read this page as an all-clear</strong> — an absent figure is not a zero, and a
      short list is not a complete one.
    </div>
  );
}
