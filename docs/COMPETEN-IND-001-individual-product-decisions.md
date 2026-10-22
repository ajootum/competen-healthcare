# COMPETEN-IND-001 — Competen Individual: product decisions of record

**Status:** Decision record. Records decisions the owner has made; it is not a build specification.
**Adopted:** Option B, by the owner. Recorded 2026-10-22 from the COMPETEN-WEB-IND-001 brief and its review GO,
which are the sources cited below.
**Implemented so far:** the public website only — see `COMPETEN-WEB-IND-001-website-redesign.md`.
**Not authorised by this record:** any signed-in Individual capability. That is COMPETEN-IND-002's discovery
and needs a separate owner GO.

## 1. Decisions

| # | Decision | Source |
|---|---|---|
| D1 | **Competen Individual stays one of the four top-level products** (Enterprise, Individual, Practice, Recruitment). | WEB-IND-001 brief s1 |
| D2 | **Individual is presented through two independently branded experiences:** **Competen Scholar** (AI-powered healthcare education, revision, clinical reasoning, academic development) and **Competen Professional** (personal professional operating system: lifelong learning, CPD, competencies, credentials, professional evidence, career progression). | WEB-IND-001 brief s2 |
| D3 | **The two are experiences of Individual, not new products.** They are named and navigated separately but are not a fifth and sixth product in the catalogue. | WEB-IND-001 brief s1–s2 |
| D4 | **Lifecycle: graduation activates, it does not migrate.** Professional is introduced through guided activation on the same account. Scholar and Professional may be active at the same time. | WEB-IND-001 brief s4 |
| D5 | **Shared foundation:** one identity, one personal AI, one learning history and one lifelong Competen Passport. Reuse existing IAM, routing, entitlements, workspace, governance and platform capabilities. Do not duplicate engines. | WEB-IND-001 brief s5 |
| D6 | **Commercial boundary:** Scholar is operated by a separately incorporated, majority-owned Competen Holdings subsidiary, and Professional by Competen Holdings. Commercial entitlements stay distinct without fragmenting personal identity. | WEB-IND-001 brief s6 |
| D7 | **Canonical public routes are the brand routes:** `/scholar` and `/professional`. The previously indexed `/students` and `/professionals` are permanent redirects. | Review GO, item 3 |
| D8 | **The Scholar operator's legal name is pending.** The public disclosure line is built but stays hidden until the owner confirms the name. | Review GO, item 1 |
| D9 | **Scholar contact details are configurable.** The shared enquiries address is used for now. | Review GO, item 2 |

## 2. Unchanged by this record

- **Product separation** (`COMP-ARCH-PSA-001`, ADR-001) and **identity boundaries** (ADR-002). D5 asks the
  Individual build to *reuse* these, not to reinterpret them.
- **The 2026-08-11 audience mapping:** the Students and Professionals pathways gate into Competen
  Individual through `/individual/sign-in`, the coming-soon screen (`src/lib/access-doors.ts`: `being_built`).
- **Signup posture:** the estate `/signup` stays closed and no Individual surface links to it.

## 3. Where the decisions are enforced today

| Decision | Enforced in |
|---|---|
| D1, D3 | `src/lib/marketing/products.ts` (four entries; Individual carries `experiences`) · harness `public-disclosure-harness.ts` 7g/7h |
| D2, D4, D5 (public wording) | `src/lib/marketing/individual-family.ts` (single source for every Individual-family surface) |
| D7 | `src/app/scholar`, `src/app/professional` (pages) · `src/app/students`, `src/app/professionals` (308 redirects) · `src/lib/marketing/solutions.ts` slugs · harness 7l (route gates into Individual; legacy route redirects permanently) |
| D8 | `Experience.operator` in `individual-family.ts` (`null` renders nothing) |
| D9 | `Experience.contact` in `individual-family.ts` |
| D6 (entitlements) | **Not yet enforced anywhere.** It applies to the signed-in product — see COMPETEN-IND-002. |
