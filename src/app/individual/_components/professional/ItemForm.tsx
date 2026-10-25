"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { primaryBtn, secondaryBtn } from "../chrome";
import { Field, inputCls } from "./forms";

// Add a profile record, or a new version of one (COMPETEN-PROFESSIONAL-PROFILE-01 GO s4). A change never edits
// the record: it posts a new version naming the one it supersedes, and the earlier version is kept. Which
// inputs show follows the kind (the same matrix as migration 450's section_shape CHECK).

type Opt = { code: string; label: string };
export type ItemValues = {
  id?: string; title?: string | null; type_code?: string | null; organisation?: string | null; jurisdiction?: string | null;
  self_declared_identifier?: string | null; started_on?: string | null; ended_on?: string | null; expires_on?: string | null;
  target_on?: string | null; detail?: string | null; document_name?: string | null;
};
type Kind = "qualification" | "registration" | "employment" | "specialty" | "interest" | "aspiration";

const COPY: Record<Kind, { title: string; titleHint?: string; type?: string; org?: string; started?: string; ended?: string; expires?: string; target?: string; identifier?: string }> = {
  qualification: { title: "Qualification", titleHint: "For example: a degree, diploma or specialist certificate, as it is named on the award.", type: "Type", org: "Awarding institution", started: "Awarded on", expires: "Expires on (if it does)" },
  registration: { title: "Register or category", titleHint: "For example: the general or specialist register you are on.", type: "Standing", org: "Registration body", started: "Registered since", ended: "Ended on", expires: "Renewal due", identifier: "Registration or licence number (optional)" },
  employment: { title: "Role", type: "Practice setting", org: "Employer or organisation", started: "Started", ended: "Ended (leave empty if current)" },
  specialty: { title: "Specialty or practice area", started: "Since" },
  interest: { title: "Professional or career interest" },
  aspiration: { title: "Aspiration", titleHint: "For example: become an educator, specialise, lead a team or move into research.", target: "Hoping to reach it by" },
};
const FIELDS: Record<Kind, string[]> = {
  qualification: ["type", "organisation", "jurisdiction", "startedOn", "expiresOn", "detail"],
  registration: ["type", "organisation", "jurisdiction", "identifier", "startedOn", "endedOn", "expiresOn", "detail"],
  employment: ["type", "organisation", "jurisdiction", "startedOn", "endedOn", "detail"],
  specialty: ["startedOn", "detail"],
  interest: ["detail"],
  aspiration: ["targetOn", "detail"],
};

