"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { focusRing, primaryBtn, secondaryBtn } from "../chrome";

// The Professional forms' shared behaviour: submit to a Professional API route, say what happened in
// text (role=status / role=alert, never colour alone), and refresh the server-rendered record. The
// pages stay server components; only these controls run in the browser.

export const inputCls =
  "block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-[14.5px] text-gray-900 "
  + "placeholder:text-gray-400 " + focusRing;

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[13.5px] font-semibold text-gray-800">{label}</label>
      {hint && <p id={`${htmlFor}-hint`} className="text-[12.5px] text-gray-500">{hint}</p>}
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * An "Add ..." panel. The page may suggest it open (nothing recorded yet), but once it is showing it stays
 * showing until the person closes it. A server-decided <details open={...}> closed itself on the refresh
 * after the first item was added, and took the confirmation inside it out of sight (IND-007 s7, PARTIAL).
 * A suggestion that turns ON (the first need makes "Add a goal" the next step) still opens it.
 */
export function AddPanel({ label, accent, suggestOpen, children }: {
  label: string; accent: string; suggestOpen: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(suggestOpen);
  const [suggested, setSuggested] = useState(suggestOpen);
  if (suggestOpen !== suggested) {
    setSuggested(suggestOpen);
    if (suggestOpen) setOpen(true);
  }
  return (
    <details className="mt-4 rounded-xl border border-gray-200 p-4" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-[14px] font-semibold" style={{ color: accent }}>{label}</summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

type Method = "POST" | "PUT" | "PATCH";

/**
 * A form that posts its fields as JSON, or as multipart when `multipart` (a document may be attached).
 * Resets after a create; keeps its values after an update.
 */
export function ApiForm({ action, method = "POST", multipart, submitLabel, accent, reset = true, children, savedText = "Saved." }: {
  action: string; method?: Method; multipart?: boolean; submitLabel: string; accent: string; reset?: boolean;
  children: React.ReactNode; savedText?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<RefusalMsg | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>, overrideField?: string) {
    e.preventDefault();
    if (!ref.current) return;
    setBusy(true); setMsg(null);
    const fd = new FormData(ref.current);
    if (overrideField) fd.set(overrideField, "yes");
    try {
      const res = await fetch(action, multipart
        ? { method, body: fd }
        : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string"))) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(refusalMsg(json, "That could not be saved. Try again shortly.")); return; }
      setMsg({ ok: true, text: savedText });
      if (reset) ref.current?.reset();
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "That could not be saved. Check your connection and try again." });
    } finally { setBusy(false); }
  }

  return (
    <form ref={ref} onSubmit={submit} className="space-y-4" noValidate={false}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={primaryBtn} style={{ background: accent }}>{busy ? "Saving…" : submitLabel}</button>
        {msg && <RefusalNote msg={msg} busy={busy} onOverride={f => void submit({ preventDefault() {} } as React.FormEvent<HTMLFormElement>, f)} />}
      </div>
    </form>
  );
}

/** A save's outcome. A refusal can carry a link to read and an override the person may choose (never automatic). */
export type RefusalMsg = { ok: boolean; text: string; link?: { href: string; label: string }; override?: { field: string; label: string } };

type RefusalJson = { error?: unknown; link?: { href?: unknown; label?: unknown }; override?: { field?: unknown; label?: unknown } } | null | undefined;

/** Pure: a refusal body as the form shows it. Only a same-site link is followed. */
export function refusalMsg(json: RefusalJson, fallback: string): RefusalMsg {
  const l = json?.link, o = json?.override;
  return {
    ok: false, text: typeof json?.error === "string" ? json.error : fallback,
    link: typeof l?.href === "string" && l.href.startsWith("/") && !l.href.startsWith("//") && typeof l.label === "string" ? { href: l.href, label: l.label } : undefined,
    override: typeof o?.field === "string" && typeof o.label === "string" ? { field: o.field, label: o.label } : undefined,
  };
}

export function RefusalNote({ msg, busy, onOverride }: { msg: RefusalMsg; busy: boolean; onOverride: (field: string) => void }) {
  return (
    <div role={msg.ok ? "status" : "alert"} className={`text-[13.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>
      <p>{msg.text}{msg.link && <> <a href={msg.link.href} className={`font-semibold underline underline-offset-2 ${focusRing}`}>{msg.link.label}</a></>}</p>
      {msg.override && (
        <button type="button" disabled={busy} onClick={() => onOverride(msg.override!.field)}
          className={`mt-1.5 inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`}>
          {msg.override.label}
        </button>
      )}
    </div>
  );
}

/** One action on one row: a status change (PATCH with a body) or a removal (DELETE ?id=). */
export function ApiButton({ action, method, body, label, confirm, small = true }: {
  action: string; method: "PATCH" | "DELETE"; body?: Record<string, string>; label: string; confirm?: string; small?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(action, body
        ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : { method });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j?.error ?? "That did not work. Try again."); return; }
      router.refresh();
    } catch { setErr("That did not work. Check your connection."); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={go} disabled={busy}
        className={small
          ? `inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`
          : secondaryBtn}>
        {busy ? "…" : label}
      </button>
      {err && <span role="alert" className="mt-1 text-[12px] text-red-700">{err}</span>}
    </span>
  );
}
