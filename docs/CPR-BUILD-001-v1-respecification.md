# CPR-BUILD-001 — the v1.0 re-specification of Competen Practice

Thirty-seven developer specifications, CPR-000 to CPR-490, all dated 14–24 May 2025 and all marked
**v1.0**. This is not an increment on what was built. It is a different, larger product definition, and
the first job is to say so plainly rather than start typing.

## 0. ⚠️ READ THE SPECIFICATION AND ITS COMP BEFORE BUILDING

Every one of the thirty-seven v1.0 documents is a `.docx` in `~/Downloads`, and **each ships with a
`.png` design comp beside it**. Extract the text with:

```bash
unzip -p ~/Downloads/CPR-<n>_*.docx word/document.xml | sed -e 's/<[^>]*>/\n/g' | grep -v '^\s*$'
```

Open the `.png` beside it before writing any UI. The layout in the comp is the brief; only its *claims*
(invented figures, badges, unbuilt AI panels) are subject to the honesty rule below.

**§2 below is an index, not a brief.** Eleven modules were built in one session from those title lines
alone, without opening a single specification or comp. The result was plausible, coherent, harnessed —
and wrong in ways recorded in `CPR-AUDIT-001-spec-conformance.md`: two modules built to the wrong
subject entirely, two structurally different from their specification, and every UI diverging from a
design that existed the whole time.

A module built from its title will look finished. Read the document.

## 1. THE NUMBERING COLLIDES WITH WHAT IS ALREADY BUILT. Read this first.

The existing `/practice` section was built against **CPR-001 … CPR-020 "V2"/"V3"** — twenty *workspace*
documents. The new set uses **CPR-000 … CPR-490 v1.0**, where the same strings mean different things:

| Identifier | Means in the OLD set (built) | Means in the NEW set (specified) |
|---|---|---|
| `CPR-001` | Practice Command Centre (workspace) | *not used* — v1.0 starts at CPR-000, then 010/020/030/040 |
| `CPR-010` | *not used* | Workspace Experience & UI System |
| `CPR-020` | Navigation & Application Shell | Workflow & Orchestration Engine |
| `CPR-030` | *not used* | Enterprise Data Architecture |
| `CPR-110` | *not used* | Appointment & Scheduling Management |

**This is live in code today.** `src/lib/marketing/practice-content.ts` tags every capability area with
`workspaces: ["CPR-0xx"]`, and `scripts/practice-content-harness.ts` asserts coverage of
`SURFACES = CPR-001..020`. Adopting the new numbering without addressing that turns a real traceability
assertion into a meaningless one — it will keep printing PASS against a scheme nobody uses.

**Decision required before any code is written.** Either
(a) namespace the old references (`CPR-V2-001`) and re-key the harness to the v1.0 set, or
(b) keep the marketing traceability on the V2 documents, which still describe the public pages, and use
v1.0 identifiers only for application modules.

### SETTLED — (b), with (a)'s namespacing applied to make it safe

**The division of labour is (b)'s.** The public pages keep tracing to the V2 workspace documents, which
is what they were written from; application modules trace to the v1.0 set, which is what the product is
now built from. Nothing was re-derived, and no marketing claim changed.

**But (b) alone scopes the collision rather than removing it**, and "you can tell which scheme this is
from context" is the kind of rule that survives until the first reader who lacks the context. So the old
set is re-keyed to `CPR-V2-nnn` **everywhere in `src/` and `scripts/`** — 143 identifiers across 30 files,
in traceability arrays and in the comments that tell a developer which document a module implements.

**The rule, in one line: a bare three-digit `CPR-nnn` is always the v1.0 set; the V2 set always carries
the `CPR-V2-` prefix.** It lives in `src/lib/practice/spec-numbering.ts`, which also holds both registers:
the twenty-one V2 surfaces (ids only — the codebase disagrees with itself about two of the titles, and
inventing them here would be claiming an authority this file does not have) and all thirty-seven v1.0
specifications with their titles.

Three assertions in `scripts/practice-content-harness.ts` keep it true rather than merely written down:
no bare old-set id anywhere in the tree; every v1.0-shaped citation is one of the thirty-seven; and a
control proving the scan reads real files and finds real citations before either can pass.

Two things were learned doing it, both recorded in the code:

- **The re-key corrupted the register that defines the new scheme**, because that file spelled out
  `CPR-000/010/020` as literals and those are exactly the three colliding numbers. The v1.0 ids are now
  computed from their number, so a future tree-wide re-key cannot reach them.
- **The harness's `SURFACES` list was generated, not literal**, so the re-key moved every id in the tree
  and silently left that one behind — the harness would have kept printing PASS against a scheme that no
  longer existed anywhere else. It now reads the register. This is the exact failure this section warned
  about, arriving through the mechanism meant to fix it.

## 2. The 37, by domain

**Foundation (5)** — CPR-000 Enterprise Architecture · 010 Workspace Experience & UI · 020 Workflow &
Orchestration Engine · 030 Enterprise Data Architecture · 040 Practice Design System.

**Clinical Care (6)** — CPR-100 Patient Management · 110 Appointment & Scheduling · 120 Encounter
Management · 130 Clinical Documentation · 140 Follow-up Management · 150 Procedure & Clinical Activity.

**Practice Intelligence (8)** — CPR-200 Practice Intelligence · 210 AI Clinical Assistant · 220 Case
Memory · 230 Clinical Reflection · 240 Professional Portfolio · 250 Competency & CPD · 260 Knowledge
Management · 270 Analytics & Reporting.

**Practice Operations (8)** — CPR-300 Operations Home · 310 Team & Delegated Access · 320 Communication
& Document Management · 330 Reports, Documents & Correspondence · 340 Tasks, Reminders & Notifications ·
350 Search & Global Retrieval · 360 Configuration & Personalisation · 370 Security, Privacy &
Practitioner Control.

**Enterprise Services (10)** — CPR-400 Integration & Interoperability · 410 Mobile & Offline · 420 AI
Automation & Workflow Engine · 430 API & Developer Platform · 440 Billing, Subscription & Licensing ·
450 Deployment, Provisioning & Tenant Lifecycle · 460 Monitoring & Observability · 470 Business
Continuity & DR · 480 Enterprise Administration · 490 Roadmap & Release Governance.

## 3. What is already built, mapped to the new scheme

| v1.0 spec | Status today |
|---|---|
| CPR-040 Design System | **Built.** Indigo and the `--cp-*` token layer adopted across the Practice app; 83 hex literals tokenised. The spec prose won over its own swatch graphic, recorded in `globals.css` (`cpr040-design-system-harness.ts`, 9 assertions). |
| CPR-100 Patient Management | **Core built.** Registry, identity, duplicate doctrine, merge (migration 193, `patients.ts`, 20 harness assertions). Far short of the spec's 360° profile. |
| CPR-110 Scheduling | **Core built.** Diary, availability, queue, arrival (migration 192, `scheduling.ts`, 19 assertions). No multi-location or AI scheduling. |
| CPR-120 Encounter Management | **Core built.** Eight-state lifecycle, SOAP, diagnosis/problem split, DB-enforced signed immutability (migration 194, 41 assertions). No 8-step guided lifecycle UI. |
| CPR-130 Clinical Documentation | **Extended (§21).** Template library, append-only note versioning, sign-and-lock document object with a supersession chain, release register, browser dictation (migration 195, 64 assertions) — *plus* the requirements that had been designed against: autosave to drafts that write no version history, smart text, clinical calculators that carry their inputs into the note, and attachments in private storage (migration 207, `documentation-tools.ts`, 51 assertions). Clinical forms and offline drafts remain. |
| CPR-450 Deployment & Tenant Lifecycle | **Partial.** Provisioning saga, entitlements, launch flags, operator console (migration 191). |
| CPR-140 Follow-up Management | **Rebuilt (§20).** Obligation loop as before — overdue *derived* rather than stored, the practice's own calendar day, DB-enforced release when a booking dies, event trail (migration 196, 47 assertions) — *plus* the structure the spec describes: follow-up plans and templates, the patient-centric view with its tabs, adherence as a count, the fixed outcome taxonomy, and a derived recall queue in place of a reminder engine this product has no channel for (migration 206, `follow-up-plans.ts`, 44 assertions). |
| CPR-150 Procedure & Clinical Activity | **Completed (s23).** Procedure recording, custom catalogue, consent, outcomes, complications and laterality enforcement as before (migration 197, 44 assertions) -- plus the half the title names: clinical activity logging, procedure teams, instruments with implant traceability, procedure templates, attachments and a portfolio of counts (migration 209, `clinical-activity.ts`, 38 assertions). |
| CPR-300 Operations Home | **Built.** `/practice/home` rebuilt as a worklist: every figure is the length of a list you can open, ordered by cost of ignoring, capability-aware with named blind spots. No migration (`operations-home.ts`, `practice-time.ts`, 37 harness assertions). |
| CPR-340 Tasks, Reminders & Notifications | **Completed (s25).** Tasks, assignment, priorities, reminder dates, in-app notifications and derived orphaning as before (migration 198, 44 assertions) -- plus recurrence, task templates, escalation rules derived at read time, bulk close and the daily agenda (migration 211, `task-orchestration.ts`, 36 assertions). Notification preferences came with CPR-360. |
| CPR-350 Search & Global Retrieval | **Completed (s26).** Cross-domain, capability-scoped search as before (migration 199, 43 assertions) -- plus saved searches that store the QUERY and never the answers, private search history, date filters, the per-reader count strip and quick searches (migration 212, `saved-search.ts`, 30 assertions). Semantic AI search stays refused: CPR-210. |
| CPR-320 Communication & Document Management | **Completed (s24).** Internal threads, contact log and the incoming register as before (migration 200, 44 assertions) -- plus the shared document library with folders and a recycle bin, and the per-patient correspondence register composed from four existing stores (migration 210, `document-library.ts`, 38 assertions). Six of the gaps the audit listed had already been filled by CPR-130, CPR-310 and CPR-330. |
| CPR-310 Team & Delegated Access | **Rebuilt (s22).** Invitations, memberships, capability-level delegation and the audit trail as before (migration 201, 52 assertions) -- plus the model the spec describes: delegation by AREA materialising ordinary grants, role templates, an approval queue that is explicitly not a gate, and derived work queues (migration 208, `delegation.ts`, 48 assertions). |
| CPR-370 Security, Privacy & Practitioner Control | **Completed (s27).** The access log as before (migration 202, 36 assertions) -- plus the five capabilities never started: a device register whose revocation the shell ENFORCES, an idle limit, MFA as a practice policy checked at the shell, standing patient consent with derived expiry where withdrawal never deletes, and break-glass that is self-granted, reason-required, time-boxed and impossible to take quietly (migration 213, `security.ts`, 53 assertions). |
| CPR-330 Reports, Documents & Correspondence | **Rebuilt (§18).** Template designer with a merge body, merge-field resolver, generation, batch generation, practice letterhead, print/PDF view, schedule definitions, dashboard to the comp (migration 204, `document-generation.ts`, 52 harness assertions). The activity counting that was first built under this heading moved to `/practice/reports/analytics` as an early slice of CPR-270. |
| CPR-360 Configuration & Personalisation | **Rebuilt (§19).** Workspace configuration as before (migration 203, 35 assertions) *plus* the personalisation half that was missing: dark theme with a checked mapping scan, accent, size, density, reduce-visual-noise, dashboard layout, notification categories, specialty profile, keyboard shortcuts, personal-over-practice overrides with locking, import/export/reset (migration 205, `preferences.ts`, 48 assertions). |
| CPR-200–270, 400–440, 460–490 | **Not started.** |

