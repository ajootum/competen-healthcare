# CPR-BUILD-001 — the v1.0 re-specification of Competen Practice

Thirty-seven developer specifications, CPR-000 to CPR-490, all dated 14–24 May 2025 and all marked
**v1.0**. This is not an increment on what was built. It is a different, larger product definition, and
the first job is to say so plainly rather than start typing.

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
| CPR-130 Clinical Documentation | **Built.** Template library (platform + workspace), append-only note versioning, sign-and-lock document object with a supersession chain, release register, browser dictation (migration 195, `documentation.ts`, 64 harness assertions). |
| CPR-450 Deployment & Tenant Lifecycle | **Partial.** Provisioning saga, entitlements, launch flags, operator console (migration 191). |
| CPR-140 Follow-up Management | **Built.** Obligation loop with overdue *derived* rather than stored, the practice's own calendar day, DB-enforced release when a booking dies, event trail (migration 196, `follow-ups.ts`, 47 harness assertions). |
| CPR-150 Procedure & Clinical Activity | **Built.** Catalogue with enforced laterality and consent, performed-procedure record, append-only later-learned outcomes, activity counts (migration 197, `procedures.ts`, 44 harness assertions). |
| CPR-300 Operations Home | **Built.** `/practice/home` rebuilt as a worklist: every figure is the length of a list you can open, ordered by cost of ignoring, capability-aware with named blind spots. No migration (`operations-home.ts`, `practice-time.ts`, 37 harness assertions). |
| CPR-340 Tasks, Reminders & Notifications | **Built.** Operational tasks with derived overdue and derived orphaning, reminders as a column rather than a second object, in-app notifications holding only non-derivable events. No delivery channel, deliberately (migration 198, `tasks.ts`, 44 harness assertions). |
| CPR-350 Search & Global Retrieval | **Built.** One box over ten domains; generated tsvector columns so the index cannot drift from the text; capability filter runs BEFORE the query; skipped domains named; no hidden counts (migration 199, `search.ts`, 43 harness assertions). |
| CPR-320 Communication & Document Management | **Built.** Internal threads with per-reader derived unread, a register of contact WITH patients (recorded never sent), and an incoming-document register whose review is a named clinical stamp (migration 200, `communication.ts`, 44 harness assertions). |
| CPR-310 Team & Delegated Access | **Built.** Invitation codes (bearer, single-use, expiry derived), membership lifecycle, time-bounded delegation, DB-guarded last owner. Fixed a shipped resolver bug that made every delegation invisible and ignored `effective_from` (migration 201, `team.ts`, 52 harness assertions). |
| CPR-370 Security, Privacy & Practitioner Control | **Built.** Read logging (the other half of the trail), de-identified access review, append-only enforcement, patient-record export (migration 202, `privacy.ts`, 36 harness assertions). |
| CPR-330 Reports | **Built.** Counts and denominators only — no rates, no benchmarks, no targets; aged backlog; CSV that states it is not anonymised. No migration (`reports.ts`, 30 harness assertions). |
| CPR-360 Configuration | **Built.** Wires up a configuration table that had existed since Phase 0 and was read by nothing; correctable timezone with write-time validation; locations; the hardcoded appointment length removed (migration 203, `configuration.ts`, 35 harness assertions). |
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

## 15. CPR-330 as built: this product computes no rates

`src/lib/practice/reports.ts`, `/practice/reports`, a CSV export, and
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
