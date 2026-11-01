"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PaneGrid } from "@/components/ui/pane-grid";
import OrgChart, { type ChartSelection } from "../_components/OrgChart";
import {
  CONSTITUTION_STATUSES, DOCUMENT_STATUSES, POSITION_KINDS, POSITION_KIND_LABEL, UNIT_KINDS, UNIT_KIND_LABEL, VERSION_STATUS_LABEL,
  diffDefinitions, validateDefinition, type GovDefinition, type GovStudioLoad, type StudioOp,
} from "@/lib/hq/governance-studio";

/**
 * The Studio. Every change is one operation posted to /api/hq/governance/studio against the draft's revision, and every
 * refusal shown is the server's or the database's own sentence. Nothing here appoints anyone or grants anything.
 */

type Props = { load: GovStudioLoad; isOwner: boolean };
const input = "border border-gray-300 rounded-lg px-2 py-1 text-sm min-h-9 pointer-coarse:min-h-11 w-full";
const btn = "text-[12px] font-medium rounded-lg px-3 py-1.5 min-h-9 pointer-coarse:min-h-11 disabled:opacity-40";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const quiet = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`;
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-[12px] text-gray-600">{label}{children}</label>
);
const STATUS_TONE: Record<string, string> = {
  draft: "bg-[var(--cmp-surface-warning)] text-amber-900", review: "bg-indigo-50 text-indigo-900", approved: "bg-indigo-100 text-indigo-900",
  published: "bg-[var(--cmp-surface-success)] text-green-800", superseded: "bg-gray-100 text-gray-700", discarded: "bg-gray-100 text-gray-500",
};

export default function StudioBoard({ load, isOwner }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [reason, setReason] = useState("");
  const [view, setView] = useState<"version" | "published">("version");
  const [selection, setSelection] = useState<ChartSelection>(null);

  const post = async (body: Record<string, unknown>, key: string, okText: string) => {
    if (reason.trim().length < 5) { setMsg({ k: "err", t: "Write a reason of at least 5 characters first. It goes to the audit trail." }); return false; }
    setBusy(key); setMsg(null);
    try {
      const r = await fetch("/api/hq/governance/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, reason }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { setMsg({ k: "ok", t: okText }); router.refresh(); return true; }
      setMsg({ k: "err", t: j.error ?? `The request failed (HTTP ${r.status}). Nothing was changed.` });
    } catch {
      setMsg({ k: "err", t: "The request did not reach the server, so nothing was changed." });
    } finally { setBusy(null); }
    return false;
  };

  const header = (
    <header>
      <p className="text-[12px] font-semibold tracking-wide text-indigo-800 uppercase">Competen Holdings · shared capability</p>
      <h1 className="text-xl font-bold text-gray-900">Organisation &amp; Governance Studio</h1>
      <p className="text-gray-500 text-sm mt-1 max-w-3xl">
        Change a structure in a draft, preview it against the published version, and publish it through review and owner
        approval. Published versions never change and stay readable as <Link href="/super-admin/users/governance/history" className="text-teal-700 hover:underline">history</Link>.
        A structure grants nothing: platform rights come only from an HQ appointment on <Link href="/super-admin/users/appointments" className="text-teal-700 hover:underline">HQ positions</Link>.
      </p>
    </header>
  );
  if (load.state !== "ok")
    return (
      <div className="space-y-6">{header}
        <p className="text-sm rounded-lg px-3 py-2 bg-[var(--cmp-surface-warning)] text-amber-900">
          {load.state === "absent" ? load.reason : <>The studio could not be read. This is not an empty structure. <span className="text-amber-800/80">({load.error})</span></>}
        </p>
      </div>
    );

  const sel = load.selected;
  const pub = load.published;
  const open = load.versions.find(v => ["draft", "review", "approved"].includes(v.status)) ?? null;
  const editable = !!sel && sel.status === "draft";
  const shown = view === "published" && pub ? pub.definition : sel?.definition ?? null;
  const qs = (version?: string) => `?structure=${encodeURIComponent(load.structure?.code ?? "")}${version ? `&version=${version}` : ""}`;

  return (
    <div className="space-y-6">
      {header}
      {msg && <p role="status" className={`text-sm rounded-lg px-3 py-2 ${msg.k === "ok" ? "bg-[var(--cmp-surface-success)] text-green-800" : "bg-[var(--cmp-surface-error)] text-red-800"}`}>{msg.t}</p>}

      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Structure">
            <select className={input} value={load.structure?.code ?? ""} onChange={e => router.push(`?structure=${encodeURIComponent(e.target.value)}`)}>
              {load.structures.map(s => <option key={s.code} value={s.code}>{s.name} ({s.productLine})</option>)}
            </select>
          </Field>
          <div className="flex-1 min-w-[16rem]">
            <Field label="Reason for your next change (written to the audit trail)">
              <input className={input} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
            </Field>
          </div>
        </div>
        {isOwner && <CreateStructure lines={load.productLines} post={post} busy={busy} />}
      </section>

      {load.structure && (
        <section className="space-y-2">
          <h2 className="text-base font-bold text-gray-900">Versions of {load.structure.name}</h2>
          <ol className="flex flex-wrap gap-2">
            {load.versions.map(v => (
              <li key={v.id}>
                <Link href={qs(v.id)} aria-current={sel?.id === v.id ? "page" : undefined}
                  className={`inline-flex flex-col rounded-lg border px-3 py-1.5 text-[12px] ${sel?.id === v.id ? "border-teal-600" : "border-gray-200"} bg-white`}>
                  <span className="font-semibold text-gray-900">v{v.versionNo} · {v.title}</span>
                  <span className={`mt-0.5 self-start rounded-full px-2 text-[11px] font-semibold ${STATUS_TONE[v.status] ?? ""}`}>
                    {VERSION_STATUS_LABEL[v.status] ?? v.status}{v.effectiveFrom ? ` · from ${v.effectiveFrom}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          {!open && <button type="button" className={primary} disabled={busy === "draft"}
            onClick={() => post({ action: "create_draft", structure: load.structure!.code }, "draft", "Draft opened as a copy of the published version.")}>Start a draft</button>}
        </section>
      )}

      {sel && (
        <Lifecycle sel={sel} isOwner={isOwner} post={post} busy={busy} />
      )}

      {sel && shown && (
        <PaneGrid bp="lg" className="items-start" end={{ storageKey: "governance.studio.editor.w", defaultPx: c => Math.round((c - 24) * 0.4), minPx: 280, label: "Resize the editor panel", node: (
          <aside className="space-y-3">
            {pub && sel.id !== pub.id && <Preview pub={pub.definition} draft={sel.definition} load={load} />}
            {editable && view === "version" && (
              <Editor def={sel.definition} selection={selection} load={load}
                apply={(op: StudioOp, ok: string) => post({ action: "edit", version: sel.id, revision: sel.revision, op }, `op-${op.op}`, ok)} busy={busy} />
            )}
            {!editable && <p className="text-[12px] text-gray-500">This version is {VERSION_STATUS_LABEL[sel.status]?.toLowerCase() ?? sel.status} and cannot be edited. {sel.status === "published" ? "Start a draft to change the structure." : ""}</p>}
            <RelationTypes load={load} post={post} busy={busy} />
          </aside>
        ) }}>
          <section className="space-y-3" aria-label="Organisation chart">
            {pub && sel.id !== pub.id && (
              <div role="tablist" className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-[12px]">
                <button role="tab" aria-selected={view === "version"} className={`${btn} ${view === "version" ? "bg-teal-700 text-white" : ""}`} onClick={() => setView("version")}>v{sel.versionNo} ({VERSION_STATUS_LABEL[sel.status]})</button>
                <button role="tab" aria-selected={view === "published"} className={`${btn} ${view === "published" ? "bg-teal-700 text-white" : ""}`} onClick={() => setView("published")}>Published v{pub.versionNo}</button>
              </div>
            )}
            <OrgChart def={shown} relationTypes={load.relationTypes} showRetired
              changes={view === "version" && pub && sel.id !== pub.id ? diffDefinitions(pub.definition, sel.definition) : []}
              selection={selection} onSelect={setSelection}
              onMovePosition={editable && view === "version" ? (code, unit) => post({ action: "edit", version: sel.id, revision: sel.revision, op: { op: "position_move", code, unit } }, `mv-${code}`, "Position moved in the draft.") : undefined} />
          </section>
        </PaneGrid>
      )}
    </div>
  );
}

