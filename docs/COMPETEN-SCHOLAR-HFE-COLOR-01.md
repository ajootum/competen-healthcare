# COMPETEN-SCHOLAR-HFE-COLOR-01 — build record

Calm Teal + Warm Learning Accents for Competen Scholar, as a **reviewable variant** on COMPETEN-DESIGN-SYSTEM-01.
Branch `scholar/hfe-color-01`. **No migration. No new capability. No production write.** The approved Scholar theme
stays the default for everyone until the owner publishes otherwise, after comparison.

## How it is switched

| `scholar_theme` (Individual policy, HQ → Individual → Configuration) | Who sees Calm Teal |
|---|---|
| `current` (**default**) | Nobody. A stored learner choice is ignored. Nothing is offered. |
| `preview` | Learners who choose it in Scholar → Settings → *Scholar colours*. Default stays current. |
| `calm` | Everyone by default; a learner may choose the current theme back. |

Written through the existing CONFIG-002 door (`hq.individual.config.manage`): draft → publish → rollback, all audited.
The learner's choice is a browser cookie (`cmp_scholar_theme`, path `/individual`), a display preference only.
The Individual app layout resolves both (`src/lib/design/scholar-theme.ts`) into `data-cmp-scholar="calm"`.
Nothing about learning, permissions, records or AI governance changes.

## What the variant changes

- **Tokens** (`tokens.ts` `scholarVariant.calm`, generated into `globals.css`): primary `#0B7089`, hover `#07566B`,
  soft teal `#E8F6F9`, page `#F8FAF9`, card `#FFFFFF`, border `#D9E3E8`, text `#142638`, secondary `#475569`,
  warm `#D97706` on `#FFF4DC`, success `#15803D`, error `#B91C1C`.
- `[data-cmp-scholar="calm"]` re-points `--cmp-product-scholar-*`. Scholar's accents now come from CSS variables, so
  every Scholar accent (header, tabs, buttons, links, switcher mark) follows at once. The `.cmp-scholar` gray and amber
  scale is re-pointed to page, border, text, secondary and warm-tint tokens.
- **Activity indicators:** each learning-space tab (Library, Learn, Revise, Apply, Evaluate, Progress) gets a small icon
  on a soft chip, rendered only under the variant. It is one shared component, not six themes: teal stays the action
  colour, and the tab label always names the space. The Revise "cards due" badge, the suggested step, turns warm.
- **Unchanged:** Professional `#4338CA`, Individual, Platform, the frozen sidebar and nav structure, and semantic colours.

## Accessibility (WCAG 2.2 AA), measured

| Use | Pair | Ratio | Need | Result |
|---|---|---|---|---|
| Body text | `#142638` on `#FFFFFF` / `#F8FAF9` | 15.39 / 14.69 | 4.5 | pass |
| Secondary text | `#475569` on `#FFFFFF` / `#F8FAF9` | 7.58 / 7.23 | 4.5 | pass |
| Button label / hover | white on `#0B7089` / `#07566B` | 5.69 / 8.23 | 4.5 | pass |
| Links | `#0B7089` on card / page | 5.69 / 5.42 | 4.5 | pass |
| Selected tab, navigation | `#0B7089` on `#E8F6F9` | 5.14 | 4.5 | pass |
| Ink on soft teal | `#07566B` on `#E8F6F9` | 7.44 | 4.5 | pass |
| Focus / selected outline | `#0B7089` on white | 5.69 | 3 | pass |
| Form-field edge, candidate border | `#D9E3E8` on white | **1.30** | 3 | **fail**, fixed: fields use `#7A8B99` (3.51 / 3.35 on page) |
| Warm as normal text | `#D97706` on white | **3.19** | 4.5 | **fail**: never used as text (harness-pinned) |
| Warm as icon or large text | `#D97706` on white | 3.19 | 3 | pass |
| Warm on its own tint | `#D97706` on `#FFF4DC` | **2.92** | 3 | **fail**: warm icons use `#B45309` (4.60) |
| Words on warm tint | `#92400E` on `#FFF4DC` | 6.49 | 4.5 | pass |
| Warm button (mock-up `#D97706` + white) | white on `#D97706` | **3.19** | 4.5 | **fail**: warm buttons use `#B45309` (5.02) |
| Success / error text | `#15803D` / `#B91C1C` on white | 5.02 / 6.47 | 4.5 | pass |
| Activity icons on chips | library 5.14, learn 5.17, revise 4.60, apply 6.02, evaluate 5.44, progress 4.49 | | 3 | pass |

Meaning is never carried by colour alone: tabs keep their text labels, and the due count keeps its number plus
"cards due" for screen readers. The selected tab keeps its 3px underline. Touch targets are unchanged (CPR-MOB-001).

**Pre-existing finding (current theme, not changed here):** Scholar's current field border (`#cbd8df`) is 1.46:1
on white, below WCAG 1.4.11's 3:1. The variant fixes it for Calm Teal; the current theme needs its own decision.

## Decisions taken (derived values, all within the directive's palette family)

1. `warmInk #92400E` for words on the warm tint, and `warmStrong #B45309` for warm buttons, badges and warm icons. `#D97706` itself is kept for large text, borders and decoration only.
2. `controlBorder #7A8B99` for form fields. `#D9E3E8` stays for cards and dividers.
3. Activity chip tints: Learn sky, Apply violet and Evaluate blue are added as icon tints only, following the mock-up. Teal remains the only action colour.
4. Layout is unchanged. The mock-up's large activity tiles and three suggestion cards are a layout redesign, not a colour change. They are not built here.

## Validation plan (directive §6)

Compare the current theme (A) with Calm Teal (B) on staging. Set `scholar_theme = preview`; each participant does both,
order counterbalanced, on desktop and on phone.

| Task | Measures |
|---|---|
| Find a material in My Learning and open it | time to target, errors, first click |
| Start a Learn session from the recommended step | task completion, time, misclicks |
| Find and complete due revision cards | finds the due count unaided (yes/no), time |
| Start a clinical case in Apply | completion, navigation errors |
| Read a 150-word explanation, answer 3 recall questions | reading time, recall accuracy, SEQ |

- **After each theme:** SEQ per task, and UMUX-Lite (2 items) per theme.
- **At the end:** preference (A, B or none) with a stated reason, plus a readability rating (1 to 7).
- **Recruitment:** 8 to 12 Scholar learners, including at least 2 on low-end phones in bright light and at least 1 screen-reader or zoom user.

**Decision rule:**
- Adopt B (`scholar_theme = calm`) only if it is no worse on completion and errors, and is better or equal on SEQ and readability.
- Engagement or retention gains are **not** claimed without longitudinal data.

## Verification

- `design-system-themes-harness` passes 94/94, of which 33 checks are new in section 6. A planted visible chip went red, and restored it went green.
- Unchanged and passing: individual-config 47/47, individual-foundation 74/74, pui-tokens 58/58, pui-colour 17/17, cpr040 14, access-doors 39/39.
- Unit tests: design and individual suites, 693 tests, including the new resolver tests.
- tsc is clean apart from the PDF typing errors that were already there. eslint is clean on the changed files.
