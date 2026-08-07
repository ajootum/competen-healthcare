# CPR-OPT-001 — Competen Practice product optimisation backlog

**Written:** 2026-08-07
**Status:** PARKED. Deliberately not to be started now.
**Trigger to revisit:** the project owner says the current build is done.

> This is not a bug list and not a spec. It is a **product** review — what stands between Competen
> Practice as built and Competen Practice as something a working paediatrician uses every clinic day and
> pays for. Nothing here contradicts the frozen UI ([[cpr-ui-design-freeze]] / CPR-CORE-001); the frozen
> nine-item sidebar and context header survive all of it. See `CPR-OPT-001` §E on why most of the
> existing screens should simply be *hidden*, not rebuilt.

---

## 0. The product thesis this backlog serves

The pain, in the one sentence a doctor would nod at:

> **"You can't see what happened to the child you saw at the other hospital three months ago."**

The peripatetic specialist works Mon/Wed at Hospital A, Tue in their own rooms, Thu at Hospital B, Fri
in theatre at C. Each site has its own EMR or paper. None of them talk to each other and none of them
belong to the doctor. So the one view that is genuinely theirs — the longitudinal thread of their own
patients — is the one view nobody provides. The incumbent is a notebook, WhatsApp, Excel and memory.

**Beachhead specialty: paediatrics.** Longitudinal by nature (growth, milestones, immunisation), repeat
visits guaranteed so the follow-up loop closes on its own, an engaged parent who answers WhatsApp,
structured low-friction data that suits fast capture, and a dense referral network where word of mouth
works.

**The line that decides everything below:** if capture takes more than **~45 seconds per patient**, the
product fails, regardless of how good the pathways, follow-ups and portfolio are. Every clinical
personal-record product in history has died here.

---

## 1. Diagnosis as measured, 2026-08-07

| Finding | Where | Implication |
|---|---|---|
| `EncounterConsole.tsx` is **1,316 lines, 8 tabs, ~15 form state objects**, explicit Save per segment | `src/app/practice/(shell)/encounters/[encounterId]/` | A **documentation console**, not a capture surface. Realistic time-to-record: 3–8 min against a 45-second target. |
| **1 responsive utility class** in that entire file; **235+ hard `grid-cols-2/3/4/5`** across `/practice` with no breakpoint prefixes | all of `src/app/practice` | **Desktop-only.** The user of this product carries a phone between three hospitals. |
| No service worker, no `manifest.json`, no IndexedDB, no `navigator.onLine` | repo-wide | **No offline.** A note typed on a ward with no signal is lost. |
| `"sms adapter pending"`; no WhatsApp adapter at all; only Resend email + webhook deliver | `src/lib/notifications/dispatch.ts` | **The follow-up loop cannot close.** Email does not reach a Nairobi parent. |
| `RegistrationForm` requires name + DOB/age + contact + guardian-if-minor + custom fields | `(shell)/patients/RegistrationForm.tsx` | Clinically correct; too heavy for a walk-in mid-clinic. |
| `Dictation.tsx` is the browser's `SpeechRecognition`, dictating into a chosen segment | `src/components/practice/Dictation.tsx` | A typing substitute, not ambient capture. No iOS Safari. Streams patient audio to the browser vendor — a DPA/NDPA/POPIA problem, not only a quality one. The component's own comment already says so honestly. |
| `encounters/record/[patientId]` — 10 parallel history queries, facility-aware, honest about unreadable reads | `(shell)/encounters/record/[patientId]/` | **This is the good part.** The longitudinal record is genuinely built and is the differentiator. |

**Summary: the record is built. The capture, the phone and the loop are not.**

---

## A. Capture — existential

1. **A third screen: the 45-second encounter.** One screen, zero tabs. Patient → one box (typed or
   spoken) → 2–4 taps of structured fields → *Save & next*. Diagnoses, treatments, procedures,
   referrals, investigations and documents become **optional and deferrable**. `EncounterConsole` stops
   being the default path and becomes "complete this record", reached from a *needs completing* queue.

2. **Specialty-tuned quick fields, not universal ones.** Paediatric capture shows weight, height, temp,
   immunisation, milestone; cardiology shows something else. Drive the quick-capture field set from the
   active `practice_parameter_pack` / `practice_parameter_pack_item`. Config over an existing engine, not
   new architecture.

3. **Ambient voice, not dictation-into-a-box.** Record the consult (or a 20-second post-consult summary)
   → server transcribes → model returns a structured draft (S/O/A/P + diagnosis + follow-up interval) →
   practitioner reads and signs. `@anthropic-ai/sdk` is already a dependency and
   `/api/v1/practice/assistant` already exists. **Highest-value single build remaining in the product.**

4. **Retire browser `SpeechRecognition` for clinical use.** No iOS Safari, weak on African-accented
   English, medical vocabulary and code-switching (Swahili / Sheng / Pidgin), and it ships patient audio
   to a third party with no relationship to the practice. Replace with server-side transcription under
   our control. Keep the existing disclosure discipline.

5. **Photograph-as-input, first class.** Photograph the hospital's paper chart or EMR screen → attach to
   the encounter → optionally model-extract into the note. **Valuable even with zero extraction**: a
   5-second capture beats no capture. `practice_attachment` and `documents/classify` already exist.

6. **Retro-capture — "I saw 12 patients today."** Doctors will not open an app during a ward round.
   End-of-session batch entry: pick session → tap through names → one line each. **A thin record for 12
   patients beats a perfect record for 2.**