type Post = (body: Record<string, unknown>, key: string, okText: string) => Promise<boolean>;
type Ok = Extract<GovStudioLoad, { state: "ok" }>;

function CreateStructure({ lines, post, busy }: { lines: { code: string; name: string }[]; post: Post; busy: string | null }) {
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [line, setLine] = useState("");
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer text-gray-700">Create a structure for another product line (owner)</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-4 items-end">
        <Field label="Code"><input className={input} value={code} onChange={e => setCode(e.target.value.trim())} /></Field>
        <Field label="Name"><input className={input} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Product line"><select className={input} value={line} onChange={e => setLine(e.target.value)}>
          <option value="">Choose</option>{lines.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}</select></Field>
        <button type="button" className={quiet} disabled={!code || !name || !line || busy === "struct"}
          onClick={() => post({ action: "create_structure", code, name, product_line: line }, "struct", "Structure created. Start its first draft.")}>Create</button>
      </div>
    </details>
  );
}

function Lifecycle({ sel, isOwner, post, busy }: { sel: NonNullable<Ok["selected"]>; isOwner: boolean; post: Post; busy: string | null }) {
  const [basis, setBasis] = useState(""); const [eff, setEff] = useState("");
  const step = (s: string, ok: string) => post({ action: "transition", version: sel.id, step: s }, `t-${s}`, ok);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3 flex flex-wrap items-end gap-2 text-[12px]" aria-label="Lifecycle">
      <p className="basis-full text-gray-700">
        <span className="font-semibold">v{sel.versionNo} · {sel.title}</span> is <span className="font-semibold">{VERSION_STATUS_LABEL[sel.status]}</span>.
        {" "}Draft → Review → Approved → Published → Superseded. Approval and publication are the platform owner&apos;s.
        {sel.selfApproved && <span className="text-amber-900"> Approved by an owner who also edited it (recorded).</span>}
        {sel.approvalBasis && <span className="text-gray-500"> Basis: {sel.approvalBasis}.</span>}
      </p>
      {sel.status === "draft" && <>
        <button type="button" className={primary} disabled={!!busy} onClick={() => step("submit", "Submitted for review.")}>Submit for review</button>
        <button type="button" className={quiet} disabled={!!busy} onClick={() => step("discard", "Draft discarded. It stays in the history.")}>Discard draft</button>
      </>}
      {sel.status === "review" && <>
        {isOwner && <button type="button" className={primary} disabled={!!busy} onClick={() => step("approve", "Approved.")}>Approve</button>}
        <button type="button" className={quiet} disabled={!!busy} onClick={() => step("return", "Returned to draft.")}>Return to draft</button>
        <button type="button" className={quiet} disabled={!!busy} onClick={() => step("discard", "Discarded.")}>Discard</button>
      </>}
      {sel.status === "approved" && <>
        {isOwner && <>
          <Field label="Effective from"><input type="date" className={input} value={eff} onChange={e => setEff(e.target.value)} /></Field>
          <Field label="Basis (decision or approval reference)"><input className={input} value={basis} onChange={e => setBasis(e.target.value)} maxLength={300} /></Field>
          <button type="button" className={primary} disabled={basis.trim().length < 5 || !!busy}
            onClick={() => post({ action: "publish", version: sel.id, basis, effective_from: eff || null }, "publish", "Published. The previous version is now history.")}>Publish</button>
        </>}
        <button type="button" className={quiet} disabled={!!busy} onClick={() => step("return", "Returned to draft.")}>Return to draft</button>
      </>}
    </section>
  );
}

