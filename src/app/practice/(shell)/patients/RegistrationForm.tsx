"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// CPR-PRM-001 s4/s5/s6 -- the registration form.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE AGE IS COMPUTED HERE WITH THE SAME ARITHMETIC THE SERVER USES, so the number on screen and the
// number that decides whether a guardian is required cannot disagree. If they could, somebody would fill
// in a form that says "17 years" and be refused by a server that thinks 18, with nothing on the page
// explaining why.
//
// THE GUARDIAN BLOCK IS NOT A SETTING. Which fields appear is the practice's template; whether a
// guardian is REQUIRED is the date of birth, and no configuration can switch that off -- the same floor
// the server enforces.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const label = "block text-[11px] font-semibold text-gray-600";

export const RELATIONSHIP_OPTIONS = [
  ["guardian", "Guardian"], ["mother", "Mother"], ["father", "Father"], ["grandparent", "Grandparent"],
  ["carer", "Carer"], ["social_worker", "Social worker"], ["spouse", "Spouse"], ["partner", "Partner"],
  ["sibling", "Sibling"], ["child", "Child"], ["emergency_contact", "Emergency contact"],
  ["interpreter", "Interpreter"], ["employer", "Employer"], ["insurance_contact", "Insurance contact"],
  ["other", "Other"],
];

// Only these can hold legal authority -- the server refuses the rest, and the form should not offer
// what the server will reject.
const GUARDIAN_TYPES = new Set(["guardian", "mother", "father", "grandparent", "carer", "social_worker"]);

type Relation = {
  relationshipType: string; fullName: string; phone: string; secondaryPhone: string;
  email: string; isLegalGuardian: boolean; mayReceiveInformation: boolean; isPrimary: boolean;
};

const emptyRelation = (asGuardian: boolean): Relation => ({
  relationshipType: asGuardian ? "mother" : "emergency_contact", fullName: "",
  phone: "", secondaryPhone: "", email: "",
  isLegalGuardian: asGuardian, mayReceiveInformation: true, isPrimary: false,
});

/** The same arithmetic as relationships.ts ageFrom(). Years, months and days -- s4. */
function ageFrom(birthDate: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  if (birthDate > today) return null;
  let years = ty - by, months = tm - bm, days = td - bd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(tm === 1 ? ty - 1 : ty, tm === 1 ? 12 : tm - 1, 0)).getUTCDate();
  }
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return null;
  const label = years >= 2 ? `${years} years, ${months} months, ${days} days`
    : years === 1 ? `1 year, ${months} months, ${days} days`
    : months >= 1 ? `${months} months, ${days} days`
    : `${days} days`;
  return { years, months, days, label };
}

