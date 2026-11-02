"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/interactive";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/hq/account-classification";
import { ROLE_CONFIG } from "@/lib/roles";
import { COUNTRIES } from "@/lib/countries";
import { PARTICIPATION, PARTICIPATION_LABEL, PREFILL_LABEL, PREFILL_MAX, type Participation } from "@/lib/hq/person-details";
import {
  ACCESS_MAX_DAYS, ACCESS_PRESET_DAYS, displayDate, endDateFor, individualBody, individualReady, individualRefusalText, individualSuccess,
  type IndividualForm,
} from "@/lib/hq/add-user-form";

// ── ADD USER ── owner GO "HQ User Management, Invitations and Individual Profile Completion" (2 Nov 2026) ──────
//
// Moved out of UsersWorkspace so the directory and this dialog can change independently.
//
// THREE THINGS THAT ARE NOT THE SAME THING, and the dialog keeps them apart:
//   * what the person is GIVEN: personal access to Competen Scholar or Professional (no organisation role), or a
//     role in an organisation (Educator, Assessor, Healthcare Worker);
//   * how they are COUNTED: the account type (Human, Demo, Test ...) and the participation label (Regular, Pilot,
//     Staff tester). Both are labels. Neither grants or removes access;
//   * how long complimentary access LASTS: required and at most 366 days for Scholar or Professional.
// Super Admin and Admin are never offered here: they are given through HQ appointments.

type OrgOption = { id: string; name: string };
type Notice = { kind: "ok" | "err"; text: string };

const ORG_ROLES = ["educator", "assessor", "nurse"] as const;

const field = "w-full min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)] border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const labelCls = "mb-1 block text-xs font-semibold text-gray-700";
const hint = "mt-1 text-[11.5px] text-gray-600";
const choice = "flex min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 has-[:checked]:border-teal-700 has-[:checked]:bg-[var(--cmp-surface-information)]";
const primary = "flex-1 min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)] rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50";
const secondary = "flex-1 min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)] rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50";

const BLANK_INDIVIDUAL: IndividualForm = {
  email: "", givenName: "", middleNames: "", familyName: "", preferredName: "", accountType: "human",
  scholar: true, professional: false, adultConfirmed: false, endsOn: "", participation: "regular", expiresInDays: "14",
  phone: "", country: "", note: "", profession: "", qualification: "", institution: "", programme: "", trainingLevel: "",
  organisation: "", facility: "", position: "",
};
const BLANK_ORG = { role: "", mode: "invite", organisation_id: "", hospital_id: "" };