function Preview({ pub, draft, load }: { pub: GovDefinition; draft: GovDefinition; load: Ok }) {
  const changes = useMemo(() => diffDefinitions(pub, draft), [pub, draft]);
  const problems = useMemo(() => validateDefinition(draft, {
    base: pub, relationTypes: load.relationTypes.filter(t => t.isActive).map(t => t.code),
    positionCodes: load.positionCodes.ok ? load.positionCodes.value.map(p => p.code) : undefined,
    liveSeats: load.liveSeats.ok ? load.liveSeats.value : undefined,
  }), [draft, pub, load]);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3 space-y-2 text-[12px]" aria-label="Preview against the published version">
      <h2 className="text-sm font-bold text-gray-900">Changes against the published version ({changes.length})</h2>
      {changes.length === 0 ? <p className="text-gray-500">No change yet.</p> : (
        <ul className="space-y-0.5">{changes.map(c => <li key={`${c.kind}-${c.code}-${c.change}`}><span className="font-semibold capitalize">{c.change}</span> {c.kind} <span className="text-gray-900">{c.name}</span>{c.detail && <span className="text-gray-500"> · {c.detail}</span>}</li>)}</ul>
      )}
      {problems.length > 0 && (
        <div className="rounded-md bg-[var(--cmp-surface-warning)] text-amber-900 p-2">
          <p className="font-semibold">This draft would not publish yet:</p>
          <ul className="list-disc pl-4">{problems.map(p => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function Editor({ def, selection, load, apply, busy }: { def: GovDefinition; selection: ChartSelection; load: Ok; apply: (op: StudioOp, ok: string) => Promise<boolean>; busy: string | null }) {
  const unit = selection?.kind === "unit" ? def.units.find(u => u.code === selection.code) : undefined;
  const position = selection?.kind === "position" ? def.positions.find(p => p.code === selection.code) : undefined;
  const liveSeat = position && load.liveSeats.ok && load.liveSeats.value.includes(position.code);
  const unitOpts = def.units.filter(u => !u.retired).map(u => <option key={u.code} value={u.code}>{u.name}</option>);
  const levelOpts = def.levels.map(l => <option key={l.level} value={l.level}>{l.level} · {l.label}</option>);
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string, fallback = "") => f[k] ?? fallback;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const reset = () => setF({});

  return (
    <div className="space-y-3">
      {unit && (
        <section className="rounded-xl border border-teal-300 bg-white p-3 space-y-2 text-[12px]" aria-label="Unit detail" key={`u-${unit.code}`}>
          <h2 className="text-sm font-bold text-gray-900">Unit: {unit.name} <code className="text-[11px] text-gray-500">{unit.code}</code></h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name"><input className={input} defaultValue={unit.name} onChange={set("u_name")} /></Field>
            <Field label="Kind"><select className={input} defaultValue={unit.kind} onChange={set("u_kind")}>{UNIT_KINDS.map(k => <option key={k} value={k}>{UNIT_KIND_LABEL[k]}</option>)}</select></Field>
            <Field label="Constitution"><select className={input} defaultValue={unit.constitution_status ?? "pending_constitution"} onChange={set("u_const")}>{CONSTITUTION_STATUSES.map(k => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select></Field>
            <Field label="Governing document"><select className={input} defaultValue={unit.document_status ?? "none"} onChange={set("u_doc")}>{DOCUMENT_STATUSES.map(k => <option key={k} value={k}>{k}</option>)}</select></Field>
            <Field label="Document reference"><input className={input} defaultValue={unit.document_ref ?? ""} onChange={set("u_docref")} /></Field>
            <Field label="Interim authority"><input className={input} defaultValue={unit.interim_authority ?? ""} onChange={set("u_interim")} /></Field>
            <div className="sm:col-span-2"><Field label="Description"><textarea className={input} rows={2} defaultValue={unit.description ?? ""} onChange={set("u_desc")} /></Field></div>
          </div>
          <button type="button" className={quiet} disabled={!!busy} onClick={() => apply({ op: "unit_edit", code: unit.code, fields: {
            name: v("u_name", unit.name), kind: v("u_kind", unit.kind), constitution_status: v("u_const", unit.constitution_status ?? ""),
            document_status: v("u_doc", unit.document_status ?? ""), document_ref: v("u_docref", unit.document_ref ?? ""),
            interim_authority: v("u_interim", unit.interim_authority ?? ""), description: v("u_desc", unit.description ?? "") } }, "Unit updated in the draft.").then(reset)}>Save unit</button>
          <div className="grid gap-2 sm:grid-cols-3 items-end">
            <Field label="Move under"><select className={input} defaultValue={unit.parent ?? ""} onChange={set("u_parent")}><option value="">Top of its level</option>{unitOpts}</select></Field>
            {unit.kind !== "service" && <Field label="Level"><select className={input} defaultValue={unit.level ?? ""} onChange={set("u_level")}>{levelOpts}</select></Field>}
            <button type="button" className={quiet} disabled={!!busy} onClick={() => apply({ op: "unit_move", code: unit.code, parent: v("u_parent", unit.parent ?? "") || null,
              level: unit.kind === "service" ? undefined : Number(v("u_level", String(unit.level ?? ""))) || null }, "Unit moved in the draft.").then(reset)}>Move</button>
          </div>
          <button type="button" className={quiet} disabled={!!busy} onClick={() => apply({ op: unit.retired ? "unit_restore" : "unit_retire", code: unit.code }, unit.retired ? "Unit restored." : "Unit retired. It stays in history.")}>{unit.retired ? "Restore unit" : "Retire unit"}</button>
        </section>
      )}
      {position && (
        <section className="rounded-xl border border-teal-300 bg-white p-3 space-y-2 text-[12px]" aria-label="Position detail" key={`p-${position.code}`}>
          <h2 className="text-sm font-bold text-gray-900">Position: {position.name} <code className="text-[11px] text-gray-500">{position.code}</code></h2>
          {liveSeat && <p className="text-amber-900">Has a live appointment record: it cannot be retired until that record ends.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name"><input className={input} defaultValue={position.name} onChange={set("p_name")} /></Field>
            <Field label="Kind"><select className={input} defaultValue={position.kind} onChange={set("p_kind")}>{POSITION_KINDS.map(k => <option key={k} value={k}>{POSITION_KIND_LABEL[k]}</option>)}</select></Field>
            <Field label="Linked HQ position (reference only, grants nothing)">
              <select className={input} defaultValue={position.authority_position ?? ""} onChange={set("p_auth")} disabled={position.kind === "director"}>
                <option value="">None</option>{(load.positionCodes.ok ? load.positionCodes.value : []).map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Appointment requirements"><input className={input} defaultValue={position.requirements ?? ""} onChange={set("p_req")} /></Field>
            <div className="sm:col-span-2"><Field label="Responsibilities"><textarea className={input} rows={2} defaultValue={position.accountability ?? ""} onChange={set("p_acc")} /></Field></div>
            <div className="sm:col-span-2"><Field label="Description"><textarea className={input} rows={2} defaultValue={position.description ?? ""} onChange={set("p_desc")} /></Field></div>
          </div>
          <button type="button" className={quiet} disabled={!!busy} onClick={() => apply({ op: "position_edit", code: position.code, fields: {
            name: v("p_name", position.name), kind: v("p_kind", position.kind), authority_position: v("p_auth", position.authority_position ?? ""),
            requirements: v("p_req", position.requirements ?? ""), accountability: v("p_acc", position.accountability ?? ""), description: v("p_desc", position.description ?? "") } }, "Position updated in the draft.").then(reset)}>Save position</button>
          <div className="grid gap-2 sm:grid-cols-2 items-end">
            <Field label="Move to unit"><select className={input} defaultValue={position.unit} onChange={set("p_unit")}>{unitOpts}</select></Field>
            <button type="button" className={quiet} disabled={!!busy} onClick={() => apply({ op: "position_move", code: position.code, unit: v("p_unit", position.unit) }, "Position moved in the draft.").then(reset)}>Move</button>
          </div>
          <button type="button" className={quiet} disabled={!!busy || (!position.retired && !!liveSeat)} onClick={() => apply({ op: position.retired ? "position_restore" : "position_retire", code: position.code }, position.retired ? "Position restored." : "Position retired. It stays in history.")}>{position.retired ? "Restore position" : "Retire position"}</button>
        </section>
      )}
      {!unit && !position && <p className="text-[12px] text-gray-500">Select a unit or position on the chart to edit, move or retire it. You can also drag a position onto a unit.</p>}

      <details className="rounded-xl border border-gray-200 bg-white p-3 text-[12px]">
        <summary className="cursor-pointer font-semibold text-gray-900">Add a unit (board, committee, department, portfolio, service)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="Name"><input className={input} value={v("n_name")} onChange={set("n_name")} /></Field>
          <Field label="Kind"><select className={input} value={v("n_kind", "department")} onChange={set("n_kind")}>{UNIT_KINDS.map(k => <option key={k} value={k}>{UNIT_KIND_LABEL[k]}</option>)}</select></Field>
          {v("n_kind", "department") !== "service" && <Field label="Level"><select className={input} value={v("n_level")} onChange={set("n_level")}><option value="">Choose</option>{levelOpts}</select></Field>}
          <Field label="Inside"><select className={input} value={v("n_parent")} onChange={set("n_parent")}><option value="">Top of its level</option>{unitOpts}</select></Field>
        </div>
        <button type="button" className={`${quiet} mt-2`} disabled={!v("n_name").trim() || !!busy} onClick={() => apply({ op: "unit_add", unit: {
          name: v("n_name"), kind: v("n_kind", "department"), level: v("n_kind", "department") === "service" ? null : Number(v("n_level")) || null,
          parent: v("n_parent") || undefined, constitution_status: "pending_constitution" } }, "Unit added to the draft.").then(ok => ok && reset())}>Add unit</button>
      </details>

      <details className="rounded-xl border border-gray-200 bg-white p-3 text-[12px]">
        <summary className="cursor-pointer font-semibold text-gray-900">Add a position (vacant)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="Name"><input className={input} value={v("q_name")} onChange={set("q_name")} /></Field>
          <Field label="Unit"><select className={input} value={v("q_unit", selection?.kind === "unit" ? selection.code : "")} onChange={set("q_unit")}><option value="">Choose</option>{unitOpts}</select></Field>
          <Field label="Kind"><select className={input} value={v("q_kind", "position")} onChange={set("q_kind")}>{POSITION_KINDS.map(k => <option key={k} value={k}>{POSITION_KIND_LABEL[k]}</option>)}</select></Field>
          <Field label="Appointment requirements"><input className={input} value={v("q_req")} onChange={set("q_req")} /></Field>
          <div className="sm:col-span-2"><Field label="Responsibilities"><input className={input} value={v("q_acc")} onChange={set("q_acc")} /></Field></div>
        </div>
        <button type="button" className={`${quiet} mt-2`} disabled={!v("q_name").trim() || !v("q_unit", selection?.kind === "unit" ? selection.code : "") || !!busy}
          onClick={() => apply({ op: "position_add", position: { name: v("q_name"), unit: v("q_unit", selection?.kind === "unit" ? selection.code : ""), kind: v("q_kind", "position"),
            requirements: v("q_req") || undefined, accountability: v("q_acc") || undefined } }, "Position added to the draft. It is vacant.").then(ok => ok && reset())}>Add position</button>
      </details>

      <details className="rounded-xl border border-gray-200 bg-white p-3 text-[12px]">
        <summary className="cursor-pointer font-semibold text-gray-900">Add a relationship</summary>
        <p className="mt-1 text-gray-500">A new relationship is published pending and delegates nothing until it is decided on the governance screen.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Field label="From"><select className={input} value={v("r_from")} onChange={set("r_from")}><option value="">Choose</option>{unitOpts}</select></Field>
          <Field label="Type"><select className={input} value={v("r_type")} onChange={set("r_type")}><option value="">Choose</option>{load.relationTypes.filter(t => t.isActive).map(t => <option key={t.code} value={t.code}>{t.label}</option>)}</select></Field>
          <Field label="To"><select className={input} value={v("r_to")} onChange={set("r_to")}><option value="">Choose</option>{unitOpts}</select></Field>
          <div className="sm:col-span-3"><Field label="Scope"><input className={input} value={v("r_scope")} onChange={set("r_scope")} /></Field></div>
        </div>
        <button type="button" className={`${quiet} mt-2`} disabled={!v("r_from") || !v("r_to") || !v("r_type") || !v("r_scope").trim() || !!busy}
          onClick={() => apply({ op: "relationship_add", relationship: { from: v("r_from"), to: v("r_to"), type: v("r_type"), scope: v("r_scope") } }, "Relationship added to the draft.").then(ok => ok && reset())}>Add relationship</button>
        <ul className="mt-2 space-y-1">
          {def.relationships.map(r => (
            <li key={r.code} className="flex items-center justify-between gap-2">
              <span className={r.retired ? "line-through text-gray-400" : ""}>{r.from} → {r.to} · {r.type}</span>
              <button type="button" className={quiet} disabled={!!busy} onClick={() => apply({ op: r.retired ? "relationship_restore" : "relationship_retire", code: r.code }, r.retired ? "Relationship restored." : "Relationship retired.")}>{r.retired ? "Restore" : "Retire"}</button>
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-xl border border-gray-200 bg-white p-3 text-[12px]">
        <summary className="cursor-pointer font-semibold text-gray-900">Levels and independence pairs</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3 items-end">
          <Field label="Level number"><input type="number" min={1} max={9} className={input} value={v("l_no")} onChange={set("l_no")} /></Field>
          <Field label="Label"><input className={input} value={v("l_label")} onChange={set("l_label")} /></Field>
          <button type="button" className={quiet} disabled={!v("l_no") || !v("l_label").trim() || !!busy} onClick={() => apply({ op: "level_set", level: Number(v("l_no")), label: v("l_label") }, "Level saved in the draft.").then(ok => ok && reset())}>Add or rename level</button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 items-end">
          <Field label="Position"><select className={input} value={v("x_a")} onChange={set("x_a")}><option value="">Choose</option>{def.positions.filter(p => !p.retired).map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
          <Field label="Must stay independent of"><select className={input} value={v("x_b")} onChange={set("x_b")}><option value="">Choose</option>{def.positions.filter(p => !p.retired).map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
          <Field label="Why"><input className={input} value={v("x_reason")} onChange={set("x_reason")} /></Field>
        </div>
        <button type="button" className={`${quiet} mt-2`} disabled={!v("x_a") || !v("x_b") || !v("x_reason").trim() || !!busy} onClick={() => apply({ op: "pair_add", pair: { a: v("x_a"), b: v("x_b"), reason: v("x_reason") } }, "Independence pair added. Pairs are only ever added.").then(ok => ok && reset())}>Add pair</button>
      </details>
    </div>
  );
}

function RelationTypes({ load, post, busy }: { load: Ok; post: Post; busy: string | null }) {
  const [code, setCode] = useState(""); const [label, setLabel] = useState(""); const [style, setStyle] = useState("solid");
  return (
    <details className="rounded-xl border border-gray-200 bg-white p-3 text-[12px]">
      <summary className="cursor-pointer font-semibold text-gray-900">Relationship types ({load.relationTypes.length})</summary>
      <ul className="mt-2 space-y-0.5">{load.relationTypes.map(t => <li key={t.code}><span className="font-medium">{t.label}</span> <span className="text-gray-500">· {t.lineStyle}{t.isActive ? "" : " · retired"}</span></li>)}</ul>
      <div className="mt-2 grid gap-2 sm:grid-cols-4 items-end">
        <Field label="Code"><input className={input} value={code} onChange={e => setCode(e.target.value.trim())} /></Field>
        <Field label="Label"><input className={input} value={label} onChange={e => setLabel(e.target.value)} /></Field>
        <Field label="Line"><select className={input} value={style} onChange={e => setStyle(e.target.value)}><option>solid</option><option>dashed</option><option>dotted</option></select></Field>
        <button type="button" className={quiet} disabled={!code || !label || busy === "rt"} onClick={() => post({ action: "add_relation_type", code, label, line_style: style }, "rt", "Relationship type added.")}>Add type</button>
      </div>
    </details>
  );
}
