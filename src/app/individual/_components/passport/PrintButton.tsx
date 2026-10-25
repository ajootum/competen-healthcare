"use client";

// Print or save one Passport view (COMPETEN-PROFESSIONAL-PASSPORT-01 P4 export). The browser's own print dialog: nothing
// is generated on the server, nothing is stored, and the printed page carries its issue date and the link to check.
export default function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()}
      className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-300 bg-white px-4 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 print:hidden">
      {label}
    </button>
  );
}
