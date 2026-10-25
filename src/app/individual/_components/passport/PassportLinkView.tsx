import { CATEGORY_LABEL, TRUST_LABEL, VALIDITY_LABEL, orderItems, type PassportCategory, type PassportSelection, type Trust } from "@/lib/individual/passport-view";

// ONE RENDERING OF ONE PASSPORT LINK -- COMPETEN-PROFESSIONAL-PASSPORT-01 (Stage 7) P3 P5.
//
// The recipient's /verify page, the owner's preview and the printable export all render THIS, from the same
// loadPassportSelection read, so the preview is exactly what the recipient sees. Every item states where it came from,
// who issued or assessed it, when, which version, what it means (attendance, completion, assessed knowledge,
// self-report, formative evaluation or independent verification), how far it can be trusted, and whether it is still
// current. Nothing is upgraded, documents are never served, and only what was chosen for this link is here.

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : null);
const TRUST_TONE: Record<Trust, string> = {
  self_declared: "bg-amber-100 text-amber-900", document_supported: "bg-amber-100 text-amber-900", platform_recorded: "bg-sky-100 text-sky-900",
  educational: "bg-indigo-100 text-indigo-900", assessed: "bg-teal-100 text-teal-900", independently_verified: "bg-emerald-100 text-emerald-900",
};

export default function PassportLinkView({ selection, order, name, detailed = true }: { selection: PassportSelection; order: readonly PassportCategory[]; name: string | null; detailed?: boolean }) {
  const items = orderItems(selection.items, order);
  const categories = [...new Set(items.map(i => i.category))];
  const m = selection.meta;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{name ?? "Professional"}</h1>
        {m?.purposeLabel && <p className="text-[13px] text-gray-700">Shared for: <span className="font-semibold">{m.purposeLabel}</span>{m.recipientLabel ? ` · for ${m.recipientLabel}` : ""}</p>}
        {m?.summary && <p className="mt-2 whitespace-pre-wrap text-[13.5px] text-gray-800">{m.summary} <span className="text-[11px] text-gray-500">(in the professional&apos;s own words)</span></p>}
      </div>
      <details className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700">
        <summary className="cursor-pointer font-semibold">How to read this Passport</summary>
        <ul className="mt-1 space-y-0.5">
          {(Object.keys(TRUST_LABEL) as Trust[]).map(t => <li key={t}><span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${TRUST_TONE[t]}`}>{TRUST_LABEL[t]}</span></li>)}
        </ul>
        <p className="mt-1">Only records the professional chose for this link are shown. Documents are never shared. A course completion or a formative evaluation is not a verified clinical competence.</p>
      </details>
      {items.length === 0 && <p className="text-[13px] text-gray-600">This link carries no records.</p>}
      {categories.map(c => (
        <section key={c} aria-labelledby={`cat-${c}`}>
          <h2 id={`cat-${c}`} className="text-sm font-semibold text-gray-900">{CATEGORY_LABEL[c]}</h2>
          <ul className="mt-1 divide-y divide-gray-100">
            {items.filter(i => i.category === c).map(i => (
              <li key={i.key} className="py-2 text-[12.5px] text-gray-800">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{i.title}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${TRUST_TONE[i.trust]}`}>{TRUST_LABEL[i.trust]}</span>
                  <span className={`text-[10.5px] font-semibold ${i.validity === "current" || i.validity === "not_applicable" ? "text-gray-600" : "text-red-700"}`}>{VALIDITY_LABEL[i.validity]}</span>
                </div>
                {i.description && <p className="text-[12px] text-gray-700">{i.description}</p>}
                {detailed && <p className="text-[11px] text-gray-500">
                  {[i.sourceService, i.issuer ? `issued or provided by ${i.issuer}` : null, fmt(i.date), i.version, i.method, i.authority ? `authority: ${i.authority}` : null, i.evidenceRef].filter(Boolean).join(" · ")}
                </p>}
                <p className="text-[11px] text-gray-600">Meaning: {i.meaning}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {selection.unreadable.length > 0 && <p className="text-[12px] text-gray-600">Some records could not be read just now ({selection.unreadable.map(c => CATEGORY_LABEL[c].toLowerCase()).join(", ")}). Nothing is shown for them rather than a guess.</p>}
    </div>
  );
}
