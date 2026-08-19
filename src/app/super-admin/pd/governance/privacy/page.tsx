import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadDataInventory } from "@/lib/hq/gov-data-inventory";
import { Explain, Cite } from "../../_components/evidence";

// CPR-PD-010 §7 — PRIVACY & DATA GOVERNANCE.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ WHAT THIS PRODUCT STORES IS A FACT. WHY, AND FOR HOW LONG, IS A POLICY. This page shows the first
// from the schema and refuses the second, because §7 asks for purpose, retention rule, sharing model and
// lawful basis per class and nobody has stated any of them.
//
// ⚠ AND §7 IS EXPLICIT ABOUT THE LINE THIS PAGE MUST NOT CROSS: "Privacy governance may inspect
// control/evidence state, NOT ROUTINE PATIENT CLINICAL CONTENT." The inventory is derived from table
// NAMES in the migration DDL — this page never queries a clinical row, so there is no path by which one
// could reach it.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.governance.view");
  const admin = await createAdminClient();
  const recorded = await admin.from("gov_data_class")
    .select("data_class_id, code, label, category, purpose, retention_rule, next_review_on, contains_personal_data")
    .limit(200);
  const inv = loadDataInventory();

  const classified = inv ? inv.byCategory.reduce((n, c) => n + c.tables, 0) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="mb-1 border-b border-gray-200 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Governance &amp; Risk</p>
        <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-gray-900">Privacy &amp; Data Governance</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-600">
          What Competen Practice holds, for what purpose, how long it is kept and how it is shared.
        </p>
      </header>

      {/* ── the governed inventory ───────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">The governed data inventory (§7)</h2>
        {recorded.error ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The data inventory could not be read. That is not zero classes.
          </p>
        ) : (recorded.data ?? []).length === 0 ? (
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <p className="text-[12px] font-semibold text-gray-700">No data class has been governed.</p>
            <p className="mt-0.5 max-w-4xl text-[11.5px] leading-relaxed text-gray-600">
              A measured zero. ⚠ It does not mean this product holds no data — the panel below counts
              what it holds. It means no class has a stated purpose, retention rule, sharing model or
              lawful basis, and each of those is a decision rather than something the schema can answer.
            </p>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-gray-100">
            {(recorded.data as Record<string, unknown>[]).map(d => (
              <li key={String(d.data_class_id)} className="py-2 first:pt-0 last:pb-0">
                <p className="text-[12.5px] font-semibold text-gray-900">{String(d.label)}</p>
                <p className="mt-0.5 text-[11.5px] text-gray-600">
                  {String(d.purpose)}
                  {d.retention_rule ? ` · retained: ${String(d.retention_rule)}` : " · no retention rule stated"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── what the schema actually holds ───────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <h2 className="text-[13px] font-bold text-amber-900">What Competen Practice actually holds</h2>
        {inv === null ? (
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The product schema could not be read from this environment, so the inventory is unavailable
            rather than empty.
          </p>
        ) : (
          <>
            <p className="mt-1 max-w-4xl text-[12px] leading-relaxed text-gray-800">
              Derived from the schema, scoped to the Practice data plane.{" "}
              <strong>{inv.inScopeTables} tables</strong> are in scope; {inv.outOfScope} in this database
              belong to other Competen product lines and are not Practice&apos;s to govern.
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {inv.byCategory.filter(c => c.tables > 0).map(c => (
                <div key={c.category} className="rounded-lg border border-amber-200 bg-white px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{c.label}</p>
                  <p className="mt-0.5 text-[20px] font-bold leading-none tabular-nums text-gray-900">{c.tables}</p>
                  <p className="mt-1 truncate font-mono text-[10px] text-gray-500">{c.sample.slice(0, 2).join(", ")}</p>
                </div>
              ))}
              <div className="rounded-lg border border-[var(--cmp-color-warning)] bg-white px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Unclassified</p>
                <p className="mt-0.5 text-[20px] font-bold leading-none tabular-nums text-[var(--cmp-text-warning)]">
                  {inv.unclassified}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-gray-500">No pattern claimed these.</p>
              </div>
            </div>

            <p className="mt-3 text-[12.5px] font-semibold text-amber-900">
              {classified} of {inv.inScopeTables} in-scope tables classify themselves by name.{" "}
              {inv.unclassified} do not, and 0 of any of them are governed.
            </p>

            <Explain summary="Why the unclassified are counted rather than assigned">
              A name like <span className="font-mono text-[11px]">practice_encounter</span> classifies
              itself. Plenty do not, and assigning those by feel would turn an inventory into an opinion
              while keeping the typography of a fact. §7 asks for an inventory, and the honest state of
              one is &ldquo;this much is known&rdquo;. The unclassified count is the work remaining, and
              it is a governance figure rather than a defect.
              <Cite>gov-data-inventory.ts classifies on name patterns and reports the remainder</Cite>
            </Explain>

            <div className="mt-3 border-t border-amber-200 pt-2">
              <p className="text-[11px] font-semibold text-gray-700">A sample of the unclassified</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {inv.unclassifiedSample.map(t => (
                  <li key={t} className="rounded border border-amber-200 bg-white px-1.5 py-0.5 font-mono text-[10.5px] text-gray-700">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">What §7 asks for that no schema can answer</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {[
            ["Purpose", "Why this product holds each class. A schema shows what is stored and can never show what it is for."],
            ["Retention rule", "How long each class is kept. A legal question per jurisdiction, and §10 forbids hard-coding one — inventing a number here would be an unauthorised compliance claim."],
            ["Sharing and access model", "Who may read each class and under what circumstances. The capability model constrains this today; stating it as policy is a different act."],
            ["Lawful basis", "The ground on which personal data is processed. A determination somebody makes, per market."],
            ["Data-subject request interface", "§7 asks for one where applicable. None exists in this product."],
          ].map(([label, why]) => (
            <li key={label} className="rounded-lg border border-dashed border-gray-300 bg-[var(--cmp-surface-neutral)] px-3 py-2">
              <p className="text-[12px] font-bold text-gray-700">{label}</p>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{why}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">The line this page does not cross (§7)</h2>
        <p className="mt-2 max-w-4xl text-[12px] leading-relaxed text-gray-700">
          §7: privacy governance &ldquo;may inspect control/evidence state, not routine patient clinical
          content&rdquo;. The inventory above is derived from table names in the schema — this page never
          queries a clinical row, so there is no path by which one could reach it. Material privacy events
          are handled as incidents in{" "}
          <Link href="/super-admin/pd/support" className="font-semibold text-teal-700 hover:underline">
            Support &amp; Incidents
          </Link>
          , and the controls protecting each class are read in{" "}
          <Link href="/super-admin/pd/governance/controls" className="font-semibold text-teal-700 hover:underline">
            Controls &amp; Assurance
          </Link>.
        </p>
      </section>
    </div>
  );
}
