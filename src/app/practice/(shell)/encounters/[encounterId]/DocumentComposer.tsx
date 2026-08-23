"use client";

import { useEffect, useState } from "react";

// CPR-DOC-AUTO-001 sections 7 and 18 -- THE PURPOSE-DRIVEN ENTRY POINTS.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS REPLACES, AND WHAT IT DELIBERATELY DOES NOT.
//
// Section 7's complaint is exact: writing a referral letter today means "Title + type dropdown + blank
// body", which asks a practitioner to author prose the product could construct and to name a document
// the product already knows the name of. This asks for the four decisions section 13 says a referral
// actually needs -- who, why, what to include, what is being asked for -- and composes the rest.
//
// The blank-body form is still there and still works. Section 19 requires it: "Blank/manual document
// authoring remains available for exceptions", and an exception is exactly the case a purpose-driven
// form cannot anticipate.
//
// ONE DIALOG, NOT ONE PER DOCUMENT. Section 20 forbids "a collection of one-off letter forms", and
// that applies to the screen as much as to the engine. Everything these documents share -- choosing
// what from the record goes in, honest absence, the disclosure summary, the create button -- is here
// once. PURPOSES holds the only things that genuinely differ: what to call it, where to post it, and
// which two or three extra fields that purpose needs.
//
// THE VISIT SUMMARY IS NOT IN HERE ON PURPOSE. Section 3 gives it mode A, "one-click / review": CP
// already holds the facts, so asking anything at all would be the wrong shape. It is a button that
// generates and lands on the draft -- see the console.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// SECTION 18: "Never expose prompts, model parameters, internal record IDs or specification codes to
// practitioners." Fact keys carry row ids and never reach the screen -- they are the value of a
// checkbox and nothing else. No code from this specification appears in any string a practitioner reads.
//
// THE INCLUDE LIST IS THE PRE-ISSUE SUMMARY. Section 18 also asks that included clinical facts be shown
// "in readable human terms before issue", and this list is that, rather than a separate preview screen
// showing the same facts a second time. What is ticked here is what the letter will contain -- the
// server composes from exactly this selection and from nothing else.

type Fact = {
  key: string; category: string; label: string; detail: string | null;
  scope: "current_encounter" | "historical"; recordedOn: string | null; defaultSelected: boolean;
};
type Group = { category: string; title: string; facts: Fact[]; truncated: boolean; unreadable: string | null };
type Destination = {
  id: string; kind: string; display_name: string;
  specialty: string | null; facility: string | null; address: string | null;
};

const KINDS: [string, string][] = [
  ["clinician", "A named clinician"], ["specialty", "A specialty or service"],
  ["facility", "A facility"], ["other", "Someone else"],
];

const field = "min-h-[var(--cp-touch)] w-full rounded-lg border border-gray-200 px-2.5 text-[13px] text-gray-800";

export type ComposerPurpose = "referral_letter" | "patient_instructions";

const PURPOSES: Record<ComposerPurpose, {
  endpoint: string; heading: string; blurb: string; submit: string; working: string;
  recipient: boolean; reason: boolean; requestedAction: boolean; instructions: boolean;
}> = {
  referral_letter: {
    endpoint: "/api/v1/practice/documents/referral-letter",
    heading: "Write a referral letter",
    blurb: "This creates a draft. Nothing is sent, and nothing is signed until you say so.",
    submit: "Create draft letter", working: "Creating the draft…",
    recipient: true, reason: true, requestedAction: true, instructions: false,
  },
  patient_instructions: {
    endpoint: "/api/v1/practice/documents/patient-instructions",
    heading: "Write patient instructions",
    blurb: "For the patient to take away. This creates a draft -- nothing is issued until you say so.",
    submit: "Create draft instructions", working: "Creating the draft…",
    recipient: false, reason: false, requestedAction: false, instructions: true,
  },
};

