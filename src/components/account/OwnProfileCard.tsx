"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { OwnAccess, OwnProfile, Read } from "@/lib/account/own-profile";

/**
 * MY PROFILE -- the one personal-profile card, mounted inside each product shell behind that shell's own
 * guard (owner GO 2026-10-23, PR D). See src/lib/account/own-profile.ts for the rules it keeps.
 *
 * ⚠ MISSING IS "Not recorded", UNREADABLE IS UNREADABLE. Neither renders as a blank.
 * ⚠ EMAIL CHANGES ONLY THROUGH SUPABASE'S VERIFIED FLOW (auth.updateUser), never a profile write, and the
 *   card shows the change as pending until the person confirms it.
 * ⚠ "YOUR ACCESS" IS READ-ONLY. Nothing on this card can change it.
 * ⚠ A PROFILE IS NOT A CREDENTIAL. Registrations and credentials live elsewhere, with their own
 *   verification status, and `credentialsNote` says where, per product.
 */

type View = { profile: Read<OwnProfile>; access: OwnAccess };

async function fetchView(): Promise<{ view: View } | { error: string }> {
  try {
    const res = await fetch("/api/account/profile", { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) return { error: json?.error ?? `Your profile could not be loaded (HTTP ${res.status}).` };
    return { view: json as View };
  } catch {
    return { error: "Competen could not be reached, so your profile could not be loaded." };
  }
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const input = `mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 ${focusRing}`;
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-[14px] font-semibold text-white hover:bg-teal-800 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;

const NotRecorded = () => <span className="italic text-gray-500">Not recorded</span>;
const value = (v: string | null) => (v ? v : <NotRecorded />);

function Unreadable({ what, error }: { what: string; error: string }) {
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
      <span className="font-semibold">{what} could not be read.</span> This is not the same as none. <span className="text-amber-800/80">({error})</span>
    </p>
  );
}

export default function OwnProfileCard({ credentialsNote }: { credentialsNote?: ReactNode }) {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);

  const apply = useCallback((r: { view: View } | { error: string }) => {
    if ("error" in r) setLoadError(r.error);
    else { setLoadError(""); setView(r.view); }
  }, []);
  const load = useCallback(async () => apply(await fetchView()), [apply]);
  useEffect(() => {
    let alive = true;
    fetchView().then(r => { if (alive) apply(r); });
    return () => { alive = false; };
  }, [apply]);

  return (
    <section aria-labelledby="my-profile-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="my-profile-h" className="text-[16px] font-bold text-gray-900">My profile</h2>
        <p className="text-[12.5px] text-gray-500">Your personal details, the same in every Competen product you use.</p>
      </div>

      {loadError ? <div className="mt-3"><Unreadable what="Your profile" error={loadError} /></div>
        : !view ? <p className="mt-3 text-[13px] text-gray-500" aria-live="polite">Loading your profile…</p>
          : !view.profile.ok ? <div className="mt-3"><Unreadable what="Your profile" error={view.profile.error} /></div>
            : editing
              ? <EditForm p={view.profile.value} onDone={async saved => { setEditing(false); if (saved) await load(); }} />
              : <Details p={view.profile.value} onEdit={() => setEditing(true)} />}

      {view?.profile.ok && <EmailChange p={view.profile.value} onChanged={load} />}

      {view && <AccessBlock a={view.access} />}

      <p className="mt-5 border-t border-gray-100 pt-4 text-[12.5px] leading-relaxed text-gray-600">
        <span className="font-semibold text-gray-800">This is your personal profile, not a credential.</span>{" "}
        Professional registrations and credentials are kept separately, each with its own verification status, and nothing
        here changes them. {credentialsNote}
      </p>
    </section>
  );
}

