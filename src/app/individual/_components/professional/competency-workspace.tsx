import Link from "next/link";
import type { ProfessionalCompetencyPolicy } from "@/lib/individual/policy";
import type { CatalogueCompetency } from "@/lib/individual/catalogue";
import { findLearningHref } from "@/lib/individual/professional/learning";
import { reassessDue, suggestEvidence, type ScaleLevel } from "@/lib/individual/professional/competency-form";
import { ASPECT_TEXT, PORTFOLIO_KIND_LABEL, SELF_REPORTED, SHAREABLE_KINDS } from "@/lib/individual/professional/competency-vocabulary";
import { linkKind, linkSourceId, type CompetencyEntry, type EntryHistoryRow, type EvidenceLink, type PortfolioItem, type SelfAssessment } from "@/lib/individual/professional/competency-store";
import { currentDecision, type VerificationRead } from "@/lib/individual/professional/competency-verification";
import { Empty, fmtDate } from "./bits";
import { AddPanel, ApiButton, ApiForm, Field, inputCls } from "./forms";
import CompetencyAssist from "./CompetencyAssist";

// MY COMPETENCIES -- COMPETEN-PROFESSIONAL-COMPETENCY-01 (Professional Stage 5), C1 C2 C3 C4 C6.
//
// Server-rendered pieces of the My Competencies page. An entry opens with ?c=, a catalogue competency is explored with
// ?explore=. No other navigation.
//
// ⚠ FOUR PANELS, NEVER MERGED. What the catalogue EXPECTS, what the person ASSESSES themselves at (self-reported),
// what EVIDENCE supports it (each with its own record's class, not verification), and what an appointed assessor
// VERIFIED (C5, read only). Where nothing is recorded, the panel says so: never a zero, never "not competent".
// ⚠ DRAFT CONTENT IS LABELLED. A competency not clinically approved says so, wherever it is shown.

export const statusNote = (c: Pick<CatalogueCompetency, "contentStatus">) =>
  c.contentStatus === "approved" ? null : c.contentStatus === "draft" ? "Draft content, not clinically reviewed" : "Not clinically reviewed";

// ── The list (C1) ─────────────────────────────────────────────────────────────────────────────────────────────

export function EntryRow({ e, latest, evidence, offered, today, policy, accent }: {
  e: CompetencyEntry; latest: SelfAssessment | null; evidence: number; offered: CatalogueCompetency | null; today: string; policy: ProfessionalCompetencyPolicy; accent: string;
}) {
  const note = offered ? statusNote(offered) : null;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <Link href={`?c=${e.id}#competency`} className="text-[14.5px] font-semibold text-gray-900 underline-offset-2 hover:underline">{e.title}</Link>
        <p className="text-[12.5px] text-gray-500">
          {e.kind === "catalogue" ? `${offered?.catalogue.name ?? "Catalogue"}${e.framework_version ? ` ${e.framework_version}` : ""}` : "In your own words"}
          {note ? ` · ${note}` : ""}{e.category_label ? ` · ${e.category_label}` : ""}{e.interest ? " · development interest" : ""}
        </p>
        <p className="text-[12.5px] text-gray-700">
          {latest ? <>Self-assessed: {latest.level_label} <span className="text-gray-500">({SELF_REPORTED.toLowerCase()}, {fmtDate(latest.assessed_at)})</span></> : <span className="text-gray-500">Not self-assessed yet</span>}
          {" · "}{evidence ? `${evidence} ${evidence === 1 ? "piece" : "pieces"} of evidence` : <span className="text-gray-500">No evidence linked</span>}
        </p>
        {latest && reassessDue(latest.assessed_at, today, policy.reassessDays) && <p className="text-[12px] font-semibold text-amber-800">Time to reassess? Your last self-assessment was {fmtDate(latest.assessed_at)}.</p>}
      </div>
      <Link href={`?c=${e.id}#competency`} className="text-[13px] font-semibold" style={{ color: accent }}>Open →</Link>
    </li>
  );
}

// ── Adding and exploring (C1) ─────────────────────────────────────────────────────────────────────────────────

