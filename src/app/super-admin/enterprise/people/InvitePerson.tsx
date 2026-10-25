"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Modal } from "@/components/ui/interactive";

// Invite a person from People, Positions & Roles (owner, 25 Oct 2026: "add it here"). No new authority:
// it posts to the same owner-only POST /api/super-admin/users as /super-admin/users "+ Add User", which
// creates the auth user, the profile and the platform membership and writes the audit row. super_admin is
// deliberately not offered here -- the people UI never escalates to platform control (people.ts).
// Resending a pending invitation stays on /super-admin/users: only that page reads the auth status that
// says an invitation is still pending.

const INVITE_ROLES: { value: string; label: string }[] = [
  { value: "nurse", label: "Healthcare worker" },
  { value: "assessor", label: "Assessor" },
  { value: "educator", label: "Educator" },
  { value: "hospital_admin", label: "Organisation admin" },
];
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const EMPTY = { full_name: "", email: "", role: "nurse", hospital_id: "" };

export default function InvitePerson({ facilities }: { facilities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const valid = form.full_name.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  async function send() {
    setBusy(true); setError(null);
    const res = await fetch("/api/super-admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: form.full_name.trim(), email: form.email.trim(), role: form.role, mode: "invite",
        organisation_id: null, hospital_id: form.hospital_id || null,
      }),
    });
    setBusy(false);
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(j.error ?? "The invitation could not be sent."); return; }
    setSentTo(form.email.trim());
    setForm(EMPTY);
    router.refresh();
  }

  function close() { setOpen(false); setError(null); setSentTo(null); setForm(EMPTY); }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white px-3.5 py-2">
        + Invite person
      </button>
      {open && (
        // initialIndex 1: land on the first field, not the close X.
        <Modal open title={sentTo ? "Invitation sent" : "Invite a person"} onClose={close} initialIndex={sentTo ? 0 : 1}>
          {sentTo ? (
            <div className="space-y-3">
              <p className="text-sm rounded-lg bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)] px-3 py-2">Invitation sent to {sentTo}. They set their own password from the email.</p>
              <p className="text-xs text-gray-600">To give them an HQ position (for example Competency Author), appoint them once their account appears in the list.</p>
              <div className="flex gap-2">
                <Link href="/super-admin/users/appointments" className="flex-1 text-center py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Appoint to a position</Link>
                <button onClick={() => setSentTo(null)} className="flex-1 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-800">Invite another</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-gray-700">Full name
                <input value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} className={`${input} mt-1`} />
              </label>
              <label className="block text-xs font-medium text-gray-700">Email
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className={`${input} mt-1`} />
              </label>
              <label className="block text-xs font-medium text-gray-700">Workspace role
                <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))} className={`${input} mt-1`}>
                  {INVITE_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium text-gray-700">Facility <span className="font-normal text-gray-500">(optional)</span>
                <select value={form.hospital_id} onChange={e => setForm(p => ({ ...p, hospital_id: e.target.value }))} className={`${input} mt-1`}>
                  <option value="">None</option>
                  {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              {error && <p role="alert" className="text-sm rounded-lg bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)] px-3 py-2">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={close} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button onClick={send} disabled={!valid || busy} className="flex-1 py-2 bg-teal-700 text-white rounded-lg text-sm font-semibold hover:bg-teal-800 disabled:opacity-60">{busy ? "Sending…" : "Send invitation"}</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
