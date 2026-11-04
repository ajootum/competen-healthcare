# Scholar Learning Design System

**Status:** v1, 4 Nov 2026. This is the start of a consistent Scholar learning design system (owner directive, LESSON EXPERIENCE REDESIGN).
**First consumer:** Scholar → My Learning → Learn (the lesson page).
**Extends:** PUI-001 design tokens (`src/lib/design/tokens.ts`, generated into `src/app/globals.css`), COMPETEN-DESIGN-SYSTEM-01 (product themes) and COMPETEN-SCHOLAR-HFE-COLOR-01 (app surfaces, role accents). It is not a parallel system: its tokens sit in the same token source, go through the same generator and pass the same `pui-tokens-harness`.

## 1. Purpose

A learner can spend a long study session in Scholar, reading, listening, answering, practising and moving on. Each learning activity has one recognisable identity, so the learner always knows what kind of content they are looking at:

- teaching from their notes;
- a check on their understanding;
- AI content from beyond their notes;
- practice;
- their own notes;
- sources;
- what to do next.

The system is visual only. It decides no learning rule, scoring, routing, record or AI behaviour.

## 2. Tokens

### 2.1 Learning tones

Source: `learningTone` in `src/lib/design/tokens.ts`. Tones are named by what the content is, never by page.

| Tone | Identity | Used for |
|---|---|---|
| `teach` | sage | Teach me, the main teaching from the learner's notes |
| `check` | lavender | Check your understanding: questions, answers, feedback and previous checks |
| `aiBeyond` | sky | AI explanation beyond your notes, and the "General background, not from your notes" callout |
| `explain` | green | Teaching style: Explain |
| `guide` | blue | Teaching style: Guide me |
| `challenge` | violet | Teaching style: Challenge me |
| `practice` | teal | Practise this lesson |
| `quickCheck` | lilac | Quick check |
| `notes` | cream | Your notes: the uploaded notes and the learner's own notes |
| `sources` | lavender-grey | Sources and citations |
| `next` | cyan | What next?, the suggested next step, Continue where you stopped, the lesson navigator |
| `memory` | rose | Memory aid callout. It has its own identity, distinct from `aiBeyond` sky and `quickCheck` lilac |
| `caution` | amber | Clinical caution callout. It has the strongest styling |
| `key` | Scholar teal | Key concept callout |
| `example` | emerald | Example callout |
| `record` | indigo | "From your record" callout |
| `summary` | slate | Summary callout |

### 2.2 Roles

Every tone has four roles:

| Role | Use | Minimum contrast |
|---|---|---|
| `surface` | The soft background of the section | — |
| `border` | The quiet edge (decorative) | — |
| `accent` | Icons and the selected edge | 3:1 on its surface, on a white card and on the page (WCAG 1.4.11) |
| `ink` | Headings, labels, and filled-button backgrounds (with `surface` as their text) | 4.5:1 on its surface and on white (WCAG 1.4.3) |

Body text stays the app text colour (`--cmp-app-text`, `--cmp-app-text-secondary`).

### 2.3 CSS

The generator (`scripts/gen-design-tokens.ts`) emits three things:

- `--cmp-learn-<tone>-<role>`: the light values, on `:root`.
- `--cmp-learn-dark-<tone>-<role>`: the staged dark values, plus one `[data-cmp-scheme="dark"]` rule that points each light variable at its dark twin.
- `.cmp-learn-<tone>`: exposes the four roles as `--learn-surface`, `--learn-border`, `--learn-accent` and `--learn-ink`.

Helpers in `globals.css`:

- `.cmp-learn-box`: the tone's card.
- `.cmp-learn-ink`, `.cmp-learn-accent`: text in the tone's ink or accent.
- `.cmp-reading`: the long-reading type, 15.5px with 1.7 line height and paragraph rhythm.

Never hard-code a tone colour in a component. Name the tone and read the `--learn-*` roles.

### 2.4 Dark

Each tone has contrast-checked dark values. They are **staged**: they apply under `[data-cmp-scheme="dark"]`, which no shell sets today. The Scholar shell stays light under `prefers-color-scheme: dark`, as it did before. Turning dark on is a separate decision for the whole shell, not for one page.

