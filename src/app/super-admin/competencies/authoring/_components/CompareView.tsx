import Link from "next/link";
import { diffSummary, fieldLabel, formatValue } from "@/lib/competency/diff-format";
import type { DiffResponse } from "@/lib/competency/framework-diff";

// FRAMEWORK-DESIGN-STUDIO-02 S2: "Compare with published". Presents the S1 diff (framework-diff.ts) as it is: what a
// published version has and the draft now has differently. Read only and not a governance decision: the clinical
// fingerprint and the publication guards stay the authority on what needs review and who may publish.

type Props = {
  result: DiffResponse; components: Record<string, string>;
  /** competency id -> its name, for criteria moved between competencies. */
  names: Record<string, string>; levels: Record<string, string>; back: string;
};

const card = "rounded-2xl border border-gray-200 bg-white p-5";
const h = "text-[15px] font-bold text-gray-900";
const tag = (cls: string) => `inline-flex rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${cls}`;

export default function CompareView({ result, components, names, levels, back }: Props) {
  if (result.status === "no_published_version") {
    return (
      <section aria-label="Compare with published" className={card}>
        <h2 className={h}>No published version yet</h2>
        <p className="mt-1 max-w-2xl text-[13.5px] text-gray-700">{result.framework.name} has never been published, so there is nothing to compare it with. Once a version is published, this page shows what a draft changes against it.</p>
        <p className="mt-3 text-[13px]"><Link href={back} className="font-semibold text-teal-800 hover:underline">Back to the competencies →</Link></p>
      </section>
    );
  }
  const { diff, version } = result;
  const sec = (c: string | null) => (c ? components[c] ?? c : "Not classified");
  const when = version.publishedAt ? new Date(version.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Kampala" }) : null;
  const lookup = (id: string) => levels[id];
  const nm = (id: string) => names[id] ?? "another competency";

  return (
    <div className="space-y-5">
      <section aria-label="Compare with published" className={card}>
        <h2 className={h}>Compared with published version {version.label}</h2>
        <p className="mt-1 text-[12.5px] text-gray-600">Published{when ? ` ${when}` : ""}{version.publishedBy ? ` by ${version.publishedBy}` : ""}. Learners and assessors still see that version.</p>
        <p role="status" className="mt-3 text-[14px] font-semibold text-gray-900">{diffSummary(diff)}</p>
        <p className="mt-1 text-[12.5px] text-gray-600">This is a read-only comparison. It does not review, approve or publish anything.</p>
      </section>

      {(diff.framework.length > 0 || diff.domains.added.length > 0 || diff.domains.removed.length > 0 || diff.domains.renamed.length > 0 || diff.domains.reordered || diff.sectionOrderChanged) && (
        <section aria-label="Framework and domains" className={card}>
          <h3 className={h}>Framework and domains</h3>
          <ul className="mt-2 space-y-1.5 text-[13.5px] text-gray-900">
            {diff.framework.map(f => <li key={f.field}><span className="font-semibold">{f.field === "name" ? "Framework name" : "Framework description"}</span> changed. <Was before={f.before} after={f.after} /></li>)}
            {diff.domains.added.map(d => <li key={`a${d.id ?? d.name}`}><span className={tag("bg-teal-50 text-teal-900")}>Domain added</span> {d.name}</li>)}
            {diff.domains.removed.map(d => <li key={`r${d.id ?? d.name}`}><span className={tag("bg-red-50 text-red-900")}>Domain removed</span> {d.name}</li>)}
            {diff.domains.renamed.map(d => <li key={`n${d.id}`}><span className={tag("bg-amber-50 text-amber-900")}>Domain renamed</span> <Was before={d.before} after={d.after} /></li>)}
            {diff.domains.reordered && <li><span className={tag("bg-gray-100 text-gray-800")}>Order</span> The order of the domains changed.</li>}
            {diff.sectionOrderChanged && <li><span className={tag("bg-gray-100 text-gray-800")}>Order</span> The order of the assessment sections changed.</li>}
          </ul>
        </section>
      )}

      {(diff.competencies.added.length > 0 || diff.competencies.removed.length > 0) && (
        <section aria-label="Competencies added and removed" className={card}>
          <h3 className={h}>Competencies added and removed</h3>
          <ul className="mt-2 space-y-1.5 text-[13.5px] text-gray-900">
            {diff.competencies.added.map(c => <li key={`a${c.id}`}><span className={tag("bg-teal-50 text-teal-900")}>Added</span> <Code c={c.code} /> {c.name} <span className="text-gray-500">in {c.domain}</span></li>)}
            {diff.competencies.removed.map(c => <li key={`r${c.id}`}><span className={tag("bg-red-50 text-red-900")}>Removed</span> <Code c={c.code} /> {c.name} <span className="text-gray-500">from {c.domain}</span></li>)}
          </ul>
        </section>
      )}

      {diff.competencies.changed.length > 0 && (
        <section aria-label="Competencies changed" className={card}>
          <h3 className={h}>Competencies changed ({diff.competencies.changed.length})</h3>
          <div className="mt-2 divide-y divide-gray-100">
            {diff.competencies.changed.map(c => (
              <article key={c.id} className="py-3">
                <p className="text-[14px] font-semibold text-gray-900"><Code c={c.code} /> {c.name} <span className="font-normal text-gray-500">· {c.domain}</span></p>
                <ul className="mt-1.5 space-y-1.5 text-[13px] text-gray-900">
                  {c.fields.map(f => (
                    <li key={f.field}>
                      <span className="font-semibold">{fieldLabel(f.field)}</span> changed{" "}
                      <span className={tag(f.clinical ? "bg-amber-50 text-amber-900" : "bg-gray-100 text-gray-800")}>{f.clinical ? "Needs clinical review" : "Organisational"}</span>
                      <Was before={formatValue(f.before, lookup)} after={formatValue(f.after, lookup)} block />
                    </li>
                  ))}
                  {c.movedDomain && <li><span className={tag("bg-gray-100 text-gray-800")}>Moved</span> From the domain {c.movedDomain.from} to {c.movedDomain.to}.</li>}
                  {c.reordered && <li><span className={tag("bg-gray-100 text-gray-800")}>Order</span> Its place among the domain&apos;s competencies changed.</li>}
                  {c.criteria.added.map((k, i) => <li key={`a${k.id ?? i}`}><span className={tag("bg-teal-50 text-teal-900")}>Criterion added</span> <span className="text-gray-500">{sec(k.component)}</span> {k.text}</li>)}
                  {c.criteria.retired.map((k, i) => <li key={`t${k.id ?? i}`}><span className={tag("bg-red-50 text-red-900")}>Criterion retired</span> <span className="text-gray-500">{sec(k.component)}</span> {k.text}</li>)}
                  {c.criteria.removed.map((k, i) => <li key={`x${k.id ?? i}`}><span className={tag("bg-red-50 text-red-900")}>Criterion removed</span> <span className="text-gray-500">{sec(k.component)}</span> {k.text}</li>)}
                  {c.criteria.textChanged.map(k => <li key={`c${k.id}`}><span className={tag("bg-amber-50 text-amber-900")}>Criterion reworded</span> <span className="text-gray-500">{sec(k.component)}</span><Was before={k.before} after={k.after} block /></li>)}
                  {c.criteria.moved.map(k => (
                    <li key={`m${k.id}`}><span className={tag("bg-amber-50 text-amber-900")}>Criterion moved in</span> {k.text}
                      <span className="block text-[12.5px] text-gray-600">From {nm(k.from.competencyId)}, {sec(k.from.component)}, to {nm(k.to.competencyId)}, {sec(k.to.component)}.</span></li>
                  ))}
                  {c.criteria.movedOut.map(k => <li key={`o${k.id}`}><span className={tag("bg-amber-50 text-amber-900")}>Criterion moved out</span> {k.text} <span className="text-gray-500">to {nm(k.toCompetencyId)}</span></li>)}
                  {c.criteria.reordered.map(code => <li key={`s${code ?? ""}`}><span className={tag("bg-gray-100 text-gray-800")}>Order</span> The order of the criteria in {sec(code)} changed.</li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Code({ c }: { c: string | null }) { return <span className="font-mono text-[12px] text-gray-600">{c ?? "no code"}</span>; }

function Was({ before, after, block = false }: { before: string | null; after: string | null; block?: boolean }) {
  return (
    <span className={block ? "mt-1 grid gap-1 sm:grid-cols-2" : "inline"}>
      <span className={block ? "block whitespace-pre-wrap break-words rounded-lg bg-red-50/60 px-2 py-1 text-[12.5px] text-gray-800" : ""}><span className="text-gray-500">{block ? "Published: " : "Was: "}</span>{before ?? "Not set"}</span>
      {" "}
      <span className={block ? "block whitespace-pre-wrap break-words rounded-lg bg-teal-50/60 px-2 py-1 text-[12.5px] text-gray-800" : ""}><span className="text-gray-500">{block ? "Draft: " : "Now: "}</span>{after ?? "Not set"}</span>
    </span>
  );
}
