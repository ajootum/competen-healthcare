import Link from "next/link";
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { componentUsage, listComponents } from "@/lib/competency/studio-components";
import { ComponentForm } from "../_studio/StudioForms";

// /super-admin/competencies/components -- CFCA-STUDIO-P1 item 7: Assessment Components. The registry of the
// components a competency can be assessed in (Clinical Skills, Knowledge, Knowledge Application, and any added
// here). Guarded by hq.quality.competency.author. Which components apply to a competency, and what each must
// reach, is set per programme on Programme frameworks. A component is retired, never deleted.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assessment components" };

export default async function AssessmentComponentsPage() {
  const ctx = await requireHqCapability("hq.quality.competency.author");
  const [defs, usage] = await Promise.all([listComponents(ctx.admin), componentUsage(ctx.admin)]);

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competency Studio</p>
        <h1 className="text-xl font-bold text-gray-900">Assessment components</h1>
        <p className="mt-1 text-sm text-gray-600">
          The parts a competency can be assessed in. Each programme decides which apply to each competency and what each must reach, on{" "}
          <Link href="/super-admin/competencies/programmes" className="font-semibold underline">Programme frameworks</Link>.
        </p>
        <p className="mt-2 rounded-lg border border-[var(--cmp-color-information)] bg-[var(--cmp-surface-information)] px-3 py-2 text-[13px] text-blue-900">
          The rule is fixed: a competency is achieved only when every mandatory component reaches its pass level, and a weighted level never overrides a failed
          mandatory or safety-critical component. A safety-critical component is always mandatory. Clinical verification is not switched on yet.
        </p>
      </header>
      {defs === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          The components could not be read just now (or migration 660 is not applied here).
        </p>
      ) : (
        <section aria-labelledby="cm-h" className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 id="cm-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Components</h2>
          {defs.map(d => (
            <div key={d.code} className="space-y-1 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
              <ComponentForm def={d} />
              <p className="text-[12px] text-gray-500">{usage === null ? "Use could not be counted." : `Required by ${usage.get(d.code) ?? 0} programme catalogue entr${(usage.get(d.code) ?? 0) === 1 ? "y" : "ies"}.`}</p>
            </div>
          ))}
          <details className="border-t border-gray-100 pt-2"><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Add a component</summary><div className="mt-2"><ComponentForm def={null} /></div></details>
        </section>
      )}
    </div>
  );
}