### 2.5 Contrast

`src/lib/design/scholar-learning-contrast.ts` lists the pairs a component draws. There are 8 pairs per tone per scheme, 272 in all. `src/lib/design/scholar-learning-tokens.test.ts` (vitest, CI) asserts every pair and includes a planted failing pair. `npx tsx docs/evidence/LEARN-REDESIGN/contrast.ts` prints the table.

At v1:

| Pair type | Lowest | AA needs |
|---|---|---|
| Text pairs | 6.68:1 | 4.5 |
| Non-text pairs | 4.64:1 | 3 |

## 3. Components

All components are in `src/components/ui/scholar-learning.tsx`. They are presentational only. Each one takes its words from the caller and never invents wording.

| Component | Pattern | States and accessibility |
|---|---|---|
| `LearningSection` / `LearningSectionHead` | Section shell: card in a tone, an icon in a round tile, the heading in the tone's ink, optional trailing badge or action. | Real heading element (`level`); `aria-labelledby` or `aria-label`. |
| `LearningDisclosure` | Collapsible section in a tone; the body sits on white for long reading. | Native `details`/`summary`, so it works from the keyboard and its expanded state is announced. Summary ≥ 48px. The caret does not animate under reduced motion. |
| `StyleCard` | Selectable card: one choice of a radiogroup, for example Explain, Guide me or Challenge me. | `role="radio"`, `aria-checked`, `aria-describedby`. **Selected:** 2px accent edge with a ring, the word "Selected", a filled tick badge and a stronger surface. **Unselected:** 1px edge and an empty ring. The caller owns the roving tabIndex and the arrow keys. |
| `QuestionCard` | One question on a white row in its section. | **Unanswered:** filled action. **Answered:** a tick, "Answered · <last outcome in words>", and the action steps back to outlined. **Open / feedback:** the answer form and its feedback follow under the question. |
| `VerdictLine` | An informal verdict in words, with a shape. | Ring with tick for understood, half disc for partly, dashed ring for not yet. |
| `FeedbackParts` | Feedback in parts: correct, missing, misconceptions, key points, next action. | Each part has a heading and its own icon. Misconceptions use the calm revision amber, never red. |
| `ProgressListItem` / `ProgressMark` | Progress-state list item: number, wrapping title, state in words. | The current item is a filled row with `aria-current="step"`. Completed, in progress and not started differ by the mark's shape and by words. |
| `CitationChip` / `SourceLink` | Inline `[S n]` citation link, and a source row (tag chip, citation link, optional note or excerpt). | Accessible name "Source S3: …". An AI-read source shows a visible "AI" mark. |
| `ActionBand` | Primary and secondary action band (What next?). | One filled primary, the rest outlined; stacks on touch screens. Nothing advances by itself. |
| `DisclaimerBadge` | Provenance and safety disclaimer, always visible and in words. | Amber (the revision role), the "not reviewed" colour. |
| `LearningCallout` | Answer callout: icon and label in words. | `role="note"`, `aria-label`. Emphasis `safety` (caution): full 2px edge and a 6px rule. `prominent` (memory): full edge and a 4px rule. `standard`: 4px rule. |
| `LearningIcon` | The shared line icons. | Always `aria-hidden`; the words beside an icon carry its meaning. |

## 4. Rules

1. **No colour-only meaning.** Every tone also has a heading in words and an icon. Every state (selected, answered, verdict, progress, feedback part) also changes shape, words or edge width.
2. **No implied verification.** No tone, badge or colour may suggest that AI content was clinically checked:
   - The AI-generated, not-clinically-reviewed badge stays amber and visible, with its exact wording.
   - The formative disclaimers stay visible with their meaning.
   - Sage (`teach`), green (`explain`) and emerald (`example`) are identities, not "correct" or "verified".
3. **Formative, never punitive.** Feedback distinguishes correct, partial, misconceptions or missing points, and next action, without red and without scores the engine did not produce.
4. **Clinical caution is the strongest callout.** No other callout may use the safety emphasis.
5. **The Memory aid stays prominent.**
   - It uses its own rose identity, the bulb icon and the label "Memory aid", wherever `ScholarAnswer` renders: the teaching-style replies (Guide me, Challenge me, Explain my mistake …) and Personal AI.
   - The prompt and the callout parsing are unchanged.
