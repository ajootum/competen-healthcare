import { DIMENSION_HELP } from "@/lib/assessment/catalogue/shape";
import type { TaxonomyDimension } from "@/lib/assessment/catalogue/classify";
import type { Family } from "@/lib/assessment/catalogue/families";

// Static explainer. The dimension and family names are read from the registries so the guide cannot drift from them.
export default function ClassificationGuide({ taxonomy, families }: { taxonomy: TaxonomyDimension[]; families: Family[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <h2 className="text-base font-bold text-gray-900">How an instrument is classified</h2>
        <p className="mt-1 text-[13px] text-gray-700">
          Each axis is independent, so nothing is filed in a folder. An instrument carries any number of terms on an axis, and one primary term where a single answer is needed (for example the domain shown in the registry).
        </p>
        <dl className="mt-3 divide-y divide-gray-100">
          {taxonomy.filter(d => d.isActive).map(d => (
            <div key={d.code} className="py-2">
              <dt className="text-[13px] font-bold text-gray-900">{d.label}</dt>
              <dd className="text-[12.5px] text-gray-700">{DIMENSION_HELP[d.code] ?? "A classification axis."} {d.terms.length > 0 && <span className="text-gray-600">{d.terms.filter(t => t.isActive).length} terms.</span>}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <h2 className="text-base font-bold text-gray-900">Family, method and permitted modes are three different things</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-gray-800">
          <li><b>Family</b> is the kind of instrument. It prefixes the permanent code (for example CA-000001) and cannot change once the instrument is registered.</li>
          <li><b>Method</b> is how the assessment is carried out. It is a classification term and can change.</li>
          <li><b>Permitted modes</b> (self, assessor, auditor) are set in the published version by Checklist Studio. The catalogue shows them and never edits them.</li>
        </ul>
        <h3 className="mt-4 text-[13px] font-bold uppercase tracking-wide text-gray-700">Families</h3>
        <ul className="mt-1 grid gap-1 text-[13px] text-gray-800 sm:grid-cols-2">
          {families.filter(f => f.isActive).map(f => <li key={f.code}><span className="font-mono text-[12px] font-bold text-teal-900">{f.code}</span> {f.label}</li>)}
        </ul>
      </section>
      <section className="rounded-xl border border-gray-100 bg-white p-5 lg:col-span-2">
        <h2 className="text-base font-bold text-gray-900">Who does what</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Catalogue", "Registers identity. Classifies. Says which products can discover an instrument. Holds metadata only."],
            ["Checklist Studio", "Writes the content: sections, items, scales, scoring and layouts. Versions, reviews and publishes it."],
            ["Assessment engine", "Delivers a published version and records the answers. The catalogue never sees those records."],
            ["Products", "Decide whether and to whom an instrument is offered, under their own policy."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-gray-100 p-3"><p className="text-[13px] font-bold text-gray-900">{t}</p><p className="mt-1 text-[12.5px] text-gray-700">{d}</p></div>
          ))}
        </div>
      </section>
    </div>
  );
}