export default function AddUserDialog({ open, onClose, organisations, hospitals, onNotice, onCreated }: {
  open: boolean; onClose: () => void;
  organisations: OrgOption[]; hospitals: { id: string; name: string }[];
  onNotice: (n: Notice) => void; onCreated: () => void;
}) {
  const uid = useId();
  const id = (s: string) => `${uid}-${s}`;
  // null: not asked yet. The default choice follows the Competen Individual release gate.
  const [gate, setGate] = useState<boolean | null>(null);
  const [kind, setKind] = useState<"individual" | "org" | null>(null);
  const [ind, setInd] = useState<IndividualForm>(BLANK_INDIVIDUAL);
  const [org, setOrg] = useState(BLANK_ORG);
  const [orgNames, setOrgNames] = useState({ givenName: "", middleNames: "", familyName: "", email: "", accountType: "human" });
  const [preset, setPreset] = useState<number | "date">(90);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; accountExists?: boolean } | null>(null);
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/super-admin/users/invite-options")
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive) setGate(j && typeof j.individualEnabled === "boolean" ? j.individualEnabled : false); })
      .catch(() => { if (alive) setGate(false); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;
  const mode = kind ?? (gate === false ? "org" : "individual");
  const endsOn = preset === "date" ? ind.endsOn : endDateFor(preset);
  const indForm: IndividualForm = { ...ind, endsOn };
  const setI = <K extends keyof IndividualForm>(k: K, v: IndividualForm[K]) => setInd(p => ({ ...p, [k]: v }));
  const text = (k: keyof IndividualForm) => ({ value: String(ind[k]), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setI(k, e.target.value as never) });

  function close() { setCreds(null); setProblem(null); onClose(); }
  function reset() { setInd(BLANK_INDIVIDUAL); setOrg(BLANK_ORG); setOrgNames({ givenName: "", middleNames: "", familyName: "", email: "", accountType: "human" }); setPreset(90); setMore(false); }

  async function sendIndividual() {
    setBusy(true); setProblem(null);
    try {
      const res = await fetch("/api/hq/individual/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(individualBody(indForm)) });
      const j = await res.json().catch(() => ({})) as { error?: string | { code?: string; message?: string }; classificationWarning?: string; warnings?: string[] };
      if (!res.ok) {
        const e = typeof j.error === "string" ? { message: j.error } : j.error ?? {};
        setProblem({ text: individualRefusalText({ status: res.status, code: e.code, message: e.message }), accountExists: e.code === "ACCOUNT_EXISTS" });
        return;
      }
      const warnings = [j.classificationWarning ?? null, ...(j.warnings ?? [])].filter((x): x is string => !!x);
      onNotice({ kind: warnings.length ? "err" : "ok", text: individualSuccess({ email: indForm.email.trim(), scholar: indForm.scholar, professional: indForm.professional, endsOn, warnings }) });
      reset(); close(); onCreated();
    } catch {
      setProblem({ text: "Competen could not be reached. Nothing was created." });
    } finally { setBusy(false); }
  }

  async function createOrg() {
    setBusy(true); setProblem(null);
    try {
      const res = await fetch("/api/super-admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: orgNames.email.trim(), givenName: orgNames.givenName.trim(), familyName: orgNames.familyName.trim(),
          ...(orgNames.middleNames.trim() ? { middleNames: orgNames.middleNames.trim() } : {}),
          role: org.role, mode: org.mode, account_type: orgNames.accountType,
          organisation_id: org.organisation_id || null, hospital_id: org.hospital_id || null,
        }),
      });
      const j = await res.json().catch(() => ({})) as { error?: string; tempPassword?: string | null; classificationWarning?: string };
      if (!res.ok) { setProblem({ text: j.error ?? "Failed to create user." }); return; }
      const roleLabel = ROLE_CONFIG[org.role as keyof typeof ROLE_CONFIG]?.label ?? org.role;
      if (j.tempPassword) {
        setCreds({ email: orgNames.email.trim(), password: j.tempPassword });
        if (j.classificationWarning) onNotice({ kind: "err", text: j.classificationWarning });
      } else {
        onNotice(j.classificationWarning
          ? { kind: "err", text: `Invitation sent to ${orgNames.email.trim()} as ${roleLabel}. ${j.classificationWarning}` }
          : { kind: "ok", text: `Invitation sent to ${orgNames.email.trim()} as ${roleLabel}, classified ${ACCOUNT_TYPE_LABEL[orgNames.accountType as AccountType] ?? orgNames.accountType}.` });
        reset(); close();
      }
      onCreated();
    } catch {
      setProblem({ text: "Competen could not be reached. Nothing was created." });
    } finally { setBusy(false); }
  }

  const orgReady = /.+@.+\..+/.test(orgNames.email.trim()) && !!orgNames.givenName.trim() && !!orgNames.familyName.trim() && !!org.role;
  const accountTypeSelect = (value: string, set: (v: string) => void, sid: string) => (
    <div>
      <label htmlFor={sid} className={labelCls}>Account type</label>
      <select id={sid} value={value} onChange={e => set(e.target.value)} className={field}>
        {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t === "unclassified" ? "Leave unclassified" : ACCOUNT_TYPE_LABEL[t]}</option>)}
      </select>
      <p className={hint}>Human for a real person. Only Human accounts can be appointed to HQ positions.</p>
    </div>
  );

  return (
    <Modal open title={creds ? "Account created" : "Add User"} onClose={close} width="2xl" initialIndex={creds ? 0 : 1}>
      {creds ? (
        <>
          <p className="mb-4 text-xs text-gray-600">Share these credentials securely. The password is shown only once.</p>
          <div className="flex flex-col gap-1.5 rounded-lg bg-gray-50 p-4 font-mono text-sm break-all">
            <p><span className="text-xs text-gray-600">Email:</span> {creds.email}</p>
            <p><span className="text-xs text-gray-600">Password:</span> {creds.password}</p>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={() => navigator.clipboard.writeText(`Email: ${creds.email}\nPassword: ${creds.password}`)} className={secondary}>Copy both</button>
            <button type="button" onClick={() => { reset(); close(); }} className={primary}>Done</button>
          </div>
        </>
      ) : (
        <form onSubmit={e => { e.preventDefault(); if (mode === "individual" ? individualReady(indForm) : orgReady) void (mode === "individual" ? sendIndividual() : createOrg()); }}>
          <fieldset className="mb-4">
            <legend className={labelCls}>What is this person being given?</legend>
            <div className="grid gap-2">
              <label className={`${choice} ${gate === false ? "opacity-60" : ""}`}>
                <input type="radio" name={id("kind")} className="mt-0.5 accent-teal-700" checked={mode === "individual"} disabled={gate === false} onChange={() => { setKind("individual"); setProblem(null); }} />
                <span>
                  <span className="font-semibold">Competen Scholar or Professional: personal access, no organisation role</span>
                  {gate === false && <span className="block text-[11.5px] text-gray-600">Competen Individual is not switched on here yet.</span>}
                </span>
              </label>
              <label className={choice}>
                <input type="radio" name={id("kind")} className="mt-0.5 accent-teal-700" checked={mode === "org"} onChange={() => { setKind("org"); setProblem(null); }} />
                <span className="font-semibold">Organisation user: a role in an organisation</span>
              </label>
            </div>
          </fieldset>

          {mode === "individual" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor={id("given")} className={labelCls}>First name *</label><input id={id("given")} autoComplete="off" required className={field} {...text("givenName")} /></div>
              <div><label htmlFor={id("middle")} className={labelCls}>Middle name(s)</label><input id={id("middle")} autoComplete="off" className={field} {...text("middleNames")} /></div>
              <div><label htmlFor={id("family")} className={labelCls}>Last name *</label><input id={id("family")} autoComplete="off" required className={field} {...text("familyName")} /></div>
              <div><label htmlFor={id("pref")} className={labelCls}>Preferred name</label><input id={id("pref")} autoComplete="off" maxLength={80} className={field} {...text("preferredName")} /></div>
              <div className="sm:col-span-2"><label htmlFor={id("email")} className={labelCls}>Email *</label><input id={id("email")} type="email" autoComplete="off" required placeholder="name@example.com" className={field} {...text("email")} /></div>
              <div className="sm:col-span-2">{accountTypeSelect(ind.accountType, v => setI("accountType", v), id("acct"))}</div>

              <fieldset className="sm:col-span-2">
                <legend className={labelCls}>Products *</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className={choice}><input type="checkbox" className="mt-0.5 accent-teal-700" checked={ind.scholar} onChange={e => setI("scholar", e.target.checked)} /><span className="font-semibold">Competen Scholar</span></label>
                  <label className={choice}><input type="checkbox" className="mt-0.5 accent-teal-700" checked={ind.professional} onChange={e => setI("professional", e.target.checked)} /><span className="font-semibold">Competen Professional</span></label>
                </div>
                {ind.scholar && (
                  <label className="mt-2 flex items-start gap-2 text-sm text-gray-800">
                    <input type="checkbox" className="mt-0.5 accent-teal-700" checked={ind.adultConfirmed} onChange={e => setI("adultConfirmed", e.target.checked)} />
                    <span>I confirm this person is aged 18 or over. Competen Scholar is for people aged 18 or over.</span>
                  </label>
                )}
              </fieldset>

              <fieldset className="sm:col-span-2">
                <legend className={labelCls}>Access ends *</legend>
                <div className="flex flex-wrap gap-2">
                  {ACCESS_PRESET_DAYS.map(d => (
                    <label key={d} className={`${choice} !py-1.5`}><input type="radio" name={id("ends")} className="mt-0.5 accent-teal-700" checked={preset === d} onChange={() => setPreset(d)} />{d} days</label>
                  ))}
                  <label className={`${choice} !py-1.5`}><input type="radio" name={id("ends")} className="mt-0.5 accent-teal-700" checked={preset === "date"} onChange={() => setPreset("date")} />Pick a date</label>
                </div>
                {preset === "date" && (
                  <div className="mt-2 max-w-xs">
                    <label htmlFor={id("endson")} className="sr-only">Access end date</label>
                    <input id={id("endson")} type="date" className={field} value={ind.endsOn} min={endDateFor(0)} max={endDateFor(ACCESS_MAX_DAYS)} onChange={e => setI("endsOn", e.target.value)} />
                  </div>
                )}
                <p className={hint}>{endsOn ? `Access ends on ${displayDate(endsOn)}. ` : ""}At most {ACCESS_MAX_DAYS} days. Complimentary access, granted by Competen. Paid access: the person subscribes in Competen.</p>
              </fieldset>

              <div>
                <label htmlFor={id("part")} className={labelCls}>Participation</label>
                <select id={id("part")} className={field} value={ind.participation} onChange={e => setI("participation", e.target.value as Participation)}>
                  {PARTICIPATION.map(p => <option key={p} value={p}>{PARTICIPATION_LABEL[p]}</option>)}
                </select>
                <p className={hint}>Separate from access. Pilot participants may be included in supervised pilot features.</p>
              </div>
              <div>
                <label htmlFor={id("days")} className={labelCls}>Invitation can be accepted for (days)</label>
                <input id={id("days")} type="number" inputMode="numeric" min={1} max={30} className={field} {...text("expiresInDays")} />
                <p className={hint}>1 to 30 days. After that a new invitation is needed.</p>
              </div>

              <div className="sm:col-span-2">
                <button type="button" aria-expanded={more} aria-controls={id("more")} onClick={() => setMore(m => !m)}
                  className="min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)] rounded-lg px-1 text-sm font-semibold text-teal-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40">
                  {more ? "▾" : "▸"} More about this person (optional)
                </button>
                <p className={hint}>Shown to the person to confirm when they first sign in. Nothing here is required.</p>
                <div id={id("more")} className={more ? "mt-2 grid gap-3 sm:grid-cols-2" : "hidden"}>
                  <div><label htmlFor={id("phone")} className={labelCls}>Phone</label><input id={id("phone")} type="tel" autoComplete="off" maxLength={40} className={field} {...text("phone")} /></div>
                  <div>
                    <label htmlFor={id("country")} className={labelCls}>Country</label>
                    <select id={id("country")} className={field} {...text("country")}>
                      <option value="">Not recorded</option>
                      {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  {(["profession", "qualification", "institution", "programme", "trainingLevel", "organisation", "facility", "position"] as const).map(k => (
                    <div key={k}><label htmlFor={id(k)} className={labelCls}>{PREFILL_LABEL[k]}</label><input id={id(k)} autoComplete="off" maxLength={PREFILL_MAX} className={field} {...text(k)} /></div>
                  ))}
                  <div className="sm:col-span-2"><label htmlFor={id("note")} className={labelCls}>Note (kept on the invitation, for HQ)</label><textarea id={id("note")} rows={2} maxLength={500} className={field} {...text("note")} /></div>
                </div>
              </div>

              <p className="sm:col-span-2 text-[12px] text-gray-700">Delivery: invitation email only. A sign-in is never shown to you for a personal account, so a temporary password is not offered here.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor={id("ogiven")} className={labelCls}>First name *</label><input id={id("ogiven")} autoComplete="off" required className={field} value={orgNames.givenName} onChange={e => setOrgNames(p => ({ ...p, givenName: e.target.value }))} /></div>
              <div><label htmlFor={id("omiddle")} className={labelCls}>Middle name(s)</label><input id={id("omiddle")} autoComplete="off" className={field} value={orgNames.middleNames} onChange={e => setOrgNames(p => ({ ...p, middleNames: e.target.value }))} /></div>
              <div><label htmlFor={id("ofamily")} className={labelCls}>Last name *</label><input id={id("ofamily")} autoComplete="off" required className={field} value={orgNames.familyName} onChange={e => setOrgNames(p => ({ ...p, familyName: e.target.value }))} /></div>
              <div><label htmlFor={id("oemail")} className={labelCls}>Email *</label><input id={id("oemail")} type="email" autoComplete="off" required placeholder="name@example.com" className={field} value={orgNames.email} onChange={e => setOrgNames(p => ({ ...p, email: e.target.value }))} /></div>
              <div className="sm:col-span-2">{accountTypeSelect(orgNames.accountType, v => setOrgNames(p => ({ ...p, accountType: v })), id("oacct"))}</div>
              <div className="sm:col-span-2">
                <label htmlFor={id("role")} className={labelCls}>Role *</label>
                <select id={id("role")} className={field} value={org.role} onChange={e => setOrg(p => ({ ...p, role: e.target.value }))}>
                  <option value="">Choose a role</option>
                  {ORG_ROLES.map(k => <option key={k} value={k}>{ROLE_CONFIG[k].label}</option>)}
                </select>
                <p className={hint}>Super Admin and Admin are given through HQ appointments, not here. Fine-grained organisation roles can be set afterwards in the user details.</p>
              </div>
              <div>
                <label htmlFor={id("org")} className={labelCls}>Organisation (optional)</label>
                <select id={id("org")} className={field} value={org.organisation_id} onChange={e => setOrg(p => ({ ...p, organisation_id: e.target.value }))}>
                  <option value="">None</option>
                  {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={id("fac")} className={labelCls}>Facility (optional)</label>
                <select id={id("fac")} className={field} value={org.hospital_id} onChange={e => setOrg(p => ({ ...p, hospital_id: e.target.value }))}>
                  <option value="">None</option>
                  {hospitals.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <fieldset className="sm:col-span-2">
                <legend className={labelCls}>Access</legend>
                <div className="grid gap-2">
                  <label className={choice}><input type="radio" name={id("mode")} className="mt-0.5 accent-teal-700" checked={org.mode === "invite"} onChange={() => setOrg(p => ({ ...p, mode: "invite" }))} />Send invitation email. They set their own password.</label>
                  <label className={choice}><input type="radio" name={id("mode")} className="mt-0.5 accent-teal-700" checked={org.mode === "password"} onChange={() => setOrg(p => ({ ...p, mode: "password" }))} />Create with a temporary password. It is shown to you once.</label>
                </div>
              </fieldset>
            </div>
          )}

          {problem && (
            <p role="alert" className="mt-4 rounded-lg bg-[var(--cmp-surface-error)] px-3 py-2 text-sm text-[var(--cmp-text-error)]">
              {problem.text}{" "}
              {problem.accountExists && <Link href="/super-admin/individual" className="font-semibold underline">Open Individual access</Link>}
            </p>
          )}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={close} className={secondary}>Cancel</button>
            <button type="submit" className={primary} disabled={busy || (mode === "individual" ? !individualReady(indForm) : !orgReady)}>
              {busy ? "Sending..." : mode === "individual" ? "Send invitation" : org.mode === "invite" ? "Send invitation" : "Create account"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
