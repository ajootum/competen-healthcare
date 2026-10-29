/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { loadAssessorAppointments, loadMethods, loadQueue, mayPublish, SCOPE_KIND_LABEL, verificationReady } from "@/lib/competency/verification";
import { listComponents } from "@/lib/competency/studio-components";
import { EMPTY_CONTENT, METHOD_KIND_LABEL, NOT_A_DECLARATION, STANDING_LABEL, STATE_LABEL, type MethodContent, type MethodKind } from "@/lib/competency/verification-config";
import { Assign, DecisionComponents, GrantScope, MethodEditor, NewMethod, ReasonAction, VersionAction, type EditorOptions } from "./_components/StudioControls";

// /super-admin/verification-studio -- COMPETEN-PROFESSIONAL-COMPETENCY-01 C5 (migration 510), the Holdings Competency
// Verification Studio. Guarded by hq.competency.verification.manage, which only the Verification Studio Administrator
// position holds, and nobody holds that until the owner appoints someone.
//
// ⚠ CONFIGURATION, NOT CODE. Methods, criteria, outcomes, evidence, workflow, validity and assessor scopes are all data
// here. The integrity controls are not: no self-verification, an active in-scope appointment, the assigned assessor only,
// pinned criteria and immutable history are 510's triggers, and nothing on this page can switch them off.
// ⚠ AN ADMINISTRATOR NEVER DECIDES. Deciding is the Competency Assessor's, on /super-admin/competency-assessment, and 511
// keeps the two rights off one position.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verification Studio" };

const fmt = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);
const section = "space-y-3 rounded-xl border border-gray-200 bg-white p-4";
const h2 = "text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500";

