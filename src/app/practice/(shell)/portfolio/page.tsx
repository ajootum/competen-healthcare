import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { buildPortfolio, PORTFOLIO_KINDS, PROVENANCE } from "@/lib/practice/portfolio";
import PortfolioConsole from "./PortfolioConsole";

// /practice/portfolio -- CPR-240 PROFESSIONAL PORTFOLIO.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS IS THE ONE PAGE WHOSE FIGURES LEAVE THE BUILDING UNDER SOMEBODY'S NAME.
//
// A portfolio goes to an appraiser, a regulator, a credentialing committee. If it overstates, it is the
// clinician who signed it -- which makes every invented number here worse than it would be anywhere
// else in the product.
//
// The comp promises "Your complete professional story" and prints "Total Experience 8.6 yrs -- Since
// 2016" and "Patients Managed 2,348 -- All time". This product holds only what was recorded in it. So
// the COVERAGE WINDOW is the first thing on the page and the first field of the export, and the two are
// the same sentence so they cannot drift apart.
//
// AND NOTHING IS "VERIFIED" -- the comp says so twice. Every figure instead says where it came from:
// work recorded here, or declared by the practitioner.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");

  const admin = createAdminClient();
  const p = await buildPortfolio(admin, shell.ctx);

  const card = "rounded-xl border border-gray-200 bg-white p-4";
  const { recorded, declared, attention } = p;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Professional portfolio</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            What this product recorded of your work, and what you have declared alongside it.
          </p>
        </div>
        <Link href="/api/v1/practice/portfolio?view=export"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          Export
        </Link>
      </div>

      {/* ── THE COVERAGE WINDOW, FIRST. The comp puts "Total Experience 8.6 yrs" here instead. ──── */}
      <p className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3 text-[12px] text-gray-700">
        {p.coverage.statement}
      </p>

      {/* ── The strip (comp: six tiles, one of them a score) ────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          ["Consultations", recorded.consultations, "you opened"],
          ["People seen", recorded.patients, `across ${recorded.consultations} consultations`],
          ["Procedures", recorded.procedures, "you performed"],
          ["Teaching and training", recorded.teachingSessions, `of ${recorded.activities} activities`],
          ["CPD minutes", recorded.cpdMinutes, "claimed by you"],
        ].map(([label, value, note]) => (
          <div key={String(label)} className={card}>
            <p className="text-[11px] font-semibold text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
            <p className="mt-0.5 text-[10px] text-gray-500">{note}</p>
          </div>
        ))}
        {/* THE COMP'S "PORTFOLIO SCORE 842/1000 -- EXCELLENT", IN ITS DESIGNED POSITION. */}
        <div className={`${card} border-dashed bg-gray-50/60`}>
          <p className="text-[11px] font-semibold text-gray-500">Portfolio score</p>
          <p className="mt-1 text-2xl font-bold text-gray-300">&mdash;</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            None is computed. A weak portfolio with many entries would outscore a strong one with few.
          </p>
        </div>
      </div>

      {/* ── What an appraiser asks about first ─────────────────────────────────────────────────── */}
      {(attention.expiring.length > 0 || attention.registrationExpired || attention.profileIncomplete) && (
        <section className={`${card} mt-4`}>
          <h2 className="text-[13px] font-bold text-gray-900">Worth dealing with before an appraisal</h2>
          <ul className="mt-2 flex flex-col">
            {attention.registrationExpired && (
              <li className="border-b border-gray-100 py-1.5 last:border-0">
                <p className="text-[12px] font-semibold text-[var(--cmp-text-warning)]">
                  Your registration is recorded as expiring on {attention.registrationExpiresOn}
                </p>
                <p className="text-[10px] text-gray-500">
                  Recorded by you. Nothing here checked it with a regulator.
                </p>
              </li>
            )}
            {attention.expiring.map((e: { id: string; title: string; expires_on: string; expired: boolean }) => (
              <li key={e.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className="min-w-0 truncate text-[12px] text-gray-800">{e.title}</span>
                <span className={`ml-auto shrink-0 text-[11px] font-semibold ${e.expired ? "text-[var(--cmp-text-warning)]" : "text-gray-700"}`}>
                  {e.expired ? "expired" : "expires"} {e.expires_on}
                </span>
              </li>
            ))}
            {attention.profileIncomplete && (
              <li className="border-b border-gray-100 py-1.5 last:border-0">
                <p className="text-[12px] text-gray-800">Your name and profession are not recorded yet</p>
                <p className="text-[10px] text-gray-500">An export without them is hard for a reader to attribute.</p>
              </li>
            )}
          </ul>
        </section>
      )}

      <div className="mt-4 grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* ── From work recorded here ──────────────────────────────────────────────────────── */}
          <section className={card}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h2 className="text-[13px] font-bold text-gray-900">{PROVENANCE.sourceLinked.label}</h2>
              <span className="text-[10px] text-gray-500">{PROVENANCE.sourceLinked.detail}</span>
            </div>
            <div className="mt-2 grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-semibold text-gray-600">Procedures</p>
                {recorded.procedureTypes.length === 0 ? (
                  <p className="mt-1 text-[12px] text-gray-400">None recorded.</p>
                ) : (
                  <ul className="mt-1 flex flex-col">
                    {recorded.procedureTypes.slice(0, 8).map((t: { label: string; total: number }) => (
                      <li key={t.label} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                        <span className="min-w-0 truncate text-[12px] text-gray-800">{t.label}</span>
                        <span className="ml-auto text-[12px] font-bold text-gray-900">{t.total}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold text-gray-600">Activities</p>
                {recorded.activityKinds.length === 0 ? (
                  <p className="mt-1 text-[12px] text-gray-400">None recorded.</p>
                ) : (
                  <ul className="mt-1 flex flex-col">
                    {recorded.activityKinds.map((k: { kind: string; total: number }) => (
                      <li key={k.kind} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                        <span className="min-w-0 truncate text-[12px] text-gray-800">{k.kind.replace(/_/g, " ")}</span>
                        <span className="ml-auto text-[12px] font-bold text-gray-900">{k.total}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <p className="mt-2 text-[10px] text-gray-500">
              {recorded.reflections} reflections and {recorded.learningPoints} learning points are recorded
              against your name. Reflections are counted only &mdash; their text is private and stays that way.
            </p>
          </section>

          {/* ── Declared ─────────────────────────────────────────────────────────────────────── */}
          <section className={card}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h2 className="text-[13px] font-bold text-gray-900">{PROVENANCE.selfDeclared.label}</h2>
              <span className="text-[10px] text-gray-500">{PROVENANCE.selfDeclared.detail}</span>
            </div>
            {declared.byKind.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">
                Nothing declared yet &mdash; publications, awards, certificates and posts held elsewhere go here.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-3">
                {declared.byKind.map((g: {
                  key: string; label: string;
                  items: { id: string; title: string; organisation: string | null; reference: string | null;
                    occurred_on: string | null; expires_on: string | null; expired: boolean }[];
                }) => (
                  <div key={g.key}>
                    <p className="text-[11px] font-semibold text-gray-600">{g.label}</p>
                    <ul className="mt-1 flex flex-col">
                      {g.items.map(i => (
                        <li key={i.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] text-gray-800">{i.title}</span>
                            {(i.organisation || i.reference) && (
                              <span className="block text-[10px] text-gray-500">
                                {[i.organisation, i.reference].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                          <span className="ml-auto shrink-0 text-right">
                            <span className="block text-[11px] text-gray-700">{i.occurred_on ?? ""}</span>
                            {i.expires_on && (
                              <span className={`block text-[10px] ${i.expired ? "text-[var(--cmp-text-warning)]" : "text-gray-500"}`}>
                                {i.expired ? "expired" : "expires"} {i.expires_on}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            <PortfolioConsole kinds={PORTFOLIO_KINDS.map(([key, label]) => ({ key, label }))} />
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* ── The practitioner (comp: "Portfolio Profile") ─────────────────────────────────── */}
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">You</h2>
            {p.profile ? (
              <ul className="mt-2 flex flex-col">
                {[
                  ["Name", p.profile.full_name],
                  ["Profession", p.profile.profession],
                  ["Specialty", p.profile.specialty],
                  ["Registration", p.profile.registration_number],
                  ["Issued by", p.profile.registration_body],
                  ["Practising since", p.profile.practising_since],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <li key={String(k)} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                    <span className="text-[12px] text-gray-700">{k}</span>
                    <span className="ml-auto truncate text-[11px] font-semibold text-gray-900">{v}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] text-gray-400">Not recorded yet.</p>
            )}
            <p className="mt-1.5 text-[10px] text-gray-500">
              All of it declared by you. The design shows a licence number beside a verified badge; nothing
              here contacted a regulator, so there is no badge.
            </p>
            {p.profile?.practising_since && p.coverage.from && (
              <p className="mt-1.5 text-[10px] text-gray-500">
                You have practised since {p.profile.practising_since}. This portfolio covers from{" "}
                {p.coverage.from}. The difference is not missing &mdash; it happened before this product.
              </p>
            )}
          </section>

          {/* THE PANEL THE COMP HAS NO ROOM FOR. */}
          <section className={`${card} border-dashed bg-gray-50/60`}>
            <h2 className="text-[13px] font-bold text-gray-900">What this portfolio does not claim</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {p.limits.map(l => (
                <li key={l.key}>
                  <p className="text-[12px] font-semibold text-gray-700">{l.label}</p>
                  <p className="text-[10px] text-gray-500">{l.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
