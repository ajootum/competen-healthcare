import Link from "next/link";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import {
  REPORT_CATEGORIES, REPORT_TEMPLATES, QUICK_ACCESS_TEMPLATES, reportTemplateById,
} from "@/lib/practice/report-templates";
import type { IntelligenceSuite } from "@/lib/practice/intelligence";
import { CARD, PanelHead } from "./Ui";

// CPR-PI-001 v2 s12 -- the Reports tab, rebuilt: quick access, the template catalogue, recent
// generations, and the two honest absences (favourites, scheduling) named in place.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// RECENT REPORTS ARE THE AUDIT TRAIL, REGENERATED ON CLICK (owner's decision, 2026-08-15). Nothing
// stores a generated file: a click re-runs the same template over the same period against TODAY's
// records and stamps a fresh timestamp -- which the definition block states, so a reader cannot
// mistake a regeneration for the original artifact. The alternative (storing files) buys byte-exact
// history at the price of a second copy of clinical data with its own retention question.
//
// SCHEDULED REPORTS ARE REFUSED WITH s12's OWN WORDS: Future/Conditional, "only after
// notification/delivery permissions and destination controls are implemented" -- and this product's
// no-sending doctrine means that precondition deliberately does not exist yet.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ReportsV2Area({ admin, ctx, suite, fromDay, toDay }: {
  admin: any; ctx: WorkspaceContext; suite: IntelligenceSuite; fromDay: string; toDay: string;
}) {
  const canBilling = hasCapability(ctx, "billing.view");
  const visible = REPORT_TEMPLATES.filter(t => !t.capability || hasCapability(ctx, t.capability));
  const genHref = (id: string) =>
    `/api/v1/practice/reports/generate?template=${id}&from=${fromDay}&to=${toDay}`;

  // Recent generations, from the trail (s12 "Recent reports"): who, what, when, and whether names left.
  const { data: recentRows } = await admin.from("practice_audit_event")
    .select("payload, occurred_at, event_type").eq("workspace_id", ctx.workspaceId)
    .in("event_type", ["practice.report_generated", "practice.report_exported"])
    .order("occurred_at", { ascending: false }).limit(10);
  const recent = ((recentRows ?? []) as any[]).map(r => ({
    templateId: r.payload?.templateId ?? null,
    name: r.payload?.templateId
      ? (reportTemplateById(r.payload.templateId)?.name ?? r.payload.templateId)
      : (r.event_type === "practice.report_exported" ? "Data export (CSV)" : "Report"),
    when: String(r.occurred_at).slice(0, 16).replace("T", " "),
    fromDay: r.payload?.fromDay ?? null, toDay: r.payload?.toDay ?? null,
    identified: r.payload?.identified === true,
  }));

  const defs: any = suite.reports?.data;

  return (
    <div className="flex flex-col gap-4">
      {/* ── s12 QUICK ACCESS ──────────────────────────────────────────────────────────────────── */}
      <section className={CARD}>
        <PanelHead panel="recent_reports" title="Reports"
          note="Every report carries its practice, period, filters, generated time and the definitions of its figures -- the header travels with the file."
          action={{ href: "/practice/reports", label: "Generate a document" }} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_ACCESS_TEMPLATES.map(id => {
            const t = reportTemplateById(id)!;
            if (t.capability && !hasCapability(ctx, t.capability)) return null;
            return (
              <a key={id} href={genHref(id)}
                className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-50">
                {t.name} (CSV) ↓
              </a>
            );
          })}
          <Link href="/practice/reports/analytics"
            className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-100">
            Export data &rarr;
          </Link>
        </div>
        <p className="mt-1.5 text-[10px] text-gray-500">
          Downloads use the period selected above ({fromDay} to {toDay}). Counts and denominators;
          aggregate but <b>not anonymised</b> &mdash; a count of one identifies somebody to anyone who
          knows this practice.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* ── s12 TEMPLATE CATALOGUE ────────────────────────────────────────────────────────── */}
          <section className={CARD}>
            <PanelHead panel="recent_reports" title="Template catalogue" />
            {REPORT_CATEGORIES.map(cat => {
              const inCat = visible.filter(t => t.category === cat.key);
              if (inCat.length === 0) {
                // The financial category exists because the governed module exists; a caller without
                // billing.view sees WHY it is absent rather than an unexplained hole.
                return cat.key === "financial" && !canBilling ? (
                  <p key={cat.key} className="mt-3 text-[11px] text-gray-500">
                    <span className="font-semibold text-gray-700">{cat.label}:</span> exists for this
                    practice, and needs billing.view to open.
                  </p>
                ) : null;
              }
              return (
                <div key={cat.key} className="mt-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{cat.label}</h3>
                  <ul className="mt-1 flex flex-col">
                    {inCat.map(t => (
                      <li key={t.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                        <span className="min-w-0">
                          <span className="block text-[12px] font-semibold text-gray-800">{t.name}</span>
                          <span className="block text-[10px] leading-relaxed text-gray-500">{t.blurb}</span>
                        </span>
                        <span className="ml-auto flex shrink-0 gap-1">
                          <a href={genHref(t.id)}
                            className="rounded-lg border border-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50">
                            CSV ↓
                          </a>
                          <a href={`${genHref(t.id)}&format=xlsx`}
                            className="rounded-lg border border-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50">
                            XLSX ↓
                          </a>
                          <Link href={`/practice/reports/view?template=${t.id}&from=${fromDay}&to=${toDay}`}
                            className="rounded-lg border border-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50">
                            Print
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <p className="mt-2 text-[10px] text-gray-400">
              Reports use the same metric definitions as the screens &mdash; each file lists the registry
              entries behind its figures. CSV and XLSX render the same generated report; Print is the
              PDF, through your browser, the same policy every print view in this product follows.
            </p>
          </section>

          {/* ── s12 RECENT REPORTS -- the audit trail, regenerated on click ───────────────────── */}
          <section className={CARD}>
            <PanelHead panel="recent_reports" title="Recent reports"
              note="Read from the audit trail. Regenerating re-runs the template against today's records with a fresh timestamp -- it is not the original file." />
            {recent.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">Nothing generated yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {recent.map((r, i) => (
                  <li key={i} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-gray-800">{r.name}</span>
                      <span className="block text-[10px] text-gray-500">
                        {r.when} &middot; {r.fromDay && r.toDay ? `${r.fromDay} to ${r.toDay}` : "period on the file"} &middot;{" "}
                        {r.identified ? "carried names" : "counts only"}
                      </span>
                    </span>
                    {r.templateId && r.fromDay && r.toDay && (
                      <a href={`/api/v1/practice/reports/generate?template=${r.templateId}&from=${r.fromDay}&to=${r.toDay}`}
                        className="ml-auto shrink-0 rounded-lg border border-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50">
                        Regenerate ↓
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* The definitions panel the old tab carried -- real rows, kept. */}
          <section className={CARD}>
            <PanelHead panel="recent_reports" title="Defined reports" />
            {!defs || defs.status !== "ok" || defs.defined.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">
                No report has been defined for re-running. Defining one records an intention; nothing
                runs on a schedule.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {defs.defined.map((r: any) => (
                  <li key={r.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                    <span className="min-w-0 truncate text-[12px] text-gray-800">{r.name}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-gray-500">
                      {r.lastRunAt ? `last run ${String(r.lastRunAt).slice(0, 10)}` : "never run"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {defs?.limitation && <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700">{defs.limitation}</p>}
          </section>

          <section className={`${CARD} border-dashed bg-gray-50/60`}>
            <PanelHead panel="refused" title="Not here, and why" />
            <ul className="mt-2 flex flex-col gap-2">
              <li className="text-[11px] leading-relaxed text-gray-600">
                <b>Scheduled reports.</b> s12 makes them conditional on delivery permissions and
                destination controls &mdash; and this product deliberately sends nothing, so the
                precondition does not exist yet. A schedule that could not deliver would be theatre.
              </li>
              <li className="text-[11px] leading-relaxed text-gray-600">
                <b>Favourites.</b> Optional in the contract, and honestly not built.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
