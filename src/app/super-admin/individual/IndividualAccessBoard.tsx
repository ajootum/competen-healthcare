"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import type { ExperienceKey } from "@/lib/individual/experiences";
import type { PersonLookup } from "@/lib/individual/grants";
import type { InvitationView } from "@/lib/individual/invitations";

/**
 * The Individual pilot access board -- COMPETEN-IND-ACCESS-001 s4.
 *
 * ⚠ THE SERVER DECIDES, THIS DRAWS. Every refusal the API gives (not yourself, 18+ for Scholar, a
 * suspended or revoked membership, an end date in the past) is shown as it comes back. Nothing here is a
 * rule the server does not also enforce.
 *
 * ⚠ THREE STATES FOR A LOOKUP: an account with its access, no account with that email, or the read
 * failed -- and the third is never drawn as the second.
 */

type Exp = { key: ExperienceKey; name: string; accent: string };
type Invitations = { invitations?: InvitationView[]; invitationsProvisioned?: boolean };
type Found = Extract<PersonLookup, { found: true }> & { isSelf: boolean } & Invitations;

const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cmp-color-primary)]/30";
const btn = "inline-flex min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center justify-center rounded-lg px-4 text-sm font-semibold disabled:opacity-40";
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}
const messageOf = (r: { status: number; json: any }) =>
  r.json?.error?.message ?? (typeof r.json?.error === "string" ? r.json.error : `The request was refused (${r.status}).`);

