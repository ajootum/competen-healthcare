"use client";

import { useCallback, useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { BUTTON } from "@/lib/practice/palette";
import { pathwayFor } from "@/lib/practice/encounter-start";
import UniversalSearch from "../patients/UniversalSearch";
import RegistrationForm from "../patients/RegistrationForm";

// CPR-FLOW-001 -- "Start encounter", in place, on the encounters board.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE DEFECT THIS EXISTS TO CLOSE.
//
// The primary action on this page was a LINK to /practice/patients. It started nothing. It navigated to
// a register that did not know why you had arrived, where the nearest equivalent action ("Start
// consultation") is in a side panel that only appears once a patient is selected. One press, named for
// a clinical act, that quietly became a change of page and a search for the control again. The practice
// owner walking the product found it in one sentence: "Start encounter takes me to patient section."
//
// ⚠ AN ENCOUNTER NEEDS A PATIENT, so the button cannot avoid asking for one. What it CAN avoid is
// making that somebody else's page: the picker opens over the board, the search is the register's own
// search, and the next thing on screen is the consultation. One action, no page change, no dead end.
//
// THIS FILE WRITES NO SEARCH AND NO REGISTRATION.
//
//   the search        <UniversalSearch/> -- the patients workspace's own box, over
//                     GET /api/v1/practice/patients/search -> universalSearch(). It reports each probe
//                     separately, so it can say "nothing found in what could be searched" instead of
//                     "nobody matches", and it refuses a query under two characters. A picker with its
//                     own search would be a second answer to "is this person registered", and the
//                     looser of the two would be the one used at a busy desk.
//   the registration  <RegistrationForm/> -- over POST /api/v1/practice/registration -> register() ->
//                     registerPatient(). That is the engine that enforces the CPR-V2-005 minimum
//                     dataset (a birth date OR an estimated age), the guardian rule, this practice's
//                     own configured fields, and the duplicate detection this product sells against.
//                     A lighter "quick create" here would be a path to a SECOND record for a patient
//                     who already exists -- exactly the failure the register defends.
//
// WHAT THIS FILE ITSELF DOES: decides the FLOW-001 pathway from the record (and refuses to guess when
// the record could not be read -- see pathwayFor), launches, and lands on the consultation.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

type Notice = { kind: "ok" | "err"; text: string };

type RegistrationFormPayload = {
  today: string;
  majorityAge: number;
  template: any;
  fields: any[];
};

/**
 * Everything the picker draws, as a function of its props.
 *
 * SEPARATED FROM THE STATE ABOVE IT so the branches can be rendered and asserted -- in particular the
 * one that must not exist for a caller without patient.create.
 */
export function StartEncounterPanel({
  canRegisterPatient, phase, notice, busy, form, formError, justRegistered,
  onSelectPatient, onOpenRegister, onBackToSearch, onRegistered, onNotice,
}: {
  /** patient.create. ⚠ HIDDEN, NOT DISABLED: a greyed-out "Register" is still an offer, and the person
   *  it is offered to is the one who cannot take it. */
  canRegisterPatient: boolean;
  phase: "search" | "register";
  notice: Notice | null;
  busy: boolean;
  /** null while the practice's registration form is being read, or when it could not be. */
  form: RegistrationFormPayload | null;
  formError: string | null;
  /** Somebody registered a moment ago whose consultation was NOT opened. Named so the journey does not
   *  end on a message telling them to go and search for a patient they have just typed in full. */
  justRegistered: { patientId: string; displayName: string } | null;
  onSelectPatient: (patientId: string) => void;
  onOpenRegister: () => void;
  onBackToSearch: () => void;
  onRegistered: (r: any) => void;
  onNotice: (n: Notice) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-gray-600">
        An encounter is filed against a patient, so this asks for one first. Searching creates nothing
        &mdash; and if a consultation is already open for whoever you choose, it is{" "}
        <strong>resumed rather than duplicated</strong>.
      </p>

      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok"
          ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
          : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {busy && (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          Opening the consultation&hellip; nothing has been signed and nothing is final.
        </p>
      )}

      {justRegistered && phase === "search" && (
        <div className="rounded-xl border border-[var(--cp-primary)]/30 bg-[var(--cp-primary)]/5 p-4">
          <p className="text-[13px] text-gray-800">
            <strong>{justRegistered.displayName}</strong> is on the register and nothing clinical is open
            for them. Opening the consultation is a separate act, and it is this one.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSelectPatient(justRegistered.patientId)}
            className={`mt-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${BUTTON.primary}`}
          >
            Start the consultation for {justRegistered.displayName}
          </button>
        </div>
      )}

      {phase === "search" ? (
        <>
          {/* ⚠ THE REGISTER'S OWN SEARCH BOX, NOT A COPY OF IT. Its three states are already right:
              nothing typed, a read that failed, and genuinely nobody -- and it will not make the third
              claim when a probe returned an error. */}
          <UniversalSearch
            initialQuery=""
            initial={null}
            canCreate={canRegisterPatient}
            selectedPatientId={null}
            onSelect={onSelectPatient}
            onRegister={onOpenRegister}
            onSubmitQuery={() => { /* the query is not URL state here: this panel closes with the board still behind it */ }}
          />

          {canRegisterPatient && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="text-[13px] font-bold text-gray-900">Not on the register?</h3>
              <p className="mt-0.5 text-[12px] text-gray-500">
                Register them and open the consultation in one act. It is the practice&rsquo;s own
                registration form, with its duplicate check &mdash; a walk-in is not a reason to make a
                second record for somebody who already has one.
              </p>
              <button
                type="button"
                onClick={onOpenRegister}
                className={`mt-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${BUTTON.secondaryAction}`}
              >
                Register a new patient
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-bold text-gray-900">Register and start the consultation</h3>
              <p className="text-[12px] text-gray-500">
                Finish with <span className="font-semibold text-gray-700">Register and start the
                consultation</span> &mdash; that is the button that does both. Registering alone leaves
                the patient on the register with nothing open.
              </p>
            </div>
            <button
              type="button"
              onClick={onBackToSearch}
              className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50"
            >
              ← Search instead
            </button>
          </div>

          {/* THE THREE STATES AGAIN, FOR THE FORM ITSELF. A practice's registration form is configured
              data; a form that could not be read is not a form with no questions on it, and drawing a
              bare name box would collect a registration this practice's own rules would refuse. */}
          {formError ? (
            <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
              <strong>This practice&rsquo;s registration form could not be read.</strong> {formError}{" "}
              Nothing was registered. This is not a form with no questions on it &mdash; try again, or
              register from the patients workspace.
            </p>
          ) : !form ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
              Reading this practice&rsquo;s registration form&hellip;
            </p>
          ) : (
            <>
              <RegistrationForm
                form={{ template: form.template, fields: form.fields ?? [] }}
                majorityAge={form.majorityAge ?? 18}
                today={form.today}
                // QUICK IS THE ONLY HONEST MODE FOR A WALK-IN, and it hides exactly one card: hospital
                // numbers, which have to name the facility that issued them and are added from the
                // patient's own page. Everything the minimum dataset needs is still asked for here, and
                // a guardian is still required for a child -- no configuration can switch that off.
                mode="quick"
                canStartEncounter
                onNotice={onNotice}
                onRegistered={onRegistered}
              />
              <p className="text-[11px] text-gray-400">
                Deferred by this quick registration, and only this: hospital and clinic numbers, which
                need the issuing facility. Nothing else is skipped &mdash; the minimum dataset, the
                guardian rule, this practice&rsquo;s own required questions and the duplicate check all
                run exactly as they do on the full form, because it is the same form and the same engine.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function StartEncounter({ canStart, canRegisterPatient }: {
  /** encounter.create. */
  canStart: boolean;
  /** patient.create. */
  canRegisterPatient: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"search" | "register">("search");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<RegistrationFormPayload | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [justRegistered, setJustRegistered] = useState<{ patientId: string; displayName: string } | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => { setOpen(false); setPhase("search"); setNotice(null); }, []);
  // ⚠ THE PAGE HAS TO GO WHERE THE ACTION WENT. useModalFocus moves focus into the panel, wraps Tab
  // inside it, closes on Escape and puts focus back on this button afterwards -- which is what makes
  // aria-modal a promise kept rather than a promise made. A dialog that opens behind the keyboard is
  // the same defect as a button that navigates somewhere and says nothing.
  useModalFocus(open, panel, close);

  /**
   * Choose a patient, and be in the consultation.
   *
   * TWO READS, IN THIS ORDER, AND THE FIRST ONE CAN REFUSE THE SECOND. The pathway is written onto the
   * encounter and never revised, so it is established before anything is created.
   */
  const startFor = useCallback(async (patientId: string) => {
    setBusy(true); setNotice(null);
    try {
      let prior: { unavailable: boolean; count: number };
      try {
        const r = await fetch(`/api/v1/practice/encounters?status=all&patientId=${encodeURIComponent(patientId)}`);
        if (!r.ok) {
          setNotice({
            kind: "err",
            text: `This patient's history could not be read (HTTP ${r.status}), so the visit type cannot be `
              + "determined and nothing was opened.",
          });
          return;
        }
        const d = await r.json();
        prior = {
          unavailable: d?.unavailable === true,
          count: Array.isArray(d?.encounters) ? d.encounters.length : 0,
        };
      } catch (e) {
        setNotice({
          kind: "err",
          text: `The patient's history did not reach the server: ${e instanceof Error ? e.message : String(e)}. Nothing was opened.`,
        });
        return;
      }

      const decided = pathwayFor(prior);
      if (!decided.ok) { setNotice({ kind: "err", text: decided.message }); return; }

      const res = await fetch("/api/v1/practice/encounters", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientId, pathway: decided.pathway }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.encounter?.id) {
        // ⚠ THE SERVER'S OWN WORDS. "That did not work" over a refused launch sends somebody to press
        // it again; "this patient record is not active (archived or merged)" sends them to the record.
        setNotice({
          kind: "err",
          text: `The consultation did not open: ${data?.error?.message ?? data?.error ?? `HTTP ${res.status}`}. Nothing was created.`,
        });
        return;
      }
      window.location.assign(`/practice/encounters/${data.encounter.id}`);
    } catch (e) {
      setNotice({
        kind: "err",
        text: `The consultation did not open: ${e instanceof Error ? e.message : String(e)}. Nothing was created.`,
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const openRegister = useCallback(async () => {
    setPhase("register"); setNotice(null);
    if (form) return;
    setFormError(null);
    try {
      const r = await fetch("/api/v1/practice/registration");
      if (!r.ok) {
        setFormError(r.status === 403
          ? "Your role does not carry patient.create."
          : `The server answered HTTP ${r.status}.`);
        return;
      }
      const d = await r.json();
      setForm({ today: d.today, majorityAge: d.majorityAge, template: d.template, fields: d.fields ?? [] });
    } catch (e) {
      setFormError(`It did not reach the server: ${e instanceof Error ? e.message : String(e)}.`);
    }
  }, [form]);

  if (!canStart) {
    // SAID, NOT SILENTLY ABSENT. A board with no way to start anything and no explanation reads as a
    // broken page rather than as a role that does not open consultations.
    return (
      <p className="max-w-[260px] text-right text-[11px] text-gray-500">
        Opening a consultation needs <span className="font-mono">encounter.create</span>, which your
        role does not carry. Encounters others open are still listed here.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setPhase("search"); setNotice(null); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${BUTTON.primary}`}
      >
        + Start encounter
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
          {/* The scrim is a plain click target, not a dialog: giving it a role would announce an empty one. */}
          <button type="button" aria-label="Close" onClick={close} className="fixed inset-0 cursor-default" />
          <div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Start an encounter"
            className="relative z-10 w-full max-w-[900px] rounded-xl bg-[var(--cp-canvas)] shadow-2xl outline-none"
          >
            <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 bg-white px-5 py-3 rounded-t-xl">
              <div>
                <h2 className="text-[16px] font-bold text-gray-900">Start an encounter</h2>
                <p className="text-[12px] text-gray-500">
                  Search the register, or register somebody who is not on it. You stay on this board
                  until the consultation opens.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
            <div className="p-5">
              <StartEncounterPanel
                canRegisterPatient={canRegisterPatient}
                phase={phase}
                notice={notice}
                busy={busy}
                form={form}
                formError={formError}
                justRegistered={justRegistered}
                onSelectPatient={id => void startFor(id)}
                onOpenRegister={() => void openRegister()}
                onBackToSearch={() => { setPhase("search"); setNotice(null); }}
                onNotice={setNotice}
                onRegistered={r => {
                  // REACHED ONLY WHEN THE PATIENT WAS REGISTERED AND NO CONSULTATION WAS ASKED FOR --
                  // "Register only", "Register and book", "Register and add to the queue", or a launch
                  // that failed and reported itself. Nothing is opened on their behalf: an encounter is
                  // a clinical record, and one created by a side effect has to be explained by somebody
                  // who was never in the room. So the act is offered, with the patient named.
                  setPhase("search");
                  if (r?.patientId) {
                    setJustRegistered({ patientId: r.patientId, displayName: r.displayName ?? "this patient" });
                  }
                  setNotice({
                    kind: "ok",
                    text: `${r?.displayName ?? "The patient"} is registered${r?.practiceId ? ` as ${r.practiceId}` : ""}.`
                      + (r?.incomplete?.length ? ` Not everything saved: ${r.incomplete.map((i: any) => i.reason).join("; ")}.` : "")
                      + " No consultation was opened.",
                  });
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