**Sixteen of thirty-seven** now have a real implementation. **Every Practice Operations module (CPR-300 to 370) is now built.** The clinical spine (CPR-130/140/150) and the
operations home are complete rather than partial; the four marked "core built" remain subsets of what
their v1.0 documents ask for.

## 4. What the comps ask for that cannot be built as drawn

Recorded here because it recurs across the set and will otherwise be reinstated from the mockups:

- **Named real hospitals and invented testimonials** (already refused on the homepage — see
  `practice-content.ts`). Chris Hani Baragwanath, Kenyatta, UCH Ibadan, Muhimbili, Groote Schuur and
  Aga Khan are named as customers in the CPR-001 v3 comp; CPR-450's comp names client practices too.
- **Every dashboard number in every comp is invented** — 128 tenants, 2,348 encounters, 99.95% uptime,
  86.4 hrs saved. They are fine as *illustrations of a layout*; they must never render as data. Each
  module needs the same rule the existing pages use: real query or an honest empty state.
- **Compliance badges** — "HIPAA Compliant", "ISO 27001 Ready", "PCI DSS Compliant", "GDPR Compliant"
  appear across CPR-210/370/430/440/470. These are certifications, not design elements. None should
  render until someone can name the audit.
- **Pricing** appears again in CPR-440 at $0 / $5 / $15/user — a *fourth* set of numbers, after the
  homepage comps' $5/$10/$20 and $0/$7.99/$14.99. Still undecided; still omitted.

## 5. Proposed sequence

Nothing here is a week's work. A realistic order that keeps the product usable at every step:

1. ~~**Settle the numbering** (§1). One decision, then a mechanical re-key.~~ **Done** — see §1.
2. ~~**CPR-040 design system**~~ **Done.** Indigo and the `--cp-*` token layer are adopted across the
   Practice app; the swatch-versus-prose disagreement is recorded in `globals.css` and asserted in
   `scripts/cpr040-design-system-harness.ts`.
3. ~~**Finish the clinical spine**~~ **Done** — CPR-130 documentation, CPR-140 follow-ups and CPR-150
   procedures (all three below). The encounter the product already had is now complete: it can be
   documented, it can commit the practice to seeing someone again, and it can record what was done.
4. ~~**CPR-300 Operations Home**~~ **Done** (below). /practice/home is now a worklist rather than a dashboard.
5. ~~**CPR-340 tasks / 350 search / 320 documents**~~ **Done** — the operational spine is complete (all three below).
6. **Practice Intelligence (200–270)** — needs clinical volume to be worth anything, so it follows.
7. **Enterprise Services (400–490)** — infrastructure-heavy; several are platform concerns that already
   have partial answers elsewhere in Competen (monitoring, billing, tenant lifecycle).

## 6. CPR-130 as built, and the decisions inside it

Migration 195, `src/lib/practice/documentation.ts`, `scripts/practice-documentation-harness.ts`, and a
`/practice/documents` section in the shell.

**A document is not the encounter, and that is why it needs its own signature.** DM-001 s2 says the
encounter "is never replaced by a note document", so a clinical document here is a *derived, issuable*
artefact — a referral letter, a sick note, a summary. The thing that leaves the practice. An encounter
signature says "this is what I recorded"; a document signature says "this is what I issued, to someone,
who now holds a copy I cannot retrieve". The second is the stronger claim, and it is why amendment
produces a new linked version rather than an edit: the recipient's copy of version 1 still exists in the
world, so version 1 must still exist in the record for the amendment to be an amendment *of* anything.

**Three versioning models, deliberately different**, because the three objects fail differently. Note
segments get append-only snapshots — "what did the note say when I signed it" was unanswerable before
this, because migration 194 upserted the segment in place. Documents get a supersession chain. Templates
get a plain integer, because a template is configuration and nobody needs the third draft of a heading
list.

**Applying a template can never destroy clinical text.** Fill-empty is the default and the only mode the
UI offers; `replace` exists, has to be asked for by name, and still versions the old text first. The
harness asserts the non-destructive case *together with its control* — the same call that leaves a
written segment alone must be shown filling an empty one, or "it did not overwrite" is just "it did
nothing".

**Dictation is the browser's, and its disclosure is the honest part.** There is no transcription service
in this product, no audio is uploaded by us, and no audio is stored. But in Chrome — and most browsers
implementing the API — recognition is *not* on-device: the audio goes to the browser vendor's service.
Dictating a consultation therefore sends a recording of a clinician describing a patient to a third party
with no relationship to the practice. That is a fact about the browser we cannot change; what we can do
is refuse to let a practitioner find out afterwards. First use in a session shows it plainly and requires
an acknowledgement, and the acknowledgement is not remembered, because a permission remembered forever
stops being a decision. Each version records whether its text was typed or dictated — speech-assembled
text has a different error profile, and a reader of a clinical record is entitled to know which they are
looking at.

**What is deliberately absent.** No letterhead: a header carrying a practice's name, registration number
and address is data this product has not been given, and inventing one would put unverified details on a
clinical certificate. No delivery: the release register records that a copy left the practice, it does
not send anything. `practice_owner` gets `template.manage` and nothing else — migration 191 withholds
`patient.list` and `encounter.list` from the owner role because owning a practice is a business role, and
a business role does not read clinical documents.

## 7. CPR-140 as built, and the decision the whole module turns on

Migration 196, `src/lib/practice/follow-ups.ts`, `scripts/practice-followups-harness.ts`, and
`/practice/follow-ups`. CPR-BUILD-000 called Phases 0–4 "the smallest honest *product exists* milestone:
one practitioner can run a diary, register patients, record encounters and **close follow-ups**". This is
the fourth.

**Overdue is not a status.** The obvious design gives `status` an `OVERDUE` value and runs something
nightly to set it. That design fails backwards: if the job does not run — no cron, a suspended tenant, a
practice that does not open the app for a week — then nothing is overdue. The screen whose entire purpose
is to say *"these people are waiting on you"* goes quietest precisely when the practice has been least
attentive. So `status` holds only what a human decided, and overdue is derived from the due date at read
time. It cannot be stale and needs nothing to run. The harness asserts that no row can even hold an
overdue status, and pairs the derivation with a control — a future-dated obligation in the same query
that does not read as overdue, so "overdue" is provably a computation and not a flag set on everything.

**Missed is still a status, and it is a different thing.** Overdue is a fact about the calendar. Missed is
a judgement — "we tried, they did not come, we are no longer chasing this" — and a judgement belongs to
the person who made it, with their name and the time on it. It is also reversible, because a patient given
up on in March who walks in in June has not made the March judgement wrong; the obligation is simply live
again, and a record that could not say so would force a duplicate and lose the history.

**"Today" is the practice's today.** An obligation due on the 14th is overdue in Kampala at 00:00 EAT, not
at 03:00 EAT when UTC catches up. Three hours is a whole working morning of a board saying nothing is
late while things are late. Asserted against a fixed instant in three timezones, including one where UTC
and the practice are on different dates, and in both directions from UTC.

**A dead booking releases its obligation, and the database does it.** Cancelling or no-showing an
appointment puts the follow-up back on the board with the appointment id cleared. In a trigger rather than
the scheduling engine, because `SCHEDULED` pointing at a cancelled booking is the most dangerous state
this table can hold — *it looks handled* — and the rule must hold for every path that cancels an
appointment, including ones written later and including a console session. The harness proves it through
a raw update that bypasses the engine entirely.

**Closing requires saying what happened.** Completing needs a closing encounter or an outcome; marking
missed needs an outcome. A close with nothing attached records that somebody clicked, not that anybody was
seen. Closing from inside a consultation names that encounter as what settled it, which is why the action
exists in both places.

**The capability split is deliberate.** `practice_assistant` gets `followup.view`: they can work the
board and chase people all day, which is the actual labour of follow-up, and they already hold
`appointment.manage` to book the visit. `practitioner` gets `followup.manage`, because raising a clinical
obligation and deciding one has been met or missed are clinical judgements. An assistant can therefore
work the board without altering a single obligation.

## 8. CPR-150 as built, and why it is not the treatment table

Migration 197, `src/lib/practice/procedures.ts`, `scripts/practice-procedures-harness.ts`, and a
procedures panel in the consultation.

**Intention and act are different facts.** Migration 194 said of `practice_treatment`: *"a record of what
the practitioner DECIDED, not what a ward gave"*. `practice_procedure` holds what was actually done to a
person — the needle went in, the lesion came off, and there is now a wound that can become infected. A
treatment row saying "excision, planned" is not evidence anything happened; a procedure row is. They
link, and a plan never carried out simply leaves no procedure row. The harness asserts that planning one
creates no procedure record. This is written into the migration header because two tables that both
mention procedures look like duplication to anyone who did not read 194, and the cheap fix — merging them
— destroys the distinction.