function Details({ p, onEdit }: { p: OwnProfile; onEdit: () => void }) {
  const rows: [string, ReactNode][] = [
    ["Full name", p.fullName],
    ...(p.names.supported
      ? ([["Given name", value(p.names.given)], ["Family name", value(p.names.family)]] as [string, ReactNode][])
      : ([["Given and family name", <span key="n" className="italic text-gray-500">Not available on this environment yet</span>]] as [string, ReactNode][])),
    ["Phone", value(p.phone)],
    ["Country", value(p.country)],
    ["Speciality", p.specialization ?? <span className="italic text-gray-500">Not recorded (optional)</span>],
  ];
  return (
    <div className="mt-4">
      <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[auto_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500">{k}</dt>
            <dd className="min-w-0 break-words text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className={`${ghost} mt-4`} onClick={onEdit}>Edit my details</button>
    </div>
  );
}

function EditForm({ p, onDone }: { p: OwnProfile; onDone: (saved: boolean) => void }) {
  const [form, setForm] = useState({
    full_name: p.fullName, phone: p.phone ?? "", country: p.country ?? "", specialization: p.specialization ?? "",
    given_name: p.names.supported ? p.names.given ?? "" : "", family_name: p.names.supported ? p.names.family ?? "" : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const body: Record<string, string> = { full_name: form.full_name, phone: form.phone, country: form.country, specialization: form.specialization };
    if (p.names.supported) { body.given_name = form.given_name; body.family_name = form.family_name; }
    try {
      const res = await fetch("/api/account/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Your profile could not be saved. Nothing was changed."); setBusy(false); return; }
      onDone(true);
    } catch {
      setError("Competen could not be reached. Nothing was changed.");
      setBusy(false);
    }
  }

  const field = (k: keyof typeof form, labelText: string, hint?: string, required = false, auto?: string) => (
    <label className="block text-[13px] font-semibold text-gray-800">
      {labelText}{!required && <span className="font-normal text-gray-500"> (optional)</span>}
      <input className={input} value={form[k]} onChange={set(k)} required={required} autoComplete={auto} maxLength={k === "full_name" || k === "specialization" ? 120 : k === "phone" ? 40 : k === "country" ? 80 : 100} />
      {hint && <span className="mt-0.5 block text-[12px] font-normal text-gray-500">{hint}</span>}
    </label>
  );

  return (
    <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">{field("full_name", "Full name", "How your name appears across Competen.", true, "name")}</div>
      {p.names.supported ? (
        <>
          {field("given_name", "Given name", "Only if you want it recorded. Competen never works it out from your full name.", false, "given-name")}
          {field("family_name", "Family name", undefined, false, "family-name")}
        </>
      ) : (
        <p className="sm:col-span-2 text-[12.5px] text-gray-500">Given and family names are not available on this environment yet.</p>
      )}
      {field("phone", "Phone", undefined, false, "tel")}
      {field("country", "Country", undefined, false, "country-name")}
      <div className="sm:col-span-2">{field("specialization", "Speciality")}</div>
      <p className="sm:col-span-2 text-[12.5px] text-gray-500">Your email, roles and access are not changed here.</p>
      {error && <p role="alert" className="sm:col-span-2 text-[13px] font-semibold text-red-700">{error}</p>}
      <div className="sm:col-span-2 flex flex-wrap gap-2">
        <button type="submit" className={btn} disabled={busy || !form.full_name.trim()}>{busy ? "Saving…" : "Save my details"}</button>
        <button type="button" className={ghost} disabled={busy} onClick={() => onDone(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function EmailChange({ p, onChanged }: { p: OwnProfile; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    // ⚠ Supabase's verified email-change flow. Nothing is written to the profile; the change takes effect
    // only when the person confirms it from their inbox.
    const { error } = await createClient().auth.updateUser({ email: email.trim() }, { emailRedirectTo: window.location.href });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error.message || "The email change could not be started." }); return; }
    setMsg({ ok: true, text: "Check your inbox to confirm the change. Your sign-in email stays the same until you do." });
    setOpen(false); setEmail("");
    onChanged();
  }

  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <h3 className="text-[14px] font-bold text-gray-900">Sign-in email</h3>
      <p className="mt-1 text-[14px] text-gray-900 break-all">{p.email.current ?? <NotRecorded />}</p>
      {p.email.pending && (
        <p className="mt-1 text-[13px] text-amber-900">
          Change to <span className="font-semibold break-all">{p.email.pending}</span> is pending confirmation. Follow the link sent to confirm it.
        </p>
      )}
      {msg && <p role="status" className={`mt-2 text-[13px] ${msg.ok ? "text-green-800" : "font-semibold text-red-700"}`}>{msg.text}</p>}
      {!open ? (
        <button type="button" className={`${ghost} mt-3`} onClick={() => setOpen(true)}>Change email</button>
      ) : (
        <form onSubmit={change} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block min-w-[240px] flex-1 text-[13px] font-semibold text-gray-800">
            New email
            <input type="email" required className={input} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <button type="submit" className={btn} disabled={busy || !email.trim()}>{busy ? "Sending…" : "Send confirmation"}</button>
          <button type="button" className={ghost} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        </form>
      )}
    </div>
  );
}

function AccessBlock({ a }: { a: OwnAccess }) {
  const list = (r: Read<string[]>, what: string, none: string) =>
    !r.ok ? <Unreadable what={what} error={r.error} /> : r.value.length === 0 ? <span className="text-gray-600">{none}</span> : r.value.join(", ");
  const rows: [string, ReactNode][] = [
    ["Roles", list(a.roles, "Your roles", "No estate role")],
    ["Products", list(a.products, "Your products", "No product access yet")],
    ["HQ positions", list(a.hqPositions, "Your HQ positions", "None")],
    ...(a.individual === null ? [] : [["Competen Individual", !a.individual.ok
      ? <Unreadable key="i" what="Your Competen Individual access" error={a.individual.error} />
      : a.individual.value.live.length ? a.individual.value.live.join(", ")
        : <span key="i" className="text-gray-600">No active experience ({a.individual.value.status.replace(/_/g, " ")})</span>] as [string, ReactNode]]),
  ];
  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <h3 className="text-[14px] font-bold text-gray-900">Your access</h3>
      <p className="mt-1 text-[12.5px] text-gray-500">Set by your organisation or by Competen. Read-only: editing your profile cannot change it.</p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[auto_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500">{k}</dt>
            <dd className="min-w-0 text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── THE SAME PROFILE, EDITED ONE FIELD AT A TIME ── COMPETEN-INDIVIDUAL-PROFILE-HFE (Individual Profile & History) ──
//
// One field at a time: Edit, then Save or Cancel (Escape cancels). It writes through the ONE own-profile endpoint
// (/api/account/profile, the person's own session, column grants and RLS), so editing a profile can never change
// access. The limits below mirror parseProfilePatch for immediate feedback; the server checks them again.
// ⚠ Email is never a field here: it changes only through Supabase's verified flow (EmailChange), and stays the
// sign-in email until the person confirms.

type Key = "full_name" | "given_name" | "family_name" | "phone" | "country";
const FIELDS: { key: Key; label: string; max: number; required?: boolean; type?: string; autoComplete: string; hint?: string }[] = [
  { key: "full_name", label: "Full name", max: 120, required: true, autoComplete: "name", hint: "As you want it to appear on your Passport." },
  { key: "given_name", label: "Given name", max: 100, autoComplete: "given-name" },
  { key: "family_name", label: "Family name", max: 100, autoComplete: "family-name" },
  { key: "phone", label: "Phone", max: 40, type: "tel", autoComplete: "tel" },
  { key: "country", label: "Country", max: 80, autoComplete: "country-name" },
];

const inlineInput = `w-full min-h-[44px] rounded-lg border bg-white px-3 py-2 text-[14.5px] text-gray-900 ${focusRing}`;
const small = `inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center justify-center rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-50 ${focusRing}`;

function check(f: (typeof FIELDS)[number], v: string): string | null {
  const t = v.replace(/\s+/g, " ").trim();
  if (f.required && !t) return `${f.label} cannot be empty.`;
  if (t.length > f.max) return `${f.label} must be ${f.max} characters or fewer (now ${t.length}).`;
  if (f.key === "phone" && t && !/^[+()\d\s.-]{4,}$/.test(t)) return "Use digits, spaces and + ( ) - only.";
  return null;
}

function valueOf(p: OwnProfile, k: Key): string | null {
  if (k === "full_name") return p.fullName;
  if (k === "phone") return p.phone;
  if (k === "country") return p.country;
  if (!p.names.supported) return null;
  return k === "given_name" ? p.names.given : p.names.family;
}

function Row({ f, current, accent, onSaved }: { f: (typeof FIELDS)[number]; current: string | null; accent: string; onSaved: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const id = `pf-${f.key}`;
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  function cancel() { setDraft(current ?? ""); setErr(null); setEditing(false); }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const problem = check(f, draft);
    if (problem) { setErr(problem); ref.current?.focus(); return; }
    const next = draft.replace(/\s+/g, " ").trim();
    if (next === (current ?? "")) { setEditing(false); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/account/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [f.key]: next || null }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error ?? "That could not be saved. Nothing was changed."); return; }
      setEditing(false);
      onSaved(`${f.label} saved.`);
    } catch { setErr("Competen could not be reached. Nothing was changed."); } finally { setBusy(false); }
  }

  return (
    <div className="border-b border-gray-100 py-3 last:border-b-0">
      {!editing ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{f.label}</p>
            <p className="break-words text-[14.5px] text-gray-900">{current ?? <span className="italic text-gray-500">Not recorded</span>}</p>
          </div>
          <button type="button" onClick={() => { setDraft(current ?? ""); setEditing(true); }} aria-label={`Edit ${f.label.toLowerCase()}`}
            className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>{current ? "Edit" : "Add"}</button>
        </div>
      ) : (
        <form onSubmit={save} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); cancel(); } }} noValidate>
          <label htmlFor={id} className="text-[12px] font-semibold uppercase tracking-wide text-gray-600">{f.label}{f.required ? "" : " (optional)"}</label>
          <input ref={ref} id={id} type={f.type ?? "text"} value={draft} autoComplete={f.autoComplete} maxLength={f.max + 20}
            onChange={e => { setDraft(e.target.value); setErr(check(f, e.target.value)); }}
            aria-invalid={!!err} aria-describedby={`${id}-help${err ? ` ${id}-err` : ""}`}
            className={`${inlineInput} mt-1 ${err ? "border-red-500" : "border-gray-300"}`} />
          <p id={`${id}-help`} className="mt-1 text-[12px] text-gray-500">{f.hint ?? (f.required ? "Required." : "Optional. Leave it empty to remove it.")} {draft.trim().length}/{f.max}</p>
          {err && <p id={`${id}-err`} role="alert" className="mt-1 text-[12.5px] font-semibold text-red-700">{err}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !!err} className={`${small} border-transparent text-white`} style={{ background: accent }}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" onClick={cancel} disabled={busy} className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