7. **A 3-field registration path.** Name + age + phone → saved. Guardian, national ID, hospital
   identifiers and custom fields become "complete later" prompts on the patient record. `mode="quick"`
   exists — push it much further and make it the default at an unscheduled encounter. **Keep the guardian
   rule, but enforce it before *signing*, not before *creating*.**

8. **One box that searches or creates.** Typing a name searches existing patients and offers "new"
   inline. The practitioner should never have to decide which screen to be on. `UniversalSearch.tsx`
   already exists — make it the front door of capture.

---

## B. Mobile and offline — also existential

9. **Mobile-first, properly.** Not a responsive pass over 44 desktop screens — design the six screens
   that matter for a phone held in one hand in a corridor. The 235 unbreakpointed `grid-cols-N` are the
   symptom: nothing was laid out for 390px.

10. **PWA with an offline write queue.** Service worker + IndexedDB + sync on reconnect. Ward
    connectivity is unreliable in every target market. The draft-autosave from migration 207 is the right
    foundation — extend it to survive an app kill and a dead network, not only a closed tab.

11. **Design for interruption.** Large tap targets, no hover-dependent UI, always resume exactly where
    the practitioner left off.

---

## C. Closing the loop — this *is* the product promise

12. **WhatsApp. It is the whole follow-up story and it is missing.** WhatsApp Business API (with Africa's
    Talking SMS fallback) wired to `practice_follow_up` + `practice_contact_log`. Without a channel that
    actually reaches an African patient, "see what happens to them over time" is aspirational.

13. **Inbound as well as outbound.** A parent replying *"he's fine, fever gone"* lands on the patient
    timeline as a contact-log entry. **The cheapest outcome data that exists, and data no hospital EMR
    has.**

14. **The overdue list becomes the home screen.** `home` and `today` are session-oriented — they answer
    "what is my clinic". The retention hook is the other question: **who is due, who did not come back,
    who I have not heard from.** That is the screen a practitioner opens on a Sunday.

---

## D. Cross-facility — the differentiator, currently underexpressed

15. **Show the facility, do not merely store it.** `practice_facility` / `practice_location` exist, but
    the timeline should *read* "Aga Khan · 12 Mar → Nairobi Hospital · 4 Jun". **That visual is the
    product demo.** Today it is a column, not a story.

16. **The session sets the location once.** One tap at the start of clinic — "I am at Hospital B today" —
    and every encounter inherits it. Never ask for a facility per patient.

17. **Surface cross-facility conflicts.** *"You started X at Hospital A; Hospital B has them on Y."* No
    EMR can produce this because none of them see both sites. It falls out of `practice_treatment` +
    facility, it is nearly free, and it is the strongest single marketing claim in the product.

---

## E. Scope discipline

18. **Hide most of the 44 screens.** Portfolio, reflection, pathways, intelligence, reports/analytics,
    delegation, library and procedures are all real work and none of them is what a first user needs.
    Ship **six**: Today, Capture, Patients, Patient record, Follow-ups, Settings. The rest behind "More"
    or a flag. A first-run doctor facing 44 screens churns before day three. **This is hiding, not
    deleting — the frozen sidebar stands.**

19. **No tabs in the default path.** Eight tabs signals "this will take a while." Tabs are right for the
    completion console and wrong for capture.

20. **Solve the empty-app problem.** Import from CSV or from a photograph of a patient list. The value is
    the timeline and a timeline needs history; day one with zero patients is day one with zero value.

---

## F. Trust — before the first real patient

21. **Export and delete must actually work.** The anonymisation claim exists only in the comp while 111
    cascade FKs say otherwise, and `practice_audit_event` is not append-only — see
    [[cpr-life-lifecycle]]. Once "your private record" is marketed, these become contractual promises.

22. **Controller / processor terms per market**, written and lawyer-reviewed, before the first paying
    doctor. The defensible position is practitioner-as-controller, Competen-as-processor — but it has to
    be written down. Kenya DPA 2019, Nigeria NDPA 2023, POPIA, GDPR.

23. **Turn `logAccess` into a feature.** Every patient view is already logged. Show the practitioner
    "here is everyone who has opened this record." A selling point, not a compliance chore.

24. **Have an answer ready for facility conflict.** Some hospitals will assert the record is theirs.
    Decide the position before an administrator asks it in front of the best customer.

---

## Suggested sequencing when this is picked up

| # | Work | Rough effort |
|---|---|---|
| 1 | 45-second capture screen + quick registration + search-or-create (A1, A2, A7, A8) | 2–3 weeks |
| 2 | Mobile-first pass over the six screens (B9, E18) | 2 weeks |
| 3 | Ambient voice → structured draft (A3, A4) | 2–3 weeks |
| 4 | WhatsApp in and out + overdue home screen (C12, C13, C14) | 2 weeks |
| 5 | PWA offline queue (B10) | 2 weeks |
| 6 | Facility story + conflict surfacing (D15, D16, D17) | 1 week |

**~12 weeks to something ten paediatricians could be given.** Every item is additive to engines that
already exist; almost nothing requires unwinding what is built.

---

## What this backlog is not

- Not a replacement for [[cpr-open-gaps]], which records correctness edges left open deliberately. That
  document is about whether the code is right; this one is about whether the product is used.
- Not permission to start. **Parked until the owner says the current build is done.**
- Not a UI redesign. CPR-CORE-001 / CPR-V5-002 froze the shell; §E is about which screens are *reachable*
  on first run, not what they look like.

## Next artefact, once this is unparked

The ten-doctor pilot protocol: who to recruit, what to instrument (capture time per patient is the
primary endpoint), what result counts as a pass. Not written yet — deliberately, because the protocol
should be written against the product as it will be, not as it is.