export default function IndividualAccessBoard({ enabled, experiences }: { enabled: boolean; experiences: Exp[] }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [lookup, setLookup] = useState<{ kind: "found"; value: Found } | ({ kind: "none"; email: string } & Invitations) | { kind: "error"; message: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const nameOf = (k: string) => experiences.find(x => x.key === k)?.name ?? k;

  async function find(e?: React.FormEvent, quiet = false) {
    e?.preventDefault();
    if (!quiet) setNotice(null);
    setBusy("lookup");
    try {
      const r = await call(`/api/hq/individual/grants?email=${encodeURIComponent(email.trim())}`);
      if (!r.ok) setLookup({ kind: "error", message: messageOf(r) });
      else if (!r.json.found) setLookup({ kind: "none", email: email.trim(), invitations: r.json.invitations, invitationsProvisioned: r.json.invitationsProvisioned });
      else setLookup({ kind: "found", value: r.json as Found });
    } catch {
      setLookup({ kind: "error", message: "The lookup could not be completed. Check your connection." });
    } finally { setBusy(null); }
  }

  if (!enabled) {
    return (
      <Shell>
        <div className="rounded-xl border border-amber-200 bg-[var(--cmp-surface-warning)] p-4 text-sm text-amber-900">
          <p className="font-semibold">Competen Individual is switched off in this environment.</p>
          <p className="mt-1">Its release gate is off, so no access can be looked up or granted here. Holding the pilot-grant right does not open the product; switching it on is a separate owner decision.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={find} className="rounded-xl border border-gray-200 bg-white p-4">
        <label htmlFor="ind-email" className="block text-sm font-semibold text-gray-900">Find a Competen account</label>
        <p className="mt-0.5 text-[12.5px] text-gray-500">By the email address they sign in with. The pilot is by invitation, and access is added to the account the person already has.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input id="ind-email" type="email" required autoComplete="off" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="name@example.com" className={input} />
          <button type="submit" disabled={busy !== null} className={`${btn} bg-gray-900 text-white`}>{busy === "lookup" ? "Looking up…" : "Find"}</button>
        </div>
      </form>

      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "error" ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]" : "bg-[var(--cmp-surface-success)] text-green-900"}`}>
          {notice.text}
        </p>
      )}

      {lookup?.kind === "error" && (
        <p role="alert" className="rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">Not read.</span> {lookup.message} This is not &ldquo;no access&rdquo; &mdash; nothing was concluded about the account.
        </p>
      )}
      {lookup?.kind === "none" && (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
            <p className="font-semibold text-gray-900">No Competen account uses {lookup.email}.</p>
            <p className="mt-1">You can invite this address to Competen Individual. Inviting creates the person&apos;s one Competen account and emails them a link to set a password. Competen Individual is added only when they accept, and nothing else ever is: no workspace, organisation or practice access.</p>
          </div>
          <InvitationList list={lookup.invitations ?? []} nameOf={nameOf} busy={busy} setBusy={setBusy}
            onDone={async (text, tone) => { setNotice({ text, tone }); if (tone === "ok") await find(undefined, true); }} />
          {lookup.invitationsProvisioned === false ? (
            <p className="rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-sm text-amber-900">Invitations are not set up in this environment yet.</p>
          ) : !(lookup.invitations ?? []).some(i => i.status === "PENDING") && (
            <InviteForm email={lookup.email} experiences={experiences} busy={busy} setBusy={setBusy}
              onDone={async (text, tone) => { setNotice({ text, tone }); if (tone === "ok") await find(undefined, true); }} />
          )}
        </>
      )}
      {lookup?.kind === "found" && (
        <>
          <Person p={lookup.value} experiences={experiences} nameOf={nameOf} busy={busy} setBusy={setBusy}
            onDone={async (text, tone) => { setNotice({ text, tone }); if (tone === "ok") await find(undefined, true); }} />
          <InvitationList list={lookup.value.invitations ?? []} nameOf={nameOf} busy={busy} setBusy={setBusy}
            onDone={async (text, tone) => { setNotice({ text, tone }); if (tone === "ok") await find(undefined, true); }} />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-gray-900">Individual pilot access</h1>
        <p className="mt-1 text-sm text-gray-600">
          Grant or end Competen Scholar and Competen Professional for people invited to the Competen Individual pilot.
          Every change is recorded in the audit log under your name.
        </p>
      </header>
      {children}
    </div>
  );
}

function Person({ p, experiences, nameOf, busy, setBusy, onDone }: {
  p: Found; experiences: Exp[]; nameOf: (k: string) => string; busy: string | null;
  setBusy: (b: string | null) => void; onDone: (text: string, tone: "ok" | "error") => Promise<void>;
}) {
  const live = new Set(p.entitlements.filter(e => e.live).map(e => e.experience));
  const [chosen, setChosen] = useState<ExperienceKey[]>([]);
  const [adult, setAdult] = useState(false);
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const membershipBlocked = p.membership && p.membership.status !== "active";
  const canGrant = !p.isSelf && !membershipBlocked;
  const needsAdult = chosen.includes("scholar");

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy("grant");
    try {
      const r = await call("/api/hq/individual/grants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: p.person.id, experiences: chosen, adultConfirmed: adult, endsOn: endsOn || null, note: note || null }),
      });
      if (!r.ok) { await onDone(messageOf(r), "error"); return; }
      const granted: string[] = r.json.granted ?? [];
      const already: string[] = r.json.alreadyLive ?? [];
      const parts = [
        granted.length ? `Granted ${granted.map(nameOf).join(" and ")}.` : "",
        already.length ? `${already.map(nameOf).join(" and ")} was already active.` : "",
      ].filter(Boolean);
      setChosen([]); setAdult(false); setEndsOn(""); setNote("");
      await onDone(parts.join(" ") || "Nothing changed.", "ok");
    } catch {
      await onDone("The grant could not be sent. Check your connection.", "error");
    } finally { setBusy(null); }
  }

  async function end(experience: ExperienceKey) {
    if (!window.confirm(`End ${nameOf(experience)} for ${p.person.name ?? p.person.email}? Their records are kept, and access can be granted again later.`)) return;
    setBusy(`end-${experience}`);
    try {
      const r = await call("/api/hq/individual/grants/end", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: p.person.id, experience }),
      });
      await onDone(r.ok ? `Ended ${nameOf(experience)}.` : messageOf(r), r.ok ? "ok" : "error");
    } catch {
      await onDone("The change could not be sent. Check your connection.", "error");
    } finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="person-h" className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="person-h" className="text-base font-semibold text-gray-900">{p.person.name ?? <span className="text-gray-500">Name not recorded</span>}</h2>
        <p className="text-sm text-gray-600">{p.person.email}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Membership</dt>
            <dd className="text-gray-900">{p.membership ? p.membership.status : "None yet — the first grant creates it"}</dd></div>
          <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Opens first</dt>
            <dd className="text-gray-900">{p.membership?.primaryExperience ? nameOf(p.membership.primaryExperience) : "Not chosen yet"}</dd></div>
          <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Welcome</dt>
            <dd className="text-gray-900">{p.membership ? (p.membership.onboarded ? "Completed" : "Not completed yet") : "—"}</dd></div>
        </dl>
        {p.isSelf && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[13px] text-gray-700">This is your own account. Another administrator, or the owner, grants your access.</p>}
        {membershipBlocked && (
          <p className="mt-3 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[13px] text-amber-900">
            {p.membership!.status === "suspended"
              ? "This membership is suspended: access is closed and everything is kept. Reinstate it below to reopen access."
              : "This membership is revoked. That is final from this screen; nothing new can be granted to it."}
          </p>
        )}
        {p.membership && !p.isSelf && p.membership.status !== "revoked" && (
          <MembershipControls status={p.membership.status} personId={p.person.id} busy={busy} setBusy={setBusy} onDone={onDone} />
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <h3 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">Access periods</h3>
        {p.entitlements.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-600">No Competen Individual access has been granted to this account.</p>
        ) : (
          <ul>
            {p.entitlements.map(e => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 border-t border-gray-50 px-4 py-2.5 text-sm first:border-0">
                <span className="font-medium text-gray-900">{nameOf(e.experience)}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${e.live ? "bg-[var(--cmp-surface-success)] text-green-800" : "bg-gray-100 text-gray-600"}`}>
                  {e.live ? "Active now" : e.status === "active" ? "Not active now (outside its dates)" : e.status}
                </span>
                <span className="text-[12px] text-gray-500">
                  from {fmt(e.startsAt)}{e.endsAt ? ` to ${fmt(e.endsAt)}` : ", no end date"} · {e.source} · {e.operatingEntity.replace("_", " ")}
                  {e.experience === "scholar" ? (e.adultConfirmed ? " · 18+ confirmed" : "") : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {[...live].length > 0 && canGrant && (
          <div className="flex flex-wrap gap-2 border-t border-gray-100 px-4 py-3">
            {[...live].map(k => (
              <button key={k} type="button" onClick={() => end(k)} disabled={busy !== null}
                className={`${btn} border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] hover:bg-[var(--cmp-surface-error)]`}>
                {busy === `end-${k}` ? "Ending…" : `End ${nameOf(k)}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {canGrant && (
        <form onSubmit={grant} className="rounded-xl border border-gray-200 bg-white p-4">
          <fieldset>
            <legend className="text-sm font-semibold text-gray-900">Grant access</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {experiences.map(x => {
                const isLive = live.has(x.key);
                return (
                  <label key={x.key} className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-sm ${isLive ? "border-gray-100 text-gray-400" : "border-gray-300 text-gray-900"}`}>
                    <input type="checkbox" disabled={isLive} checked={chosen.includes(x.key)} style={{ accentColor: x.accent }}
                      onChange={ev => setChosen(c => ev.target.checked ? [...c, x.key] : c.filter(k => k !== x.key))} />
                    {x.name}{isLive ? " (active)" : ""}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {needsAdult && (
            <label className="mt-3 flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
              <input type="checkbox" checked={adult} onChange={e => setAdult(e.target.checked)} className="mt-0.5" />
              <span>I confirm this person is 18 or over. The Competen Scholar pilot is for adults only, and the confirmation is recorded with your name.</span>
            </label>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ind-ends" className="block text-[12.5px] font-semibold text-gray-700">Last day of access (optional)</label>
              <input id="ind-ends" type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} className={input} />
              <p className="mt-1 text-[11.5px] text-gray-500">Access ends at the end of this day (UTC). Leave empty for no end date.</p>
            </div>
            <div>
              <label htmlFor="ind-note" className="block text-[12.5px] font-semibold text-gray-700">Note (optional)</label>
              <input id="ind-note" type="text" maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Pilot cohort 1" className={input} />
            </div>
          </div>
          <p className="mt-3 text-[12px] text-gray-500">Competen Scholar is operated by the Scholar operating company; Competen Professional by Competen Holdings. The person accepts each service&apos;s terms on first use.</p>
          <button type="submit" disabled={busy !== null || chosen.length === 0 || (needsAdult && !adult)} className={`${btn} mt-3 bg-gray-900 text-white`}>
            {busy === "grant" ? "Granting…" : "Grant access"}
          </button>
        </form>
      )}
    </section>
  );
}

// ── INVITATIONS (COMPETEN-IND-ACCESS-001, migration 378) ────────────────────────────────────────────────
// For an address with no Competen account. "Waiting" is the database clock's answer (live), never a date
// compared here. The invite link goes to the person's mailbox and is never shown on this screen.

function InvitationList({ list, nameOf, busy, setBusy, onDone }: {
  list: InvitationView[]; nameOf: (k: string) => string; busy: string | null;
  setBusy: (b: string | null) => void; onDone: (text: string, tone: "ok" | "error") => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  if (!list.length) return null;
  async function revoke(id: string) {
    setBusy(`revoke-${id}`);
    try {
      const r = await call("/api/hq/individual/invitations/revoke", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitationId: id, reason }),
      });
      if (r.ok) setReason("");
      await onDone(r.ok ? "Invitation revoked. The record is kept." : messageOf(r), r.ok ? "ok" : "error");
    } catch {
      await onDone("The change could not be sent. Check your connection.", "error");
    } finally { setBusy(null); }
  }
  const label = (i: InvitationView) =>
    i.status === "PENDING" ? (i.live ? "Waiting to be accepted" : "Expired, not accepted") : i.status === "ACCEPTED" ? "Accepted" : "Revoked";
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <h3 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">Invitations</h3>
      <ul>
        {list.map(i => (
          <li key={i.id} className="border-t border-gray-50 px-4 py-2.5 text-sm first:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{i.experiences.map(nameOf).join(" and ")}</span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${i.status === "PENDING" && i.live ? "bg-[var(--cmp-surface-warning)] text-amber-900" : "bg-gray-100 text-gray-600"}`}>{label(i)}</span>
              <span className="text-[12px] text-gray-500">
                sent {fmt(i.createdAt)} · {i.status === "PENDING" ? `open until ${fmt(i.expiresAt)}` : i.status === "ACCEPTED" ? `accepted ${fmt(i.acceptedAt)}` : `revoked ${fmt(i.revokedAt)}${i.revokedReason ? ` — ${i.revokedReason}` : ""}`}
                {i.endsAt ? ` · access until ${fmt(i.endsAt)}` : ""}
              </span>
            </div>
            {i.status === "PENDING" && (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input aria-label="Reason for revoking" value={reason} onChange={e => setReason(e.target.value)} maxLength={500}
                  placeholder="Reason for revoking (at least 8 characters)" className={input} />
                <button type="button" onClick={() => revoke(i.id)} disabled={busy !== null || reason.trim().length < 8}
                  className={`${btn} shrink-0 border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] hover:bg-[var(--cmp-surface-error)]`}>
                  {busy === `revoke-${i.id}` ? "Revoking…" : "Revoke invitation"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InviteForm({ email, experiences, busy, setBusy, onDone }: {
  email: string; experiences: Exp[]; busy: string | null;
  setBusy: (b: string | null) => void; onDone: (text: string, tone: "ok" | "error") => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<ExperienceKey[]>([]);
  const [adult, setAdult] = useState(false);
  const [endsOn, setEndsOn] = useState("");
  const [days, setDays] = useState("14");
  const [note, setNote] = useState("");
  const needsAdult = chosen.includes("scholar");

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy("invite");
    try {
      const r = await call("/api/hq/individual/invitations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name || null, experiences: chosen, adultConfirmed: adult, endsOn: endsOn || null, expiresInDays: Number(days), note: note || null }),
      });
      await onDone(r.ok ? `Invitation sent to ${email}. It is open for ${days} days.` : messageOf(r), r.ok ? "ok" : "error");
    } catch {
      await onDone("The invitation could not be sent. Check your connection.", "error");
    } finally { setBusy(null); }
  }

  return (
    <form onSubmit={invite} className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Invite to Competen Individual</h3>
      <div className="mt-3">
        <label htmlFor="inv-name" className="block text-[12.5px] font-semibold text-gray-700">Name (optional)</label>
        <input id="inv-name" type="text" maxLength={200} value={name} onChange={e => setName(e.target.value)} className={input} />
      </div>
      <fieldset className="mt-3">
        <legend className="text-[12.5px] font-semibold text-gray-700">Experiences</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {experiences.map(x => (
            <label key={x.key} className="flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900">
              <input type="checkbox" checked={chosen.includes(x.key)} style={{ accentColor: x.accent }}
                onChange={ev => setChosen(c => ev.target.checked ? [...c, x.key] : c.filter(k => k !== x.key))} />
              {x.name}
            </label>
          ))}
        </div>
      </fieldset>
      {needsAdult && (
        <label className="mt-3 flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
          <input type="checkbox" checked={adult} onChange={e => setAdult(e.target.checked)} className="mt-0.5" />
          <span>I confirm this person is 18 or over. The Competen Scholar pilot is for adults only, and the confirmation is recorded with your name.</span>
        </label>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="inv-days" className="block text-[12.5px] font-semibold text-gray-700">Invitation open for</label>
          <select id="inv-days" value={days} onChange={e => setDays(e.target.value)} className={input}>
            {["3", "7", "14", "30"].map(d => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="inv-ends" className="block text-[12.5px] font-semibold text-gray-700">Last day of access (optional)</label>
          <input id="inv-ends" type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="inv-note" className="block text-[12.5px] font-semibold text-gray-700">Note (optional)</label>
          <input id="inv-note" type="text" maxLength={500} value={note} onChange={e => setNote(e.target.value)} className={input} />
        </div>
      </div>
      <p className="mt-3 text-[12px] text-gray-500">The person sets a password from the email, signs in, and accepts. They then choose which experience opens first and accept each service&apos;s terms before using it.</p>
      <button type="submit" disabled={busy !== null || chosen.length === 0 || (needsAdult && !adult)} className={`${btn} mt-3 bg-gray-900 text-white`}>
        {busy === "invite" ? "Sending…" : "Send invitation"}
      </button>
    </form>
  );
}

// ── MEMBERSHIP STATUS (COMPETEN-LEGAL-001 s13 step 7) ────────────────────────────────────────────────────
// Suspend (reversible), reinstate (from suspended only), revoke (final here, reason required). The server
// enforces every one of those rules again; this only offers what the current status allows.

function MembershipControls({ status, personId, busy, setBusy, onDone }: {
  status: string; personId: string; busy: string | null;
  setBusy: (b: string | null) => void; onDone: (text: string, tone: "ok" | "error") => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  async function act(action: "suspend" | "reinstate" | "revoke") {
    if (action === "revoke" && !window.confirm("Revoke this Competen Individual membership? This is final from this screen. Records are kept.")) return;
    setBusy(`membership-${action}`);
    try {
      const r = await call("/api/hq/individual/grants/membership", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: personId, action, reason: reason || null }),
      });
      if (r.ok) setReason("");
      const done = { suspend: "Membership suspended.", reinstate: "Membership reinstated.", revoke: "Membership revoked." }[action];
      await onDone(r.ok ? done : messageOf(r), r.ok ? "ok" : "error");
    } catch {
      await onDone("The change could not be sent. Check your connection.", "error");
    } finally { setBusy(null); }
  }
  return (
    <div className="mt-3 rounded-lg border border-gray-100 p-3">
      <label htmlFor="mem-reason" className="block text-[12.5px] font-semibold text-gray-700">Reason (required to revoke)</label>
      <input id="mem-reason" type="text" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} className={input}
        placeholder="e.g. Left the pilot cohort" />
      <div className="mt-2 flex flex-wrap gap-2">
        {status === "active" && (
          <button type="button" onClick={() => act("suspend")} disabled={busy !== null} className={`${btn} border border-gray-300 text-gray-800 hover:bg-gray-50`}>
            {busy === "membership-suspend" ? "Suspending…" : "Suspend membership"}
          </button>
        )}
        {status === "suspended" && (
          <button type="button" onClick={() => act("reinstate")} disabled={busy !== null} className={`${btn} border border-gray-300 text-gray-800 hover:bg-gray-50`}>
            {busy === "membership-reinstate" ? "Reinstating…" : "Reinstate membership"}
          </button>
        )}
        <button type="button" onClick={() => act("revoke")} disabled={busy !== null || reason.trim().length < 8}
          className={`${btn} border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] hover:bg-[var(--cmp-surface-error)]`}>
          {busy === "membership-revoke" ? "Revoking…" : "Revoke membership"}
        </button>
      </div>
    </div>
  );
}