**Two refusals are clinical safety rules, not validation.** *Laterality*: a catalogue entry marked `sided`
cannot be recorded without a side. Not a warning, not a default — a refusal, and `not_applicable` is
refused too, because it is exactly what somebody picks to get past a required field on a busy day.
Wrong-site is the canonical never-event. *Consent*: defaults to `not_recorded` and never to `obtained`,
because a column defaulting to true manufactures a legal claim about a conversation nobody can evidence.
Where the catalogue requires consent, `not_recorded` is refused — but `refused` passes, because a patient
declining is a real event the record should be able to state. Both refusals are paired with a procedure
needing neither flag, so a green "refused" cannot be `recordProcedure` being broken.

**An outcome is learned later, and that is why it is its own table.** The encounter that performed the
procedure is signed the same day; three weeks on the wound is infected. That fact can go into the signed
encounter (breaking the immutability guarantee 194 s6 exists to hold), nowhere (what most systems do), or
into an append-only row pointing at the encounter that *noticed* it. It is the third. The harness records
a complication weeks after the fact and asserts the signed encounter is still signed and unchanged.

**The label is written down, not joined.** Renaming or retiring a catalogue entry must not rewrite what a
past procedure says it was — a procedure performed in March would otherwise start describing itself in
the words of a September edit. Asserted, with a control proving the catalogue itself *does* show the new
name, so the check is not just reading a stale row.

**Activity counts, and stops there.** `procedureActivity` reports complications as a count and a
denominator, never as a rate: "2.4% complication rate" over forty-one procedures is a number that sounds
like a statistic and is not one. There are no targets, benchmarks or trends, because those need a
comparison this product has not been given. It does surface how many procedures have no consent recorded,
which is a fact about the record rather than a claim about the practice.

## 9. CPR-300 as built, and the bug it turned up

`src/lib/practice/operations-home.ts`, `src/lib/practice/practice-time.ts`, a rebuilt `/practice/home`, and
`scripts/practice-operations-harness.ts`. **No migration** -- everything it shows already existed, which
is the point: an operations home that needed its own tables would be one that was inventing something.

**Every figure on this page is the length of a list you can open.** Every comp for a screen like this is
a wall of large numbers, and s4 records that all of them are invented. Replacing them with REAL large
numbers would not fix it: a big true figure is still not something a practitioner can act on at 8am. So
the rule is stricter than "render real data only" -- a count with nothing behind it is a dashboard, a
count you can click into is a worklist, and if a number cannot be given a link it does not belong here.
The engine enforces it structurally: attention items carry a count, a link and real sample rows, and the
page has no other source of numbers.

**Ordered by what it costs to ignore**, stated once as data so the page cannot re-sort itself on
aesthetics. An overdue follow-up outranks an unsigned encounter outranks a draft letter -- the follow-up
is the only item whose cost falls on somebody outside the room.

**A zero is earned; a blind spot is named.** If the caller lacks `followup.view`, the follow-up tile is
ABSENT, not zero, and "follow-ups" appears in `blindSpots` so the page can say why it looks quiet.
"Nothing is owed" and "you cannot see what is owed" are different sentences, and a home page that
conflates them tells a locum their day is clear when it is not.

**The bug this turned up.** The old home computed "today" as `new Date().toISOString().slice(0, 10)` and
queried a UTC day window. For a Kampala practice that is right for twenty-one hours a day and wrong for
three -- and the three are the early morning, which is exactly when somebody opens the app to see what
the day holds. A 01:00 EAT appointment is 22:00Z the previous day and vanished from "today". Fixed in
`practice-time.ts`, which is now the single clock CPR-140 and CPR-300 share, with the offset read at
midday so a DST transition cannot sample the wrong side of itself.

**And a bug in the harness, worth recording.** The first version of the ordering assertions passed while
the engine was deliberately broken to sort by count -- every tile had a count of one, so the sort was
indistinguishable from the correct order. Fixed by making due-soon the LARGEST group and asserting it
still ranks below an unsigned encounter: size is not urgency, and the assertion now fails under both a
count sort and the engine's own build order. An assertion that cannot tell right from wrong is worse than
no assertion, because it is counted.

## 10. CPR-340 as built, and the three things it refused to build

Migration 198, `src/lib/practice/tasks.ts`, `/practice/tasks`, and
`scripts/practice-tasks-harness.ts`. All three decisions are the same decision: **do not build a second
one of something.**

**A task is not a follow-up.** CPR-140's follow-up is a clinical obligation to a patient -- it lives in
their record, and failing it is a clinical failure. A task is a piece of work assigned to a person:
chase the lab, order dressings, fill in the form. It may reference a patient; deleting every task would
lose no clinical fact. The cheap thing is to let tasks absorb follow-ups, since both have a due date and
a done button -- and the result is two systems each holding half the commitments with a patient in the
gap between them. The harness closes every task in the workspace and asserts the follow-up is still
open, with a control proving the tasks really did close.

**A reminder is not a third object.** "Remind me on the 14th to chase the lab" and "task: chase the lab,
due the 14th" are the same sentence. A separate table would be a task table with fewer columns and its
own board, and the two would drift. `remind_on` is a column; the reminder IS the task surfacing on that
date. A reminder dated after the deadline is refused, because one that arrives too late is not a
reminder.

**There is no sending.** Not email, not SMS, not WhatsApp, not to patients. Every comp for a screen like
this shows "Reminder sent to patient", and this product has no delivery channel -- the same position
CPR-130 took when it recorded that a document was issued without pretending to have issued it. There is
no channel column and no `sent_at`, because a nullable `sent_at` sitting unused is how a product ends up
claiming to have messaged somebody.

**Notifications hold only what cannot be derived.** CPR-300 established that derivable state is derived,
so nothing has to run for it to be true. A notification row saying "you have an overdue follow-up" would
be a second source of truth for something the home page already computes, and the two would disagree the
moment one was closed without the other being cleared. This table holds only "somebody assigned you a
task" and "somebody amended a document you wrote" -- facts not recoverable from the record afterwards.
In a solo practice it will be permanently empty, which is correct rather than broken.

**Two things are derived that a lesser version would have stored.** Overdue, as for follow-ups. And
*orphaned* -- a task assigned to somebody whose membership was later revoked. Computed at read time, so
the board says so the moment the access goes rather than when somebody remembers to run a sweep, and it
ranks above everything else operational on the home page: work nobody can see is work nobody is doing.

**The capability split changes here, deliberately.** Every clinical capability so far stopped at the
practitioner. Operational work is different -- chasing a lab and ordering dressings are the assistant's
job and the owner's business -- so all three roles get `task.view` and `task.manage`. The clinical
boundary is untouched: a task can reference a patient, and reading that patient still needs
`patient.view`.

## 11. CPR-350 as built: search is the easiest place to accidentally grant access

Migration 199, `src/lib/practice/search.ts`, `/practice/search`, and
`scripts/practice-search-harness.ts`. The migration is index-only -- generated tsvector columns and one
new capability; no plpgsql, so it survives any splitter.

**The capability filter runs BEFORE the query, not after it.** A domain the caller cannot see is never
queried -- not queried-then-filtered, not hidden behind a "3 more results" affordance. Filtering after
the fact is how a count leaks the existence of records somebody may not know about, and for a clinical
record that is the whole game: "2 results hidden" against a name is a disclosure on its own. `total`
counts only what was returned, and the harness asserts no withheld count exists anywhere in the result.
The deliberate break for this one -- moving the filter after the query, the classic search leak -- turned
five assertions red, one per capability.

**`search.use` is its own capability.** The results are things the caller could already open, but the
ABILITY is different: a role that can open a record it is handed a link to should not necessarily be able
to go fishing across every note in the practice for a name. `read_only_auditor` and `billing_reporting`
do not get it.

**Generated columns, not triggers**, extending migration 193's doctrine to clinical text: a search
vector maintained by a trigger somebody forgets on one code path produces a record that is silently
unfindable -- worse than one that cannot be searched at all, because it looks searched.

**No cross-domain relevance score.** Ranking a patient against a task against a SOAP segment needs
weights, and any weights chosen would be somebody's guess presented as an ordering. Results are grouped
by what they are; patients keep the identity ranking from 193 (identifier beats phone beats name), and
everything else is recency. Patients are searched through `patients.ts`, not re-indexed here -- two
answers to "find this person" is one too many.

**The input is sanitised to an allowlist** -- everything that is not a letter, digit or space is
discarded before `to_tsquery` sees it, terms are prefix-matched, capped at eight. Proven by disabling
the sanitiser: operators pass straight through and two assertions go red.

**Named limitation:** the index uses the English configuration, so notes in Luganda or Swahili match
exactly but not on variants. A multilingual configuration is a specification decision, not a string
swap; recorded rather than quietly accepted.

**Server-rendered from the query string.** Clinical search results are not held in client state --
keystroke-search fires a query for every prefix of what somebody types ("hiv" on the way to "hives"),
each one a real read in a real log. One search per intention, submit-triggered. Matches are not
highlighted, because highlighting clinical prose by string replacement is how markup ends up rendered
inside a note.

## 12. CPR-320 as built: what arrives, and what was said

Migration 200, `src/lib/practice/communication.ts`, `/practice/messages`, `/practice/inbox`, a contact
log on the patient record, and `scripts/practice-communication-harness.ts`.

**CPR-130 owns what LEAVES; this owns what ARRIVES.** An incoming lab result is not the practice's
authored artefact -- no signature, no supersession chain. Merging the two registers would hang
issued-document machinery on rows it cannot apply to.

**Communication with a patient is RECORDED, not PERFORMED.** CPR-340's no-sending rule stands: no email,
no SMS, no patient messaging. What a practice does have is a phone on the desk, and "three calls, no
answer" currently lives in nobody's record. The contact log is that register -- the same posture as
CPR-130's release register. The harness asserts it structurally: no `sent_at`, no delivery state
anywhere on the row, so nothing can ever claim to have messaged somebody.

**No file storage, named rather than faked.** The register records THAT a document arrived and WHERE IT
IS HELD ("paper file", "lab portal"). Upload is an infrastructure and retention decision -- scanning,
size limits, storage RLS, how long a clinical scan is kept -- and half-doing it produces a shadow record
system.

