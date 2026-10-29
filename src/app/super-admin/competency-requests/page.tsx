/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { loadClassifications, typeOf } from "@/lib/hq/account-classification";
import { loadRequestsBy, loadVerifications, scaleLevels, verificationMethodsFor, verificationReady } from "@/lib/competency/verification";
import { NOT_A_DECLARATION, STANDING_LABEL, STATE_LABEL, type MethodContent } from "@/lib/competency/verification-config";
import { RequestForm, type CompetencyOption, type MethodState, type PersonOption, type RenewalChoice } from "./_components/RequestForm";

// /super-admin/competency-requests -- CCHU Competency Assessment Implementation (owner GO 29 Oct 2026), migration 690.
// The door for a Competency Programme Lead. Guarded by hq.competency.verification.request.
//
// ⚠ A LEAD ASKS, NEVER DECIDES. The person is told, adds their own evidence and may withdraw. An appointed Competency
// Assessor decides, and the lead holds no assessing right (511/690 keep the two off one position).
// ⚠ REAL PEOPLE ONLY. Only accounts confirmed as a real person (650 classification) are offered, never the lead, and the
// API and the database check that again. The methods offered are only those published and clinically approved.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assessment requests" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fmt = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);
const h2 = "text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500";
const section = "space-y-3 rounded-xl border border-gray-200 bg-white p-4";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CompetencyRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireHqCapability("hq.competency.verification.request");
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const head = (
    <header>
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings</p>
      <h1 className="text-xl font-bold text-gray-900">Assessment requests</h1>
      <p className="mt-1 text-sm text-gray-600">Ask for a competency assessment for a person. They are told, add their own evidence and may withdraw. You cannot assess it yourself.</p>
      <p className="mt-1 text-[12.5px] text-gray-600">{NOT_A_DECLARATION}</p>
    </header>
  );
  if (!(await verificationReady(ctx.admin))) {
    return <div className="max-w-4xl space-y-3">{head}<p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[13.5px] text-gray-700">Competency verification is not set up on this environment yet (migration 510).</p></div>;
  }

  const [classes, profiles, comps, raised] = await Promise.all([
    loadClassifications(ctx.admin),
    ctx.admin.from("profiles").select("id, full_name, email").order("full_name").limit(5000),
    ctx.admin.from("framework_competencies").select("id, code, name, framework_domains!inner(framework_id, frameworks!inner(id, name, code, hospital_id, pub_status))")
      .is("framework_domains.frameworks.hospital_id", null).eq("framework_domains.frameworks.pub_status", "published").order("code").limit(1000),
    loadRequestsBy(ctx.admin, ctx.userId, today),
  ]);

  const profileRows = ((profiles.data ?? []) as any[]);
  const nameOf = new Map<string, string>(profileRows.map(p => [p.id, p.full_name ?? p.email ?? "Unnamed person"]));
  const humans = classes.available ? profileRows.filter(p => p.id !== ctx.userId && typeOf(classes, p.id) === "human") : [];
  const people: PersonOption[] = humans.map(p => ({ id: p.id, label: `${p.full_name ?? "Unnamed person"}${p.email ? ` (${p.email})` : ""}` }));

  const first = (x: any) => (Array.isArray(x) ? x[0] : x);
  const competencies: CompetencyOption[] = ((comps.data ?? []) as any[]).map(c => {
    const fw = first(first(c.framework_domains)?.frameworks);
    return { id: c.id, label: `${c.code ? `${c.code} ` : ""}${c.name}`, group: `${fw?.name ?? "Framework"}${fw?.code ? ` (${fw.code})` : ""}` };
  }).sort((a, b) => a.group.localeCompare(b.group));

  // The chosen person and competency come from the address. Anything that is not a listed Human or a listed competency is dropped.
  const personId = people.some(p => p.id === one(sp.person)) ? one(sp.person) : "";
  const competencyId = UUID.test(one(sp.competency)) && competencies.some(c => c.id === one(sp.competency)) ? one(sp.competency) : "";

  let methodState: MethodState = null;
  if (competencyId) {
    const offer = await verificationMethodsFor(ctx.admin, competencyId);
    if (offer === null) methodState = { kind: "unreadable" };
    else if (!offer.provisioned) methodState = { kind: "unavailable" };
    else if (offer.methods.length === 0) methodState = { kind: "none" };
    else {
      const ms = await Promise.all(offer.methods.map(async m => {
        const lv = await scaleLevels(ctx.admin, (m.content as MethodContent)?.scaleId);
        return { versionId: m.versionId, label: `${m.name}, version ${m.versionNo}`, levels: lv.map(l => ({ id: l.id, label: `${l.score} · ${l.label}` })) };
      }));
      methodState = { kind: "ok", methods: ms };
    }
  }

  // Verified decisions of this person on this competency that are current with an expiry date, or have expired, and that no later request renews.
  let renewals: RenewalChoice[] = [];
  if (personId && competencyId) {
    const theirs = await loadVerifications(ctx.admin, personId, today);
    const renewed = new Set((theirs ?? []).map(r => r.renewsDecisionId).filter(Boolean) as string[]);
    renewals = (theirs ?? []).filter(r => r.competencyId === competencyId).flatMap(r => r.decisions)
      .filter(d => d.outcomeClass === "verified" && !!d.validUntil && (d.standing === "current" || d.standing === "expired") && !renewed.has(d.id))
      .map(d => ({ id: d.id, label: `${d.outcomeLabel ?? d.outcomeCode}, ${d.standing === "expired" ? "expired" : "valid until"} ${fmt(d.validUntil)}` }));
  }

  // Names of the people on the list the lead raised, including any account since reclassified.
  const missing = [...new Set((raised ?? []).map(r => r.userId))].filter(id => !nameOf.has(id));
  if (missing.length) {
    const { data } = await ctx.admin.from("profiles").select("id, full_name, email").in("id", missing.slice(0, 200));
    for (const p of (data ?? []) as any[]) nameOf.set(p.id, p.full_name ?? p.email ?? "Unnamed person");
  }

  return (
    <div className="max-w-4xl space-y-6">
      {head}
      <section aria-labelledby="ask-h" className={section}>
        <h2 id="ask-h" className={h2}>Ask for an assessment</h2>
        {!classes.available
          ? <p className="text-[13.5px] text-gray-700">Accounts have not been classified on this environment yet, so nobody can be put forward.</p>
          : comps.error
            ? <p role="alert" className="text-[13.5px] text-red-700">The competencies could not be read just now.</p>
            : <RequestForm people={people} competencies={competencies} personId={personId} competencyId={competencyId} methodState={methodState} renewals={renewals} peopleTotal={profileRows.length - 1} />}
      </section>

      <section aria-labelledby="raised-h" className={section}>
        <h2 id="raised-h" className={h2}>Requests you raised</h2>
        {raised === null ? <p role="alert" className="text-[13.5px] text-red-700">Your requests could not be read just now.</p> : raised.length === 0
          ? <p className="text-[13.5px] text-gray-600">You have not asked for any assessment yet.</p>
          : (
            <ul className="divide-y divide-gray-100">
              {raised.map(r => {
                const d = r.decisions[r.decisions.length - 1] ?? null;
                return (
                  <li key={r.id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[14px] font-semibold text-gray-900">{nameOf.get(r.userId) ?? "Person"} <span className="font-normal text-gray-500">· {r.competency?.name ?? "Competency"}</span></p>
                      <p className="text-[12.5px] font-semibold text-gray-700">{STATE_LABEL[r.state]}</p>
                    </div>
                    <p className="text-[12.5px] text-gray-600">Asked {fmt(r.createdAt)}{r.renewsDecisionId ? " · renews an earlier verification" : ""} · {r.evidence.length} evidence item{r.evidence.length === 1 ? "" : "s"} added</p>
                    {d && (
                      <div className="rounded-lg bg-gray-50 p-2.5 text-[13px] text-gray-800">
                        <p><span className="font-semibold">{d.outcomeLabel ?? d.outcomeCode}</span>{d.stage ? ` · stage: ${d.stage.label}` : ""} · decided {fmt(d.decidedAt)} · {STANDING_LABEL[d.standing]}{d.validUntil ? ` · valid until ${fmt(d.validUntil)}` : ""}</p>
                        {d.confirmationRequired && (
                          <p className="text-[12.5px] text-gray-600">{d.confirmation ? (d.confirmation.result === "confirmed" ? "Confirmed by a second assessor." : "A second assessor did not confirm it.") : "A second assessor must confirm it."}</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </section>
    </div>
  );
}
