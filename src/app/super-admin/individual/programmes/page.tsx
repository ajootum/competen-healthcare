/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { PROGRAMME_LAYERS, listProgrammesForHq } from "@/lib/individual/programme-admin";
import ProgrammeEditor from "./_components/ProgrammeEditor";

// /super-admin/individual/programmes -- COMPETEN-SCHOLAR-JOIN-01, owner ruling CONFIGURATION: the Scholar study
// programmes and the shared catalogues each learns against, no code. Guarded by hq.individual.config.manage, the
// right that governs the Individual policy (migration 376) -- NOT super-admin.
//
// Which programmes are OFFERED at join, their levels and the institutions are set on the Individual policy page;
// this page makes the programmes that policy chooses from. A programme is retired by deactivating it, never
// deleted: learners and their history keep its name.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scholar programmes" };

export default async function ScholarProgrammesPage() {
  const ctx = await requireHqCapability("hq.individual.config.manage");
  const [list, cats] = await Promise.all([
    listProgrammesForHq(ctx.admin),
    // The catalogues a programme may link: shared, active, published -- the same rule the route enforces.
    ctx.admin.from("frameworks").select("id, name, competency_layer").is("hospital_id", null).eq("is_active", true).eq("pub_status", "published").order("name"),
  ]);
  const catalogues = ((cats.data ?? []) as any[]).map(f => ({ id: String(f.id).toLowerCase(), name: f.competency_layer ? `${f.name} (${f.competency_layer})` : String(f.name) }));
  const names = new Map(catalogues.map(c => [c.id, c.name]));

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Individual</p>
        <h1 className="text-xl font-bold text-gray-900">Scholar programmes</h1>
        <p className="mt-1 text-sm text-gray-600">
          The study programmes a student can choose in Competen Scholar, and the shared competency catalogues each one learns against.
          Which programmes are offered when a person joins, their levels and the institutions are set on the{" "}
          <Link href="/super-admin/individual/configuration" className="font-semibold underline">Individual policy</Link> page.
        </p>
        <p className="mt-2 rounded-lg border border-[var(--cmp-color-information)] bg-[var(--cmp-surface-information)] px-3 py-2 text-[13px] text-blue-900">
          A programme is never deleted. Deactivating it stops it being offered to anyone new, and every student who chose it keeps its name in their history.
        </p>
      </header>

      {!list.ok ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          {list.notProvisioned ? "Scholar programmes are not set up on this environment (migration 387)." : "The programmes could not be read just now. Nothing below can be trusted until this page loads cleanly."}
        </p>
      ) : (
        <>
          <section aria-labelledby="prog-h" className="space-y-3">
            <h2 id="prog-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Programmes</h2>
            {list.programmes.length === 0 && <p className="text-[13.5px] text-gray-600">No programme exists yet. Create the first one below.</p>}
            {list.programmes.map(p => (
              <article key={p.code} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-bold text-gray-900">{p.label}</h3>
                  <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${p.is_active ? "bg-green-100 text-green-900" : "bg-gray-100 text-gray-700"}`}>
                    {p.is_active ? "Active" : "Deactivated"}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-gray-600">
                  {p.profession}{p.country ? `, ${p.country}` : ""}{p.level ? `, ${p.level}` : ""} <span className="font-mono text-[12px] text-gray-500">({p.code})</span>
                </p>
                <p className="mt-1 text-[13px] text-gray-700">
                  {p.frameworks.length
                    ? `Catalogues: ${p.frameworks.map(f => `${names.get(String(f.framework_id).toLowerCase()) ?? "a catalogue no longer shared and published (offers nothing)"} as ${f.layer}`).join("; ")}.`
                    : "No catalogue linked: Scholar proposes no competencies for this programme."}
                </p>
                <details className="mt-3 border-t border-gray-100 pt-3">
                  <summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Edit</summary>
                  <div className="mt-3">
                    <ProgrammeEditor catalogues={catalogues} layers={[...PROGRAMME_LAYERS]} existing={{
                      code: p.code, label: p.label, profession: p.profession, country: p.country ?? "", level: p.level ?? "", active: p.is_active,
                      frameworks: p.frameworks.map(f => ({ frameworkId: String(f.framework_id).toLowerCase(), layer: f.layer })),
                    }} />
                  </div>
                </details>
              </article>
            ))}
          </section>

          <section aria-labelledby="new-h" className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 id="new-h" className="text-[15px] font-bold text-gray-900">New programme</h2>
            <div className="mt-3"><ProgrammeEditor catalogues={catalogues} layers={[...PROGRAMME_LAYERS]} existing={null} /></div>
          </section>
        </>
      )}
    </div>
  );
}