**The unreviewed result is the missed-result harm**, so REVIEWED is a clinical stamp with a name and a
time on it, `inbox.review` is practitioner-only, and RECEIVED cannot jump to ACTIONED -- the register
exists to answer "who looked at this". "Received and nobody has looked" is derived onto the operations
home and ranked directly after overdue follow-ups: both are harms to somebody outside the room, and the
result is the one the practice may not know it owes.

**Two bugs this turned up, both caught by the harness.**

*A table-name collision.* The first draft called the contact register `practice_patient_contact` --
which migration 193 already owns for a patient's phone numbers. `create table if not exists` skipped
silently and the index failed against the wrong table. **`if not exists` makes a collision quieter, not
safer.** Renamed to `practice_contact_log`, and the same collision then appeared as a shadowed variable
on the patient page.

*A clock race in the read cursor.* `markThreadRead` wrote `new Date()` while `last_message_at` came from
the database clock; with the database a second ahead, every author saw their own thread flagged unread
at them. The cursor now takes the thread's own `last_message_at`, so both sides of the comparison come
from one clock -- removing the race rather than shrinking it.

## 13. CPR-310 as built, and the bug it found in Phase 0

Migration 201, `src/lib/practice/team.ts`, `/practice/people`, `/practice/join`, and
`scripts/practice-team-harness.ts`. The module that makes everything since CPR-340 reachable by more
than one person — assistant capabilities, task hand-over and messaging all existed with no way to add
the colleague.

**Delegation needed no new table, and that is the finding.** `practice_role_assignment` has carried
`source`, `effective_from` and `effective_to` since migration 191. What it did not have was a resolver
that honoured them: `access.ts` read `.is("effective_to", null)`, so **a grant with an end date was
invisible even while live** — every delegation the schema was designed for would have granted nothing —
and **`effective_from` was ignored entirely**, making a grant dated to begin next Monday live the moment
it was written. The second is the security-relevant one. Fixed in the resolver and asserted from all
three directions, with a control proving open-ended role grants still resolve throughout.

**You cannot delegate a capability you do not hold.** Migration 191 gives the owner administration and
no clinical access; the owner also runs the team. Without this rule those combine into one-click
self-escalation. Building a real subject for the test was itself instructive: provisioning gives the
founding practitioner BOTH memberships, so in a solo practice the owner legitimately holds clinical
access and lending it is not escalation at all. The harness revokes the owner's practitioner membership
first, producing the shape the rule actually guards.

**An invitation code is a bearer credential**, because this product has no delivery of any kind and
inventing it for invitations alone would make every other honest statement about sending false. Shown
once, never listed back, single-use, revocable, and every bad code gets the *same* refusal so guessing
learns nothing. Expiry is derived, so an old code stops working with nothing having run.

**A workspace may never lose its last owner** — refused by the engine with a sentence, and by a trigger
for anything that bypasses it, including demotion rather than revocation.

**Two more bugs this turned up.** Suspending a membership closed only *open-ended* grants, so a lent
capability with a future end date survived suspension and was live again on reinstatement — the exact
thing the code claimed to prevent. And shipping the page at the `team` slug silently shadowed the
**public** marketing page of the same name: a static route beats `[area]` and nothing errors. The
content harness caught it; the authenticated route is now `/practice/people`, and navigation.ts lists
every public slug that must not be shadowed.

## 14. CPR-370 as built: the other half of the trail

Migration 202, `src/lib/practice/privacy.ts`, `/practice/privacy`, an access panel on the patient
record, a patient-record export, and `scripts/practice-privacy-harness.ts`.

**This product recorded everything that was written and nothing about who read, and that is backwards.**
`practice_audit_event` has captured every write since Phase 0. Nothing ever recorded a read — but for a
clinical record the harm is almost always a read: the staff member who opens a neighbour's file, an
ex-partner's, somebody in the news. "Who has opened this person's record" is the question a patient is
most entitled to ask, and this product could not answer it.

**What is logged, and what deliberately is not.** Opening a patient, a consultation or a document;
running a search; exporting. *Not* every page view — the home page and the diary are the practitioner's
own working surface, and logging them buries the reads that matter under the reads that do not.
Self-access is still logged: excluding it would make the log unable to answer the question at all.

**The reviewer of a privacy control must not be its easiest bypass.** An access log is a list of who your
patients are — every row names somebody who attends. So reviewing shows *names* only to a caller who
already holds `patient.view`; everybody else sees stable references and can still audit who looked and
how often. The harness asserts this over the *whole serialised response*, not one field, because a name
leaking through any other key is just as much a disclosure. Reviewing is itself logged.

**Logging never blocks a clinician, and the gap is never silent.** If the log write fails the page still
renders — a doctor staring at an error while a patient waits is the worse harm — but the failure lands in
the audit trail, so a hole in the trail is visible rather than assumed. Both halves are asserted.

**The log is append-only in the database**: update *and* delete both refused, because a log somebody can
prune reads as innocence.

**The bug that caused, and how it surfaced.** A `BEFORE DELETE` trigger fires on cascade deletes too.
The first version of the file carried a comment claiming the workspace cascade would still work — it did
not, and **a practice could not be deleted at all**. It surfaced the indirect way these things do:
harness cleanup silently stopped working and the next run found duplicate patients from the previous one.
The trigger now allows the delete when the parent workspace is already gone (a practice leaving entirely)
and refuses it while the workspace exists (somebody pruning). Asserted directly on a throwaway workspace
so it cannot regress into somebody else's confusing failure.

**Retention is named, not guessed.** Nothing deletes from the access log, because how long to keep a
clinical access log is a legal question with a different answer in every jurisdiction — inventing "two
years" in a migration would be a compliance claim nobody authorised. The privacy page states that gap
alongside the guarantees, each of which is a property of the code rather than a promise about intent.

## 15. CPR-270's first slice as built: this product computes no rates

> **Re-labelled after CPR-AUDIT-001.** This was written under the CPR-330 heading. Counting what a
> practice did is CPR-270 Analytics & Reporting's subject; CPR-330 is document generation and is now
> §18. The engine and its harness were kept unchanged — they are real and CPR-270 will want them. The
> page moved to `/practice/reports/analytics`. **The no-rates doctrine below is not affected by the
> re-labelling and is not up for revision.**

`src/lib/practice/reports.ts`, `/practice/reports/analytics`, a CSV export, and
`scripts/practice-reports-harness.ts`. **No migration** — every number is derived from tables that
already exist, which is the point: a reporting layer with its own tables is one keeping a second copy of
the truth.

**A report is the last place the comps' invented dashboards could still get in.** §4 lists what they
wanted — 2,348 encounters, 86.4 hours saved, 99.95% uptime. Replacing those with *real* percentages
would not fix them, because a percentage is where a small number goes to hide: "67% attendance" over
three appointments is a sentence that sounds like a measurement and is not one.

**So every figure is a count and its denominator**, in that form: "4 did not attend, of 37 booked". The
reader divides if they want to. CPR-150 took this position for complication counts; CPR-330 takes it for
everything, and the harness asserts it structurally over the whole serialised report — no field named
like a rate, no percentage-shaped value anywhere. Breaking it by adding a `dnaRate` turned both
assertions red.

**No benchmarks, no targets, no trends against expectation.** "Better than last month" needs a claim
about what last month should have been; "top quartile" needs practices this product has never seen. Both
are available to invent and neither is available to know. The caveats render *on the page*, because
somebody reading a number is deciding something with it.

**Diagnosis labels are counted as typed.** Nothing here forces a terminology, so "Malaria" and "malaria"
are two rows and the report says how many carry a code. Tidying them together would be inventing a
coding nobody performed.

**The backlog is aged, not merely counted** — an encounter unsigned for an hour and one unsigned for
three weeks are different problems, and one number treats them as the same. Asserted by back-dating a
real row and watching it change bucket.

**De-identification carries over from CPR-370.** A caller with `report.view` and no `patient.view` —
exactly what migration 191 gives the owner — gets the counts and no names anywhere in the response. And
running a report is a read of the whole practice, so it is logged.

**The CSV says it is not anonymised.** Aggregate is not the same as safe: a count of one in a small
practice identifies somebody to anyone who knows the practice, and a CSV travels further than the page
it came from, so the sentence travels with it.

## 16. CPR-360 as built: wiring up a table nobody read

Migration 203, `src/lib/practice/configuration.ts`, `/practice/settings`, and
`scripts/practice-configuration-harness.ts`.

**`practice_configuration` has existed since migration 191 and nothing has ever read it.** Provisioning
writes one row carrying the locale and never looks at it again; `date_format`, `default_encounter_mode`,
`identifier_policy` and `feature_flags` have sat at their defaults since Phase 0, honoured by nothing.
That is the same shape as the bug CPR-310 found in `practice_role_assignment`: a table designed
correctly and then not wired up, which is worse than an absent feature because it reads as a working one.
So the migration adds almost nothing — CPR-360 is mostly the work of making what exists real.

**Changing the timezone retroactively changes what "today" meant.** Every derived figure in this product
reads the practice clock *at read time* — CPR-140's overdue, CPR-300's day window, CPR-330's reporting
periods. Correcting the zone therefore changes what all of them would have said about dates already
recorded. That is still the right thing to allow, because a practice provisioned into the wrong zone has
had a wrong clock since day one with no way to fix it. But it must be loud: the confirmation names the
consequence, and the audit payload carries *both* values, because "the clock is Africa/Kampala" does not
explain why last month's report moved.

**And it must be validated at the point of write, because the read path cannot.** `practiceToday()`
falls back to UTC on an unknown zone rather than throwing — deliberately, so a bad value never takes a
page down. That fallback is silent by design, which makes write-time validation the *only* place a typo
is catchable at all: "Africa/Kampla" would otherwise move a whole practice to UTC and say nothing. The
harness demonstrates the silence before asserting the refusal.

**The hardcoded 20 is gone.** The default appointment length was a literal in two places in
`scheduling.ts`, so a practice whose consultations run half an hour had been fighting that number since
Phase 1. Proven by changing the setting and booking again.

**Locations exist in the product for the first time.** The table and `practice.locations.manage` have
both been there since 191 with no way to create one — the operations home has been counting a number
nobody could change. They are closed rather than deleted, because appointments point at them. The *last*
active location can be closed, unlike the last owner: a practice with no location is odd but workable,
whereas one with no owner cannot be administered at all.

