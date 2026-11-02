"use client";

import { useState } from "react";
import {
  EDITABLE_FIELDS, FIELD_LABEL, FIELD_LIMIT, buildProfilePatch, patchErrorMessage,
  type EditableField, type FieldValues,
} from "@/lib/hq/user-detail";
import type { PersonalDetail, PreferredName, Src } from "./user-detail-load";
import { Field, Notice, SectionCard, SourceNote, StatePill, SubHead, ValueOrState, btn, btnPrimary, inputCls } from "./UserDetailParts";

// Section 1 -- Personal & Contact. The OFFICIAL identity (what Competen holds in profiles) is separate from the
// DISPLAY preference the person chooses (individual_identity_profile.preferred_name). Edits go through
// PATCH /api/super-admin/users/profile with the values this screen loaded, so a change made meanwhile is refused
// ("changed since you opened them") rather than overwritten. Email is never edited here: it changes through the
// person's own verified sign-in flow.

const FIELD_ORDER: EditableField[] = ["given_name", "middle_names", "family_name", "full_name", "phone", "country"];

export default function UserDetailPersonal({ userId, personal, preferred, canManage, onSaved }: {
  userId: string;
  personal: Src<PersonalDetail>;
  preferred: PreferredName;
  canManage: boolean;
  /** Called after a successful save so the detail and the directory row are read again. */
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<EditableField, string>>(() => emptyDraft());
  const [prefDraft, setPrefDraft] = useState("");
  const [errors, setErrors] = useState<Partial<Record<EditableField | "preferred_name", string>>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  if (personal.state !== "ok") {
    return (
      <SectionCard id="personal" title="Personal & Contact">
        <SourceNote state={personal.state} what="The profile" />
      </SectionCard>
    );
  }
  const p = personal.value;
  const loaded: FieldValues = {
    given_name: p.givenName, middle_names: p.middleNames, family_name: p.familyName,
    full_name: p.fullName, phone: p.phone, country: p.country,
  };
  // A name part whose column is not there yet cannot be edited, and says so rather than looking empty.
  const supported = (k: EditableField) => (k === "given_name" || k === "family_name" ? p.namesSupported : k === "middle_names" ? p.middleSupported : true);
  const canEditPreferred = canManage && preferred.kind === "no_profile";

  function start() {
    const d = emptyDraft();
    for (const k of EDITABLE_FIELDS) d[k] = loaded[k] ?? "";
    setDraft(d); setPrefDraft(""); setErrors({}); setMsg(null); setEditing(true);
  }

  async function save() {
    const built = buildProfilePatch(userId, loaded, draft, canEditPreferred ? { loaded: null, draft: prefDraft } : undefined);
    if (!built.ok) { setErrors(built.errors); setMsg({ kind: "err", text: "Fix the highlighted details first." }); return; }
    setErrors({});
    if (!built.body) { setEditing(false); setMsg({ kind: "ok", text: "Nothing changed." }); return; }
    setSaving(true); setMsg(null);
    try {
      const res = await fetch("/api/super-admin/users/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(built.body) });
      const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) { setMsg({ kind: "err", text: patchErrorMessage(res.status, j.code, j.error) }); return; }
      setEditing(false);
      setMsg({ kind: "ok", text: `Saved ${Object.keys(built.body.fields).length} detail${Object.keys(built.body.fields).length === 1 ? "" : "s"}. The change is in the audit trail.` });
      onSaved();
    } catch {
      setMsg({ kind: "err", text: "The details could not be saved. Check your connection and try again." });
    } finally { setSaving(false); }
  }

  return (
    <SectionCard id="personal" title="Personal & Contact" subtitle="Official identity as Competen holds it, then what the person chose to show."
      action={canManage && !editing ? <button type="button" onClick={start} className={btn}>Edit details</button> : undefined}>
      <SubHead>Official identity</SubHead>
      {editing ? (
        <form onSubmit={e => { e.preventDefault(); void save(); }} className="grid gap-3 sm:grid-cols-2" noValidate>
          {FIELD_ORDER.map(k => (
            <div key={k} className={k === "full_name" ? "sm:col-span-2" : undefined}>
              <label htmlFor={`ud-f-${k}`} className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">{FIELD_LABEL[k]}</label>
              {supported(k) ? (
                <>
                  <input id={`ud-f-${k}`} value={draft[k]} maxLength={FIELD_LIMIT[k] + 20}
                    inputMode={k === "phone" ? "tel" : undefined} autoComplete="off"
                    onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                    aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `ud-f-${k}-e` : undefined}
                    className={`${inputCls} ${errors[k] ? "border-[var(--cmp-color-critical)]" : ""}`} />
                  {errors[k] && <p id={`ud-f-${k}-e`} className="mt-1 text-[11px] text-[var(--cmp-text-critical)]">{errors[k]}</p>}
                  {k === "full_name" && <p className="mt-1 text-[11px] text-gray-500">The display name. It is not rebuilt from the parts above.</p>}
                </>
              ) : <StatePill state="not_set_up" />}
            </div>
          ))}
          {canEditPreferred && (
            <div className="sm:col-span-2">
              <label htmlFor="ud-f-preferred" className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">{FIELD_LABEL.preferred_name} (display preference)</label>
              <input id="ud-f-preferred" value={prefDraft} onChange={e => setPrefDraft(e.target.value)} className={inputCls} autoComplete="off"
                aria-invalid={!!errors.preferred_name} />
              {errors.preferred_name && <p className="mt-1 text-[11px] text-[var(--cmp-text-critical)]">{errors.preferred_name}</p>}
              <p className="mt-1 text-[11px] text-gray-500">The person has not set up their own profile yet, and can change this once they do.</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={saving} className={btnPrimary}>{saving ? "Saving…" : "Save details"}</button>
            <button type="button" disabled={saving} onClick={() => { setEditing(false); setErrors({}); setMsg(null); }} className={btn}>Cancel</button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label="Given name">{p.namesSupported ? <ValueOrState value={p.givenName} /> : <StatePill state="not_set_up" />}</Field>
          <Field label="Middle name(s)">{p.middleSupported ? <ValueOrState value={p.middleNames} whenAbsent="missing" /> : <StatePill state="not_set_up" />}</Field>
          <Field label="Family name">{p.namesSupported ? <ValueOrState value={p.familyName} /> : <StatePill state="not_set_up" />}</Field>
          <Field label="Full name"><ValueOrState value={p.fullName} /></Field>
          <Field label="Phone"><ValueOrState value={p.phone} /></Field>
          <Field label="Country"><ValueOrState value={p.country} /></Field>
          <Field label="Email" hint="Changed by the person through sign-in.">{p.email ?? <StatePill state="missing" />}</Field>
        </dl>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {!canManage && <p className="mt-2 text-[11px] text-gray-500">Only a platform owner can edit these details.</p>}

      <SubHead>Display preferences</SubHead>
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label="Preferred name" hint={preferred.kind === "chosen" ? "Chosen by the person. HQ cannot change it." : undefined}>
          {preferred.kind === "chosen" ? <ValueOrState value={preferred.value} whenAbsent="missing" why="The person has a profile and has not chosen a preferred name." />
            : preferred.kind === "no_profile" ? <StatePill state="not_applicable" why="The person has not set up an Individual profile." />
            : preferred.kind === "not_set_up" ? <StatePill state="not_set_up" />
            : <span className="text-[12px] text-[var(--cmp-text-warning)]">Could not be read just now</span>}
        </Field>
      </dl>
    </SectionCard>
  );
}

function emptyDraft(): Record<EditableField, string> {
  return Object.fromEntries(EDITABLE_FIELDS.map(k => [k, ""])) as Record<EditableField, string>;
}
