import { CONTENT_STATUS_LABEL, FLAG_HEADING, FLAG_NOTE, SOURCE_KIND_LABEL } from "@/lib/individual/scholar/config";

// STAGE 3 ACCEPTANCE ITEM 3 -- ONE rendering, in Learn and in Saved learning, of the two kinds of content a student
// could mistake for review. An AI flag is the AI's, for the student to check: amber, dashed, marked, and never styled
// as review. A governed reference shows "Clinically approved" (emerald, with a tick) only where the route says
// `approved` -- 395 approved that exact content (learn.ts referenceStatus). A status string alone never shows it.

export type ShownReference = { tag?: string; title?: string; code?: string | null; outcome?: string | null; status?: string; approved?: boolean };

export function GovernedReferenceList({ refs }: { refs: readonly ShownReference[] }) {
  return (
    <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2">
      <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-teal-900">{SOURCE_KIND_LABEL.reference}</p>
      <ul className="mt-1 space-y-0.5">
        {refs.map((x, i) => (
          <li key={x.tag ?? i} className="text-[12.5px] text-gray-800">
            {x.tag && <span className="font-mono font-bold">[{x.tag}] </span>}{x.code ? `${x.code} ` : ""}{x.title}{x.outcome ? ` -- ${x.outcome}` : ""}{" "}
            {x.approved === true
              ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-900"><span aria-hidden>✓</span>{CONTENT_STATUS_LABEL.approved}</span>
              : <span className="text-gray-600">({x.status && x.status !== CONTENT_STATUS_LABEL.approved ? x.status : CONTENT_STATUS_LABEL.unreviewed})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiFlagList({ flags }: { flags: readonly { text: string }[] }) {
  return (
    <div role="note" aria-label={FLAG_HEADING} className="mt-2 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-amber-900"><span aria-hidden>⚑</span>{FLAG_HEADING}</p>
      <p className="mt-0.5 text-[12px] text-amber-950">{FLAG_NOTE}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-amber-950">{flags.map((f, i) => <li key={i}>{f.text}</li>)}</ul>
    </div>
  );
}