**Two things deliberately not built.** No new trail table — configuration changes go to
`practice_audit_event`, which already carries actor, payload and correlation id; every module since
CPR-140 has added a trail and the reflex to add a fifth is the one this codebase keeps warning itself
about. And no personalisation, despite the module's title: nothing here has a per-user preference worth
storing, and inventing a preferences table so the module matches its own heading would be building a
feature to fill a word. The inert columns are *listed* on the settings page rather than rendered as
inputs, because a setting you can change that changes nothing is worse than one that is missing.

## 17. Standing rules that carry over

- Render real data only; an honest empty state beats a plausible number.
- Every module gets a harness, and the harness is proven able to fail before it is trusted.
- Migrations: plain idempotent statements, ASCII only, no do-blocks, RLS deny-by-default.
- A claim on a public page is a promise; a claim in a mockup is a drawing. Do not confuse them.

## 18. CPR-330 as rebuilt: an unresolved merge field is never blank

`src/lib/practice/document-generation.ts`, `/practice/reports`, `/practice/documents/[id]/print`,
migration 204, and `scripts/practice-generation-harness.ts` — 52 assertions, four of them proven able to
fail by deliberately breaking the rule each one guards.

**This is the module the first attempt got wrong.** It read the title "Reports" and built activity
counts. The specification is clinical reports, referral and consultation letters, discharge summaries,
medical certificates, a template designer with dynamic field merging, batch generation, practice
branding, scheduled reports, approval workflow, digital signatures, version control and archive. See
`CPR-AUDIT-001-spec-conformance.md`.

### The rule the whole module turns on

**An unresolved merge field renders as a visible marker. Never as blank.** A template reads
`Dear {{referral.addressee}},` and the field has no value; blanking it produces `Dear ,` — which a
practitioner skims past and signs. Leaving `[[referral.addressee]]` visible is impossible to miss and
impossible to sign by accident. The argument is harder for clinical facts: a certificate whose
`{{patient.date_of_birth}}` silently vanished is a certificate about nobody.

Generation therefore **refuses by default** when any field cannot be filled, and names them. Asking for
the draft anyway is a separate, deliberate act — so nobody generates forty certificates with a hole in
each and finds out at the signing. Two kinds of failure are distinguished because they are different
mistakes: an **unknown** field is an authoring error, an **empty** one is a data gap.

### No fourth document model

CPR-130 owns the issued document — signing, versioning, supersession, release register. CPR-320 added
the incoming register. A generation module with its own document table would give this product three
places a referral letter can live and no answer to which one is the record. So migration 204 **adds to**
what exists: templates gain `body_template`, configuration gains letterhead columns, and a run gains
`practice_document_batch`. A generated letter is an ordinary `practice_clinical_document` in DRAFT, and
CPR-130 finalises and signs it exactly as if it had been typed.

**Two shapes of template, decided by `kind`.** An encounter note fills five SOAP boxes and needs
sections; a letter is one flowing body and needs a merge body. Requiring both would make every referral
template carry five empty headings. An `encounter_note` template passed to the generator is refused
outright.

### The letterhead refusal, and why it could finally be resolved

CPR-130 refused to render a letterhead because *"a header carrying a practice's name, registration and
address is a document this product has not been given, and inventing one would put unverified details on
a clinical certificate."* That was correct then. CPR-360 built configuration, so the practice can now
supply those details itself. **The refusal was never about letterheads being wrong — it was about having
no source for the facts.** Every field is optional and an unsupplied field prints nothing, never a
placeholder: a practice that fills in none of it gets a document with no letterhead.

**The letterhead is not written into the body.** It is composed at print time from one definition.
Baking it in would freeze a copy of the practice's address inside every signed clinical record, so
correcting a registration number would leave a hundred documents quietly disagreeing with it — and the
print view would then have to guess whether a header was already there. A letterhead is stationery, not
clinical content.

### A batch reports what actually happened

One row per **run**, not per document; the documents point back at it. `generated` and `failed` are
recorded separately and the UI shows both, because "forty certificates were generated" when thirty-eight
were is the kind of claim somebody relies on without checking. The harness archives one patient of two
and asserts the stored row says 1 of 2.

### Built to the comp, including the two tiles that cannot be filled

The six-tile KPI strip, report categories, recently generated, quick create 3×3, template library,
scheduled reports and most-used templates are all the comp's layout. Applying CPR-AUDIT-001's decision:
**unavailable figures render in their designed position with an explicit empty state** rather than being
dropped — a gap looks like a bug, an empty state looks like a decision. "Time saved by AI" says CPR-210
is not built; the AI Report Assistant panel says the same rather than offering a button that does
nothing.

The comp's `↑23% vs last 7 days` became **"39 in the period before"** — a count against a count. The
previous period *is* recorded, so the comparison is real; it was the **percentage** that was refused,
under §15's doctrine.

### What is honestly not built

- **Scheduled reports fire nothing.** The definition is real and a Run now button against it is useful
  today; the firing needs a tenant-triggered scheduler, which is an infrastructure decision with its own
  specification. Every row carries `fires: false` **as a field, not a footnote** — a client cannot render
  it as an automation without discarding the field that says it is not one. A schedule that looks
  automatic and is not is worse than no schedule, because nobody checks.
- **Word export.** The print view is the PDF path — a browser's print-to-PDF, which avoids taking on a
  rendering library, a font licence and a second definition of what the document looks like. A draft
  prints watermarked DRAFT, because a printed draft that looks like a signed one is a document somebody
  hands over in good faith.
- **Sending.** Unchanged since CPR-320: this product has no email or messaging channel. A copy leaves the
  practice when somebody records that it did.
- **No signature image.** Signing records who and when; drawing a facsimile would assert something the
  record does not hold.

Printing is logged as an **export**, not a view — the taxonomy has no "print", and printing is the action
that produces a copy nobody can recall.

## 19. CPR-360 as rebuilt: a preference that changes nothing is worse than a missing one

`src/lib/practice/preferences.ts`, `preference-constants.ts`, `/practice/settings`, the shell's theme
layer in `globals.css`, migration 205, and `scripts/practice-personalisation-harness.ts` — 48
assertions, five proven able to fail.

**The commit message asserting that "nothing in this product has a per-user preference worth storing"
was written without opening a specification that is mostly per-user preferences.** The spec and comp are
roughly four-fifths personalisation. What was built was workspace configuration, which appears in the
comp as two fields inside one panel. The workspace configuration is kept in full — the timezone
correction and its write-time validation are load-bearing — and moved to where the comp puts it.

### Every switch has a consumer, and the harness proves it by wiring

The rule this module turns on, and the same one the settings page already followed when it *listed* the
inert columns rather than rendering them as inputs. Theme, accent, size and density reach the shell as
data attributes; the widget list reaches the operations home; the notification categories filter what
CPR-340 surfaces; the specialty reorders the template library; the shortcuts drive a real key handler.
The harness asserts each by *effect* — switch a category off and the notification disappears from the
list — so a preference wired to a column nobody reads would fail.

**Three of the comp's five notification categories control nothing**, because CPR-340 raises four event
types and they are all about tasks and documents. They render disabled, saying nothing raises them yet.
**A clinical alert may not be switched off at all** — a preference that silences the thing saying a
patient is deteriorating is a hazard with a toggle. The rule is written now so it is already true on the
day something raises one.

### A dark theme, without a token migration

The Practice pages were built on literal light utilities — about 650 sites across 17 pages.
Re-tokenising them is CPR-040's job. Instead the utilities that are *actually used* are remapped under
`[data-practice-theme="dark"]`, and **the brittleness is checked rather than latent**: a static scan
fails when a colour utility in the Practice tree has no dark mapping, so a new page reaching for an
unmapped colour is a red harness rather than a white card in a dark workspace. Two files are exempt with
stated reasons — the sidebar, which was never light, and the print view, which goes onto white paper.

**The scan was not enough, and this is the honest part.** It passed while the page canvas stayed light
behind dark cards: the shell root carries the theme attribute *and* its background utility on the same
element, and a descendant selector never matches the element it is written on. The scan asked whether a
rule existed, not whether it applied. Found by opening the page and measuring computed styles; there is
now a self-matching rule and an assertion for it.

Contrast was measured in the browser against actual backgrounds rather than asserted: 15.8:1 for
headings down to 5.2:1 for the most muted text, all above the 4.5:1 floor.

### Personal over practice, except where the practice has locked it

CPR-360 §5 made storable. `locked_preferences` on the configuration records which settings a practice
controls; NULL in a personal override means "follow the practice", so not-choosing is representable and a
personal row can never silently freeze a copy of a practice default. **A refused key is not a failed
save** — somebody who changes their theme and their locked consultation length in one form gets the
theme, and is told plainly which part the practice controls.

**Appearance is not lockable, and that is enforced rather than left to whoever writes the admin UI.** A
practice may standardise its clinical defaults; it may not decide that somebody who needs larger text
does not get it.

### Smaller decisions worth keeping

- **A saved layout is reconciled against the widgets that exist, on every read.** A widget added since
  somebody saved their layout appears rather than being invisible to everyone with a saved layout —
  which is how a new feature ships to nobody.
- **Not every widget may be hidden.** An empty dashboard cannot be undone from the dashboard.
- **Reordering is buttons, not drag-and-drop.** A list that can only be reordered by dragging cannot be
  reordered with a keyboard, which would make the accessibility panel the least accessible thing on it.
- **Shortcuts are two-key sequences with no modifiers** (`g` then `p`). The comp draws Ctrl+N and Ctrl+T,
  which are the browser's and cannot be taken. Nothing fires while somebody is typing — the first rule of
  a global key handler in a clinical product.
- **Not remappable**, deliberately: a remapped shortcut is invisible to everyone else, so "press g then
  p" stops being true across a practice.
- **"Text and interface size", not "font size".** This product's type is in arbitrary pixels, which do not
  respond to a root font size; the setting scales the content, and is labelled as what it does.
- **The page has no capability guard** — it guards the *practice* half, inside. The previous guard
  redirected everybody without `practice.settings.manage` away from their own accessibility settings.
