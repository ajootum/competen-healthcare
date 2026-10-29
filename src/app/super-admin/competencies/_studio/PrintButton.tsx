"use client";

// Opens the browser's print dialog, where "Save as PDF" makes the PDF copy of the review pack.
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()}
      className="inline-flex items-center rounded-lg bg-teal-700 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-teal-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
      Print or save as PDF
    </button>
  );
}