export function AddEntry({ offered, mine, policy, accent }: { offered: CatalogueCompetency[] | null; mine: Set<string>; policy: ProfessionalCompetencyPolicy; accent: string }) {
  const available = (offered ?? []).filter(c => !mine.has(c.competencyId));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <AddPanel label="Add from a competency catalogue" accent={accent} suggestOpen={false}>
        {offered === null ? <p className="text-[13px] text-gray-600">The catalogues could not be read just now.</p>
          : offered.length === 0 ? <p className="text-[13px] text-gray-600">No approved competency catalogue is offered yet. You can still add competencies in your own words.</p> : (
            <ApiForm action="/api/individual/professional/my-competencies" submitLabel="Add to My Competencies" accent={accent} savedText="Added.">
              <Field label="Competency" htmlFor="add-comp" hint="From every catalogue Competen Professional offers, not only your current role.">
                <select id="add-comp" name="competencyId" required defaultValue="" className={inputCls}>
                  <option value="">Choose…</option>
                  {available.slice(0, 500).map(c => <option key={c.competencyId} value={c.competencyId}>{c.title} · {c.catalogue.name}{statusNote(c) ? ` (${statusNote(c)})` : ""}</option>)}
                </select>
              </Field>
              <label className="flex items-start gap-2 text-[13px] text-gray-700"><input type="checkbox" name="interest" value="true" className="mt-1 h-4 w-4" /><span>Mark it as a development interest</span></label>
            </ApiForm>
          )}
      </AddPanel>
      {policy.personal === "on" && (
        <AddPanel label="Add one in your own words" accent={accent} suggestOpen={false}>
          <ApiForm action="/api/individual/professional/my-competencies" submitLabel="Add" accent={accent} savedText="Added. It is yours to assess and evidence; it is never verified.">
            <Field label="Competency" htmlFor="add-own"><input id="add-own" name="title" required minLength={3} maxLength={200} className={inputCls} placeholder="e.g. Respiratory assessment" /></Field>
            <Field label="What it means to you (optional)" htmlFor="add-own-d"><textarea id="add-own-d" name="description" rows={2} maxLength={2000} className={inputCls} /></Field>
            {policy.categories.length > 0 && (
              <Field label="Group (optional)" htmlFor="add-own-c">
                <select id="add-own-c" name="category" defaultValue="" className={inputCls}>
                  <option value="">Not grouped</option>
                  {policy.categories.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </Field>
            )}
          </ApiForm>
        </AddPanel>
      )}
    </div>
  );
}