- **An exported preferences file carries no identifiers**, so it cannot be imported into the wrong
  practice by accident, and import runs through the same validation as typing.

### What is honestly not built

- **Quiet hours.** They silence notifications *as they arrive*; nothing here pushes one — no email, no
  SMS, no device notification, and the list is read when you open it. There is nothing to silence.
- **The device register.** "Your active devices" needs a session register, which is CPR-370's.
  Cross-device sync itself is not a feature but a *consequence* — the preferences are stored against the
  person, so they are already the same everywhere, with no sync engine and nothing to conflict.
- **Auto-save interval.** The comp sets it to two minutes. There is no autosave to set an interval for;
  it is CPR-130's to build, and the setting arrives with it.
- **The AI configuration assistant**, which is CPR-210's.

## 20. CPR-140 as rebuilt: a plan is a grouping, not a new kind of obligation

`src/lib/practice/follow-up-plans.ts`, the patient panel on `/practice/patients/[id]`, the recall queue
on `/practice/follow-ups`, migration 206, and `scripts/practice-followup-plans-harness.ts` — 44
assertions, five proven able to fail.

**The specification is patient-centric and sequential; what was built was a workspace-wide board of
single obligations with free-text outcomes.** Everything on that board stays — derived-overdue, the
practice clock, the DB-enforced release on a dead booking, and closing requiring words are all sound and
none is contradicted by the spec. What was missing was the structure around them.

### The rule this module turns on

**A plan is a grouping, not a new kind of obligation.** Each step is an ordinary `practice_follow_up`
with everything that already implies: its own due date, its own booking, its own event trail, its own
release when a booking dies, and closing still requires saying what happened. A plan that owned its steps
would be a second place a clinical commitment can live, and the first question at any handover would be
which one is real. The harness proves it by reading the steps back through the **original** engine, which
knows nothing about plans.

Three consequences worth stating:

- **Offsets run from the plan's start, never from the previous step.** "Three months after the operation"
  is what a surgeon means. Chaining offsets makes every later date drift when one earlier step moves, so
  a patient who came back a fortnight late for their two-week review would silently have their
  three-month review pushed to three and a half.
- **Deleting a plan leaves its follow-ups standing** (`on delete set null`). Somebody tidying up a
  mis-created plan must not silently discharge four clinical commitments.
- **Discontinuing one cancels its open steps with the reason written onto each**, and leaves closed ones
  exactly as they were — what already happened is not rewritten by a later decision. A plan whose steps
  stayed OPEN would leave the board showing obligations nobody intends to keep, which is precisely how a
  follow-up board stops being trusted.

**A plan completes itself when its last step closes**, reconciled at the moment it becomes true rather
than in a nightly sweep — the stored-overdue mistake again, needing something to run in a practice where
nothing does.

### The outcome taxonomy, and what it does not replace

Fixed at improved / no change / worsened / referred / other, because the point of a taxonomy is
**counting**: "how did the last thirty post-op reviews turn out" is not answerable over free text. **The
words are still required alongside.** A code that replaced the sentence would turn *"much better,
discharged to the GP with a note about the rash"* into "improved", and the rash would leave the record. A
code on a non-completed follow-up is refused — a missed review has no clinical outcome. Existing closed
follow-ups keep a null code rather than being backfilled with a judgement nobody made.

**Adherence is a count and its denominator** — "6 of 7 completed", which is what the comp itself prints
beside its 86% ring. The denominator counts only follow-ups that have *concluded*, so nobody looks
non-adherent for an appointment that has not happened yet.

### The reminder engine, and what replaces it

The specification asks for reminders over SMS, email, app, voice and WhatsApp. **This product has no
delivery channel of any kind** — the position CPR-320 and CPR-340 were both built on. Nothing is sent and
nothing pretends to be; the recall API returns `remindersSent: false` as a field.

What replaces it is honest and, for a practitioner, most of the value: **the recall queue, derived at
read time**, grouped by the person to contact rather than the row to tick — three overdue follow-ups on
one patient is one phone call. Urgent first, then longest overdue. Archived patients drop out, because a
recall list is a list of calls to make. It needs nothing to run, so a practice that has not opened the
app for a fortnight sees the whole backlog the moment it does, rather than a log of messages that were
never sent.

### Smaller decisions

- **Templates are workspace-scoped only**, with no platform defaults: a review schedule is a clinical
  judgement about a procedure and a population, and shipping a default one would be this product making
  that judgement for practices it has never seen.
- **A retired template cannot start a new plan** — retiring one is how a practice says "we do not do it
  that way any more" — but retiring it does not touch the plans already made from it.
- **Two steps on the same day are refused.** Far more often a mistyped offset than an intention, and a
  plan that books a patient twice on one date is one somebody has to unpick by hand.
- **The patient panel's tabs are links, not JavaScript** — state in the URL, so a tab can be bookmarked
  or sent to a colleague, and one read backs all six so no two tabs can disagree.
- The steps are inserted directly rather than through `createFollowUp`, which would re-read the patient,
  re-validate the encounter and re-resolve the clock once per step. The checks are not skipped — they
  are done once, for the plan.

## 21. CPR-130 as extended: a draft is not a version

`src/lib/practice/documentation-tools.ts`, `clinical-calculators.ts`, the documentation-tools panel and
autosave on the consultation console, migration 207, and
`scripts/practice-documentation-tools-harness.ts` — 51 assertions, five proven able to fail.

**Autosave was explicitly designed against by somebody who had not read the requirement.** CPR-130 §3
lists it first among the functional requirements, and CPR-360's comp independently sets the interval at
two minutes. The comment in `EncounterConsole.tsx` arguing against it has been corrected in place rather
than deleted, because the argument it made was *right about a different question*.

### The resolution: two objects, two questions

- a **version** answers *"what did the record say at 10:55, and who wrote it"* — deliberate, immutable,
  append-only, part of the clinical record;
- a **draft** answers *"what was in the box when the browser closed"* — overwritten in place, private to
  its author, and not part of the record until somebody saves it.

So autosave writes to `practice_note_draft`, one row per author per segment. **Twenty autosaves write no
version history at all**, and the harness asserts exactly that — paired with the control that the
deliberate save writes precisely one. The version history stays as clean as it was, and an hour of work
survives a closed laptop.

Three consequences worth stating:

- **The draft is deleted the moment its text reaches a version**, enforced inside `saveNoteSegment`
  rather than left to whoever remembers to tidy up.
- **A draft is private to its author** — there is no parameter that would return somebody else's. Two
  clinicians typing into the same consultation do not overwrite each other, which is precisely the
  accident autosave would otherwise introduce at the moment somebody stepped away from a shared screen.
- **Recovery is offered, not applied**, and the on-screen label says *"draft kept 10:55 — not in the
  record yet"*. A practitioner who read an autosave indicator as a save would leave a consultation
  believing the record held something it does not.

### Clinical calculators: every result carries its inputs

Not a convenience — the safety property. *"eGFR 36"* in a record is unverifiable: a reader cannot tell
whether the creatinine was mg/dL or µmol/L, or whether the age was right. *"eGFR 36 mL/min/1.73m² (CKD-EPI
2021; creatinine 1.60 mg/dL, age 62, female)"* can be checked by anybody, six months later, including the
person who wrote it. Insertion is never the bare number.

- **No dosing calculators**, and that is a decision. An error there is directly a harm, and getting it
  right needs a drug database, a route, a renal adjustment and an indication — none of which exists here.
- **No interpretation.** BMI is a number; whether 31 means anything for this patient is a judgement about
  someone the product has not met, and a category printed beside it would read as advice.
- **Units are never guessed.** mg/dL and µmol/L differ by 88.4×, and inferring from magnitude would be
  wrong exactly at the boundary where it matters.
- Bounds are **plausibility**, not clinical: they catch a decimal point in the wrong place and nothing
  else. A bound that refused an unusual but real patient would be the calculator overruling the clinician.

**The harness caught a real failure of its own here, and it is recorded rather than quietly fixed:** the
first draft asserted two eGFR values that had never been computed, and they were wrong — the code was
right and the expectations were invented. The assertions are now anchored to published CKD-EPI 2021
reference points, which check the *equation* rather than re-running the implementation against itself.

**A second harness defect surfaced the same way:** `noteHistory` returns its `byType` map directly, and
the harness read `.byType` off it, got `undefined`, and counted zero versions — so *"twenty autosaves
write no version history"* was passing for the wrong reason and would have kept passing if autosave had
written a hundred. The control (exactly one version after a deliberate save) is what caught it.

### Smart text

A shortcut and the text it expands to, personal or practice-wide. **Expansion is a button, never
something that happens as you type**, and **a shortcut inside a word is left exactly as typed** — a rule
that rewrote arbitrary substrings of a clinical note would be the most alarming feature in this product.
**A personal shortcut shadows a shared one** of the same name: somebody who has written their own version
of the practice's normal-examination paragraph means to use theirs.

No merge fields, deliberately, though CPR-330 has a resolver — smart text expands into a box somebody is
looking at, so an unresolvable marker in mid-sentence would be worse there than in a generated letter.

### Attachments

The row is the record; the bytes live in a **private** bucket reached only through 60-second signed URLs.
A public URL on a clinical image is a permanent, unauthenticated link to a patient's body. Images and
PDFs only — the platform's asset repository allows archives, and a clinical attachment allowing a `.zip`
would be a place to put things nobody can read from the record they are filed against.

**Removal is a state, not a delete**: the bytes go, the row stays with who removed it and why. An
attachment filed against the wrong patient is exactly the case this exists for, and a record that simply
forgot it had held somebody else's photograph could not answer the question afterwards. No new capability
was minted — attaching to a consultation *is* writing to the clinical record.

### Still not built

**Clinical forms and checklists** (CPR-130 §2) and **offline draft support** (§3). The first is a form
builder with typed fields and structured answers — a module in itself, not a corner of this one. The
second is a service worker and a local store, which is CPR-410's subject. Both are named here rather than
left to be discovered missing.

## 22. CPR-310 as rebuilt: an area delegation is a grouping of ordinary grants

`src/lib/practice/delegation.ts`, `delegation-constants.ts`, the delegation console on
`/practice/people`, migration 208, and `scripts/practice-delegation-harness.ts` — 48 assertions, four
proven able to fail.