6. **Touch and focus.**
   - Controls are at least 44px on touch screens (the CPR-MOB-001 `pointer-coarse` rule); primary actions are 48px.
   - Every control keeps the platform focus ring.
7. **Motion.** No decorative animation. Transitions are `motion-safe` only, and the platform reduced-motion floor applies.
8. **Zoom and reflow.** No fixed heights on text. Layouts wrap, and no horizontal scroll is introduced at 390px or at 200% zoom.
9. **One edge per level.** Don't nest bordered cards more than one level. Sections are siblings, not boxes in boxes.

## 5. Layout (Learn)

| Content width | Layout |
|---|---|
| ≥ 66rem | Three areas: lessons and sources (sticky), the lesson, Ask Scholar (sticky, with its own scroll, so asking never moves the reading place). |
| < 66rem (tablet, phone) | The lesson fills the width. Lessons & sources and Ask Scholar open as panels from the tab bar and keep each panel's scroll place. The sticky lesson bar offers Ask Scholar and Next lesson while reading. |
| Phone | One column, stacked cards; style cards stack. |

The page uses container queries and adds no new viewport breakpoint (CPR-MOB-001 freeze).

## 6. Adoption guidance for the other stages

Adopt by naming tones and using the components. Don't fork them, and don't hard-code colours. Next candidates:

| Stage | What to adopt |
|---|---|
| **Revise** (`study/revise`, flashcards, mistakes) | `QuestionCard` + `VerdictLine` + `FeedbackParts` for the revision questions (`check` tone); `LearningDisclosure` for sources; `ActionBand` for session end. The flashcard states (`--cmp-fc-*`) stay as they are, and could later alias `check` / `notes`. |
| **Apply** (cases, OSCE, papers) | `LearningSection` with `practice` for the case shell; `FeedbackParts` for case feedback; `LearningCallout` (`caution`) for safety points; `ActionBand` for next steps. |
| **Evaluate** | `ProgressListItem` for evaluation items; `DisclaimerBadge` for "educational, not verified competence"; `FeedbackParts` for the interpretation. |
| **My Plan** | `ProgressListItem` for plan steps and units; `ActionBand` for "today's next step"; `LearningSection` with `next` for the plan card. |
| **Saved learning / Library** | `LearningDisclosure` (`notes`, `sources`), `SourceLink`, `CitationChip`. |
| **Personal AI** | Already consumes the tokens through `ScholarAnswer` callouts. |

When you adopt:

1. Keep each page's existing words, disclaimers and behaviour.
2. Run the page's own harness and vitest.
3. Add the page to this list.

### 6.1 Adopted so far

| Stage | Since | What it uses |
|---|---|---|
| **Learn** | v1 (PR #281) | Every component; the first consumer. |
| **Apply** | DS rollout 1 | The case start and case player in the `practice` tone (`LearningSectionHead`, white inner cards with one ring, one filled primary in the tone's ink); the decision verdict as a shape and words, never a red or green box; `FeedbackParts` for the debrief; `LearningCallout` (`caution`, safety emphasis) for every safety-critical point; "Your cases" in `next`; the case-library offer and the clinically approved cases in `sources`. |
| **Evaluate** | DS rollout 1 | Dimension cards in `check`; confidence in `record`; the competency framework view in `sources`; "What to do next" in `next`; "What this evaluation cannot say" and "Verified clinical competence: not assessed here" in `summary`. Bands are words with a shape (strong: a tick in `check`; developing and needs work: the revision amber), never red or green. |

Still to adopt: Revise (once SALE R2, PR #283, is merged), Progress (next: SALE R4 is merged), My Plan, Saved learning / Library, and the papers, OSCE and monthly-review panels shared by Apply and Evaluate.

## 7. Change control

- **Tones:** a new tone or a changed value is a change to `tokens.ts`. Regenerate it with `npx tsx scripts/gen-design-tokens.ts`; `scholar-learning-tokens.test.ts` must stay green.
- **Components:** a new state or variant goes in `scholar-learning.tsx` with its accessibility contract stated here.
