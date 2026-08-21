# CPR-HFE-REF-001 — practitioner-facing refusal inventory

The s14 deliverable: what was found, what was normalized, and what is honestly still open.

Re-run the survey at any time:

```bash
node scripts/practice-refusal-inventory.mjs /tmp/inventory.txt
```

The enforcing check is `scripts/practice-refusal-harness.ts` (44 assertions). The survey finds
**candidates**; the harness enforces the **rules**. They are deliberately different tools — a survey that
failed the build would have to be tuned until it stopped finding anything.

---

## What the defect actually was

Not the refusal pattern. Rendering an absence honestly, with its reason, is required by this product and
s11 forbids weakening it. The defect was **audience**: engineering prose written for whoever reviews the
comp, shown to a doctor.

Four representative examples, all live before this work:

| Where | What a practitioner read |
|---|---|
| Patients panel | *"Elements of the CPR-PAT-002 design and specification that this record cannot honestly support"* |
| Worklist tile | *"worklists() reads practice_queue_entry.status and folds IN_CONSULTATION into the single Waiting patients figure"* |
| Availability & Booking | *"Phase 6 — not built"*, *"s10.1's eight testable scenarios"* |
| Command Centre tooltip | *"count of practice_patient rows created within the period whose status is not 'merged' Source: practice_patient.created_at, practice_patient.status"* |

⚠ **Every one of those sentences was written by somebody being careful.** The prose is good. It is aimed
at the wrong reader. Nothing in the type system or the review habit caught it, which is why s12 asks for
a ratchet rather than a copy edit.

---

## Normalized

**The contract** — `src/lib/practice/refusal-presentation.ts`. s3's six states, s6's data contract. Every
refusal carries a practitioner half (`state`, `title`, `reason`, optional `nextAction`) and an `internal`
half (`reasonCode`, `specReference`, `source`, `technicalDetail`).

`practitionerView()` returns a **new** five-field object rather than passing the refusal through, so a
component cannot reach `internal` by a spread or a debug dump. The boundary is structural, not a
convention — conventions were already being followed by the people who shipped this.

**22 refusals** across four registries: the Patients screen (9), worklist cards (3), register columns (3),
and the patient-workspace engine (7). **All original prose preserved** under
`internal.technicalDetail` — s11 requires Product Director and Engineering to keep the provenance.

**Three screens** per s8: Patients, Setup / Availability & Booking, Documents. Documents was already
compliant and is now scanned so it stays that way.

**Thirteen metrics** gained a `basis` — what the figure counts, in a practitioner's words — with
`formula`/`sources` retained and marked engineering-only. Practice Intelligence's `Provenance` component
no longer *accepts* `sources`, let alone renders it.

---

## Still open, with counts

| Item | Size | State |
|---|---|---|
| Intelligence `formula` prose | 41 lines, 38 of them prose | **Done.** 45 substitutions, every one a renaming — no clause added, removed or weakened. Three PostgREST column lists remain and are query arguments, not prose. |
| Lib-layer triage | 129 flagged strings in modules a practice screen imports | **Open.** "Imported" is not "rendered". Most are metric formulas, refusal `technicalDetail` and engine internals — all of which s11 **requires** to keep technical language. Separating them is a read, not a regex. |
| Absence claims outside the four registries | not counted | **Open.** Every `NotBuilt` and "not available" sentence in Setup, Documents and the engines. See the rot section below. |
⚠ **The count of the intelligence work was wrong four times before it was right.** `grep -c "formula:"` said
57 (occurrences of a key, including references); two cleverer regexes said 16 and 5, each blind to a
different shape — positional arguments, template literals. A blunt line-based sweep was the only one that
was right. **When counting a pattern in prose, scan lines and filter; do not parse structure.**

⚠ **And the 129 is a survey figure, not a defect count.** Quoting it as "139 leaks" would be exactly the kind
of unmeasured claim this arc keeps finding.

---

## Two things the harness found about itself

Worth recording, because both are the class where a guard looks green and is dead.

**7a matched its own documentation.** The assertion banning `technicalDetail` from screens went red
against `WorklistTiles.tsx` — because the *comment* explaining that it must not render `technicalDetail`
contains the word. Fixed by stripping comments; `plane-boundary-harness.ts` walks an AST for the same
reason.

**And the stripper was wrong the first time.** Blanking comment lines before running the block regex
destroys the `{/*` that opens a multi-line JSX comment, orphaning every continuation line. `7-control`
caught it — without a control, a stripper that emptied the file would have turned every `7a` green.

**`TABLE_RE` was dead on arrival.** Written through a shell heredoc, it arrived as
`/\x08practice_[a-z_]+\x08/` — both word-boundary escapes became literal **backspace bytes**, invisible in
every normal view of the file. `9b` passed (nothing matched, so nothing leaked) and only `9b-control`
failed.

> A detector that cannot match is indistinguishable from a clean estate.

---

## Rules that now hold

- No practitioner-facing refusal renders a spec id, section number, build phase, function name or table.
- `NO_DATA_YET` is never used for a capability-absence reason code — "no data yet" tells somebody to
  expect data, which is a lie when no storage exists.
- `RESTRICTED` never explains the authorization mechanism.
- A next action appears only where a real route exists.
- No practitioner screen renders a metric's source columns.
- Internal provenance is retained on every refusal, and assertions 3c/3d prove it.

---

## The finding this arc did not go looking for: refusals rot

Normalizing the *presentation* meant reading every refusal closely, and reading them closely showed that
some were no longer **true**. Nine capability-absence claims were checked against the schema. **Four were
false or misleading, and every false one understated the product.**

| claim | what is actually there |
|---|---|
| `NO_TAG_STORAGE` — *"tags are not currently stored"* | `practice_patient.tags text[]` **with a GIN index** (migration 221) |
| `NO_FILE_STORAGE` — *"does not store images"* | `practice-attachments` bucket (migration 336); the document library has a camera capture |
| `SEARCH_SCOPE_LIMITED` — *"Search does not look inside diagnoses, treatments"* | CPR-350 global search queries **twelve** sources, including all of them |
| notifications — *"nothing sends a message to a patient"* | `messaging.ts` sends appointment confirmation and cancellation today |

Holding: orders, order-result linkage, relationship assertion, care setting, trajectory.

**Why it happens.** A refusal is written once, when the absence is real, and the product grows past it.
Nothing re-reads it — not the type system, not review, and **not this ratchet**, whose own header says it
cannot tell whether a `reason` is true.

⚠ **Two of the four were introduced or perpetuated by this very arc.** CPR-HFE-REF-001 s7's worked example
supplies `reason_code=NO_TAG_STORAGE` and *"Patient tags are not currently stored in Competen Practice"* —
written from the old refusal, which was already stale. Copying it in shipped the falsehood one layer
deeper, with a spec's authority behind it.

> A worked example in a spec illustrates the **format**. It is not a verified fact about the product.

⚠ **The reason code matters more than the sentence.** `NO_FILE_STORAGE` sends the next engineer to build
storage that already exists; `NO_TAG_STORAGE` sends them looking for a migration that already ran. Renamed
to `NO_PATIENT_PHOTO_FIELD` and `NO_TAG_UI`.

**How to check one:** name the table, column or bucket the refusal implies, then grep
`supabase/migrations/`. Three of the four took one command each.

**Not yet checked:** the absence claims outside these four registries — every `NotBuilt`, every "not
available" sentence in Setup, Documents and the engines. The nine checked were the ones this arc happened
to touch.
