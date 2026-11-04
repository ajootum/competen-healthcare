# LESSON EXPERIENCE REDESIGN + Scholar Learning Design System v1: evidence (4 Nov 2026)

## How it was run

- **Server:** the branch's own dev server against **staging** (`ezhvpgtcqcdsgylrxgdb`; production refused by the launcher).
- **Learner:** the fixture learner. Credentials were read from the fixture file and never printed.
- **Lesson:** the lesson with Check-your-understanding questions. Session `2b9fccd2…`, *Essential Nursing Care of the Critically Ill*, lesson 2 "Eye care".
- **Tooling:** headless Chromium (Playwright), with `prefers-reduced-motion: reduce`. Tablet and phone ran in a coarse-pointer (touch) browser.

## Results

### Walk

`walk-results.txt` holds the final full run: **49 PASS, 2 FAIL**. Both FAILs are one event: a single `500` from `POST learn/act` on **Go deeper**.

The cause:

- The dev-server log shows `SyntaxError: Unexpected end of JSON input` while reading the request body.
- That request spent 16 s in on-demand compilation.
- This change does not touch the route.

Go deeper passed in walks 2 and 4. A clean re-run (`walk-go-deeper-rerun.txt`, shot `09b`) passed with **0 console errors and 0 5xx**.

### Axe

`axe-*.json`: wcag2a, wcag2aa and wcag21aa on `<main>`. **0 violations** at 1440 light, 1440 dark, 820 and 390.

### Contrast

`contrast-results.txt`, produced by `contrast.ts` from `tokens.ts`: **272 pairs, all pass**. The lowest text pair is 6.68:1 and the lowest non-text pair is 4.64:1. Vitest `src/lib/design/scholar-learning-tokens.test.ts` asserts the same pairs in CI, including a planted failing pair.

### Horizontal overflow

The page's `scrollWidth` never exceeds the viewport at 1440, 820, 390 or 200% zoom (720 CSS px).

At 390 the probe lists `ul.flex.min-w-max`. That is the shell's own Study sub-navigation strip, which scrolls inside its own container. It is untouched by this change and is not page overflow.

### Touch targets

On the coarse-pointer browser, every button, summary and What next? action in the lesson is at least 44 px at 820 and 390. Desktop sizes follow the CPR-MOB-001 `pointer-coarse` rule.

### Reading place

- Ask Scholar on desktop: focus moves into the box and the page does not move.
- Tablet and phone: open Ask Scholar from the sticky lesson bar, or from the tab bar, then come back. The lesson returns to the same `scrollY`.

### Dark mode

The Scholar shell has **no dark scheme today**. Under `prefers-color-scheme: dark` it stays light, as before (`11`, `13`, `17`).

The learning tones carry staged, contrast-checked dark values that apply under `[data-cmp-scheme="dark"]`. Shots `11b` and `11c` preview them by setting that attribute. They show the tones only; the rest of the shell is not dark.

## Screenshots

| # | What |
|---|---|
| 01 | Desktop 1440, light, full page: three areas (lessons & sources, lesson, Ask Scholar) |
| 02 | Teach me (sage) with key points and citations, the checks (lavender) with answered states, sources, AI beyond the notes (sky) |
| 03 | Lesson navigator: current, completed, in progress and not started; wrapping titles; sources apart |
| 04 | Ask about this |
| 05 | Teaching style, Guide me selected (2px edge, the word "Selected", tick) |
| 05b–05d | **Memory aid** in a Guide me reply: desktop, the callout itself, and mobile 390 |
| 06 | Ask Scholar beside the lesson (desktop) |
| 07 / 08 | Check your understanding: answering, then feedback in parts with icons |
| 09 / 09b | What next? (one primary action, the rest secondary), and the Go deeper result |
| 10 | Practise this lesson (teal) open |
| 11 / 11b / 11c | prefers-dark (unchanged light shell), and the staged dark tokens preview |
| 12–15b | Tablet 820: light, dark, Ask Scholar panel, Lessons & sources panel, teaching style |
| 16–20 | Mobile 390: light, dark, Ask Scholar panel, Lessons & sources panel, teaching style (stacked) |
| 21 | 200% zoom (1440 window = 720 CSS px) |

## What the walk exercised

- Listen
- Ask about this
- Answer this, with a judged answer
- A teaching style: Guide me, with one AI step
- More
- Go deeper
- What next?: Practise this lesson, Choose another topic, Previous lesson, Next lesson
- Ask Scholar: desktop, the tablet/phone tab, and the sticky bar

The walk left these on staging for the fixture learner: one check attempt, Guide me and Go deeper AI calls on session `2b9fccd2` step 2, and a reading position.
