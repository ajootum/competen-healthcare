# COMPETEN-SCHOLAR-HFE-COLOR-01 + COMPETEN-HFE-COLOR-02: build record

Scholar's Calm Teal and warm learning accents (COLOR-01), refined and **approved** by COLOR-02 (owner, 27 Oct 2026). COLOR-02 adds one neutral canvas for every product.
- **Built on:** COMPETEN-DESIGN-SYSTEM-01.
- **Branch:** `scholar/hfe-color-01`.
- **Scope:** no migration, no new capability, no production write.
- **Visual only:** no change to workflows, AI, navigation architecture, the frozen sidebar structure, permissions or data.
- **Checkpoints:** PR review on green CI, then the owner's deploy GO. COLOR-02 drops COLOR-01's switch, and the validation plan below is post-ship measurement, not a gate.

## Tokens (`src/lib/design/tokens.ts`, generated into `globals.css`)

| Token | Value | Use |
|---|---|---|
| `--cmp-app-bg` | `#F7F8FA` | the one application canvas: Platform, Individual, Scholar and Professional |
| `--cmp-app-surface` | `#FFFFFF` | headers, sidebars, cards |
| `--cmp-app-border` | `#E2E8F0` | card edges and dividers |
| `--cmp-app-text` / `-text-secondary` | `#142638` / `#475569` | primary and secondary text |
| `--cmp-app-control-border` | `#7A8B99` | **derived**: form-field edges (see findings) |
| `productTheme.scholar` | `#0B7089`, hover `#07566B`, soft `#E8F6F9` | Scholar action, navigation, selected navigation |
| `--cmp-role-revision-*` | `#D97706` on `#FFF4DC`; **derived** ink `#92400E`, strong `#B45309` | revision and recommendations |
| `--cmp-role-progress-*` | `#15803D` on `#ECFDF5`; ink `#166534` | progress |
| `--cmp-role-indigo-*` | `#4338CA` on `#EEF0FD` | reasoning and evaluation, used selectively |
| `--cmp-activity-<space>-icon/chip` | from `activityRole` | Scholar learning-space cues |

Product accents are kept: Platform emerald, Individual indigo, Scholar teal (now `#0B7089`), Professional indigo.

## Material changes

- **One canvas:** Platform `/dashboard`, the Individual and experience shells, the Individual home, Learning and the welcome page all paint `--cmp-app-bg`.
- **White header and sidebars:**
  - Individual and Scholar/Professional: tokenised header, sidebar and borders.
  - **Platform:** the desktop sidebar, mobile bar and drawer move from deep emerald to white. Emerald remains the logo tile, the selected item (`#064E3B` on `#ECF6F2`, 8.81:1) and the shift action.
- **Scholar palette:** `#0B7089` replaces `#087F9C` everywhere through `productTheme.scholar`. The Scholar shell's gray scale reads the shared canvas, border and text tokens; `gray-500` darkens to `#5F6F80`, which is 4.85:1 on the canvas.
- **Hard-coded colours removed:** every raw hex in Scholar screens and the shared Individual chrome became a token. The Scholar home hero's heavy teal fill is now a white card with a subtle border and shadow. Amber chips use the revision role; neutral notices are white cards.
- **Activity cues:** each learning-space tab has an icon on a soft chip.
  - Teal: Library and Learn.
  - Amber: Revise.
  - Indigo: Apply and Evaluate.
  - Green: Progress.

  The chips are `aria-hidden`, and the tab text always names the space. The Revise "cards due" badge uses the revision fill.

## Accessibility (WCAG 2.2 AA), measured