**The specification delegates by area; what was built delegates one capability at a time.** The comp
shows a personal assistant with "24 Areas" and a summary listing Scheduling & Appointments, Patient
Registration, Documentation & Letters, Communications, Billing & Payments, Reports & Data Entry. That is
what a practitioner actually decides: *"Mary handles my diary"*, not *"Mary holds appointment.manage,
practice.calendar.view and queue.manage until the 30th"*. The capability-level grant is correct and stays
— an area is the vocabulary above it.

### The rule it turns on

**An area delegation materialises ordinary capability grants.** `resolveWorkspaceContext` still reads
`practice_role_assignment` and nothing else; a `practice_delegation` row is the *grouping* that says why
those grants exist and lets them be withdrawn together. The harness proves it by reading the
capabilities back through the resolver, which knows nothing about areas. Same shape CPR-140's plans take
over follow-ups, for the same reason: two places a permission can live is two answers to "may this person
do that" and no tiebreak.

**Withdrawing ends exactly the grants it created**, by `delegation_id`. Ending them by capability would
revoke a colleague's *role default* because somebody else's temporary cover was withdrawn — and the
person who lost access would have no way to discover why.

**Nothing clinical is delegable, checked twice.** No area names a signing or clinical-authorship
capability, and `NEVER_DELEGABLE` states the same rule independently and refuses at grant time. A rule
stated once in a list is a convention; stated twice, with the second check refusing, it is a rule. The
harness breaks the first statement and watches the second catch it.

### Two bugs the harness found, both mine

- **A partial area was being granted.** The first draft gave whatever subset the delegator happened to
  hold. That is *worse* than refusing: "Documentation and letters" would have appeared against somebody's
  name on the team page while they held only `patient.list` and could not author a document. An area is
  now all of it or none, and the refusal names exactly what is missing.
- **The approval queue put urgent requests last.** `"routine"` sorts before `"urgent"` alphabetically, so
  the obvious `.order("urgency")` buried every urgent request at the bottom. It is now descending, and
  the harness fixture creates the urgent request *first* so a newest-first ordering cannot pass by
  coincidence — which an earlier version of that assertion did.

### An approval is a queue, not a gate

CPR-310 §5 already holds without any of this: only a practitioner can sign, and the signing engines
enforce it. An approval request records that a practitioner wanted to see something a delegate did, and
whether they have. **Unapproved work is not blocked** — the delegate could do it because they held the
capability. The API returns `blocksWork: false` as a field, and the harness shows a delegate authoring a
document that stays a DRAFT while its approval is pending. Anything implying otherwise would be worse
than not having approvals at all.

**Nobody approves their own work**, and a rejection without words is refused — the person who did the
work has to know what to change.

### Smaller decisions

- **Areas are fixed in code, not a table**, because an area *is* a mapping to capabilities and a
  practice-defined one would be an area whose capabilities nobody had defined. What a practice may define
  is a **role template** — a named bundle of areas — which is a table. The comp's PA / Secretary /
  Practice Manager / Receptionist are not this product's four roles, and hard-coding five more would be
  guessing at what any given practice means by "secretary".
- **Work queues are derived**, never stored: every one is a count of rows that already exist, so a
  practice that has not opened the app still sees the true backlog. Every queue leads somewhere.
- **The page lost its capability guard.** It used to redirect anybody without `practice.members.manage`,
  which put the approval queue out of reach of exactly the practitioners it exists for.
- Applying a role template **reports what it could not grant** rather than completing silently.

### Refused, and rendered as empty states in place

"Delegation Health 92% — Excellent" and its four sub-scores (Timely Completion 95%, Accuracy 93%,
Communication 90%, Approval Time 89%); "Time Saved 18.5 hrs"; "Accuracy Rate 93%". None has a formula and
none could — "accuracy" of a delegated action is not a quantity this product observes. The queue counts
are the real measure and are what the tiles carry. The AI Team Assistant is CPR-210's.

## 23. CPR-150 as completed: the module is called "Procedure AND Clinical Activity Management"

`src/lib/practice/clinical-activity.ts`, `/practice/activity`, migration 209, and
`scripts/practice-activity-harness.ts` — 38 assertions, four proven able to fail.

**Only the procedure half was built.** CPR-150 §2 lists "clinical activity logging" beside procedure
recording, and the comp gives it its own tab and its own panel: *"Log all clinical activities (not just
procedures) — ward rounds, consultations, training, etc."* That half was missing entirely, along with
procedure templates, team members, instruments, attachments and portfolio evidence. Everything that
existed — recording, the custom catalogue, consent, outcomes, complications, and the laterality
enforcement that is not even in the specification — stays.

### A clinical activity is not a procedure, and it is not a task

A procedure is done **to** a patient and lives in their record. An activity is something a clinician
**did** — a ward round, a teaching session, a mortality meeting — and most name no patient at all.
Recording a lecture as a procedure would put it in somebody's clinical record; recording it as a task
would say it was work *assigned* rather than work *done*. So `practice_clinical_activity` has **no
`patient_id`**, deliberately, and it gets its own page rather than being wedged into a consultation it
has nothing to do with.

**It belongs to whoever did it, not whoever typed it.** `performed_by` is separate from `created_by`, so
a consultant recording that a registrar led a ward round credits the registrar — otherwise the portfolio
built on top is wrong about who did the work.

**CPD minutes are separate from duration, and cannot exceed it.** A four-hour meeting is not four hours
of CPD, and a portfolio claiming six hours from a two-hour meeting discredits every entry beside it.

### Two rules that exist because of what goes wrong years later

- **An implant without its batch or serial number is refused.** It is the one field that has to be there
  when a batch is withdrawn, and the one nobody thinks to fill in at the time. **A template can never
  seed one**, because a template cannot know a batch number — which would otherwise smuggle an
  unidentifiable implant past the rule that refuses it.
- **Instruments are a child table, not a `jsonb` list**, because *"which procedures used the C-arm"* is a
  real question — for maintenance, for costing, and for the recall that follows a fault.

### Smaller decisions

- **A team entry must identify somebody**, but an agency scrub nurse with no account can still be named.
  A team list that only held account-holders would be quietly incomplete in exactly the theatres that
  matter — and a row that says somebody else was there without saying who is worse than an incomplete
  list, because it looks complete.
- **A seeded role names a place in the team, not a person.** It is a reminder to fill in who, not a claim
  that they were there.
- **A template seeds the team and the kit, never the findings** — writing what was found before anybody
  performed the operation is the mistake CPR-130's template library already refuses about starting text.
- **A portfolio is the person's own.** Nobody else may add to it or take from it; its whole worth is that
  it says what *they* did.
- `/practice/activity`, not `/practice/activities` or `/practice/procedures` — the public marketing
  section shares this URL space and a static route shadows it silently. `practice-content-harness.ts` is
  what catches a mistake there; it caught CPR-310 shipping at `/practice/team`.

### Refused

"Complication Rate 2.1%" and "Success Rate 97.9%" are rates. Over the forty-eight procedures the comp
imagines, 2.1% is arguably meaningful; over the three a new practice will have, "33%" is a sentence that
sounds like a measurement and is not one. The counts and their denominators render instead — "1 of 2".

"Portfolio Impact 31.1%" and the competency links beside it are absent, and **the payload says so**
(`competencyLinked: false`) rather than the UI merely omitting them. This product's practice tenancy does
not write into the platform's competency records — that is a cross-tenancy decision with its own
specification. AI-assisted documentation is CPR-210's.

### Still not built

