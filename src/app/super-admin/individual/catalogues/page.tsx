import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { CONTENT_STATUS_LABEL, listCatalogues, loadEntries, loadReference, type EntryView } from "@/lib/competency/catalogue-entries";
import { AddEntries, EntryStatus } from "./_components/CatalogueControls";

// /super-admin/individual/catalogues -- P0 controlled competency catalogues (migration 394).
//
// A controlled catalogue is a shared framework that NAMES existing competencies -- with their domain,
// practice and clinical practice unit (CKCM spine) -- and copies none. Each named competency carries a
// content status: approved, draft or not clinically reviewed. Guarded by hq.individual.config.manage.
//
// ⚠ THIS PAGE DOES NOT PUBLISH. Publication is the governed framework lifecycle (submit for review, then an
// independent approver). Once a catalogue leaves draft its entries are frozen (the 394 trigger), and it
// reaches Scholar or Professional only after it is published AND named in that allowlist on the Individual
// policy page. Existing frameworks are never offered by being referenced.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Controlled catalogues" };

const STATUS_STYLE: Record<string, string> = {
  approved: "border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  draft: "border-[var(--cmp-color-information)] bg-[var(--cmp-surface-information)] text-blue-900",
  unreviewed: "border-amber-300 bg-amber-50 text-amber-900",
};
const PUB_LABEL: Record<string, string> = { draft: "Draft -- entries can be changed", in_review: "In review -- entries frozen", approved: "Approved -- entries frozen", published: "Published -- entries frozen", archived: "Archived -- entries frozen" };

function group(entries: EntryView[]) {
  const by = new Map<string, EntryView[]>();
  for (const e of entries) {
    const k = e.practice ? `${e.practice.code ?? ""} ${e.practice.name}`.trim() : "No practice recorded";
    by.set(k, [...(by.get(k) ?? []), e]);
  }
  return [...by];
}

export default async function CataloguesPage({ searchParams }: { searchParams: Promise<{ catalogue?: string; browse?: string; practice?: string }> }) {
  const ctx = await requireHqCapability("hq.individual.config.manage");
  const sp = await searchParams;
  const catalogues = await listCatalogues(ctx.admin);
  const current = catalogues?.find(c => c.id === sp.catalogue) ?? null;
  const [entries, reference] = current
    ? await Promise.all([loadEntries(ctx.admin, current.id), current.status === "draft" ? loadReference(ctx.admin, sp.browse ?? null) : Promise.resolve(null)])
    : [null, null];
  const inCatalogue = new Set((entries ?? []).map(e => e.competencyId));
  const practice = reference?.practices.find(p => p.id === sp.practice) ?? null;
  const options = (reference?.competencies ?? [])
    .filter(c => !inCatalogue.has(c.id))
    .filter(c => practice ? c.practiceId === practice.id || practice.cpus.some(u => u.id === c.cpuId) : !!sp.browse)
    .map(c => ({ id: c.id, label: `${c.title}${c.code ? ` (${c.code})` : ""} -- ${c.home}, ${c.domain}` }));

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Individual</p>
        <h1 className="text-xl font-bold text-gray-900">Controlled catalogues</h1>
        <p className="mt-1 text-sm text-gray-600">
          A controlled catalogue names existing competencies, with their practice and clinical practice unit, and copies none. Each one says
          whether its content is approved, a draft, or not clinically reviewed. Publishing goes through the framework review, and a published
          catalogue reaches a person only once it is chosen on the Individual policy page.
        </p>
      </header>

      {catalogues === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          The catalogues could not be read just now (or migration 394 is not applied on this environment). Nothing is shown rather than a partial list.
        </p>
      ) : (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label htmlFor="cat" className="text-[13px] font-semibold text-gray-800">Catalogue</label>
          <select id="cat" name="catalogue" defaultValue={current?.id ?? ""} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px]">
            <option value="">Choose a catalogue</option>
            {catalogues.map(c => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""} -- {c.status}, {c.entries} named</option>)}
          </select>
          <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50">Open</button>
          {catalogues.length === 0 && <p className="w-full text-[13px] text-gray-600">No shared framework is classified as a catalogue yet. Classify one (its layer) in the framework library first.</p>}
        </form>
      )}

      {current && (
        <section aria-labelledby="entries-h" className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 id="entries-h" className="text-[16px] font-bold text-gray-900">{current.name}</h2>
          <p className="text-[13px] text-gray-600">{PUB_LABEL[current.status] ?? current.status}. Layer: {current.layer ?? "not set"}.</p>
          {entries === null ? <p role="alert" className="mt-3 text-[13px] text-[var(--cmp-text-critical)]">Its entries could not be read just now.</p>
            : entries.length === 0 ? <p className="mt-3 text-[13px] text-gray-600">It names no competency yet.</p> : (
            <div className="mt-3 space-y-4">
              {group(entries).map(([practiceName, list]) => (
                <div key={practiceName}>
                  <h3 className="text-[13px] font-bold uppercase tracking-[0.1em] text-gray-500">{practiceName}</h3>
                  <ul className="mt-1 divide-y divide-gray-100">
                    {list.map(e => (
                      <li key={e.id} className="py-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-[14px] font-semibold text-gray-900">{e.title}{e.code ? <span className="font-normal text-gray-500"> ({e.code})</span> : null}</p>
                          <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${STATUS_STYLE[e.contentStatus]}`}>{CONTENT_STATUS_LABEL[e.contentStatus]}</span>
                        </div>
                        <p className="text-[12.5px] text-gray-600">From {e.home} · {e.domain}{e.cpu ? ` · CPU ${e.cpu.code ?? ""} ${e.cpu.name}` : " · no clinical practice unit"}</p>
                        {e.statusNote && <p className="text-[12.5px] text-gray-700">{e.statusNote}</p>}
                        {current.status === "draft" && <div className="mt-2"><EntryStatus catalogueId={current.id} entryId={e.id} status={e.contentStatus} note={e.statusNote} idPrefix={`e-${e.id}`} /></div>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {current && current.status === "draft" && (
        <section aria-labelledby="add-h" className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 id="add-h" className="text-[16px] font-bold text-gray-900">Name existing competencies</h2>
          {reference === null ? <p role="alert" className="mt-2 text-[13px] text-[var(--cmp-text-critical)]">The competency library could not be read just now.</p> : (
            <>
              <form method="get" className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="catalogue" value={current.id} />
                <label htmlFor="pr" className="text-[13px] text-gray-800">By practice</label>
                <select id="pr" name="practice" defaultValue={practice?.id ?? ""} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px]">
                  <option value="">Any practice</option>
                  {reference.practices.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} ` : ""}{p.name} ({p.home}, {p.cpus.length} CPU)</option>)}
                </select>
                <label htmlFor="fw" className="text-[13px] text-gray-800">or by framework</label>
                <select id="fw" name="browse" defaultValue={sp.browse ?? ""} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px]">
                  <option value="">No framework</option>
                  {reference.frameworks.filter(f => f.id !== current.id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50">Show</button>
              </form>
              <div className="mt-3">
                {practice || sp.browse ? <AddEntries catalogueId={current.id} options={options} />
                  : <p className="text-[13px] text-gray-600">Choose a practice or a framework to see its competencies.{reference.practices.length === 0 ? " No practice is recorded on this environment yet." : ""}</p>}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
