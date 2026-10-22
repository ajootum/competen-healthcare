# COMPETEN-WEB-IND-001 — Website redesign: build record

**Status:** Built on branch `web-ind-001/individual-redesign`, in review. **No merge or deployment without a
separate owner GO.**
**Governs:** the public website only. It applies the decisions in `COMPETEN-IND-001-individual-product-decisions.md`.
**Lineage (latest wins):** COMP-HOME-001 → WEB-HP-002 → WEB-STRAT-001 → WEB-HOME-001 → **WEB-IND-001**.
WEB-HOME-001's rules still hold: four products, five audiences, no Enterprise sub-product names, honest
CTAs, and no `/signup` links.

## 1. What changed

| Surface | Route | Change |
|---|---|---|
| Homepage | `/` | The four-product section now follows the hero, with an outcome sentence per product. The Individual card links to Scholar and Professional. A new student-to-professional journey band. "Explore Competen" lands on `#products`. |
| Individual gateway | `/individual` | Rebuilt around the two experiences, the five-stage lifecycle (Study → Graduate → Practise → Specialise → Lead) and the shared Passport foundation. The CTA mode configuration is kept (`talk_to_us`). |
| Competen Scholar | `/scholar` (canonical) | A new branded experience page with its own product bar, sections, journey, sibling introduction and conversion. |
| Competen Professional | `/professional` (canonical) | The same template with Professional's brand and content. |
| Legacy routes | `/students`, `/professionals` | Permanent (308) redirects. Removed from the sitemap. |
| Header and footer | all public pages | Scholar and Professional nested under Individual in the Products menu, the mobile drawer and the footer. |

**Configuration-first:** every Individual-family string, accent, route, contact and operator value lives in
`src/lib/marketing/individual-family.ts`. Scholar and Professional render from one template
(`src/components/marketing/ExperiencePage.tsx`). The shared bands live in `IndividualFamily.tsx`.

**Honesty:** Individual cannot be signed into yet. Every "Sign in" on these pages goes to `/individual/sign-in`
(coming soon, no password field), and the primary action is a conversation.

## 2. Verification (2026-10-22, local dev server against the configured project)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` on changed files | clean |
| `vitest run` | 454 / 454 |
| `public-disclosure-harness.ts` | 213 pass / 1 fail. The failure is the **baseline** 6-control below. All redesign assertions pass, including the revised 7l. |
| 7l control proven | A planted 307 on `/students` turned 7l red; restoring the 308 turned it green. |
| `access-doors-harness.ts` | 39 / 39 |
| `domain-registry-harness.ts` | 56 / 1. **Baseline** failure 8a, below. |
| Playwright, 1440×900 and 390×844, `/` `/individual` `/scholar` `/professional` | No horizontal overflow. Products menu (desktop hover, mobile drawer) lists both experiences. |
| axe-core WCAG 2.1 A/AA | No findings introduced by this change. 5 **baseline** contrast findings remain, below. |

Evidence: `docs/evidence/COMPETEN-WEB-IND-001/` (full-page desktop and mobile captures plus both menus).

## 2a. Refinement pass — conditional acceptance (2026-10-22)

The owner accepted the screenshots as the design baseline and asked for one focused pass:

| # | Item | Change |
|---|---|---|
| 1 | Hero cropping | The portrait images are a side column in the hero panel with a face-aimed `imagePosition`, not a 2:1 strip. |
| 2 | Graduation wording | Graduation is a *suggested* activation moment everywhere: the lifecycle, the gateway, the homepage band (no "Graduate" step between the experiences) and the sibling cards. Professional opens at any stage. |
| 3 | CTAs | Unchanged: the conversation plus `/individual/sign-in`. No registration action. |
| 4 | Repetition | The full journey and Passport band are on `/individual` only. Scholar and Professional carry one `JourneyNote` that links to it. |
| 5 | Scholar demo | Upload → Understand → Revise → Apply → Progress: five steps, each with a drawn, labelled illustration (`ExperienceStep.mock`). |
| 6 | Professional demo | Development → Learning → Competency Evidence → Passport → Career, the same way, with evidence-source tags. |
| 7 | Mobile journey | Below `sm`, stages are one-line rows (12px or larger, labelled by name). |

Re-verified: tsc and eslint clean; vitest 454/454; disclosure harness 213 / 1 (the same baseline 6-control); access-doors 39/39; no horizontal overflow at 1440 and 390; axe shows the same 5 baseline footer findings and nothing new. The captures in `docs/evidence/` are refreshed.

## 3. Baseline findings — recorded, NOT fixed here (outside this scope)

1. **`public-disclosure-harness` 6-control `/signup`.** The closed `/signup` copy was rewritten on 2026-08-28
   ("Start with Competen Practice"), but the harness still looks for the old marker ("not open yet"). The
   page itself is correct. The harness marker needs updating in its own change.
2. **`domain-registry-harness` 8a.** A hostname literal in `src/app/practice/(shell)/home/BookingLinkCard.test.tsx`.
3. **Shared footer contrast (axe `color-contrast`, 5 nodes per page):** the footer tagline (`text-white/45`),
   the three legal-bar labels (`text-white/40`) and the Competen Staff Access link. These were already on every page.
4. **Homepage product-card title links** measure 21px tall as elements. The hit target is the whole card
   (a stretched `::after`), so this is a measurement artefact, not a defect.

## 4. Open owner items

- **Scholar operator legal name** (COMPETEN-IND-001 D8). Set `SCHOLAR.operator` when it is confirmed.
- **Scholar enquiry address** (D9). Set `SCHOLAR.contact.email` if a subsidiary mailbox is created.
