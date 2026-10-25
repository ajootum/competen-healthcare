import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { ckriEnabled, loadCkriPolicy } from "@/lib/knowledge/governance";
import { listSnapshots, readSnapshot } from "@/lib/knowledge/intelligence";
import { MEASURES } from "@/lib/knowledge/data-contracts";
import { ActionButton, FieldsForm } from "../_components/ResearchControls";
import { SnapshotView } from "../_components/SnapshotView";

// /super-admin/research/intelligence -- CKRI aggregate intelligence (COMPETEN-KNOWLEDGE-RESEARCH-01 K2, migration 441).
// Guarded by hq.quality.research.govern. Builds snapshots under the published policy and reads their cells. No row of
// learner evidence reaches this page: 441 builds inside the database.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Learning intelligence" };

export default async function LearningIntelligencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireHqCapability("hq.quality.research.govern");
  const sp = await searchParams;
  const [on, policy, list] = await Promise.all([ckriEnabled(ctx.admin), loadCkriPolicy(ctx.admin), listSnapshots(ctx.admin)]);
  const open = sp.snapshot && /^[0-9a-f-]{36}$/i.test(sp.snapshot) ? await readSnapshot(ctx.admin, sp.snapshot) : null;
  const buildable = MEASURES.filter(m => m.status === "available" && policy.measures[m.code]).map(m => m.code);
  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Knowledge &amp; Research Intelligence</p>
        <h1 className="text-xl font-bold text-gray-900">Learning intelligence</h1>
        <p className="mt-1 text-sm text-gray-600">Aggregate, suppressed measures of structured Scholar evidence from people who chose collective analytics. Deterministic, no AI.</p>
      </header>
      {!on && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">CKRI is switched off in this environment. Nothing can be built.</p>}
      <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="b-h">
        <h2 id="b-h" className="text-[15px] font-bold text-gray-900">Build a snapshot</h2>
        <p className="mb-2 text-[12.5px] text-gray-600">Uses the published policy: minimum cohort {policy.minCohort}, counts rounded to {policy.roundTo}, {policy.periodGrain}ly periods, kept {policy.snapshotRetentionDays} days. {buildable.length === 0 && "No measure is switched on in the published policy."}</p>
        {buildable.length > 0 && <FieldsForm action="build" endpoint="/api/hq/knowledge/intelligence" submit="Build" done="Built."
          fields={[{ name: "measure", label: "Measure", kind: "select", options: buildable, required: true }, { name: "dimension", label: "Group by", kind: "select", options: ["none", ...policy.cohortDimensions], required: true },
            { name: "from", label: "From", kind: "date", required: true }, { name: "to", label: "To (exclusive)", kind: "date", required: true }]} />}
        <div className="mt-2"><ActionButton body={{ action: "purge" }} endpoint="/api/hq/knowledge/intelligence" label="Purge expired snapshots" done="Purged." /></div>
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="l-h">
        <h2 id="l-h" className="text-[15px] font-bold text-gray-900">Snapshots</h2>
        {!list ? <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">Snapshots could not be read (or migration 441 is not applied here).</p>
          : list.length === 0 ? <p className="text-[13px] text-gray-600">None yet.</p> : (
          <ul className="mt-1 divide-y divide-gray-100 text-[13px]">
            {list.map((s: Record<string, string | number | null>) => <li key={String(s.id)} className="py-1.5"><Link className="font-semibold text-teal-800 underline" href={`?snapshot=${s.id}`}>{MEASURES.find(m => m.code === s.measure)?.label}</Link> · {s.period_from} to {s.period_to} · by {s.cohort_dimension} · {s.cells_reported} shown, {s.cells_suppressed} suppressed · built {String(s.built_at).slice(0, 10)}</li>)}
          </ul>
        )}
      </section>
      {open && <SnapshotView s={open} />}
    </div>
  );
}