async function fetchProfile(): Promise<Read<OwnProfile>> {
  try {
    const res = await fetch("/api/account/profile", { cache: "no-store" });
    const j = await res.json().catch(() => null);
    return res.ok && j?.profile ? j.profile : { ok: false, error: j?.error ?? `HTTP ${res.status}` };
  } catch { return { ok: false, error: "Competen could not be reached." }; }
}

export function OwnProfileInline({ accent }: { accent: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Read<OwnProfile> | null>(null);
  const [status, setStatus] = useState("");
  const load = useCallback(async () => setProfile(await fetchProfile()), []);
  useEffect(() => {
    let alive = true;
    fetchProfile().then(p => { if (alive) setProfile(p); });
    return () => { alive = false; };
  }, []);

  if (!profile) return <p className="text-[13.5px] text-gray-500" aria-live="polite">Loading your details…</p>;
  if (!profile.ok) return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900"><span className="font-semibold">Your details could not be read.</span> This is not the same as none. ({profile.error})</p>
  );
  const p = profile.value;
  const fields = FIELDS.filter(f => p.names.supported || (f.key !== "given_name" && f.key !== "family_name"));
  return (
    <div>
      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-[13px] font-semibold text-green-800">{status}</p>
      <div className="grid gap-x-8 md:grid-cols-2">
        {fields.map(f => <Row key={f.key} f={f} current={valueOf(p, f.key)} accent={accent}
          onSaved={text => { setStatus(text); load(); router.refresh(); }} />)}
      </div>
      <EmailChange p={p} onChanged={load} />
      <p className="mt-3 text-[12.5px] text-gray-500">These details are your one Competen identity, shared by every experience on your account. Changing them never changes your access, and they are not credentials.</p>
    </div>
  );
}