export function ExploreList({ offered, mine, accent }: { offered: CatalogueCompetency[]; mine: Set<string>; accent: string }) {
  const byLayer = new Map<string, CatalogueCompetency[]>();
  for (const c of offered) byLayer.set(c.layer ?? "unclassified", [...(byLayer.get(c.layer ?? "unclassified") ?? []), c]);
  return (
    <div className="space-y-3">
      {[...byLayer].map(([layer, list]) => (
        <details key={layer} className="rounded-xl border border-gray-200 p-3">
          <summary className="cursor-pointer text-[13.5px] font-semibold text-gray-800">{layer === "unclassified" ? "Other" : layer[0].toUpperCase() + layer.slice(1)} ({list.length})</summary>
          <ul className="mt-2 divide-y divide-gray-100">
            {list.slice(0, 200).map(c => (
              <li key={c.competencyId} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[13.5px]">
                <span>{c.title} <span className="text-[12px] text-gray-500">· {c.catalogue.name}{statusNote(c) ? ` · ${statusNote(c)}` : ""}</span></span>
                {mine.has(c.competencyId) ? <span className="text-[12px] text-gray-500">In My Competencies</span>
                  : <Link href={`?explore=${c.competencyId}#explore`} className="text-[12.5px] font-semibold" style={{ color: accent }}>Explore →</Link>}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

export function ExploreDetail({ c, accent, learningOn }: { c: CatalogueCompetency; accent: string; learningOn: boolean }) {
  return (
    <section id="explore" aria-labelledby="explore-h" className="mb-5 rounded-2xl border-2 bg-white p-5 sm:p-6" style={{ borderColor: accent }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Explore a competency</p>
          <h2 id="explore-h" className="text-[18px] font-bold text-gray-900">{c.title}</h2>
          <p className="text-[12.5px] text-gray-600">{c.catalogue.name} {c.catalogue.version ? `v${c.catalogue.version.replace(/^v/i, "")}` : ""} · {c.domain.name}{statusNote(c) ? ` · ${statusNote(c)}` : " · clinically approved content"}</p>
        </div>
        <Link href="?#competencies-h" className="text-[13px] font-semibold text-gray-700 underline">Close</Link>
      </div>
      {c.description && <p className="mt-2 text-[13.5px] text-gray-800">{c.description}</p>}
      <ExpectedPanel c={c} />
      <div className="mt-3 flex flex-wrap gap-3">
        <ApiForm action="/api/individual/professional/my-competencies" submitLabel="Add to My Competencies" accent={accent} savedText="Added.">
          <input type="hidden" name="competencyId" value={c.competencyId} />
        </ApiForm>
        {learningOn && <Link href={findLearningHref(c.competencyId)} className="self-center text-[13px] font-semibold" style={{ color: accent }}>Find learning for it →</Link>}
      </div>
    </section>
  );
}

function ExpectedPanel({ c }: { c: CatalogueCompetency | null }) {
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-600">{ASPECT_TEXT.expected}</p>
      {!c ? <p className="text-[13px] text-gray-700">This competency is in your own words, so no catalogue sets an expectation for it.</p> : (
        <>
          <p className="text-[13px] text-gray-800">Expected proficiency: {c.expectedLevel ? `${c.expectedLevel.label} (level ${c.expectedLevel.score})` : "Not set in the catalogue"}</p>
          {c.outcomes.length === 0 ? <p className="text-[13px] text-gray-600">No learning outcomes recorded in the catalogue.</p> : (
            <ol className="mt-1 list-decimal pl-5 text-[13px] text-gray-800">{c.outcomes.map(o => <li key={o}>{o}</li>)}</ol>
          )}
        </>
      )}
    </div>
  );
}

// ── An entry in detail: the four aspects, history and integrations ───────────────────────────────────────────

export function EntryDetail(p: {
  e: CompetencyEntry; c: CatalogueCompetency | null; policy: ProfessionalCompetencyPolicy; accent: string; today: string;
  levels: ScaleLevel[] | null; assessments: SelfAssessment[]; links: EvidenceLink[]; history: EntryHistoryRow[];
  portfolio: PortfolioItem[]; verifications: VerificationRead;
}) {
  const { e, c, policy, accent } = p;
  const outcomes = c?.outcomes ?? [];
  const open = p.links.filter(l => !l.unlinked_at), closed = p.links.filter(l => l.unlinked_at);
  const srcOf = (l: EvidenceLink) => p.portfolio.find(i => i.kind === linkKind(l) && i.id === linkSourceId(l)) ?? null;
  const groups = [...outcomes.map(o => ({ key: o, label: o })), { key: null as string | null, label: outcomes.length ? "The competency as a whole" : "This competency" }];
  const suggestionsFor = (target: string) => suggestEvidence(target, p.portfolio.filter(i => !open.some(l => linkKind(l) === i.kind && linkSourceId(l) === i.id)), 3);
  const decisions = p.verifications.provisioned && p.verifications.items
    ? p.verifications.items.filter(v => v.competency.frameworkCompetencyId === e.framework_competency_id) : [];
  const history = [
    ...p.history.map(h => ({ at: h.recorded_at, text: h.removed ? "Removed from My Competencies" : `${e.title}${h.framework_version ? ` (${h.framework_version})` : ""}${h.interest ? ", development interest" : ""}` })),
    ...p.assessments.map(a => ({ at: a.assessed_at, text: `Self-assessed ${a.level_label}${a.learning_outcome ? ` for "${a.learning_outcome}"` : ""}${a.confidence_label ? `, ${a.confidence_label.toLowerCase()}` : ""} (self-reported${a.framework_version ? `, ${a.framework_version}` : ""})` })),
    ...p.links.map(l => ({ at: l.linked_at, text: `Evidence linked: ${srcOf(l)?.title ?? PORTFOLIO_KIND_LABEL[linkKind(l)]} (${l.relation_label}${l.learning_outcome ? `, "${l.learning_outcome}"` : ""}${l.source === "ai" ? ", suggested by AI and accepted by you" : ""})` })),
    ...closed.map(l => ({ at: l.unlinked_at!, text: `Evidence unlinked: ${srcOf(l)?.title ?? PORTFOLIO_KIND_LABEL[linkKind(l)]}` })),
    ...decisions.flatMap(v => [{ at: v.requestedAt, text: `Verification requested (${v.status})` }, ...v.decisions.map(d => ({ at: d.decidedAt, text: `Assessor decision: ${d.outcomeLabel}${d.level ? ` at ${d.level}` : ""} by ${d.assessorName}${d.revokedAt ? `, revoked ${fmtDate(d.revokedAt)}` : ""}` }))]),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section id="competency" aria-labelledby="competency-h" className="mb-5 rounded-2xl border-2 bg-white p-5 sm:p-6" style={{ borderColor: accent }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">My competency · private to you</p>
          <h2 id="competency-h" className="text-[18px] font-bold text-gray-900">{e.title}</h2>
          <p className="text-[12.5px] text-gray-600">
            {e.kind === "catalogue" ? `${c?.catalogue.name ?? "A catalogue no longer offered"}${e.framework_version ? ` · ${e.framework_version}` : ""}${c && statusNote(c) ? ` · ${statusNote(c)}` : ""}` : "In your own words"}
            {e.category_label ? ` · ${e.category_label}` : ""} · added {fmtDate(e.added_at)}{e.removed_at ? ` · removed ${fmtDate(e.removed_at)}` : ""}
          </p>
        </div>
        <Link href="?#competencies-h" className="text-[13px] font-semibold text-gray-700 underline">Close</Link>
      </div>
      {e.description && <p className="mt-2 text-[13.5px] text-gray-800">{e.description}</p>}

      {/* 1. Expected */}
      <ExpectedPanel c={e.kind === "catalogue" ? c : null} />

      {/* 2. Self-assessment (C2) */}
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
        <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-amber-900">{ASPECT_TEXT.self}</p>
        {p.assessments.length === 0 ? <p className="text-[13px] text-gray-700">Not self-assessed yet.</p> : (
          <ul className="mt-1 space-y-1 text-[13px] text-gray-800">
            {p.assessments.map((a, i) => (
              <li key={a.id}>
                <span className="font-semibold">{a.level_label}</span>{a.scale_label ? <span className="text-gray-500"> ({a.scale_label})</span> : null}
                {a.learning_outcome ? <> for &quot;{a.learning_outcome}&quot;</> : null}{a.confidence_label ? ` · ${a.confidence_label}` : ""} · {fmtDate(a.assessed_at)}
                <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">{SELF_REPORTED}</span>
                {i === 0 ? <span className="ml-1 text-[11.5px] text-gray-500">latest</span> : null}
                {a.reflection && <p className="text-[12.5px] italic text-gray-600">Your private reflection: {a.reflection}</p>}
              </li>
            ))}
          </ul>
        )}
        {p.levels === null ? <p className="mt-2 text-[12.5px] text-gray-600">The proficiency scale could not be read just now.</p>
          : p.levels.length === 0 ? <p className="mt-2 text-[12.5px] text-gray-600">No proficiency scale is configured yet.</p> : !e.removed_at && (
            <AddPanel label={p.assessments.length ? "Reassess (your earlier assessments are kept)" : "Assess yourself"} accent={accent} suggestOpen={false}>
              <ApiForm action="/api/individual/professional/self-assessments" submitLabel="Save self-assessment" accent={accent} savedText="Saved, as self-reported. Earlier assessments are kept.">
                <input type="hidden" name="entryId" value={e.id} />
                <Field label="Your level" htmlFor={`sa-l-${e.id}`} hint="On the catalogue's proficiency scale. Your own view: evidence is not required for it.">
                  <select id={`sa-l-${e.id}`} name="levelId" required defaultValue="" className={inputCls}>
                    <option value="">Choose…</option>
                    {p.levels.map(l => <option key={l.id} value={l.id}>{l.label} (level {l.score})</option>)}
                  </select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  {policy.fields.map(f => {
                    if (f === "outcome" && outcomes.length) return (
                      <Field key={f} label="For one learning outcome (optional)" htmlFor={`sa-o-${e.id}`}>
                        <select id={`sa-o-${e.id}`} name="outcome" defaultValue="" className={inputCls}><option value="">The competency as a whole</option>{outcomes.map(o => <option key={o} value={o}>{o}</option>)}</select>
                      </Field>
                    );
                    if (f === "confidence" && policy.confidence.length) return (
                      <Field key={f} label="How sure are you? (optional)" htmlFor={`sa-c-${e.id}`}>
                        <select id={`sa-c-${e.id}`} name="confidence" defaultValue="" className={inputCls}><option value="">Not now</option>{policy.confidence.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}</select>
                      </Field>
                    );
                    if (f === "reflection") return <div key={f} className="sm:col-span-2"><Field label="A private reflection (optional)" htmlFor={`sa-r-${e.id}`} hint="Private to you: never shared, never sent for verification."><textarea id={`sa-r-${e.id}`} name="reflection" rows={2} maxLength={5000} className={inputCls} /></Field></div>;
                    if (f === "interest") return <label key={f} className="flex items-start gap-2 text-[13px] text-gray-700"><input type="checkbox" name="interest" value="true" className="mt-1 h-4 w-4" /><span>I want to develop this further</span></label>;
                    return null;
                  })}
                </div>
              </ApiForm>
            </AddPanel>
          )}
      </div>

      {/* 3. Evidence (C4) */}
      <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
        <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-sky-900">{ASPECT_TEXT.evidence}</p>
        <p className="text-[12.5px] text-gray-600">Each record keeps its own class. Linking it here raises nothing, and none of it is verification.</p>
        {groups.map(g => {
          const here = open.filter(l => l.learning_outcome === g.key);
          const ideas = suggestionsFor(g.key ?? e.title);
          return (
            <div key={g.key ?? "whole"} className="mt-2">
              <p className="text-[13px] font-semibold text-gray-800">{g.label}</p>
              {here.length === 0 ? <p className="text-[12.5px] text-gray-500">Nothing linked.</p> : (
                <ul className="text-[13px] text-gray-800">
                  {here.map(l => {
                    const s = srcOf(l);
                    return (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5">
                        <span>{s?.title ?? "A record that could not be shown"} <span className="text-[12px] text-gray-500">· {PORTFOLIO_KIND_LABEL[linkKind(l)]} · {l.relation_label} · {s?.classText ?? ""}{l.source === "ai" ? " · suggested by AI, accepted by you" : ""}</span></span>
                        <ApiButton action="/api/individual/professional/competency-evidence" method="PATCH" body={{ linkId: l.id }} label="Unlink" />
                      </li>
                    );
                  })}
                </ul>
              )}
              {!e.removed_at && ideas.length > 0 && (
                <div className="mt-1 text-[12.5px] text-gray-700">
                  <span className="text-gray-500">Shares words with this (a suggestion, not AI):</span>
                  {ideas.map(i => (
                    <span key={`${i.kind}${i.id}`} className="ml-2 inline-flex items-center gap-1">
                      {i.title}
                      <ApiForm action="/api/individual/professional/competency-evidence" submitLabel="Link" accent={accent} savedText="Linked.">
                        <input type="hidden" name="entryId" value={e.id} /><input type="hidden" name="kind" value={i.kind} /><input type="hidden" name="sourceId" value={i.id} />
                        {g.key && <input type="hidden" name="outcome" value={g.key} />}<input type="hidden" name="relation" value={policy.relations[0]?.code ?? ""} />
                      </ApiForm>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!e.removed_at && (
          <AddPanel label="Link evidence from your portfolio" accent={accent} suggestOpen={false}>
            {p.portfolio.length === 0 ? <Empty>Your portfolio is empty. Record CPD, learning or evidence first, or add supporting evidence below.</Empty> : (
              <ApiForm action="/api/individual/professional/competency-evidence" submitLabel="Link evidence" accent={accent} savedText="Linked. The record itself is unchanged.">
                <input type="hidden" name="entryId" value={e.id} />
                <Field label="Record" htmlFor={`ev-${e.id}`}>
                  <select id={`ev-${e.id}`} name="sourcePick" required defaultValue="" className={inputCls}>
                    <option value="">Choose…</option>
                    {p.portfolio.map(i => <option key={`${i.kind}:${i.id}`} value={`${i.kind}:${i.id}`}>{PORTFOLIO_KIND_LABEL[i.kind]}: {i.title}</option>)}
                  </select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  {outcomes.length > 0 && (
                    <Field label="Learning outcome (optional)" htmlFor={`ev-o-${e.id}`}>
                      <select id={`ev-o-${e.id}`} name="outcome" defaultValue="" className={inputCls}><option value="">The competency as a whole</option>{outcomes.map(o => <option key={o} value={o}>{o}</option>)}</select>
                    </Field>
                  )}
                  <Field label="What it supports" htmlFor={`ev-r-${e.id}`}>
                    <select id={`ev-r-${e.id}`} name="relation" required defaultValue={policy.relations[0]?.code ?? ""} className={inputCls}>{policy.relations.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</select>
                  </Field>
                </div>
              </ApiForm>
            )}
          </AddPanel>
        )}
        {closed.length > 0 && (
          <details className="mt-1"><summary className="cursor-pointer text-[12px] font-semibold text-gray-600">Earlier links ({closed.length})</summary>
            <ul className="mt-1 text-[12px] text-gray-600">{closed.map(l => <li key={l.id}>{srcOf(l)?.title ?? PORTFOLIO_KIND_LABEL[linkKind(l)]} · {l.relation_label}{l.learning_outcome ? ` · "${l.learning_outcome}"` : ""} · linked {fmtDate(l.linked_at)}, unlinked {fmtDate(l.unlinked_at)}</li>)}</ul>
          </details>
        )}
      </div>

      {/* 4. Verified (C5, read only) */}
      <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
        <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-violet-900">{ASPECT_TEXT.verified}</p>
        {e.kind === "personal" ? <p className="text-[13px] text-gray-700">A competency in your own words cannot be independently verified. Add the catalogue competency to request verification.</p>
          : !p.verifications.provisioned ? <p className="text-[13px] text-gray-700">Independent verification is not available yet.</p>
          : p.verifications.items === null ? <p className="text-[13px] text-gray-700">Verification could not be read just now.</p>
          : (
            <>
              {decisions.length === 0 ? <p className="text-[13px] text-gray-700">Nothing recorded by an assessor.</p> : (
                <ul className="mt-1 space-y-1 text-[13px] text-gray-800">
                  {decisions.map(v => (
                    <li key={v.requestId}>Request of {fmtDate(v.requestedAt)} · {v.status}{v.method ? ` · ${v.method}` : ""}
                      {v.decisions.map((d, i) => <p key={i} className={currentDecision(d, p.today) ? "font-semibold text-violet-900" : "text-gray-500 line-through"}>{d.outcomeLabel}{d.level ? ` at ${d.level}` : ""} · {d.assessorName} ({d.authority}){d.criteriaVersion ? ` · criteria ${d.criteriaVersion}` : ""} · {fmtDate(d.decidedAt)}{d.validUntil ? ` · valid until ${fmtDate(d.validUntil)}` : ""}</p>)}
                    </li>
                  ))}
                </ul>
              )}
              {!e.removed_at && (
                <div className="mt-2">
                  <ApiForm action="/api/individual/professional/competency-verification" submitLabel="Request independent verification" accent={accent} savedText="Requested. An appointed assessor will review it.">
                    <input type="hidden" name="entryId" value={e.id} />
                    <p className="text-[12.5px] text-gray-600">Sends this competency and the evidence linked to it ({open.filter(l => SHAREABLE_KINDS.includes(linkKind(l))).length} {open.length === 1 ? "record" : "records"}; never a reflection) to the Verification Studio.</p>
                  </ApiForm>
                </div>
              )}
            </>
          )}
      </div>

      {/* Development (S9) and the entry's own controls */}
      {!e.removed_at && (
        <div className="mt-4 flex flex-wrap gap-2">
          <ApiButton action="/api/individual/professional/my-competencies" method="PATCH" body={{ id: e.id, interest: e.interest ? "false" : "true" }} label={e.interest ? "No longer a development interest" : "Mark as a development interest"} />
          <ApiForm action="/api/individual/professional/my-competencies" submitLabel="Create a development need" accent={accent} savedText="Need created under Needs & plan.">
            <input type="hidden" name="action" value="need" /><input type="hidden" name="id" value={e.id} />
          </ApiForm>
          <ApiForm action="/api/individual/professional/my-competencies" submitLabel="Create a goal" accent={accent} savedText="Goal created under Needs & plan.">
            <input type="hidden" name="action" value="goal" /><input type="hidden" name="id" value={e.id} />
          </ApiForm>
        </div>
      )}

      {policy.ai === "on" && !e.removed_at && (
        <div className="mt-5">
          <h3 className="text-[14px] font-bold text-gray-900">Help from your personal AI</h3>
          <p className="text-[12.5px] text-gray-500">Optional. It sees this competency and the titles of your shareable records, never your reflections. It never verifies anything, and nothing is saved unless you add it.</p>
          <div className="mt-2"><CompetencyAssist entryId={e.id} accent={accent} /></div>
        </div>
      )}

      <details className="mt-5">
        <summary className="cursor-pointer text-[13px] font-semibold text-gray-700">History ({history.length})</summary>
        <ol className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3 text-[12.5px] text-gray-600">
          {history.map((h, i) => <li key={i}><span className="font-semibold text-gray-800">{fmtDate(h.at)}</span>: {h.text}</li>)}
        </ol>
      </details>

      <div className="mt-4 border-t border-gray-100 pt-3">
        {e.removed_at
          ? <ApiButton action="/api/individual/professional/my-competencies" method="PATCH" body={{ id: e.id, removed: "false" }} label="Bring it back" />
          : <ApiButton action="/api/individual/professional/my-competencies" method="PATCH" body={{ id: e.id, removed: "true" }} label="Remove from My Competencies" confirm="Remove it? Its self-assessments, evidence links and history are kept, and you can bring it back." />}
      </div>
    </section>
  );
}

// ── The portfolio (C3) ─────────────────────────────────────────────────────────────────────────────────────

export function Portfolio({ items, unreadable, links, policy, accent }: { items: PortfolioItem[]; unreadable: string[]; links: EvidenceLink[]; policy: ProfessionalCompetencyPolicy; accent: string }) {
  const uses = (i: PortfolioItem) => links.filter(l => !l.unlinked_at && linkKind(l) === i.kind && linkSourceId(l) === i.id).length;
  return (
    <>
      <p className="text-[12.5px] text-gray-500">Your own records, from wherever they are kept. Learning, CPD, credentials and your profile appear here by themselves: nothing is copied. Add only what is not recorded anywhere else.</p>
      {unreadable.length > 0 && <p className="mt-1 text-[12.5px] text-gray-600">Could not be read just now: {unreadable.join(", ")}.</p>}
      {items.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <ul className="mt-2 divide-y divide-gray-100">
          {items.map(i => (
            <li key={`${i.kind}${i.id}`} className="py-2 text-[13.5px]">
              <p className="font-semibold text-gray-900">{i.title}</p>
              <p className="text-[12.5px] text-gray-500">
                {PORTFOLIO_KIND_LABEL[i.kind]}{i.typeLabel ? ` · ${i.typeLabel}` : ""}{i.issuer ? ` · ${i.issuer}` : ""}{i.date ? ` · ${fmtDate(i.date)}` : ""} · {i.classText}
                {uses(i) ? ` · supports ${uses(i)} ${uses(i) === 1 ? "link" : "links"}` : ""}{!i.shareable ? " · never shared" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <AddPanel label="Add supporting evidence" accent={accent} suggestOpen={false}>
        <ApiForm action="/api/individual/professional/evidence" submitLabel="Save evidence" accent={accent} savedText="Saved to your evidence. Link it to a competency from that competency.">
          <input type="hidden" name="kind" value="competency" />
          <Field label="What it is" htmlFor="pe-title"><input id="pe-title" name="title" required minLength={3} maxLength={200} className={inputCls} placeholder="e.g. Observed 12-lead ECG interpretation" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {policy.evidenceTypes.length > 0 && (
              <Field label="Kind of evidence (optional)" htmlFor="pe-type">
                <select id="pe-type" name="evidenceType" defaultValue="" className={inputCls}><option value="">Not stated</option>{policy.evidenceTypes.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}</select>
              </Field>
            )}
            <Field label="Who it is from (optional)" htmlFor="pe-author" hint="An observer, mentor or issuer. Leave out anything that could identify a patient."><input id="pe-author" name="author" maxLength={160} className={inputCls} /></Field>
            <Field label="When (optional)" htmlFor="pe-date"><input id="pe-date" name="issuedOn" type="date" className={inputCls} /></Field>
          </div>
          <Field label="Details (optional)" htmlFor="pe-detail"><textarea id="pe-detail" name="detail" rows={2} maxLength={5000} className={inputCls} /></Field>
        </ApiForm>
      </AddPanel>
    </>
  );
}
