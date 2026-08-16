"use client";

// The download button a reader expects on a print view. window.print() opens the browser's dialog,
// where "Save as PDF" IS the download -- the same print-view-is-the-PDF policy every print route
// states, now with a control instead of only a sentence. One shared component so eight print views
// cannot drift into eight wordings.

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()}
      className="rounded-lg bg-[var(--cp-primary)] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
      Print / Save as PDF
    </button>
  );
}