export default function RegistrationForm({ form, majorityAge, today, mode = "full", onRegistered, onNotice }: {
  form: { template: any; fields: any[] };
  majorityAge: number;
  today: string;
  /** CPR-REG-002: quick hides the hospital identifiers card -- "minimum information, complete later". */
  mode?: "quick" | "full";
  onRegistered: (r: any) => void;
  onNotice?: (n: { kind: "ok" | "err"; text: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<any[] | null>(null);

  const [p, setP] = useState({
    givenName: "", middleName: "", familyName: "", sex: "unspecified",
    birthDate: "", ageEstimateYears: "", phone: "", email: "", nationalId: "",
    reasonForVisit: "", appointmentAt: "",
  });
  const [relations, setRelations] = useState<Relation[]>([]);
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  // Set once a draft has been saved, so pressing Save again updates it rather than leaving a trail of
  // half-finished copies of the same person on somebody's desk.
  const [draftId, setDraftId] = useState<string | null>(null);

  const age = useMemo(() => p.birthDate ? ageFrom(p.birthDate, today) : null, [p.birthDate, today]);
  const isMinor = age ? age.years < majorityAge
    : p.ageEstimateYears ? Number(p.ageEstimateYears) < majorityAge - 2 : false;
  const boundary = !age && p.ageEstimateYears &&
    Math.abs(Number(p.ageEstimateYears) - majorityAge) <= 2;

  const hasGuardian = relations.some(r => r.isLegalGuardian && GUARDIAN_TYPES.has(r.relationshipType) && r.fullName.trim());
  const name = [p.givenName, p.middleName, p.familyName].map(s => s.trim()).filter(Boolean).join(" ");
  const customFields = (form.fields ?? []).filter((f: any) => !f.is_core && f.visible);

  const canSubmit = !!name && (!!p.birthDate || !!p.ageEstimateYears) && (!!p.phone || !!p.email) &&
    (!isMinor || hasGuardian) && !busy;

  function setRelation(i: number, patch: Partial<Relation>) {
    setRelations(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  }

  async function submit(confirmNew: boolean, action: "register" | "queue" = "register") {
    setBusy(true); setError(null); setCandidates(null);
    const res = await fetch("/api/v1/practice/registration", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        givenName: p.givenName || undefined, middleName: p.middleName || undefined,
        familyName: p.familyName || undefined, sex: p.sex,
        birthDate: p.birthDate || undefined,
        ageEstimateYears: p.ageEstimateYears ? Number(p.ageEstimateYears) : undefined,
        phone: p.phone || undefined, email: p.email || undefined,
        nationalId: p.nationalId || undefined,
        relationships: relations.filter(r => r.fullName.trim()).map(r => ({
          relationshipType: r.relationshipType, fullName: r.fullName,
          phone: r.phone || undefined, secondaryPhone: r.secondaryPhone || undefined,
          email: r.email || undefined,
          isLegalGuardian: r.isLegalGuardian && GUARDIAN_TYPES.has(r.relationshipType),
          mayReceiveInformation: r.mayReceiveInformation, isPrimary: r.isPrimary,
        })),
        reasonForVisit: p.reasonForVisit || undefined,
        appointmentAt: p.appointmentAt ? new Date(p.appointmentAt).toISOString() : undefined,
        custom, confirmNew,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.status === 409 && Array.isArray(data.candidates) && data.candidates.length) {
      setCandidates(data.candidates.map((c: any) => ({ ...c, hardBlock: data?.error?.code === "DUPLICATE_IDENTIFIER" })));
      return;
    }
    if (!res.ok) { setError(data?.error?.message ?? "Registration failed."); return; }

    // REGISTER AND QUEUE IS TWO ACTS, AND THE SECOND IS REPORTED SEPARATELY. If queueing fails the
    // patient still exists -- and telling somebody they are in the queue when they are not is how a
    // person sits in a waiting room nobody is watching.
    if (action === "queue" && data.patientId) {
      const q = await fetch("/api/v1/practice/registration-workspace", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ queuePatientId: data.patientId }),
      });
      if (!q.ok) {
        const qd = await q.json().catch(() => ({}));
        onNotice?.({ kind: "err", text: `Registered, but not added to the queue: ${qd?.error?.message ?? "unknown reason"}` });
      }
    }
    onRegistered(data);
  }

  return (
    <form className="mt-3 flex flex-col gap-4" onSubmit={e => { e.preventDefault(); submit(false); }}>
      {/* ── Name: one row, three parts ────────────────────────────────────────────────────────── */}
      <div>
        <div className="grid sm:grid-cols-3 gap-2">
          <label className={label}>First name
            <input value={p.givenName} onChange={e => setP(v => ({ ...v, givenName: e.target.value }))} className={`mt-1 ${input}`} />
          </label>
          <label className={label}>Middle name
            <input value={p.middleName} onChange={e => setP(v => ({ ...v, middleName: e.target.value }))} className={`mt-1 ${input}`} />
          </label>
          <label className={label}>Last name
            <input value={p.familyName} onChange={e => setP(v => ({ ...v, familyName: e.target.value }))} className={`mt-1 ${input}`} />
          </label>
        </div>
        {/* MONONYMS ARE REAL. Any one of the three is enough, and the form says so rather than starring
            all three and forcing somebody to invent a surname. */}
        <p className="mt-1 text-[10px] text-gray-400">
          {name ? <>Will be recorded as <span className="font-semibold text-gray-600">{name}</span>.</>
            : "Any one of these is enough — a patient known by a single name is registered under it."}
        </p>
      </div>

      {/* ── Date of birth and the live age ─────────────────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-3 gap-2">
        <label className={label}>Date of birth
          <input type="date" max={today} value={p.birthDate}
            onChange={e => setP(v => ({ ...v, birthDate: e.target.value }))} className={`mt-1 ${input}`} />
        </label>
        <label className={label}>…or estimated age
          <input type="number" min={0} max={130} value={p.ageEstimateYears}
            onChange={e => setP(v => ({ ...v, ageEstimateYears: e.target.value }))} className={`mt-1 ${input}`} />
        </label>
        <label className={label}>Sex
          <select value={p.sex} onChange={e => setP(v => ({ ...v, sex: e.target.value }))} className={`mt-1 ${input}`}>
            {[["unspecified", "Not stated"], ["female", "Female"], ["male", "Male"], ["other", "Other"], ["unknown", "Unknown"]]
              .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      {age && (
        <p className="-mt-2 text-[12px] text-gray-700">
          Age: <span className="font-semibold">{age.label}</span>
          {age.years < majorityAge && <span className="ml-2 rounded bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--cmp-text-warning)]">under {majorityAge} — a guardian is required</span>}
        </p>
      )}
      {boundary && (
        <p className="-mt-2 text-[12px] text-[var(--cmp-text-warning)]">
          An estimate this close to {majorityAge} cannot settle whether a guardian is needed. Record a
          date of birth, or add a guardian to be safe.
        </p>
      )}

      {/* ── Contact ───────────────────────────────────────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-3 gap-2">
        <label className={label}>Phone
          <input value={p.phone} onChange={e => setP(v => ({ ...v, phone: e.target.value }))} className={`mt-1 ${input}`} />
        </label>
        <label className={label}>Email
          <input value={p.email} onChange={e => setP(v => ({ ...v, email: e.target.value }))} className={`mt-1 ${input}`} />
        </label>
        <label className={label}>National ID
          <input value={p.nationalId} onChange={e => setP(v => ({ ...v, nationalId: e.target.value }))} className={`mt-1 ${input}`} />
        </label>
      </div>
      <p className="-mt-3 text-[10px] text-gray-400">A phone or an email is required — one contact, either kind.</p>

      {/* ── Guardians and next of kin (s6) ─────────────────────────────────────────────────────── */}
      <section className={`rounded-lg border p-3 ${isMinor && !hasGuardian ? "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)]" : "border-gray-200 bg-gray-50/60"}`}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="text-[12px] font-bold text-gray-900">
            {isMinor ? "Guardian" : "Next of kin and contacts"}
            {isMinor && <span className="ml-1 font-normal text-[var(--cmp-text-warning)]">required</span>}
          </h3>
          <div className="flex gap-2">
            <button type="button" onClick={() => setRelations(r => [...r, emptyRelation(true)])}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
              + Guardian
            </button>
            <button type="button" onClick={() => setRelations(r => [...r, emptyRelation(false)])}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
              + Other contact
            </button>
          </div>
        </div>

        {relations.length === 0 ? (
          <p className="mt-2 text-[11px] text-gray-500">
            {isMinor
              ? `This patient is under ${majorityAge}. Add the parent, guardian or carer who has legal authority.`
              : "Add a next of kin, an emergency contact, an interpreter — as many as apply."}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {relations.map((r, i) => (
              <li key={i} className="rounded-lg border border-gray-200 bg-white p-2.5">
                <div className="grid sm:grid-cols-2 gap-2">
                  <label className={label}>Relationship
                    <select value={r.relationshipType}
                      onChange={e => setRelation(i, {
                        relationshipType: e.target.value,
                        // AN INTERPRETER CANNOT BE A LEGAL GUARDIAN, and the server refuses it. Cleared
                        // here so the checkbox cannot be left ticked against a type that will be rejected.
                        isLegalGuardian: r.isLegalGuardian && GUARDIAN_TYPES.has(e.target.value),
                      })}
                      className={`mt-1 ${input}`}>
                      {RELATIONSHIP_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label className={label}>Full name
                    <input value={r.fullName} onChange={e => setRelation(i, { fullName: e.target.value })} className={`mt-1 ${input}`} />
                  </label>
                  <label className={label}>Primary contact
                    <input value={r.phone} onChange={e => setRelation(i, { phone: e.target.value })} className={`mt-1 ${input}`} />
                  </label>
                  <label className={label}>Secondary contact
                    <input value={r.secondaryPhone} onChange={e => setRelation(i, { secondaryPhone: e.target.value })} className={`mt-1 ${input}`} />
                  </label>
                  <label className={`${label} sm:col-span-2`}>Email
                    <input value={r.email} onChange={e => setRelation(i, { email: e.target.value })} className={`mt-1 ${input}`} />
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px] text-gray-700">
                  <label className={`flex items-center gap-1.5 ${GUARDIAN_TYPES.has(r.relationshipType) ? "" : "opacity-40"}`}>
                    <input type="checkbox" checked={r.isLegalGuardian}
                      disabled={!GUARDIAN_TYPES.has(r.relationshipType)}
                      onChange={e => setRelation(i, { isLegalGuardian: e.target.checked })} />
                    Has legal authority
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={r.mayReceiveInformation}
                      onChange={e => setRelation(i, { mayReceiveInformation: e.target.checked })} />
                    May be told clinical information
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="primary-contact" checked={r.isPrimary}
                      onChange={() => setRelations(rs => rs.map((x, j) => ({ ...x, isPrimary: j === i })))} />
                    Ring first
                  </label>
                  <button type="button" onClick={() => setRelations(rs => rs.filter((_, j) => j !== i))}
                    className="ml-auto text-[11px] font-semibold text-gray-400 hover:text-[var(--cmp-text-danger)]">
                    Remove
                  </button>
                </div>
                {/* THE TWO AUTHORITIES ARE DIFFERENT QUESTIONS, and conflating them is how an emergency
                    contact ends up consenting to surgery. */}
                {!GUARDIAN_TYPES.has(r.relationshipType) && r.relationshipType !== "emergency_contact" && (
                  <p className="mt-1 text-[10px] text-gray-400">
                    A {RELATIONSHIP_OPTIONS.find(([k]) => k === r.relationshipType)?.[1].toLowerCase()} cannot hold legal authority for a patient.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Hospital identifiers (s22) -- full registration only ───────────────────────────────── */}
      {mode === "full" && (
        <section className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
          <h3 className="text-[12px] font-bold text-gray-900">Hospital numbers</h3>
          <p className="mt-0.5 text-[11px] text-gray-500">
            A patient carries a different number at every hospital. Add them once the record exists
            &mdash; each one has to name the facility that issued it, or it cannot be checked against
            anything.
          </p>
          <p className="mt-1.5 text-[10px] text-gray-400">
            The national ID above is not facility-issued and is recorded here. Hospital MRNs, clinic and
            outpatient numbers are added from the patient&rsquo;s own page, where the facility list lives.
          </p>
        </section>
      )}

      {/* ── The photograph the comp asks for, in its designed position ──────────────────────────── */}
      <section className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3">
        <h3 className="text-[12px] font-bold text-gray-900">Patient photograph</h3>
        <p className="mt-0.5 text-[11px] text-gray-600">
          The design offers Take Photo and Upload Photo. There is no file storage in this product, and a
          photograph of a patient is the most identifying file a practice could hold &mdash; so it is
          absent rather than behind a button that fails at the last step.
        </p>
      </section>

      {/* ── The visit ─────────────────────────────────────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 gap-2">
        <label className={`${label} sm:col-span-2`}>Reason for visit
          <textarea rows={2} value={p.reasonForVisit}
            onChange={e => setP(v => ({ ...v, reasonForVisit: e.target.value }))}
            placeholder="In their words, if you can" className={`mt-1 ${input}`} />
        </label>
        <label className={label}>Appointment
          <input type="datetime-local" value={p.appointmentAt}
            onChange={e => setP(v => ({ ...v, appointmentAt: e.target.value }))} className={`mt-1 ${input}`} />
        </label>
        <p className="self-end text-[10px] text-gray-400">
          Optional. Leaving it blank registers the patient without booking anything.
        </p>
      </div>

      {/* ── Whatever this practice added to its own form (s9) ──────────────────────────────────── */}
      {customFields.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
          <h3 className="text-[12px] font-bold text-gray-900">
            {form.template?.name ?? "This practice's own fields"}
          </h3>
          <div className="mt-2 grid sm:grid-cols-2 gap-2">
            {customFields.map((f: any) => (
              <label key={f.field_key} className={label}>
                {f.label}{f.required ? " *" : ""}
                {f.field_type === "select" ? (
                  <select value={String(custom[f.field_key] ?? "")}
                    onChange={e => setCustom(c => ({ ...c, [f.field_key]: e.target.value }))}
                    className={`mt-1 ${input}`}>
                    <option value="">—</option>
                    {(f.options ?? []).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.field_type === "boolean" ? (
                  <span className="mt-1 flex items-center gap-1.5 text-[12px] text-gray-700">
                    <input type="checkbox" checked={custom[f.field_key] === true}
                      onChange={e => setCustom(c => ({ ...c, [f.field_key]: e.target.checked }))} />
                    Yes
                  </span>
                ) : (
                  <input type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                    value={String(custom[f.field_key] ?? "")}
                    onChange={e => setCustom(c => ({ ...c, [f.field_key]: e.target.value }))}
                    className={`mt-1 ${input}`} />
                )}
                {f.help && <span className="mt-0.5 block font-normal text-[10px] text-gray-400">{f.help}</span>}
              </label>
            ))}
          </div>
        </section>
      )}

      {error && <p className="rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}

      {candidates && (
        <div className="rounded-lg border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
          <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">
            {candidates[0]?.hardBlock ? "That identifier already belongs to:" : "A very similar patient already exists:"}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {candidates.map((c: any) => (
              <li key={c.id}>
                <Link href={`/practice/patients/${c.id}`} className="text-[12px] font-semibold text-gray-800 hover:underline">
                  {c.displayName}{c.practiceId ? ` · ${c.practiceId}` : ""}{c.birthDate ? ` · b. ${c.birthDate}` : ""} ({c.matchedBy})
                </Link>
              </li>
            ))}
          </ul>
          {!candidates[0]?.hardBlock && (
            <button type="button" disabled={busy} onClick={() => submit(true)}
              className="mt-2 rounded-lg border border-[var(--cmp-color-warning)] px-3 py-1.5 text-[11px] font-semibold text-[var(--cmp-text-warning)] hover:bg-white/40">
              This is a different person — register anyway
            </button>
          )}
        </div>
      )}

      {/* ── The comp's four actions ─────────────────────────────────────────────────────────────
          Cancel · Save Draft · Register & Queue · Register Only. The first three are new here; the
          order is the comp's, and the primary action is the one a walk-in desk presses most. */}
      <div className="flex items-center gap-2 flex-wrap border-t border-gray-100 pt-3">
        <button type="button" disabled={busy || !canSubmit}
          onClick={() => submit(false, "queue")}
          className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-40">
          {busy ? "Checking for duplicates…" : "Register and add to the queue"}
        </button>
        <button type="submit" disabled={!canSubmit}
          className="rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
          {p.appointmentAt ? "Register and book" : "Register only"}
        </button>

        <button type="button" disabled={busy || !name.trim()}
          onClick={async () => {
            const r = await fetch("/api/v1/practice/registration-workspace", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ draftId, payload: { ...p, relations }, label: name }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { setError(d?.error?.message ?? "The draft could not be saved."); return; }
            setDraftId(d.id);
            onNotice?.({ kind: "ok", text: "Draft saved. It holds this person's details, so finish or discard it." });
          }}
          className="rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
          {draftId ? "Update draft" : "Save draft"}
        </button>

        {isMinor && !hasGuardian && (
          <span className="text-[11px] font-semibold text-[var(--cmp-text-warning)]">
            A guardian with legal authority is needed before this can be saved.
          </span>
        )}
      </div>
      {/* A DRAFT HOLDS SOMEBODY'S DETAILS OUTSIDE THE PATIENT RECORD -- outside the access log, outside
          the merge machinery, outside every retention rule. Said here, where it is created. */}
      <p className="-mt-2 text-[10px] text-gray-400">
        A draft keeps what you have typed on your own desk. It is this person&rsquo;s details held
        outside the patient record, so finish it or discard it &mdash; nothing deletes drafts on a timer.
      </p>
    </form>
  );
}
