import Link from "next/link";
import { PACK_NOTICE, versionLine, type Pack } from "@/lib/competency/review-pack";
import { PrintButton } from "./PrintButton";

// The clinical review pack, as a print-ready page (owner, 29 Oct 2026). "Print or save as PDF" prints only the pack:
// the HQ shell is hidden by the print style below. The Word copy is the same pack, from the server (review-pack.ts).
// Paper is for reading and notes; every competency carries its version and fingerprint, and every page says that the
// decision is recorded in Competen.

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #review-pack, #review-pack * { visibility: visible !important; }
  #review-pack { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
  .pack-noprint { display: none !important; }
  .pack-item { break-before: page; }
  .pack-item:first-of-type { break-before: auto; }
}`;

export function ReviewPackView({ pack, back, wordHref }: { pack: Pack; back: { href: string; label: string }; wordHref: string }) {
  return (
    <div className="max-w-4xl">
      <style>{PRINT_CSS}</style>
      <div className="pack-noprint mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={back.href} className="text-[13px] font-semibold text-teal-800 hover:underline">← {back.label}</Link>
        <div className="flex flex-wrap gap-2">
          {/* The Word copy is built from the published content: not offered for a revision preview. */}
          {!pack.revision && <a href={wordHref} className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50">Download Word (.docx)</a>}
          <PrintButton />
        </div>
      </div>
      <article id="review-pack" className="rounded-2xl border border-gray-200 bg-white p-6 print:border-0">
        <header className="border-b border-gray-200 pb-3">
          {pack.revision && <p role="status" className="mb-2 rounded-lg border-2 border-red-600 bg-red-50 px-3 py-2 text-[13.5px] font-bold text-red-950 print:border-red-800">Revision — not published. This pack shows the PROPOSED content of the open revision draft. Learners and assessors still see the published version.</p>}
          {pack.layout?.shown === "draft" && <p role="status" className="mb-2 rounded-lg border-2 border-amber-500 bg-amber-100 px-3 py-2 text-[13.5px] font-bold text-amber-950 print:border-amber-700">Preview: draft layout, not yet published</p>}
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings</p>
          <h1 className="text-[24px] font-bold text-gray-900">{pack.title}</h1>
          <p className="text-[13px] text-gray-600">{pack.scope}</p>
          <p className="text-[12.5px] text-gray-500">Prepared {new Date(pack.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" })}{pack.generatedBy ? ` for ${pack.generatedBy}` : ""}</p>
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">{PACK_NOTICE}</p>
        </header>
        {pack.items.length === 0 && <p className="mt-4 text-[13.5px] text-gray-600">Nothing is waiting, so the pack is empty.</p>}
        {pack.items.map(c => (
          <section key={c.competencyId} className="pack-item mt-6">
            <h2 className="border-b-2 border-teal-700 pb-1 text-[17px] font-bold text-teal-950">{c.code ? <span className="mr-2 font-mono text-[14px] text-teal-800">{c.code}</span> : null}{c.name}</h2>
            <p className="mt-1 text-[12.5px] text-gray-600">{c.domain} · {c.framework}</p>
            <p className="text-[12px] text-gray-500">{versionLine(c)}</p>
            {c.revision && <p className="mt-0.5 text-[12px] font-semibold text-red-900">{c.revision === "new" ? "Revision — new competency, not published" : c.revision === "changed" ? "Revision — changed from the published version, not published" : "Revision — opened, same content as published so far"}</p>}
            {c.description && <p className="mt-2 text-[13.5px] text-gray-800">{c.description}</p>}
            {c.outcomes.length > 0 && <><h3 className="mt-3 text-[13px] font-bold text-gray-900">Learning outcomes</h3><ul className="list-disc pl-5 text-[13px] text-gray-800">{c.outcomes.map((o, i) => <li key={i}>{o}</li>)}</ul></>}
            {c.groups.map(g => (
              <div key={g.label} className="mt-3">
                <h3 className="text-[13px] font-bold text-gray-900">{g.label} ({g.criteria.length})</h3>
                <ol className="mt-1 space-y-1 text-[13px] text-gray-800">
                  {g.criteria.map(k => <li key={k.n} className="flex gap-2"><span className="w-8 shrink-0 font-mono font-semibold text-teal-800">{k.n}</span><span>{k.text}</span></li>)}
                </ol>
              </div>
            ))}
            {c.checks.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"><h3 className="text-[12.5px] font-bold text-amber-950">Worth checking</h3><ul className="list-disc pl-5 text-[12.5px] text-amber-950">{c.checks.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
            <table className="mt-3 w-full border-collapse text-[12.5px]">
              <tbody>
                <tr><td className="w-1/2 border border-gray-300 p-2">☐ Recommend approval</td><td className="border border-gray-300 p-2">☐ Changes needed</td></tr>
                <tr><td colSpan={2} className="h-24 border border-gray-300 p-2 align-top">Comments:</td></tr>
                <tr><td className="border border-gray-300 p-2">Reviewer:</td><td className="border border-gray-300 p-2">Date:</td></tr>
              </tbody>
            </table>
          </section>
        ))}
      </article>
    </div>
  );
}