export default async function VerificationStudioPage() {
  const ctx = await requireHqCapability("hq.competency.verification.manage");
  const today = new Date().toISOString().slice(0, 10);
  if (!(await verificationReady(ctx.admin))) {
    return (
      <div className="max-w-4xl space-y-3">
        <h1 className="text-xl font-bold text-gray-900">Verification Studio</h1>
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[13.5px] text-gray-700">Competency verification is not set up on this environment yet (migration 510).</p>
      </div>
    );
  }
  const [methods, assessors, queue, fw, comps, terms, scales, levels, registry] = await Promise.all([
    loadMethods(ctx.admin), loadAssessorAppointments(ctx.admin), loadQueue(ctx.admin, today),
    ctx.admin.from("frameworks").select("id, code, name").is("hospital_id", null).eq("pub_status", "published").order("name").limit(200),
    ctx.admin.from("framework_competencies").select("id, code, name, framework_domains!inner(framework_id, frameworks!inner(hospital_id, pub_status))").is("framework_domains.frameworks.hospital_id", null).eq("framework_domains.frameworks.pub_status", "published").order("code").limit(500),
    ctx.admin.from("taxonomy_terms").select("id, value, taxonomies!inner(kind)").in("taxonomies.kind", ["profession", "specialty"]).limit(500),
    ctx.admin.from("scoring_scales").select("id, name").order("name"),
    ctx.admin.from("scoring_levels").select("id, scale_id, score, label").order("score"),
    listComponents(ctx.admin),
  ]);
  // Plain rows: the joins below come back as nested objects whose shape the typed client cannot see.
  const rows = (r: { data: unknown }) => (r.data ?? []) as any[];
  const kindOf = (t: any) => (Array.isArray(t.taxonomies) ? t.taxonomies[0]?.kind : t.taxonomies?.kind);
  const options: EditorOptions = {
    frameworks: rows(fw).map(f => ({ id: f.id, label: `${f.name}${f.code ? ` (${f.code})` : ""}` })),
    competencies: rows(comps).map(c => ({ id: c.id, label: `${c.code ? `${c.code} ` : ""}${c.name}` })),
    professions: rows(terms).filter(t => kindOf(t) === "profession").map(t => ({ id: t.id, label: t.value ?? "" })),
    specialties: rows(terms).filter(t => kindOf(t) === "specialty").map(t => ({ id: t.id, label: t.value ?? "" })),
    scales: rows(scales).map(sc => ({ id: sc.id, label: sc.name, levels: rows(levels).filter(l => l.scale_id === sc.id).map(l => ({ id: l.id, label: `${l.score} · ${l.label}` })) })),
    // 680: the active CCHU components of the 660 registry. Null (660 absent): none offered.
    components: (registry ?? []).filter(k => k.active).map(k => ({ id: k.code, label: k.label })),
  };
  const levelLabel = new Map<string, string>(rows(levels).map(l => [l.id, `${l.score} · ${l.label}`]));
  const componentLabels = Object.fromEntries((registry ?? []).map(k => [k.code, k.label]));
  const versionLabel = new Map((methods ?? []).flatMap(m => m.versions.map(v => [v.id, `${m.name}, version ${v.version_no}`] as const)));
  const people = [...new Set([...(queue ?? []).map(r => r.userId), ...(assessors ?? []).map(a => a.personId)])];
  const { data: names } = people.length ? await ctx.admin.from("profiles").select("id, full_name").in("id", people) : { data: [] };
  const nameOf = new Map<string, string>(((names ?? []) as any[]).map(p => [p.id, p.full_name ?? "Unnamed person"]));
  const liveAssessors = (assessors ?? []).filter(a => a.status === "active");
  const scopeOptions = [
    ...options.frameworks.map(o => ({ kind: "framework", ref: o.id, label: `Framework: ${o.label}` })),
    ...options.competencies.map(o => ({ kind: "competency", ref: o.id, label: `Competency: ${o.label}` })),
    ...options.professions.map(o => ({ kind: "profession", ref: o.id, label: `Profession: ${o.label}` })),
    ...options.specialties.map(o => ({ kind: "specialty", ref: o.id, label: `Specialty: ${o.label}` })),
    ...(methods ?? []).map(m => ({ kind: "method", ref: m.id, label: `Method (narrows): ${m.name}` })),
    ...options.scales.flatMap(s => s.levels.map(l => ({ kind: "max_level", ref: l.id, label: `Highest level (narrows): ${s.label} ${l.label}` }))),
  ];
  const scopeRefLabel = new Map(scopeOptions.map(o => [`${o.kind}|${o.ref}`, o.label.replace(/^[^:]+: /, "")]));

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings</p>
        <h1 className="text-xl font-bold text-gray-900">Verification Studio</h1>
        <p className="mt-1 text-sm text-gray-600">
          Configure how competence is independently assessed: the methods, their criteria and outcomes, who may assess what, and who takes each request.
          Published criteria never change, so every decision shows exactly what it was made against. You cannot decide a verification here.
        </p>
      </header>

      <section aria-labelledby="methods-h" className={section}>
        <h2 id="methods-h" className={h2}>Assessment methods</h2>
        {methods === null ? <p role="alert" className="text-[13.5px] text-red-700">The methods could not be read just now.</p> : methods.length === 0
          ? <p className="text-[13.5px] text-gray-600">No method yet. Create the first below.</p>
          : methods.map(m => {
            const draft = m.versions.find(v => v.state === "draft");
            const published = m.versions.find(v => v.state === "published");
            return (
              <article key={m.id} className="space-y-3 rounded-lg border border-gray-200 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-gray-900">{m.name} <span className="font-normal text-gray-500">· {METHOD_KIND_LABEL[m.kind as MethodKind] ?? m.kind} · <span className="font-mono">{m.code}</span></span></h3>
                  <p className="text-[12.5px] text-gray-600">{published ? `Version ${published.version_no} published ${fmt(published.published_at)}` : "Not published"}</p>
                </div>
                <ul className="flex flex-wrap gap-2 text-[12px]">
                  {m.versions.map(v => <li key={v.id} className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-700">v{v.version_no}: {v.state}{v.content_hash ? ` · ${v.content_hash.slice(0, 8)}` : ""}</li>)}
                </ul>
                {published && (
                  <div className="flex flex-wrap gap-2">
                    <VersionAction action="retire" body={{ versionId: published.id }} label="Retire this version" done="Retired. No new requests use it. Decisions made under it keep it." confirm="Retire this version? People can no longer request it." />
                    {!draft && <VersionAction action="new_draft" body={{ methodId: m.id }} label="Start a new version" done="New draft started from these criteria." />}
                  </div>
                )}
                {!published && !draft && <VersionAction action="new_draft" body={{ methodId: m.id }} label="Start a new version" done="New draft started." />}
                {draft && (
                  <details open={!published}>
                    <summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Edit draft version {draft.version_no}</summary>
                    <div className="mt-3"><MethodEditor versionId={draft.id} initial={{ ...EMPTY_CONTENT, ...(draft.content as Partial<MethodContent>) } as MethodContent} options={options} idPrefix={`ed-${draft.id.slice(0, 8)}`} mayPublish={draft.edited_by === undefined || mayPublish(draft, ctx.userId)} /></div>
                  </details>
                )}
              </article>
            );
          })}
        <div className="border-t border-gray-100 pt-3"><h3 className="mb-2 text-[13.5px] font-semibold text-gray-900">New method</h3><NewMethod /></div>
      </section>

      <section aria-labelledby="assessors-h" className={section}>
        <h2 id="assessors-h" className={h2}>Competency assessors and their scope</h2>
        <p className="text-[12.5px] text-gray-600">Assessors are appointed by the owner to the Competency Assessor position, which is separate from clinical content review. An appointment assesses nothing until you scope it, and an assessor can never scope themselves.</p>
        {assessors === null ? <p role="alert" className="text-[13.5px] text-red-700">Assessor appointments could not be read just now.</p> : assessors.length === 0
          ? <p className="text-[13.5px] text-gray-600">Nobody holds the Competency Assessor position.</p>
          : assessors.map(a => (
            <article key={a.appointmentId} className="space-y-2 rounded-lg border border-gray-200 p-3">
              <p className="text-[14px] font-semibold text-gray-900">{nameOf.get(a.personId) ?? a.name ?? "Assessor"} <span className="font-normal text-gray-500">· appointment {a.status}{a.termEnd ? ` until ${fmt(a.termEnd)}` : ""}</span></p>
              {a.scopes.length === 0 ? <p className="text-[12.5px] text-amber-900">No scope: this assessor cannot assess anything yet.</p> : (
                <ul className="space-y-1">
                  {a.scopes.map(s => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 text-[13px] text-gray-800">
                      <span className={s.endedAt ? "text-gray-400 line-through" : ""}>{SCOPE_KIND_LABEL[s.kind]}: {s.kind === "context" ? s.value : scopeRefLabel.get(`${s.kind}|${s.ref}`) ?? s.ref}</span>
                      <span className="text-[12px] text-gray-500">from {fmt(s.validFrom)}{s.validUntil ? ` until ${fmt(s.validUntil)}` : ""}{s.endedAt ? ` · ended ${fmt(s.endedAt)}` : ""}</span>
                      {!s.endedAt && <ReasonAction action="end_scope" body={{ scopeId: s.id }} label="End scope" done="Scope ended. It is kept as history." idPrefix={`es-${s.id.slice(0, 8)}`} reasonLabel="Why it ends" />}
                    </li>
                  ))}
                </ul>
              )}
              {a.status === "active" && <GrantScope appointmentId={a.appointmentId} options={scopeOptions} idPrefix={`gs-${a.appointmentId.slice(0, 8)}`} />}
            </article>
          ))}
      </section>

      <section aria-labelledby="queue-h" className={section}>
        <h2 id="queue-h" className={h2}>Verification requests</h2>
        <p className="text-[12.5px] text-gray-600">{NOT_A_DECLARATION}</p>
        {queue === null ? <p role="alert" className="text-[13.5px] text-red-700">Requests could not be read just now.</p> : queue.length === 0
          ? <p className="text-[13.5px] text-gray-600">No requests.</p>
          : (
            <ul className="divide-y divide-gray-100">
              {queue.map(r => (
                <li key={r.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[14px] font-semibold text-gray-900">{r.competency?.name ?? "Competency"} <span className="font-normal text-gray-500">· {versionLabel.get(r.methodVersionId) ?? "method"} · {nameOf.get(r.userId) ?? "person"}</span></p>
                    <p className="text-[12.5px] font-semibold text-gray-700">{STATE_LABEL[r.state]}{r.assignedTo ? ` · ${nameOf.get(r.assignedTo.assessorId) ?? "assessor"}` : ""}</p>
                  </div>
                  <p className="text-[12.5px] text-gray-600">Requested {fmt(r.createdAt)} · {r.evidence.length} evidence item{r.evidence.length === 1 ? "" : "s"}{r.targetLevelId ? ` · level asked: ${levelLabel.get(r.targetLevelId) ?? "set"}` : ""} · framework version {r.frameworkVersion ?? "not recorded"}</p>
                  {(r.state === "open" || r.state === "assigned") && <Assign requestId={r.id} assessors={liveAssessors.filter(a => a.personId !== r.userId).map(a => ({ appointmentId: a.appointmentId, label: nameOf.get(a.personId) ?? a.name ?? "Assessor" }))} idPrefix={`as-${r.id.slice(0, 8)}`} />}
                  {r.decisions.map(d => (
                    <div key={d.id} className="rounded-lg bg-gray-50 p-2.5 text-[13px] text-gray-800">
                      <p><span className="font-semibold">{d.outcomeLabel ?? d.outcomeCode}</span>{d.levelId ? ` at ${levelLabel.get(d.levelId) ?? "a level"}` : ""} · decided {fmt(d.decidedAt)} by {nameOf.get(d.assessorId ?? "") ?? "an assessor"} · {STANDING_LABEL[d.standing]}{d.validUntil ? ` · valid until ${fmt(d.validUntil)}` : ""}</p>
                      <DecisionComponents results={d.componentResults} outcome={d.componentOutcome} labels={componentLabels} />
                      {d.revokedReason && <p className="text-[12.5px] text-gray-600">Revoked: {d.revokedReason}</p>}
                      {d.standing === "current" && <div className="mt-2"><ReasonAction action="revoke" body={{ decisionId: d.id }} label="Revoke this outcome" done="Revoked. The decision is kept as history, with your reason." idPrefix={`rv-${d.id.slice(0, 8)}`} reasonLabel="Why it is revoked (the person sees this)" /></div>}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
