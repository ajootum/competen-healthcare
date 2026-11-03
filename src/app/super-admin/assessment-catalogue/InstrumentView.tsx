"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { InstrumentDetail } from "@/lib/assessment/catalogue/detail";
import { eventWords, modeWords } from "@/lib/assessment/catalogue/detail";
import type { TaxonomyDimension } from "@/lib/assessment/catalogue/classify";
import type { Collection } from "@/lib/assessment/catalogue/collections";
import { AVAILABILITY_MODES, MODE_LABEL, RELATION_KINDS, RELATION_LABEL, type AvailabilityMode } from "@/lib/assessment/catalogue/shape";
import { termPath } from "@/lib/assessment/catalogue/hierarchy";
import ClassificationFields, { type TermChoice } from "./ClassificationFields";
import { BASE, Chip, CodeChip, Field, Section, StatusBadge, btnGhost, btnPrimary, callApi, fmtDate, input } from "./ui";

// The instrument, as the drawer and the full page show it. One component, one data read: the page route and the drawer
// cannot disagree. It edits CATALOGUE METADATA only (classification, availability, links, collections, governance
// details). Checklist content, scoring and versions belong to Checklist Studio, and the link below goes there.

type Props = {
  detail: InstrumentDetail;
  taxonomy: TaxonomyDimension[];
  collections: Collection[];
  referenceKinds: { code: string; label: string }[];
  canManage: boolean;
  canStudio: boolean;
  layout: "drawer" | "page";
};

const TARGET_OF_KIND: Record<string, string> = { framework: "frameworks", framework_competency: "framework_competencies" };