| Use | Pair | Ratio | Need | Result |
|---|---|---|---|---|
| Body text on card / canvas | `#142638` on `#FFFFFF` / `#F7F8FA` | 15.39 / 14.49 | 4.5 | pass |
| Secondary text on card / canvas | `#475569` | 7.58 / 7.13 | 4.5 | pass |
| Scholar button label / hover | white on `#0B7089` / `#07566B` | 5.69 / 8.23 | 4.5 | pass |
| Scholar link on card / canvas | `#0B7089` | 5.69 / 5.35 | 4.5 | pass |
| Selected navigation | `#0B7089` on `#E8F6F9` | 5.14 | 4.5 | pass |
| Platform selected item | `#064E3B` on `#ECF6F2` | 8.81 | 4.5 | pass |
| Borders | `#E2E8F0` on white | **1.23** | 3 if it identifies a control | pass for card edges and dividers. **Fails as a field edge**, so Scholar fields use `#7A8B99` (3.51 / 3.30) |
| Amber as normal text | `#D97706` on white | **3.19** | 4.5 | **fail**: never used as text (harness-pinned) |
| Amber as icon or large text | `#D97706` on white | 3.19 | 3 | pass |
| Amber on its own tint | `#D97706` on `#FFF4DC` | **2.92** | 3 | **fail**: amber icons on the tint use `#B45309` (4.60) |
| Words on the amber tint | `#92400E` on `#FFF4DC` | 6.49 | 4.5 | pass |
| White on an amber fill | white on `#B45309` / on `#D97706` | 5.02 / **3.19** | 4.5 | fills use `#B45309` |
| Progress text | `#15803D` on white / on `#ECFDF5` | 5.02 / 4.76 | 4.5 | pass |
| Progress words on tint | `#166534` on `#ECFDF5` | 6.77 | 4.5 | pass |
| Indigo words on tint | `#3730A3` on `#EEF0FD` | 8.76 | 4.5 | pass |
| Activity icons on chips | 5.14 (teal) · 4.60 (amber) · 6.97 (indigo) · 4.76 (green) | | 3 | pass |

**Never colour alone:** tab labels stay; the due count is a number plus "cards due" for screen readers; the selected tab keeps its 3px underline; selected sidebar items keep weight and a ring.

**Pre-existing, outside this change:** Platform and Professional form fields use Tailwind `gray-300` (`#D1D5DB`, 1.47:1), below 3:1. Scholar's are fixed here. Fixing the others is a separate, app-wide decision.

## Genuine decisions

1. **Derived shades for AA:** `#92400E` for amber words, `#B45309` for amber fills and icons on the tint, and `#7A8B99` for field edges.
2. **Platform sidebar becomes white,** applying COLOR-02's "white headers and sidebars" to Platform as well. This is the most visible change to a live surface.
3. **Activity colours** are limited to COLOR-02's teal, amber, indigo and green, replacing the mock-up's sky, violet and blue.
4. **No layout change:** the mock-up's large activity tiles and suggestion cards are a layout redesign, not part of this colour work.

## Post-ship measurement (COLOR-01 §6, not a gate)

Compare against the previous build, or against recordings and metrics from before release. Five representative tasks on desktop and on phone:
1. Find and open a material.
2. Start Learn from the recommended step.
3. Find and clear due revision.
4. Start an Apply case.
5. Read an explanation, then answer three recall questions.

**Measures:**
- task completion;
- time;
- errors and misclicks;
- SEQ per task;
- UMUX-Lite;
- a readability rating (1 to 7);
- stated preference with a reason.

Recruit 8 to 12 learners, including low-end phones in bright light and at least one zoom or screen-reader user. No engagement or retention claim is made without longitudinal data.

## Verification

- `design-system-themes-harness` 96/96 (section 6 rewritten for COLOR-02). Plants: a planted gray-50 Platform canvas went red, and restored it went green. Amber-as-text and raw-hex plants are built in.
- CI harnesses 66/66 green, with every pure/local harness accounted for.
- Unit tests: design, individual and marketing suites, 688 tests.
- tsc is clean apart from the PDF typing errors that were already there. eslint is clean on the changed files.
- **Screens:** not yet seen in a browser, signed in. Representative desktop and phone screenshots need a staging sign-in.