Batch recording, barcode/QR readiness and offline drafts (CPR-410's subject).

## 24. CPR-320 as completed: most of it had already been built elsewhere

`src/lib/practice/document-library.ts`, `/practice/documents/library`, the correspondence panel on the
patient record, migration 210, and `scripts/practice-library-harness.ts` — 38 assertions, four proven
able to fail.

**The honest first move was to check what still needed building.** CPR-AUDIT-001 listed nine gaps here,
and six had since been filled by later modules:

| Listed as missing | Where it actually got built |
|---|---|
| Templates library | CPR-330 — `practice_note_template` with merge bodies |
| PDF generation | CPR-330 — the print view |
| Document storage and files | CPR-130 — `practice_attachment`, private bucket, signed URLs |
| Electronic signatures | CPR-130 — sign-and-lock with a supersession chain |
| Signatures/approvals queue | CPR-310 — `practice_approval_request` |
| Version control | CPR-130 — append-only versions, document supersession |

Building those again would have been the mistake, not the fix. **What was genuinely missing** is a place
to put a document that belongs to the *practice* rather than to a patient — a clinic protocol, a blank
consent form, a referral pathway. There was nowhere for those, and a practice with nowhere to put its
protocol keeps it in somebody's email.

### The rule it turns on

**A clinical document never enters the recycle bin.** CPR-130's clinical document is marked
ENTERED_IN_ERROR and kept forever, because a clinical record is not deletable — and a "restore" on one
would imply it had been *gone*, which is a claim about the record that is not true. The recycle bin is
for the library, where deleting really is deleting.

The refusal **says which it is**, rather than returning a bare not-found that would send somebody hunting
for a bug that isn't there. Two different objects, two different rules, and the engine will not confuse
them.

Three consequences:

- **Purging goes through the bin.** A one-click permanent delete is how a practice loses its only copy of
  a consent form at half past six on a Friday.
- **A purged document cannot be restored** — a row pointing at bytes that are gone is a document that
  will not open, which is worse than refusing. **The row survives the purge**, so the trail is not erased
  with the bytes.
- **Deleting a folder does not delete its documents.** Tidying is not deleting; they fall back to
  unfiled, and the response says how many did.

### The correspondence register is composed, not stored

Everything it shows already exists: documents issued and copies released (CPR-130), documents received
(CPR-320's incoming register), calls recorded (the contact log). A `correspondence` table would be a
fourth copy of facts three tables already hold, and it would drift the first time somebody wrote to one
and not the other. So it is one timeline built at read time — and `sentByThisProduct: false` travels in
the payload, because this product still has no email, SMS or patient-messaging channel and a client must
not be able to render the register as a delivery history.

### Refused

**"Storage Used 2.4 GB of 10 GB (24%)" is a quota, and there is no quota.** The bytes are real and are
shown; the denominator and the bar are not, and `quotaBytes: null` says so in the payload. A progress bar
against a limit nobody set is a warning that will never fire and a reassurance that means nothing. The
comp's "↑20% vs last 30 days" trends are percentages, refused as everywhere else. The AI Document
Assistant is CPR-210's.

### Still not built

Rich-text editing beyond the plain bodies CPR-130 and CPR-330 use, and controlled *external* sharing —
which needs a channel to share over, and there still isn't one.

## 25. CPR-340 as completed: escalation is derived, not fired

`src/lib/practice/task-orchestration.ts`, the agenda and escalation panels on `/practice/tasks`,
migration 211, and `scripts/practice-task-orchestration-harness.ts` — 36 assertions, four proven able to
fail.

**One of the five gaps had already closed elsewhere:** notification preferences arrived with CPR-360
(migration 205), wired into `listNotifications` including the rule that a clinical alert may not be
silenced. What remained was recurring tasks, task templates, escalation rules and the daily agenda.

### Escalation is derived, not fired

The specification says overdue high-priority tasks **trigger** escalation. A trigger needs something to
run, and this product's whole position on overdue — argued at length in migration 196 — is that the thing
which needs to run is exactly what a neglected practice does not do. So a **rule** records what counts as
escalated, and the board computes which tasks have breached it **at read time**.

The information is identical and available the moment somebody looks, with nothing to fail silently
overnight. **There is no `escalated` column and no job** — the harness asserts the absence of the column,
and asserts that changing the rule changes the answer on the next read with nothing re-run. What is lost
is the push, and this product has no push.

### A recurring task does not pre-generate

The next occurrence is created when the current one **closes** — the same pattern CPR-140's plans use. A
board holding fifty-two weekly copies of "check the fridge temperature" is a board nobody reads, and
fifty-one of them are commitments nobody has made yet.

- **Counted from the due date, not from today.** A weekly check done three days late is still due on the
  same weekday next week; counting from completion would let a series drift a day at a time until the
  Monday chore happens on a Thursday.
- **A cancelled task does not breed.** Cancelling is how somebody says this should not have been here;
  producing the next one would be arguing with them.
- **A task with no due date cannot recur** — there is nothing to count from.

### Smaller decisions

- **A template makes several tasks, not one.** "New patient onboarding" is four things; a template
  producing a single task called "onboarding" would be a checklist collapsed into a word. Offsets run
  **from the start**, never chained — CPR-140's rule again.
- **Bulk only closes.** Anything that needs a reason — blocking, which requires words — is refused in
  bulk and done one at a time. A bulk path with its own rules is a second door into the same room. Both
  numbers are reported: "8 completed" out of 10 selected is a claim somebody relies on unchecked.
- **The agenda is composed, not stored.** Appointments, tasks due, reminders and follow-ups read for one
  day, in the practice's timezone. An agenda table would be a fifth copy that goes stale the moment an
  appointment moves. A task *reminded* today but due later is counted as a reminder, not as due.

### Refused

"Focus Score (AI) 87% — Excellent" has no formula and no AI behind it. The task donut's "6 (27%)"
percentages divide by a total that is itself a choice about what to include; the counts render instead.
"↑18% vs yesterday" needs a baseline nothing recorded. The AI Prioritised Worklist is CPR-210's.

### A gap the harness found

`listTasks` did not select the recurrence columns, so the board could not have shown that a task repeats.
Caught by the assertion that the next occurrence carries the recurrence forward.

## 26. CPR-350 as completed: a saved search is a query, not a snapshot

`src/lib/practice/saved-search.ts`, the filters and sidebar on `/practice/search`, migration 212, and
`scripts/practice-saved-search-harness.ts` — 30 assertions, four proven able to fail.

**The last of the eleven audited modules.** What was missing: saved searches, recent searches,
quick-search chips, advanced filters and the per-module result-count strip.

### The rule it turns on, which is a security rule first

**A saved search is a query, not a snapshot of results.** The comp prints counts beside saved searches —
"High risk follow-ups 12". A *stored* 12 would have been computed for whoever saved the search, and every
later reader would see a count of records they may have no right to open. On a **shared** saved search it
would be a side channel: *"there are 15 pending referrals"* is information about the practice that a
delegate with no referral access has just been told.

So nothing stored holds a result, a count, or an identifier of anything found — asserted structurally
over the row itself. Running a saved search goes through `searchPractice` **with the caller's
capabilities**, the same gate every other search passes, evaluated fresh every time.

**That is what makes sharing safe**, and it is the harness's load-bearing assertion: a colleague without
`patient.list` opens the owner's shared saved search and gets no patients, while the owner does — and the
count strip differs between them, because it is computed for the reader.

**No count is shown beside a saved search anywhere in the UI**, and the API says why in the payload
rather than leaving it to be noticed.

### Search history is private

CPR-370's access log already answers *"who read this patient"*. This is a different object with a
different purpose — a convenience for the person typing. A colleague being able to read it would turn a
search box into a surveillance tool, and the queries people type are often a patient's name. There is no
parameter that would return somebody else's, history is de-duplicated by query, and the stored count is
labelled as **what was seen then**, never re-shown as a current one.

**The audit trail records the saved search's name, never its query** — for the same reason, since the
workspace trail is readable by anybody holding `access.review`.

### Smaller decisions

- **A filter this build does not understand is dropped, not obeyed.** A saved search written by a later
  version could otherwise narrow a search in a way the reader cannot see, and a search that silently
  hides results is worse than one returning too many.
- **Quick searches are links to the surfaces that already answer them**, not text queries.
  "Follow-ups overdue" is not a phrase to match against a record — it is a question the follow-up board
  answers exactly, with the overdue derivation and ordering it already has. Capability-filtered, so a
  chip never leads somewhere the reader is redirected away from.
- **The date filter is applied to the hits**, not pushed into every domain query: the domains carry
  different date columns and some carry none, and a filter silently ignored by half of them would be
  worse than one applied consistently after the fact.
- **A shared search is still somebody's** — readable, not editable, not deletable.

### Refused

Semantic AI search, natural-language queries and intent detection are CPR-210's, which is not built. The
comp's "AI Search Assistant" panel is not rendered as a working control.

## 27. CPR-370 as completed: nothing here may overstate what it does

`src/lib/practice/security.ts`, two new shell guards, `/practice/privacy/security`, migration 213, and
`scripts/practice-security-harness.ts` — 53 assertions, four proven able to fail.

**The last of the eleven, and the only one that was not a correction.** CPR-370's access log was built
with migration 202; these five capabilities — MFA policy, session management, device management, consent
management and break-glass — had never been started.

Every one of them is a security feature, so the rule for the whole module is that **nothing may overstate
what it does**. A control that claims more than it enforces is worse than an absent one, because
somebody stops worrying on the strength of it.

### "Sign out this device" is the one control here that could lie

Revoking a session row **does not** end the platform auth token — nothing in this product can. What it
does is real and enforced: `resolvePracticeShell` checks the register on **every request**, so a revoked
device is refused by the practice on its very next page load. The harness proves it by revoking and then
calling the same function the shell calls.

The distinction is in the column comment, the engine, the API payload
(`revocationEndsPlatformSession: false`), and beside the button on the page. A revocation that were
cosmetic is the single most dangerous thing this module could have shipped: somebody would press it after
losing a laptop and stop worrying.

`touchSession` never throws and returns *allowed* on any internal error, deliberately — a bookkeeping
failure must not lock a clinician out of a clinical record.

**A device is a cookie, and it says so.** Not a fingerprint: fingerprinting identifies a person across
contexts they did not consent to, while a cookie identifies a browser that chose to sign in here.
Clearing it honestly produces a new device.

### Break-glass is self-granted, and that is the point

CPR-310 forbids granting yourself a capability. **This is the one place in the product where the opposite
is right**, because the situation it exists for — the unconscious patient whose clinician is off duty —
is precisely the one where nobody is available to approve it.

What makes it safe is not approval but the other three properties, and it is worthless without all four:

- **A reason**, at least ten characters, enforced in the database too. *"emergency"* is not a reason; a
  reason is a sentence somebody can be asked about afterwards.
- **An expiry.** The grants carry it, so nothing has to run to end them — the resolver simply stops
  returning them.
- **Loud, three ways**: an audit event, an access-log entry, and a standing item that **never ages out**.
  A control that quietly stops showing things is not one.
- **Read capabilities only.** An emergency is a reason to *see* a record, not to sign one — a clinician
  who needs to write can start their own encounter, which is an ordinary act with their own name on it.

**Nobody reviews their own emergency access**, and **ending is not reviewing**: an ended episode is still
awaiting review, because the control is that a second person looked.

### Consent, and what it is not

Standing patient consent — to hold a record, to share with a named party, to be contacted, to be
photographed. **This is not CPR-150's procedure consent**, which records one operation at one moment;
merging them would make *"did they consent"* a question with two answers.

**Withdrawal is never a delete.** A withdrawn consent is the most important row in the table — it is the
one saying a practice may no longer do something it previously could, and erasing it would erase the
instruction along with the permission. Expiry is **derived**: no column, no job.

### MFA is a policy here and enforcement elsewhere

This product does not issue tokens, so it cannot enrol anybody in a second factor. What it can do — and
does — is **refuse to open the practice** when the policy demands one and the session does not carry it.
Off by default, because a migration must never lock a practice out of itself, and it routes to enrolment
rather than a dead end.

### Refused

**"Security Score 94% — Excellent, ↑12% vs last 30 days"** has no formula and could not have one:
security is not a quantity, and a score that moves without anybody being able to say why invites people
to chase it. **"MFA Coverage 100%"**, **"Audit Readiness 92%"** — percentages. **"HIPAA Compliant",
"GDPR Compliant", "Local Data Protection Act Compliant"** — certifications about an organisation, not
properties of code; the same position CPR-370 took the first time. **"Encryption AES-256"** and **"Data
Residency Kenya (EU)"** describe a deployment this application does not inspect.

In their place the page carries two panels: the **guarantees**, each a property of the code and each
asserted by a test made to fail on purpose, and — the one the comp has no room for — **what this page
cannot tell you**. A practitioner deciding whether to trust a system with patient records is better
served by an honest list of unknowns than by four green ticks.
