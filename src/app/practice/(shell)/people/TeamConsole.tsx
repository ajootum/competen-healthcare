"use client";

import { useState } from "react";
import { INVITABLE_ROLES } from "@/lib/practice/team-constants";
import { practiceDayOf } from "@/lib/practice/practice-time";

// The team console: invite, suspend, revoke, reinstate, delegate.
//
// THE DELEGATION PICKER OFFERS ONLY WHAT THE CALLER HOLDS. The engine refuses anything else outright
// (you cannot delegate what you do not hold), and offering a capability the API will refuse is a button
// that exists to produce an error. The list comes from the caller's own resolved capabilities.
//
// A CODE IS SHOWN ONCE. It is never listed again, here or by the API -- a team page that displays live
// invitation codes turns one careless screen-share into an open door.

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function TeamConsole({ team, invitations, history, me, myCapabilities, timezone }: {
  team: any[]; invitations: any[]; history: any[]; me: string; myCapabilities: string[];
  /** The PRACTICE's timezone, resolved by the server page -- when an invitation stops working, told to the person about to send it. */
  timezone: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string; roleCode: string } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ roleCode: "practice_assistant", invitedName: "", note: "", expiresInDays: 7 });
  const [delegateFor, setDelegateFor] = useState<string | null>(null);
  const [delegation, setDelegation] = useState({ capability: "", days: 14 });

  async function send(method: string, payload: unknown, onOk?: (data: any) => void) {
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/team", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? data?.error ?? "That did not work.");
      setBusy(false); return;
    }
    if (onOk) { onOk(data); setBusy(false); return; }
    window.location.reload();
  }

  const delegatable = [...myCapabilities].sort();

  return (
    <>
      {error && <p className="mt-3 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}

      {/* The one moment the code exists on screen. */}
      {issued && (
        <section className="mt-4 rounded-xl border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] p-4">
          <p className="text-[13px] font-bold text-[var(--cmp-text-success)]">Invitation created.</p>
          <p className="mt-1 text-[12px] text-gray-700">
            Give this code to the person joining as <span className="font-semibold">{issued.roleCode.replace(/_/g, " ")}</span>.
            They sign in and enter it at <span className="font-mono">/practice/join</span>. It works once
            and expires {String(issued.expiresAt).slice(0, 10)}.
          </p>
          <p className="mt-2 select-all rounded-lg bg-white px-3 py-2 text-center font-mono text-lg font-bold tracking-widest text-gray-900">
            {issued.code}
          </p>
          <p className="mt-2 text-[11px] text-gray-600">
            <span className="font-semibold">This is the only time it is shown.</span> It is not stored
            anywhere you can read it back, and it is not in the audit trail. Hand it over the way this
            practice already trusts &mdash; there is no email or SMS behind it, deliberately.
          </p>
          <button type="button" onClick={() => { setIssued(null); window.location.reload(); }}
            className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
            I have written it down
          </button>
        </section>
      )}

      {/* Invite */}
      {!issued && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <button type="button" onClick={() => setInviteOpen(o => !o)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
            {inviteOpen ? "Cancel" : "Invite somebody"}
          </button>
          {inviteOpen && (
            <form className="mt-3 flex flex-col gap-2" onSubmit={e => {
              e.preventDefault();
              send("POST", { invite }, data => { setIssued({ ...data.invitation, roleCode: invite.roleCode }); setInviteOpen(false); });
            }}>
              <div className="flex flex-col gap-1.5">
                {INVITABLE_ROLES.map(([code, label, blurb]) => (
                  <label key={code} className={`flex cursor-pointer gap-2 rounded-lg border p-2 ${invite.roleCode === code ? "border-[var(--cp-primary)] bg-[var(--cp-primary-soft)]" : "border-gray-200"}`}>
                    <input type="radio" name="role" value={code} checked={invite.roleCode === code}
                      onChange={() => setInvite(i => ({ ...i, roleCode: code }))} className="mt-0.5" />
                    <span>
                      <span className="text-[13px] font-semibold text-gray-900">{label}</span>
                      <span className="block text-[11px] text-gray-600">{blurb}</span>
                    </span>
                  </label>
                ))}
              </div>
              <input placeholder="Who is it for? (a note for you)" value={invite.invitedName}
                onChange={e => setInvite(i => ({ ...i, invitedName: e.target.value }))} className={input} />
              <label className="flex items-center gap-2 text-[11px] text-gray-500">
                Expires after
                <input type="number" min={1} max={30} value={invite.expiresInDays}
                  onChange={e => setInvite(i => ({ ...i, expiresInDays: Number(e.target.value) }))}
                  className={`${input} w-20`} />
                days
              </label>
              <button type="submit" disabled={busy}
                className="self-start rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                Create the code
              </button>
            </form>
          )}
        </section>
      )}

      {/* Members */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Members</h2>
        <ul className="mt-2 flex flex-col gap-3">
          {team.map(p => (
            <li key={p.userId} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-gray-900">
                  {p.name ?? (p.userId === me ? "You" : "Unnamed member")}
                </span>
                {p.userId === me && <span className="text-[10px] text-gray-400">you</span>}
                {p.roles.map((r: string) => (
                  <span key={r} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                    {r.replace(/_/g, " ")}
                  </span>
                ))}
                {!p.active && (
                  <span className="rounded bg-[var(--cmp-surface-critical)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-critical)]">
                    no access
                  </span>
                )}
                {p.endedRoles.length > 0 && (
                  <span className="text-[10px] text-gray-400">was: {p.endedRoles.join(", ")}</span>
                )}
              </div>

              {p.active && (
                <p className="mt-1 text-[11px] text-gray-500">
                  <span className="font-semibold">Can:</span>{" "}
                  {p.capabilities.length === 0 ? "nothing — no capabilities are live" : p.capabilities.join(" · ")}
                </p>
              )}

              {p.delegations.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {p.delegations.map((d: any, i: number) => (
                    <li key={i} className="text-[11px] text-[var(--cmp-text-warning)]">
                      lent {d.capability} until {String(d.to).slice(0, 10)}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-1.5 flex gap-1.5 flex-wrap">
                {p.memberships.map((m: any) => (
                  <span key={m.id} className="flex gap-1.5">
                    {m.status === "active" && (
                      <>
                        <button type="button" disabled={busy}
                          onClick={() => send("PATCH", { membershipId: m.id, status: "suspended" })}
                          className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          Suspend {m.roleCode.replace(/_/g, " ")}
                        </button>
                        <button type="button" disabled={busy}
                          onClick={() => { if (confirm("Remove this access? Their open tasks will show as assigned to somebody who can no longer see them.")) send("PATCH", { membershipId: m.id, status: "revoked" }); }}
                          className="rounded border border-[var(--cmp-color-critical)] px-2 py-0.5 text-[11px] font-semibold text-[var(--cmp-text-critical)] hover:bg-[var(--cmp-surface-critical)] disabled:opacity-50">
                          Remove
                        </button>
                      </>
                    )}
                    {m.status !== "active" && (
                      <button type="button" disabled={busy}
                        onClick={() => send("PATCH", { membershipId: m.id, status: "active" })}
                        className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        Restore {m.roleCode.replace(/_/g, " ")}
                      </button>
                    )}
                  </span>
                ))}
                {p.active && p.userId !== me && (
                  <button type="button" disabled={busy}
                    onClick={() => { setDelegation({ capability: "", days: 14 }); setDelegateFor(delegateFor === p.userId ? null : p.userId); }}
                    className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                    Lend a capability
                  </button>
                )}
              </div>

              {delegateFor === p.userId && (
                <form className="mt-2 flex gap-1.5 flex-wrap rounded-lg bg-gray-50 p-2" onSubmit={e => {
                  e.preventDefault();
                  const to = new Date(Date.now() + delegation.days * 86400000).toISOString();
                  const membershipId = p.memberships.find((m: any) => m.status === "active")?.id;
                  send("POST", { delegate: { membershipId, capability: delegation.capability, effectiveTo: to } });
                }}>
                  <select required aria-label="Capability" value={delegation.capability}
                    onChange={e => setDelegation(d => ({ ...d, capability: e.target.value }))} className={`${input} flex-1`}>
                    <option value="">Choose one of yours…</option>
                    {delegatable.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                    for
                    <input type="number" min={1} max={365} value={delegation.days}
                      onChange={e => setDelegation(d => ({ ...d, days: Number(e.target.value) }))} className={`${input} w-20`} />
                    days
                  </label>
                  <button type="submit" disabled={busy || !delegation.capability}
                    className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                    Lend
                  </button>
                  <p className="w-full text-[10px] text-gray-400">
                    Only capabilities you hold yourself are offered &mdash; lending cannot create access
                    you do not have. It ends on its own; nothing has to run.
                  </p>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Invitations */}
      {invitations.length > 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Invitations</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {invitations.map(i => (
              <li key={i.id} className="flex items-center gap-2 text-[12px]">
                <span className="font-semibold text-gray-800">{i.invited_name || "Unnamed"}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                  {i.role_code.replace(/_/g, " ")}
                </span>
                <span className={`text-[11px] ${i.usable ? "text-[var(--cmp-text-success)]" : "text-gray-400"}`}>
                  {i.status === "ACCEPTED" ? "accepted"
                    : i.status === "REVOKED" ? "revoked"
                      : i.expired ? "expired" : `usable until ${practiceDayOf(timezone, i.expires_at)}`}
                </span>
                {i.usable && (
                  <button type="button" disabled={busy} onClick={() => send("PATCH", { revokeInvitation: i.id })}
                    className="ml-auto rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-gray-400">
            Codes are not shown here. Each one appears once, when it is created; if it was lost, revoke
            it and issue another.
          </p>
        </section>
      )}

      {/* Trail */}
      {history.length > 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">How access got this way</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {history.map(h => (
              <li key={h.id} className="flex items-baseline gap-2 text-[11px]">
                <span className="font-mono text-gray-400">{String(h.occurred_at).slice(0, 16).replace("T", " ")}</span>
                <span className="text-gray-700">
                  <span className="font-semibold">{h.subject_name ?? "Somebody"}</span>{" "}
                  {h.event_type.replace(/_/g, " ")}
                  {h.to_value && <> → {h.to_value}</>}
                  {h.actor_name && h.actor_id !== h.subject_user_id && <> (by {h.actor_name})</>}
                </span>
                {h.note && <span className="text-gray-500">{h.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