export default function DocumentComposer(props: {
  purpose: ComposerPurpose;
  patientId: string;
  encounterId: string;
  /** Write the letter for a referral already recorded, instead of recording a second one. */
  referralId?: string | null;
  initialReason?: string;
  onClose: () => void;
  onGenerated: (documentId: string) => void;
}) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showEarlier, setShowEarlier] = useState(false);

  const [destinationId, setDestinationId] = useState("");
  const [newRecipient, setNewRecipient] = useState({
    kind: "clinician", displayName: "", specialty: "", facility: "", address: "", saveForReuse: true,
  });
  const [reason, setReason] = useState(props.initialReason ?? "");
  const [requestedAction, setRequestedAction] = useState("");
  const [instructions, setInstructions] = useState("");
  const cfg = PURPOSES[props.purpose];

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [factsRes, destRes] = await Promise.all([
          fetch(`/api/v1/practice/documents/facts?patientId=${props.patientId}&encounterId=${props.encounterId}`),
          fetch("/api/v1/practice/referral-destinations"),
        ]);
        if (!live) return;
        if (!factsRes.ok) { setLoadFailed("This patient's record could not be read, so nothing can be included yet."); return; }
        const facts = await factsRes.json();
        setGroups(facts.groups ?? []);
        setSelected(new Set<string>(facts.defaultSelected ?? []));
        if (destRes.ok) setDestinations((await destRes.json()).destinations ?? []);
      } catch {
        if (live) setLoadFailed("This patient's record could not be read, so nothing can be included yet.");
      }
    })();
    return () => { live = false; };
  }, [props.patientId, props.encounterId]);

  const toggle = (key: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const generate = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(cfg.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: props.patientId, encounterId: props.encounterId,
          factKeys: [...selected],
          ...(cfg.recipient ? {
            referralId: props.referralId ?? null,
            destinationId: destinationId || null,
            recipient: destinationId ? null : {
              kind: newRecipient.kind, displayName: newRecipient.displayName,
              specialty: newRecipient.specialty || null, facility: newRecipient.facility || null,
              address: newRecipient.address || null, saveForReuse: newRecipient.saveForReuse,
            },
          } : {}),
          ...(cfg.reason ? { reason } : {}),
          ...(cfg.requestedAction ? { requestedAction: requestedAction || null } : {}),
          ...(cfg.instructions ? { instructions: instructions || null } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message ?? "The letter could not be created."); return; }
      props.onGenerated(json.documentId);
    } catch {
      setError("The letter could not be created.");
    } finally { setBusy(false); }
  };

  // WHAT EACH PURPOSE NEEDS BEFORE IT CAN BE CREATED, and no more (s18: smallest number of inputs).
  // A referral has a recipient and a reason. Instructions need something to say -- typed, ticked, or
  // both -- which is the same rule the engine enforces, stated here so the button explains itself.
  const hasRecipient = destinationId !== "" || newRecipient.displayName.trim() !== "";
  const ready = !busy && (cfg.recipient ? hasRecipient : true)
    && (cfg.reason ? reason.trim() !== "" : true)
    && (cfg.instructions ? (instructions.trim() !== "" || selected.size > 0) : true);

  const current = (groups ?? []).map(g => ({ ...g, facts: g.facts.filter(f => f.scope === "current_encounter") }));
  const earlier = (groups ?? []).map(g => ({ ...g, facts: g.facts.filter(f => f.scope === "historical") }));
  const earlierCount = earlier.reduce((n, g) => n + g.facts.length, 0);
  const selectedCount = selected.size;

  const factRow = (f: Fact) => (
    <label key={f.key} className="flex min-h-[var(--cp-touch)] items-start gap-2 py-1">
      <input type="checkbox" checked={selected.has(f.key)} onChange={() => toggle(f.key)}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--cp-primary-deep)]" />
      <span className="text-[12.5px] leading-snug text-gray-800">
        {f.label}
        {f.detail && <span className="text-gray-500"> &mdash; {f.detail}</span>}
        {f.recordedOn && <span className="block text-[10.5px] text-gray-400">recorded {f.recordedOn}</span>}
      </span>
    </label>
  );

  const groupBlock = (g: Group, key: string) => {
    // HONEST ABSENCE. A category whose read failed says so. Rendering it as an empty list would tell a
    // practitioner this patient has none recorded, which is a different and possibly false statement.
    if (g.unreadable) return (
      <div key={key} className="py-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{g.title}</p>
        <p className="text-[12px] text-[var(--cmp-text-critical)]">Could not be read, so nothing here can be included.</p>
      </div>
    );
    if (!g.facts.length) return null;
    return (
      <div key={key} className="py-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{g.title}</p>
        {g.facts.map(factRow)}
        {g.truncated && <p className="text-[10.5px] text-gray-400">Showing the most recent only.</p>}
      </div>
    );
  };

  return (
    <>
      <button type="button" aria-label="Cancel writing the referral letter" onClick={props.onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/40" />
      {/* One dialog, two presentations -- the bottom sheet where a thumb reaches, a compact modal on a
          wide screen. The shape SessionLocation and the start confirmation already use. */}
      <div role="dialog" aria-modal="true" aria-label={cfg.heading}
        onKeyDown={e => { if (e.key === "Escape") props.onClose(); }}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-2xl border-t border-gray-200 bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] md:inset-0 md:m-auto md:h-fit md:max-h-[86vh] md:max-w-lg md:rounded-2xl md:border md:p-5 md:pb-5 md:shadow-xl">
        <h3 className="text-[15px] font-bold text-gray-900">{cfg.heading}</h3>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">{cfg.blurb}</p>

        <div className="mt-3 flex-1 overflow-y-auto">
          {loadFailed ? (
            <p role="alert" className="text-[12.5px] text-[var(--cmp-text-critical)]">{loadFailed}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {/* ── WHO ─────────────────────────────────────────────────────────────────────── */}
              {cfg.recipient && (
              <div>
                <label htmlFor="ref-dest" className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Refer to</label>
                {destinations.length > 0 && (
                  <select id="ref-dest" value={destinationId} onChange={e => setDestinationId(e.target.value)} className={`mt-1 ${field}`}>
                    <option value="">Someone new&hellip;</option>
                    {destinations.map(d => (
                      <option key={d.id} value={d.id}>
                        {[d.display_name, d.specialty, d.facility].filter(Boolean).join(", ")}
                      </option>
                    ))}
                  </select>
                )}
                {destinationId === "" && (
                  <div className="mt-1.5 flex flex-col gap-1.5">
                    <select aria-label="Kind of destination" value={newRecipient.kind}
                      onChange={e => setNewRecipient(p => ({ ...p, kind: e.target.value }))} className={field}>
                      {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input value={newRecipient.displayName} placeholder="Name"
                      onChange={e => setNewRecipient(p => ({ ...p, displayName: e.target.value }))} className={field} />
                    <input value={newRecipient.specialty} placeholder="Specialty (optional)"
                      onChange={e => setNewRecipient(p => ({ ...p, specialty: e.target.value }))} className={field} />
                    <input value={newRecipient.facility} placeholder="Facility (optional)"
                      onChange={e => setNewRecipient(p => ({ ...p, facility: e.target.value }))} className={field} />
                    <textarea value={newRecipient.address} placeholder="Address (optional)" rows={2}
                      onChange={e => setNewRecipient(p => ({ ...p, address: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 p-2.5 text-[13px] text-gray-800" />
                    <label className="flex min-h-[var(--cp-touch)] items-center gap-2 text-[12px] text-gray-700">
                      <input type="checkbox" checked={newRecipient.saveForReuse}
                        onChange={e => setNewRecipient(p => ({ ...p, saveForReuse: e.target.checked }))}
                        className="h-4 w-4 accent-[var(--cp-primary-deep)]" />
                      Keep this destination, so the address is not retyped next time
                    </label>
                  </div>
                )}
              </div>

              )}

              {/* ── WHY ─────────────────────────────────────────────────────────────────────── */}
              {cfg.reason && (
              <div>
                <label htmlFor="ref-reason" className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Reason for referral</label>
                <textarea id="ref-reason" value={reason} onChange={e => setReason(e.target.value)} rows={2}
                  className="mt-1 w-full rounded-lg border border-gray-200 p-2.5 text-[13px] text-gray-800" />
              </div>

              )}

              {/* ── WHAT TO DO. The point of a patient instruction sheet, so it leads. ────────── */}
              {cfg.instructions && (
                <div>
                  <label htmlFor="doc-instructions" className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                    What should the patient do?
                  </label>
                  <textarea id="doc-instructions" value={instructions} onChange={e => setInstructions(e.target.value)} rows={4}
                    placeholder="Rest for two days. Take the tablets after food."
                    className="mt-1 w-full rounded-lg border border-gray-200 p-2.5 text-[13px] text-gray-800" />
                </div>
              )}

              {/* ── WHAT GOES IN ────────────────────────────────────────────────────────────── */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Include from the record</p>
                {groups === null ? (
                  <p className="text-[12px] text-gray-400">Reading the record&hellip;</p>
                ) : (
                  <>
                    {current.map(g => groupBlock(g, `c-${g.category}`))}
                    {current.every(g => !g.facts.length && !g.unreadable) && (
                      <p className="text-[12px] text-gray-400">Nothing has been recorded at this consultation yet.</p>
                    )}

                    {/* SECTION 9. Earlier facts are offered, never pre-selected, and kept behind a
                        deliberate click so the default disclosure is this consultation only. */}
                    {earlierCount > 0 && (
                      <div className="mt-1 border-t border-gray-100 pt-1">
                        <button type="button" onClick={() => setShowEarlier(v => !v)}
                          className="min-h-[var(--cp-touch)] text-[12px] font-semibold text-[var(--cp-primary-deep)]">
                          {showEarlier ? "Hide earlier records" : `Also include from earlier (${earlierCount})`}
                        </button>
                        {showEarlier && earlier.map(g => groupBlock(g, `h-${g.category}`))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── WHAT IS BEING ASKED FOR ─────────────────────────────────────────────────── */}
              {cfg.requestedAction && (
              <div>
                <label htmlFor="ref-action" className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  What are you asking for? (optional)
                </label>
                <textarea id="ref-action" value={requestedAction} onChange={e => setRequestedAction(e.target.value)} rows={2}
                  placeholder="Assessment and management advice" className="mt-1 w-full rounded-lg border border-gray-200 p-2.5 text-[13px] text-gray-800" />
              </div>
              )}
            </div>
          )}
        </div>

        {error && <p role="alert" className="mt-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}

        <div className="mt-3 flex flex-col gap-1.5 border-t border-gray-100 pt-3">
          <p className="text-[11px] text-gray-500">
            {selectedCount === 0
              ? "No recorded facts will be included — it will carry only what you have typed."
              : `${selectedCount} recorded ${selectedCount === 1 ? "item" : "items"} will be included.`}
          </p>
          <button type="button" disabled={!ready} onClick={generate}
            className="min-h-[var(--cp-touch)] rounded-lg bg-[var(--cp-primary-deep)] px-3 text-[13px] font-bold text-white disabled:opacity-40">
            {busy ? cfg.working : cfg.submit}
          </button>
          <button type="button" onClick={props.onClose}
            className="min-h-[var(--cp-touch)] rounded-lg border border-gray-200 px-3 text-[13px] font-semibold text-gray-700">
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
