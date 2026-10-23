# COMPETEN-CONFIG-002: optional speciality field, design only

**Status:** design only. Not built, no migration authored, nothing applied.

Owner GO 2026-10-23: "Design an optional speciality field as a separate, bounded package." This document is that package's contract. Building it needs its own GO and its own migration number, allocated at the time (377 stays deferred for registration bodies).

## 1. What it is

One optional, self-declared, free-text **speciality** on the person's own Competen Professional profile, for example "Intensive care" or "Paediatric oncology". It is offered suggestions from the platform's existing `specialty` vocabulary (migration 013) exactly as profession is (#24), and it is never restricted to it.

**In scope:**
- one column;
- the profile form field with suggestions;
- the write path;
- the person's own Passport line;
- the Personal AI context;
- a harness and tests.

**Out of scope, each needing its own decision:**
- more than one speciality;
- a speciality code or link to `taxonomy_terms.id`;
- any verification;
- showing it to an organisation;
- using it to recommend frameworks or CPD;
- Scholar.

## 2. Schema: one additive migration, shape fixed here

```sql
-- MIGRATION <next free number>: OPTIONAL SELF-DECLARED SPECIALITY ON THE OWN PROFESSIONAL PROFILE
-- COMPETEN-CONFIG-002 speciality package. Additive. One nullable column and one length check on
-- individual_professional_profile (migration 373). No data change, no policy change.
alter table individual_professional_profile
  add column if not exists self_declared_speciality text;

alter table individual_professional_profile drop constraint if exists individual_professional_profile_speciality_length;
alter table individual_professional_profile add constraint individual_professional_profile_speciality_length
  check (char_length(coalesce(self_declared_speciality, '')) <= 120);

comment on column individual_professional_profile.self_declared_speciality is
  'Optional. Typed by the person, offered the specialty taxonomy as suggestions only. Not verified.';

notify pgrst, 'reload schema';
```

**Why this shape:**
- **Name.** The `self_declared_` prefix is the 270/373 rule: the column name states its provenance, so no reader can mistake it for a checked fact.
- **Nullable, no default.** Absent means "not recorded", never a blank that reads as a value.
- **Text, not a foreign key.** The GO requires free text. A `taxonomy_terms` FK would make an unlisted speciality unrepresentable, which is the opposite of the ruling.
- **A separate named check.** The 373 constraint `individual_professional_profile_lengths` is NOT edited (fix forward, never alter a committed migration's objects in place). 120 matches profession.
- **No RLS change.** The table's own-row SELECT policy already covers the new column, and it has no write policy, so browser sessions still write nothing.
- **House rules:** ASCII, no semicolons in comments, no `$$`, `notify pgrst` last.
- **Production risk tier:** proposed Low (additive nullable column).

## 3. Code (when built)

| File | Change |
|---|---|
| `src/lib/individual/professional/validate.ts` | `parseProfile` reads `b.speciality` with `text(..., 120)` and refuses over-length, the same as profession. |
| `src/lib/individual/professional/record.ts` | Add `self_declared_speciality` to `PROFILE_COLUMNS` and the type. `hasProfile` counts it. **Fail-soft:** while the column is absent, the profile read must not fail. The pattern is `loadReminderPrefs`'s separate query with a fallback (migration 374), so the page works before the migration is applied. |
| `src/lib/individual/professional/suggestions.ts` (#24) | Add `speciality: "specialty"` to `SUGGESTION_KINDS`. Staging already holds six terms. |
| `registration/page.tsx` | One optional `<input id="pr-spec" name="speciality" maxLength={120} list=…>` with a `<datalist>`, labelled "Speciality (optional)". It has no `pattern` and no `required`. |
| `passport-records.ts` | The registration line's `detail` gains the speciality after the body. It is still one line, still `self_declared`. |
| `src/lib/individual/professional/assistant.ts` | The self-declared profile sentence includes it. |

**Not changed:**
- `/verify` and share links show the Passport's own-record lines as today, so a shared link carries the speciality only inside the self-declared registration line the person already chose to share.
- No estate table, no organisation surface, no HQ read. D1 is unchanged.

**Owner decision before build (recommended answer first):**
- (a) **Recommended:** the speciality appears on the Passport registration line and therefore on a FULL share link, labelled self-declared.
- (b) Or it stays private to the profile and the AI.

## 4. Verification contract

**Static: `individual-professional-harness.ts`, group T,** each check with a planted red:
- **T2 (free text):** `pr-spec` is an `<input>` with no `pattern` and no `required`, never a `<select>`.
- **T3 (read-only vocabulary):** the speciality suggestions come from kind `specialty` through `loadSuggestions` only, with no write.
- **S3 (schema):** the migration adds exactly one nullable `self_declared_speciality text`, a separate 120-character check, no default, no FK, no policy. It does not touch `individual_professional_profile_lengths`.
- **W/R groups:** unchanged and still green. No estate write, no new reader outside the Professional tree.

**Unit:** `parseProfile` accepts empty, 120 characters and a non-vocabulary value, and refuses 121. `ownRecordsFrom` puts the speciality in `detail` and keeps `self_declared`.

**Staging acceptance (`individual-professional-acceptance-harness.ts`):**
- the column round-trips through the profile PUT;
- a value outside the vocabulary is stored verbatim;
- 121 characters is refused by both the route and the schema;
- an anonymous or other-person session cannot read it (own-row RLS);
- M1 (no estate rows) still holds.

**Migration lifecycle:** authored → applied twice on staging with pre and post fingerprints (`ind007-staging-schema-check.ts` gains the column in its fingerprint) → committed with its sha256 → main → production under its own GO.

## 5. Size

About 6 source files, 1 migration, about 6 harness checks with plants, 4 unit tests, and 3 acceptance checks. One PR.
