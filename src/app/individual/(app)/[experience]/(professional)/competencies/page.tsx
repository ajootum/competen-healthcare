import { EXPERIENCES } from "@/lib/individual/experiences";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader } from "../../../../_components/chrome";
import { Empty, Section } from "../../../../_components/professional/bits";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { learningEnabled } from "@/lib/learning/policy";
import { loadCompetencyWorkspace, loadPortfolio, loadScaleLevels } from "@/lib/individual/professional/competency-store";
import { loadVerifications, verificationMethods } from "@/lib/individual/professional/competency-verification";
import { DEFAULT_COMPETENCY_CATEGORIES } from "@/lib/individual/professional/competency-vocabulary";
import { AddEntry, EntryDetail, EntryRow, ExploreDetail, ExploreList, Portfolio } from "../../../../_components/professional/competency-workspace";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// MY COMPETENCIES -- COMPETEN-PROFESSIONAL-COMPETENCY-01, Professional Stage 5 (C1 C2 C3 C4 C6, S9 S11 S12).
//
// The competencies the person chose to develop, from any catalogue Professional offers or in their own words, each
// with four things kept apart: what is expected, the person's self-assessment (self-reported), the evidence linked
// to it, and what an appointed assessor verified (C5, read only). Then the evidence portfolio: a view of the person's
// own records, never a copy. It works without a catalogue and without AI, and nothing here is shared unless the person
// ticks it on a Passport link.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "My competencies" }); }

export default async function CompetenciesPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await experienceModulePage((await params).experience, "competencies");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  const sp = await searchParams;
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;
  const [ws, policy, offered, portfolio, learningOn] = await Promise.all([
    loadCompetencyWorkspace(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin), loadCatalogueFor(ctx.admin, "professional"),
    loadPortfolio(ctx.admin, ctx.userId, today), learningEnabled(ctx.admin),
  ]);
  const cp = policy.professionalCompetency;
  const entries = ws.entries ?? [];
  const current = entries.filter(e => !e.removed_at);
  const mine = new Set(current.map(e => e.framework_competency_id).filter((v): v is string => !!v));
  const catalogueOf = (id: string | null) => (id ? offered?.find(c => c.competencyId === id) ?? null : null);
  const open = entries.find(e => e.id === one(sp.c)) ?? null;
  const exploring = !open && one(sp.explore) ? catalogueOf(one(sp.explore)!) : null;
  const openCat = open ? catalogueOf(open.framework_competency_id) : null;
  const [levels, verifications, offeredMethods] = open ? await Promise.all([
    loadScaleLevels(ctx.admin, openCat?.expectedLevel?.id ?? null),
    open.kind === "catalogue" ? loadVerifications(ctx.admin, ctx.userId, open.framework_competency_id ?? undefined) : Promise.resolve({ provisioned: false } as const),
    open.kind === "catalogue" && open.framework_competency_id ? verificationMethods(ctx.admin, open.framework_competency_id) : Promise.resolve({ provisioned: false } as const),
  ]) : [null, { provisioned: false } as const, null];
  // The methods C5 offers: undefined while verification is not provisioned (the panel says so), null when unreadable.
  const methods = offeredMethods === null ? null : offeredMethods.provisioned ? offeredMethods.methods : undefined;
  const groups = [...new Set(current.map(e => e.category_label ?? "Not grouped"))]
    .sort((a, b) => [...cp.categories, ...DEFAULT_COMPETENCY_CATEGORIES].findIndex(c => c.label === a) - [...cp.categories, ...DEFAULT_COMPETENCY_CATEGORIES].findIndex(c => c.label === b));

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your development" title="My competencies"
        intro="The competencies you choose to develop, how you see your own capability, and the evidence behind it. What a catalogue expects, what you assess yourself at, your evidence and independent verification are always kept apart." />
      {!ws.provisioned && <p className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[13.5px] text-gray-700">My Competencies is not set up on this environment yet.</p>}

      {ws.provisioned && open && (
        <EntryDetail e={open} c={openCat} policy={cp} accent={x.accent} today={today} levels={levels}
          assessments={(ws.assessments ?? []).filter(a => a.my_competency_id === open.id)} links={(ws.links ?? []).filter(l => l.my_competency_id === open.id)}
          history={(ws.history ?? []).filter(h => h.my_competency_id === open.id)} portfolio={portfolio.items} verifications={verifications} methods={methods} />
      )}
      {ws.provisioned && exploring && <ExploreDetail c={exploring} accent={x.accent} learningOn={learningOn} />}

      {ws.provisioned && (
        <Section id="competencies-h" title="My competencies" note="Foundational, profession-specific, specialty, leadership, education, quality, research, or a personal interest. Not limited to your current role.">
          {ws.entries === null ? <p className="text-[13px] text-gray-600">Your competencies could not be read just now.</p>
            : current.length === 0 ? <Empty>None yet. Add one from a catalogue, or in your own words.</Empty> : (
              groups.map(g => (
                <div key={g} className="mb-2">
                  <h3 className="mt-2 text-[12.5px] font-bold uppercase tracking-[0.1em] text-gray-500">{g}</h3>
                  <ul className="divide-y divide-gray-100">
                    {current.filter(e => (e.category_label ?? "Not grouped") === g).map(e => (
                      <EntryRow key={e.id} e={e} offered={catalogueOf(e.framework_competency_id)} today={today} policy={cp} accent={x.accent}
                        latest={(ws.assessments ?? []).find(a => a.my_competency_id === e.id) ?? null}
                        evidence={(ws.links ?? []).filter(l => l.my_competency_id === e.id && !l.unlinked_at).length} />
                    ))}
                  </ul>
                </div>
              ))
            )}
          {entries.some(e => e.removed_at) && (
            <details className="mt-2"><summary className="cursor-pointer text-[12.5px] font-semibold text-gray-600">Removed ({entries.filter(e => e.removed_at).length})</summary>
              <ul className="mt-1 text-[13px]">{entries.filter(e => e.removed_at).map(e => <li key={e.id}><a href={`?c=${e.id}#competency`} className="underline">{e.title}</a></li>)}</ul>
            </details>
          )}
          <div className="mt-4"><AddEntry offered={offered} mine={mine} policy={cp} accent={x.accent} /></div>
        </Section>
      )}

      {ws.provisioned && offered !== null && offered.length > 0 && (
        <Section title="Explore the catalogues" note="Every competency Competen Professional offers, with its learning outcomes and expected proficiency. Content that is not clinically approved says so.">
          <ExploreList offered={offered} mine={mine} accent={x.accent} />
        </Section>
      )}
      {ws.provisioned && offered !== null && offered.length === 0 && (
        <Section title="Explore the catalogues">
          <Empty>No approved competency catalogue is offered yet. Your competencies and evidence work without one.</Empty>
        </Section>
      )}

      {ws.provisioned && (
        <Section id="portfolio-h" title="Evidence portfolio" note="One place for everything that supports your development. Each item keeps the class its own record has.">
          <Portfolio items={portfolio.items} unreadable={portfolio.unreadable} links={ws.links ?? []} policy={cp} accent={x.accent} />
        </Section>
      )}
    </>
  );
}
