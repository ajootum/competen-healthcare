"use client";

/**
 * The only client code on this page.
 *
 * ⚠ IT IS CALLED "PRINT", NOT "DOWNLOAD PDF", AND THAT IS DELIBERATE. window.print() opens the
 * browser's dialogue; whether a PDF comes out of it is the reader's choice of destination. Labelling it
 * "Download PDF" would name a feature this product does not have -- there is no PDF generator here --
 * and the button would then behave differently from every other download on the site, which produce a
 * file without asking. The page says how to get a PDF in words beside it.
 */
export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()}
      className="rounded-lg border border-gray-200 px-3 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
      Print / Save as PDF
    </button>
  );
}