export default function InstrumentView({ detail, taxonomy, collections, referenceKinds, canManage, canStudio, layout }: Props) {
  const router = useRouter();
  const api = `/api/hq/assessment-catalogue/${detail.id}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | "class" | "identity" | "reference" | "relation">(null);

  async function act(body: Record<string, unknown>, done?: () => void) {
    setBusy(true); setError(null);
    const r = await callApi(api, body);
    setBusy(false);
    if (!r.ok) { setError(r.error); return false; }
    done?.();
    router.refresh();
    return true;
  }

  const studioHref = `/super-admin/checklist-studio/${detail.id}`;
  const studioLabel = detail.status === "none" ? "Configure in Checklist Studio" : "Open in Checklist Studio";
  const dims = taxonomy.filter(d => d.isActive || detail.terms.some(t => t.dimensionCode === d.code));
  const termsOf = (dim: string) => detail.terms.filter(t => t.dimensionCode === dim);
  const classificationRows: [string, ReactNode][] = [
    ["Family", detail.familyLabel ? `${detail.familyLabel} (${detail.familyCode})` : null],
    ...dims.filter(d => d.code !== "keyword").map(d => {
      const ts = termsOf(d.code);
      const all = d.terms;
      const label = (t: typeof ts[number]) => { const term = all.find(x => x.id === t.termId); return term ? termPath(term, all).join(" / ") : t.label; };
      return [d.code === "domain" ? "Subject domain" : d.code === "level" ? "Qualification applicability" : d.label, ts.length ? ts.map((t, i) => (
        <span key={t.termId}>{i > 0 && ", "}{label(t)}{t.isPrimary && ts.length > 1 ? " (primary)" : ""}</span>
      )) : null] as [string, ReactNode];
    }),
  ];
  const keywords = termsOf("keyword");

  return (
    <div className="text-sm text-gray-900" aria-busy={busy}>
      {/* Identity */}
      <div className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CodeChip code={detail.code} />
          <StatusBadge status={detail.status} />
          <Chip tone="neutral" title="The newest version. The catalogue lists every version below.">{detail.version}</Chip>
          <Chip tone="info">Holdings master</Chip>
        </div>
        {layout === "page" && <h1 className="mt-2 text-xl font-bold text-gray-900">{detail.name}</h1>}
        {layout === "drawer" && <h2 className="mt-2 text-lg font-bold text-gray-900">{detail.name}</h2>}
        <p className="mt-1 text-[13px] text-gray-700">{detail.description ?? <span className="text-gray-600">No description yet.</span>}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {canStudio
            ? <a href={studioHref} className={btnPrimary}>{studioLabel}</a>
            : <span className="text-[12px] text-gray-600">Checklist content is edited in Checklist Studio, which needs its own right.</span>}
          {canManage && <button type="button" className={btnGhost} onClick={() => setEditing(editing === "identity" ? null : "identity")}>Edit details</button>}
          {layout === "drawer" && <a href={`${BASE}/${detail.id}`} className={btnGhost}>Open full page</a>}
        </div>
        {error && <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">{error}</p>}
        {editing === "identity" && canManage && (
          <IdentityForm detail={detail} busy={busy} onCancel={() => setEditing(null)}
            onSave={v => act({ action: "identity", ...v }, () => setEditing(null))} />
        )}
      </div>

      {/* Classification */}
      <Section title="Classification" hint="Independent axes. An instrument can carry several terms on an axis and one primary."
        action={canManage && editing !== "class" ? <button type="button" className={btnGhost} onClick={() => setEditing("class")}>Edit</button> : undefined}>
        {editing === "class" && canManage ? (
          <ClassificationEditor detail={detail} taxonomy={taxonomy} busy={busy} onCancel={() => setEditing(null)}
            onSave={terms => act({ action: "classify", terms }, () => setEditing(null))} />
        ) : (
          <div>
            {classificationRows.map(([k, v]) => <Field key={k} label={k} value={v} />)}
            {keywords.length > 0 && <Field label="Keywords" value={keywords.map(k => k.label).join(", ")} />}
            <Field label="Permitted modes" value={detail.permittedModes.length
              ? <span className="inline-flex flex-wrap justify-end gap-1">{detail.permittedModes.map(m => <Chip key={m} tone="neutral">{modeWords(m)}</Chip>)}</span>
              : <span className="text-gray-600">None until a version is published</span>} />
            <p className="mt-1 text-[11.5px] text-gray-600">Permitted modes come from the published version, set in Checklist Studio. They are separate from the family.</p>
          </div>
        )}
      </Section>

      {/* References and relations */}
      <Section title="Framework or standards relationship" hint="References point at the authoritative record. The catalogue never duplicates it."
        action={canManage ? <button type="button" className={btnGhost} onClick={() => setEditing(editing === "reference" ? null : "reference")}>Add reference</button> : undefined}>
        {detail.references.length === 0
          ? <p className="text-[13px] text-gray-600">No reference recorded.</p>
          : <ul className="flex flex-wrap gap-2">
              {detail.references.map(r => (
                <li key={r.id}>
                  <Chip tone="info" title={`${r.kindLabel}${r.refVersion ? ` version ${r.refVersion}` : ""}${r.refId ? " (linked by id)" : ""}`}>
                    <span className="text-[11px] font-bold uppercase text-blue-800">{r.kindLabel}</span> {r.refCode ? `${r.refCode} · ` : ""}{r.refLabel}
                    {canManage && <button type="button" aria-label={`Remove reference ${r.refLabel}`} disabled={busy} className="ml-1 rounded px-1 font-bold text-blue-900 hover:bg-blue-100"
                      onClick={() => act({ action: "reference_remove", referenceId: r.id })}>{"×"}</button>}
                  </Chip>
                </li>
              ))}
            </ul>}
        {editing === "reference" && canManage && (
          <ReferenceForm kinds={referenceKinds} busy={busy} onCancel={() => setEditing(null)} onSave={v => act({ action: "reference_add", ...v }, () => setEditing(null))} />
        )}
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[12px] font-bold uppercase tracking-wide text-gray-600">Related instruments</h4>
            {canManage && <button type="button" className="text-[12px] font-semibold text-teal-800 underline" onClick={() => setEditing(editing === "relation" ? null : "relation")}>Add</button>}
          </div>
          {detail.relations.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">No related instrument.</p> : (
            <ul className="mt-1 space-y-1">
              {detail.relations.map(r => (
                <li key={`${r.direction}-${r.relation}-${r.instrumentId}`} className="flex items-center justify-between gap-2 text-[13px]">
                  <span><span className="text-gray-600">{r.direction === "out" ? RELATION_LABEL[r.relation] ?? r.relation : `${RELATION_LABEL[r.relation] ?? r.relation} (by)`}</span>{" "}
                    <a className="font-semibold text-teal-800 underline" href={`${BASE}/${r.instrumentId}`}>{r.code}</a> {r.name}</span>
                  {canManage && r.direction === "out" && <button type="button" aria-label={`Remove relation to ${r.code}`} disabled={busy} className="rounded px-2 py-1 text-gray-700 hover:bg-gray-100"
                    onClick={() => act({ action: "relation", relatedId: r.instrumentId, relation: r.relation, remove: true })}>{"×"}</button>}
                </li>
              ))}
            </ul>
          )}
          {editing === "relation" && canManage && (
            <RelationForm selfId={detail.id} busy={busy} onCancel={() => setEditing(null)} onSave={v => act({ action: "relation", ...v }, () => setEditing(null))} />
          )}
        </div>
      </Section>

      {/* Availability */}
      <Section title="Product availability" hint="Makes the instrument discoverable by a product. The product's own policy decides whether a person is offered it.">
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
          {detail.availability.map(a => (
            <li key={a.productLine} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div>
                <p className="text-[13px] font-semibold text-gray-900">{a.productName}</p>
                {a.note && <p className="text-[11.5px] text-gray-600">{a.note}</p>}
              </div>
              {canManage ? (
                <select aria-label={`Availability in ${a.productName}`} value={a.mode ?? "none"} disabled={busy}
                  onChange={e => act({ action: "availability", productLine: a.productLine, mode: e.target.value === "none" ? null : e.target.value })}
                  className={`${input} !w-auto min-w-[9.5rem]`}>
                  <option value="none">{MODE_LABEL.none}</option>
                  {AVAILABILITY_MODES.map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </select>
              ) : (
                <Chip tone={a.enabled ? "good" : "muted"}>{a.enabled ? "Enabled" : "Not enabled"}{a.mode ? ` · ${MODE_LABEL[a.mode as AvailabilityMode]}` : ""}</Chip>
              )}
            </li>
          ))}
          {detail.availability.length === 0 && <li className="px-3 py-2 text-[13px] text-gray-600">No active product line.</li>}
        </ul>
        {detail.status !== "published" && <p className="mt-1 text-[11.5px] text-gray-600">A product discovers an instrument only when it has a published version.</p>}
      </Section>

      {/* Collections */}
      <Section title="Collections">
        <div className="flex flex-wrap items-center gap-2">
          {detail.collections.length === 0 && <span className="text-[13px] text-gray-600">In no collection.</span>}
          {detail.collections.map(c => (
            <Chip key={c.id} tone="neutral">{c.name}
              {canManage && <button type="button" aria-label={`Remove from ${c.name}`} disabled={busy} className="ml-1 rounded px-1 font-bold hover:bg-slate-200"
                onClick={() => act({ action: "collection", collectionId: c.id, add: false })}>{"×"}</button>}
            </Chip>
          ))}
          {canManage && (() => {
            const free = collections.filter(c => c.isActive && !detail.collections.some(x => x.id === c.id));
            return free.length ? (
              <select aria-label="Add to a collection" value="" disabled={busy} className={`${input} !w-auto`}
                onChange={e => e.target.value && act({ action: "collection", collectionId: e.target.value, add: true })}>
                <option value="">Add to collection…</option>
                {free.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : null;
          })()}
        </div>
      </Section>

      {/* Versions */}
      <Section title="Version history" hint="Read from Checklist Studio. The published version is the authoritative one. Content is managed there.">
        {detail.versions.length === 0 ? (
          <p className="text-[13px] text-gray-600">No version yet. This identity is registered and waiting for its content.</p>
        ) : (
          <ul className="space-y-1.5">
            {detail.versions.map(v => (
              <li key={v.id} className={`rounded-lg border px-3 py-2 text-[13px] ${v.isAuthoritative ? "border-green-300 bg-green-50/50" : "border-gray-100"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{v.label}</span>
                  <StatusBadge status={v.state} />
                  {v.isAuthoritative && <Chip tone="good">Authoritative</Chip>}
                  {v.isLatest && !v.isAuthoritative && <Chip tone="neutral">Current</Chip>}
                </div>
                <p className="mt-1 text-[12px] text-gray-700">
                  Created {fmtDate(v.createdAt)}
                  {v.submittedAt && ` · put forward ${fmtDate(v.submittedAt)}`}
                  {v.publishedAt && ` · published ${fmtDate(v.publishedAt)}${v.publisher ? ` by ${v.publisher}` : ""}`}
                  {v.retiredAt && ` · retired ${fmtDate(v.retiredAt)}`}
                  {v.effectiveFrom && ` · effective ${fmtDate(v.effectiveFrom)}`}
                  {v.reviewDue && ` · review due ${fmtDate(v.reviewDue)}`}
                </p>
                {layout === "page" && v.authors.length > 0 && <p className="text-[12px] text-gray-600">Authored by {v.authors.join(", ")}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Governance */}
      <Section title="Ownership & governance">
        <Field label="Owner" value={detail.owningEntity} />
        <Field label="Responsible authority" value={detail.responsibleAuthority} />
        <Field label="Governance note" value={detail.governanceNote} />
        <Field label="Registered" value={`${fmtDate(detail.createdAt)}${detail.createdBy ? ` by ${detail.createdBy}` : ""}`} />
        {detail.importId && <Field label="Source record" value={<span>Imported from {detail.importRecord ? <b>{detail.importRecord.fileName}</b> : "a workbook"}{detail.importSheet ? ` (sheet ${detail.importSheet})` : ""}{detail.importRecord ? `, sha256 ${detail.importRecord.sha256.slice(0, 12)}…` : ""} · <a className="font-semibold underline" href={`/api/hq/assessment-catalogue/import/${detail.importId}/file`}>download the original</a></span>} />}
        {detail.relations.some(r => r.direction === "out" && r.relation === "adapted_from") && <Field label="Template" value={detail.relations.filter(r => r.direction === "out" && r.relation === "adapted_from").map(r => `${r.code} ${r.name}${r.note ? ` (${r.note})` : ""}`).join("; ")} />}
        <Field label="Access boundary" value="Catalogue metadata only; no learner or patient assessment records" />
      </Section>

      {layout === "page" && (
        <Section title="Catalogue trail" hint="Every change to classification, availability, links and collections is recorded.">
          {detail.events.length === 0 ? <p className="text-[13px] text-gray-600">Nothing recorded yet.</p> : (
            <ul className="space-y-1 text-[13px]">
              {detail.events.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex flex-wrap justify-between gap-2 border-b border-gray-50 py-1">
                  <span>{eventWords(e.event)}</span>
                  <span className="text-gray-600">{e.actor ?? "System"} {"·"} {fmtDate(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}

// ---- forms -------------------------------------------------------------------------------------------------------

function IdentityForm({ detail, busy, onSave, onCancel }: {
  detail: InstrumentDetail; busy: boolean; onCancel: () => void;
  onSave: (v: { name: string; description: string; responsibleAuthority: string; governanceNote: string }) => void;
}) {
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description ?? "");
  const [responsibleAuthority, setAuthority] = useState(detail.responsibleAuthority ?? "");
  const [governanceNote, setNote] = useState(detail.governanceNote ?? "");
  return (
    <form className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3" onSubmit={e => { e.preventDefault(); onSave({ name, description, responsibleAuthority, governanceNote }); }}>
      <label className="block text-[12px] font-semibold text-gray-800">Title
        <input className={`${input} mt-1`} value={name} onChange={e => setName(e.target.value)} maxLength={200} required />
      </label>
      <label className="block text-[12px] font-semibold text-gray-800">Description
        <textarea className={`${input} mt-1`} rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} />
      </label>
      <label className="block text-[12px] font-semibold text-gray-800">Responsible authority
        <input className={`${input} mt-1`} value={responsibleAuthority} onChange={e => setAuthority(e.target.value)} maxLength={200} />
      </label>
      <label className="block text-[12px] font-semibold text-gray-800">Governance note
        <input className={`${input} mt-1`} value={governanceNote} onChange={e => setNote(e.target.value)} maxLength={1000} />
      </label>
      <p className="text-[11.5px] text-gray-600">The code {detail.code}, the family and the kind are permanent.</p>
      <div className="flex gap-2"><button type="submit" disabled={busy} className={btnPrimary}>Save</button><button type="button" className={btnGhost} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function ClassificationEditor({ detail, taxonomy, busy, onSave, onCancel }: {
  detail: InstrumentDetail; taxonomy: TaxonomyDimension[]; busy: boolean; onCancel: () => void;
  onSave: (terms: { termId: string; isPrimary: boolean }[]) => void;
}) {
  const [terms, setTerms] = useState<TermChoice[]>(() => detail.terms.map(t => ({ termId: t.termId, isPrimary: t.isPrimary })));
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <ClassificationFields taxonomy={taxonomy} value={terms} onChange={setTerms} expanded />
      <div className="flex gap-2">
        <button type="button" disabled={busy} className={btnPrimary} onClick={() => onSave(terms)}>Save classification</button>
        <button type="button" className={btnGhost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ReferenceForm({ kinds, busy, onSave, onCancel }: {
  kinds: { code: string; label: string }[]; busy: boolean; onCancel: () => void;
  onSave: (v: { kind: string; refTable: string | null; refId: string | null; refCode: string; refLabel: string; refVersion: string }) => void;
}) {
  const [kind, setKind] = useState(kinds[0]?.code ?? "");
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [version, setVersion] = useState("");
  const [picked, setPicked] = useState<{ table: string; id: string } | null>(null);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<{ id: string; code: string | null; label: string }[]>([]);
  const target = TARGET_OF_KIND[kind];

  async function find() {
    if (!target) return;
    const r = await fetch(`/api/hq/assessment-catalogue/reference-targets?key=${target}&q=${encodeURIComponent(q)}`).then(x => x.json()).catch(() => ({}));
    setMatches((r.matches ?? []) as typeof matches);
  }
  return (
    <form className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3" onSubmit={e => { e.preventDefault(); onSave({ kind, refTable: picked?.table ?? null, refId: picked?.id ?? null, refCode: code, refLabel: label, refVersion: version }); }}>
      <label className="block text-[12px] font-semibold text-gray-800">Kind
        <select className={`${input} mt-1`} value={kind} onChange={e => { setKind(e.target.value); setPicked(null); setMatches([]); }}>
          {kinds.map(k => <option key={k.code} value={k.code}>{k.label}</option>)}
        </select>
      </label>
      {target && (
        <div className="rounded-lg border border-dashed border-gray-300 p-2">
          <p className="text-[12px] text-gray-700">Find it in the library to link by id (nothing is copied).</p>
          <div className="mt-1 flex gap-2">
            <input className={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or code" aria-label="Search the library" />
            <button type="button" className={btnGhost} onClick={find}>Search</button>
          </div>
          {matches.length > 0 && (
            <ul className="mt-1 max-h-40 overflow-y-auto">
              {matches.map(m => (
                <li key={m.id}><button type="button" className="w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-white"
                  onClick={() => { setPicked({ table: target, id: m.id }); setLabel(m.label); setCode(m.code ?? ""); setMatches([]); }}>{m.code ? `${m.code} · ` : ""}{m.label}</button></li>
              ))}
            </ul>
          )}
          {picked && <p className="mt-1 text-[12px] font-semibold text-green-900">Linked by id.</p>}
        </div>
      )}
      <label className="block text-[12px] font-semibold text-gray-800">Name
        <input className={`${input} mt-1`} value={label} onChange={e => { setLabel(e.target.value); setPicked(null); }} maxLength={300} required />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[12px] font-semibold text-gray-800">Code
          <input className={`${input} mt-1`} value={code} onChange={e => setCode(e.target.value)} maxLength={100} />
        </label>
        <label className="block text-[12px] font-semibold text-gray-800">Version
          <input className={`${input} mt-1`} value={version} onChange={e => setVersion(e.target.value)} maxLength={60} />
        </label>
      </div>
      <div className="flex gap-2"><button type="submit" disabled={busy || !label.trim()} className={btnPrimary}>Add reference</button><button type="button" className={btnGhost} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

function RelationForm({ selfId, busy, onSave, onCancel }: {
  selfId: string; busy: boolean; onCancel: () => void; onSave: (v: { relatedId: string; relation: string; note: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<{ id: string; code: string; name: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; code: string; name: string } | null>(null);
  const [relation, setRelation] = useState<string>("related");
  const [note, setNote] = useState("");
  async function find() {
    const r = await fetch(`/api/hq/assessment-catalogue?q=${encodeURIComponent(q)}`).then(x => x.json()).catch(() => ({}));
    setMatches(((r.rows ?? []) as { id: string; code: string; name: string }[]).filter(m => m.id !== selfId).slice(0, 10));
  }
  return (
    <form className="mt-2 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3" onSubmit={e => { e.preventDefault(); if (picked) onSave({ relatedId: picked.id, relation, note }); }}>
      <div className="flex gap-2">
        <input className={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Find an instrument by title or code" aria-label="Find an instrument" />
        <button type="button" className={btnGhost} onClick={find}>Search</button>
      </div>
      {matches.length > 0 && !picked && (
        <ul className="max-h-40 overflow-y-auto">
          {matches.map(m => <li key={m.id}><button type="button" className="w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-white" onClick={() => { setPicked(m); setMatches([]); }}>{m.code} {"·"} {m.name}</button></li>)}
        </ul>
      )}
      {picked && <p className="text-[13px] font-semibold text-gray-900">{picked.code} {"·"} {picked.name}</p>}
      <label className="block text-[12px] font-semibold text-gray-800">Relation
        <select className={`${input} mt-1`} value={relation} onChange={e => setRelation(e.target.value)}>
          {RELATION_KINDS.map(k => <option key={k} value={k}>{RELATION_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="block text-[12px] font-semibold text-gray-800">Note
        <input className={`${input} mt-1`} value={note} onChange={e => setNote(e.target.value)} maxLength={300} />
      </label>
      <div className="flex gap-2"><button type="submit" disabled={busy || !picked} className={btnPrimary}>Add relation</button><button type="button" className={btnGhost} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
