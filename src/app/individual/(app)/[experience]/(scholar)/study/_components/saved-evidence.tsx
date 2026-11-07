import { ABSTRACT_ONLY_NOTE, NOT_ENDORSED_NOTE } from "@/lib/individual/scholar/teach-format";

// SCHOLAR-RESEARCH-TEACH-001: a saved lesson's published sources, wherever the lesson is shown as its stored text (the Library). Each [E n] in the
// text finds its record here: the provider's own details and links, and that only its abstract was read. Nothing for any other saved answer.

type Saved = { kind?: unknown; tag?: unknown; title?: unknown; authors?: unknown; journal?: unknown; year?: unknown; pmid?: unknown; doi?: unknown; accessed?: unknown };
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function SavedEvidenceList({ refs }: { refs: readonly unknown[] }) {
  const rows = (refs as (Saved | null)[]).filter((r): r is Saved => !!r && r.kind === "external" && r.accessed === "abstract" && !!str(r.tag) && !!str(r.title));
  if (!rows.length) return null;
  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-indigo-900">Research</p>
      <p className="text-[12px] text-gray-700">{ABSTRACT_ONLY_NOTE} {NOT_ENDORSED_NOTE}</p>
      <ul className="mt-1 space-y-1.5">
        {rows.map(r => {
          const authors = Array.isArray(r.authors) ? r.authors.filter((a): a is string => typeof a === "string") : [];
          return (
            <li key={str(r.tag)!} className="text-[12.5px] text-gray-800">
              <span className="mr-1 font-mono font-bold text-indigo-900">[{str(r.tag)}]</span>
              <span className="font-semibold">{str(r.title)}</span>
              {authors.length ? ` ${authors.join(", ")}${authors.length >= 3 ? " et al." : ""}.` : ""}{str(r.journal) ? ` ${str(r.journal)}` : ""}{typeof r.year === "number" ? ` (${r.year})` : ""}.
              {str(r.pmid) && <>{" "}<a href={`https://pubmed.ncbi.nlm.nih.gov/${str(r.pmid)}/`} target="_blank" rel="noopener noreferrer" className="underline">PMID {str(r.pmid)}</a></>}
              {str(r.doi) && <>{" "}<a href={`https://doi.org/${str(r.doi)}`} target="_blank" rel="noopener noreferrer" className="underline">DOI {str(r.doi)}</a></>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
