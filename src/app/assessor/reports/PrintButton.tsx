"use client";

// Print-optimised PDF export: opens the browser's print dialog; the print
// stylesheet in globals.css strips chrome so Save-as-PDF gives a clean report.
export default function PrintButton() {
  return (
    <button onClick={() => window.print()} title="Print or save this page as PDF"
      className="no-print text-[11px] font-semibold text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
      ⬇ PDF
    </button>
  );
}
