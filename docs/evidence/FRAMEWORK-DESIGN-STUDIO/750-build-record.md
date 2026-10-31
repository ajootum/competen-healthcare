# Migration 750: build record (Framework Design Studio, layout draft and section order)

- **Authority:** owner GO FRAMEWORK-DESIGN-STUDIO-01, 31 Oct 2026, implementation only (rulings 2, 3, 6 in `STATUS.md`).
- **Branch:** `hq/framework-design-studio-01`, from main `500df4d4`.
- **File:** `supabase/migrations/750-framework-design-layout.sql`, sha256 `1316e5a7114e060c3f65590b448a1c2f3bf2158eb142042bc5e387e5e20375c8` (the file staged, to be merged and applied).
- **Rollback (staging):** `ROLLBACK-750.sql`, sha256 `3d467a6b9f2f1642b112a7b311ed49f6584930edf13b947fd46388e42b73b58c`.
- **PRECHECK / VERIFY:** `PRECHECK-750-751.sql` (sha256 `5fe5312bdedfe7f912c593d310ddced4018a4964f942b875b9bf368b8611d78d`), `VERIFY-750-751.sql` (sha256 `06d66a99cfbe9ab125b6de9419a112599cd037dc9dc348bc219b9e82021569f3`). Both always roll back.
- **House rules:** ALL CLEAR (200 lines, 67 statements, 2 constraints, 3 warnings = the APPLY-WHOLE constructs).

## State

**State 2: applied and verified on staging. Production does NOT have it.** It needs a separate owner GO and is applied by the owner. Dependent code (slice B) must stay behind a server gate that defaults OFF and fails closed while 750 is absent.

## What it adds (additive)

| Column on `frameworks` | Type | Meaning |
|---|---|---|
| `layout_draft` | jsonb null | pending presentation order of a published framework (schema below) |
| `layout_draft_by` | uuid null, FK profiles on delete set null | who saved it |
| `layout_draft_at` | timestamptz null | set by the trigger |
| `component_order` | text[] null | section order for this framework. Null = registry order (660) |

- **Checks:** `frameworks_layout_draft_check` (null draft means by and at are null. A draft is an object of at most 512 KB, with `at` set). `frameworks_component_order_check` (1-100 codes, no null).
- **Trigger:** `frameworks_layout_guard` (BEFORE INSERT OR UPDATE OF layout_draft, layout_draft_by, component_order). It refuses:
  - a draft with no author;
  - a draft whose `v` is not 1, or with an unknown key;
  - a domain that is not this framework's own;
  - a competency listed under any domain but its own (a cross-domain move is clinical, ruling 2);
  - a criterion listed under any competency but its own;
  - a repeated id;
  - a `componentOrder` or `component_order` code that is repeated or not in the registry.
- Clearing the draft clears `by` and `at`.

### layout_draft schema (v1)

```json
{
  "v": 1,
  "domains": ["<domain uuid>", "..."],
  "competencies": { "<domain uuid>": ["<competency uuid of that domain>", "..."] },
  "criteria": { "<competency uuid>": ["<competency_skills uuid of that competency>", "..."] },
  "componentOrder": ["<competency_assessment_component.code>", "..."]
}
```

- Every key except `v` is optional, and a list may be partial.
- The applier appends ids not named, in their current order, and ignores ids deleted since. The DB checks ownership and repetition when the draft is written, not completeness.
- `componentOrder: null` or absent means the registry order.

## Order and dependencies

- Depends on 007, 384, 660 (`competency_assessment_component`) and 670 (`competency_skills.component_code`). All of them are in production.
- Independent of 751. The two ship together: **apply 750, then 751**.

## Staging (ezhvpgtcqcdsgylrxgdb), 31 Oct 2026, by the agent with the guarded runner

- **PRE:**
  - frameworks 22 (6 published shared), competencies 349 (13 with outcomes, 30 outcomes);
  - verification requests 2, evidence 1, decisions 1;
  - no 750 or 751 columns;
  - frameworks triggers: `trg_cfca_framework_publication_guard`, `trg_frameworks_sod_publication_guard`;
  - content fingerprint `9ee1991c...80b3`.
- **Run 1 and run 2:** both committed.
- **Post:** 4 columns, `frameworks_layout_guard` present, existing guard md5s unchanged, content fingerprint unchanged.
- **Rollback rehearsal:** `ROLLBACK-751` then `ROLLBACK-750`. The state matched PRE exactly (columns none, triggers and md5s as PRE).
- **Final:** re-applied (750 then 751), with the state identical to the post-apply state.
- **VERIFY:** 750 checks L1-L14 **14/14 ok**, run on the applied state and again on the final state.

| Check | Proved |
|---|---|
| L1 | a valid v1 draft is accepted and stamped |
| L2 | clearing the draft clears its author and time |
| L3 | a draft without an author is refused |
| L4 | a draft that is not an object is refused |
| L5 | an unknown key is refused |
| L6 | another framework's domain is refused |
| L7 | a competency under another domain of the same framework is refused |
| L8 | a criterion under another competency is refused |
| L9 | a repeated domain is refused |
| L10 | an unknown section is refused |
| L11 | a valid `component_order` is accepted |
| L12 | a repeated `component_order` code is refused |
| L13 | the 512 KB cap holds by CHECK alone, with the trigger paused inside the probe |
| L14 | the object CHECK holds by CHECK alone |

## Production

**Not applied.** Before applying it needs: an owner GO, a recovery reference, and a read-only pre-check showing no column `layout_draft` or `component_order` exists. After applying, check the verification block at the end of the file (`columns 4`, `checks 2`, `trigger 1`, `with_layout 0`).