export default function ItemForm({ kind, accent, typeOptions = [], titleOptions = [], orgSuggestions = [], allowDocument, existing, onDone }: {
  kind: Kind; accent: string; typeOptions?: Opt[]; titleOptions?: Opt[]; orgSuggestions?: string[]; allowDocument: boolean; existing?: ItemValues; onDone?: () => void;
}) {
  const router = useRouter();
  const c = COPY[kind]; const has = (f: string) => FIELDS[kind].includes(f);
  const titleKnown = existing?.title && titleOptions.find(o => o.label === existing.title)?.code;
  const [titleChoice, setTitleChoice] = useState(titleKnown || (existing?.title ? "other" : ""));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const id = (f: string) => `it-${kind}-${existing?.id ?? "new"}-${f}`;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(form);
      const file = fd.get("document");
      const multipart = file instanceof File && file.size > 0;
      if (!multipart) fd.delete("document");
      const res = await fetch("/api/individual/professional/profile-items", multipart
        ? { method: "POST", body: fd }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string"))) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved. Try again shortly." }); return; }
      setMsg({ ok: true, text: existing ? "Saved as a new version. The earlier version is kept in its history." : "Added to your profile." });
      if (!existing) form.reset();
      router.refresh();
      onDone?.();
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection and try again." }); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="hidden" name="kind" value={kind} />
      {existing?.id && <input type="hidden" name="supersedesId" value={existing.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {titleOptions.length > 0 ? (
          <Field label={c.title} htmlFor={id("titleCode")} hint={c.titleHint}>
            <select id={id("titleCode")} name="titleCode" value={titleChoice} onChange={e => setTitleChoice(e.target.value)} required className={inputCls}>
              <option value="">Choose…</option>
              {titleOptions.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
              <option value="other">Other (type it)</option>
            </select>
            {titleChoice === "other" && <input aria-label={`${c.title}: your own words`} name="title" maxLength={200} minLength={2} required defaultValue={titleKnown ? "" : existing?.title ?? ""} className={`${inputCls} mt-2`} />}
          </Field>
        ) : (
          <Field label={c.title} htmlFor={id("title")} hint={c.titleHint}>
            <input id={id("title")} name="title" maxLength={200} minLength={2} required defaultValue={existing?.title ?? ""} className={inputCls} />
          </Field>
        )}
        {has("type") && typeOptions.length > 0 && (
          <Field label={`${c.type} (optional)`} htmlFor={id("type")}>
            <select id={id("type")} name="type" defaultValue={existing?.type_code ?? ""} className={inputCls}>
              <option value="">Not given</option>
              {typeOptions.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </Field>
        )}
        {has("organisation") && (
          <Field label={`${c.org} (optional)`} htmlFor={id("org")}>
            <input id={id("org")} name="organisation" maxLength={160} defaultValue={existing?.organisation ?? ""} className={inputCls} autoComplete="off" list={orgSuggestions.length ? `${id("org")}-l` : undefined} />
            {orgSuggestions.length > 0 && <datalist id={`${id("org")}-l`}>{orgSuggestions.map(s => <option key={s} value={s} />)}</datalist>}
          </Field>
        )}
        {has("jurisdiction") && (
          <Field label="Country or jurisdiction (optional)" htmlFor={id("jur")}>
            <input id={id("jur")} name="jurisdiction" maxLength={160} defaultValue={existing?.jurisdiction ?? ""} className={inputCls} autoComplete="country-name" />
          </Field>
        )}
        {has("identifier") && (
          <Field label={c.identifier!} htmlFor={id("idn")} hint="Shown as you typed it. Competen does not check it with the registration body.">
            <input id={id("idn")} name="identifier" maxLength={60} defaultValue={existing?.self_declared_identifier ?? ""} className={inputCls} autoComplete="off" />
          </Field>
        )}
        {has("startedOn") && <Field label={`${c.started} (optional)`} htmlFor={id("st")}><input id={id("st")} name="startedOn" type="date" defaultValue={existing?.started_on ?? ""} className={inputCls} /></Field>}
        {has("endedOn") && <Field label={`${c.ended} (optional)`} htmlFor={id("en")}><input id={id("en")} name="endedOn" type="date" defaultValue={existing?.ended_on ?? ""} className={inputCls} /></Field>}
        {has("expiresOn") && <Field label={`${c.expires} (optional)`} htmlFor={id("ex")}><input id={id("ex")} name="expiresOn" type="date" defaultValue={existing?.expires_on ?? ""} className={inputCls} /></Field>}
        {has("targetOn") && <Field label={`${c.target} (optional)`} htmlFor={id("tg")}><input id={id("tg")} name="targetOn" type="date" defaultValue={existing?.target_on ?? ""} className={inputCls} /></Field>}
      </div>
      {has("detail") && (
        <Field label="Details (optional)" htmlFor={id("dt")}>
          <textarea id={id("dt")} name="detail" rows={3} maxLength={2000} defaultValue={existing?.detail ?? ""} className={inputCls} />
        </Field>
      )}
      {allowDocument && (
        <Field label="Supporting document (optional)" htmlFor={id("doc")} hint={`PDF, PNG, JPEG or WebP, up to 4 MB. It makes this record document-supported. It does not verify it.${existing?.document_name ? ` Leave empty to keep ${existing.document_name}.` : ""}`}>
          <input id={id("doc")} name="document" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="block text-[14px]" />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={primaryBtn} style={{ background: accent }}>{busy ? "Saving…" : existing ? "Save as a new version" : "Add"}</button>
        {onDone && <button type="button" className={secondaryBtn} onClick={onDone}>Cancel</button>}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}

/** "Change" on a current record: the same form, prefilled, saving a new version. */
export function ChangeItem(props: Omit<Parameters<typeof ItemForm>[0], "onDone">) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50">Change</button>;
  return <div className="mt-3 w-full rounded-xl border border-gray-200 p-4"><ItemForm {...props} onDone={() => setOpen(false)} /></div>;
}

/** Withdraw a current record, saying why. It stays in the history. */
export function WithdrawItem({ id, reasons }: { id: string; reasons: readonly (readonly [string, string])[] }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (!reason) { setErr("Choose why."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/individual/professional/profile-items?id=${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ withdraw: reason }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j?.error ?? "That did not work. Try again."); return; }
      router.refresh();
    } catch { setErr("That did not work. Check your connection."); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`wd-${id}`}>Reason for withdrawing</label>
      <select id={`wd-${id}`} value={reason} onChange={e => setReason(e.target.value)} className="min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] rounded-lg border border-gray-300 bg-white px-2 text-[12.5px]">
        <option value="">Withdraw…</option>
        {reasons.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {reason && <button type="button" disabled={busy} onClick={go} className="inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50">{busy ? "…" : "Withdraw"}</button>}
      {err && <span role="alert" className="text-[12px] text-red-700">{err}</span>}
    </span>
  );
}
