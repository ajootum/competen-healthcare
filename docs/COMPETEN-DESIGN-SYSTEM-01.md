# COMPETEN-DESIGN-SYSTEM-01 — build record

One Competen brand, four coordinated product themes. Absorbs "COMPETEN LOGIN HFE & PRODUCT IDENTITY IMPROVEMENT".
Branch `ds/design-system-01`. **No migration. No new capability. No production write.** Deploy needs a separate owner GO.

## Themes (tokens.ts `productTheme`, the only source)

| Product | Accent | Contrast on white | Shell |
|---|---|---|---|
| Platform | `#064E3B` emerald | 9.72 | `/dashboard` (sidebar + mobile sidebar) |
| Individual | `#4338CA` indigo | 7.90 | `/individual/(app)` |
| Scholar | `#087F9C` teal | 4.64 | `/individual/scholar/**` |
| Professional | `#4338CA` indigo | 7.90 | `/individual/professional/**` |

Each has accent / strong / soft / border / ink / on-accent. `scripts/gen-design-tokens.ts` emits `--cmp-product-<p>-*`,
`--cmp-theme-*` (default Platform) and one `[data-cmp-theme="<p>"]` rule per product into `globals.css`. A surface
opts in with `data-cmp-theme` and uses `bg-[var(--cmp-theme-accent)]` etc. Theme is presentation only: it never
touches identity, entitlement, permission, record or history. Scholar and Professional remain experiences of
Individual; no legal or technical ownership boundary changed.

**Not themed, on purpose (semantic colour):** Passport trust labels (educational indigo / assessed teal / verified
emerald), competency layer colours, Personal AI and formative notices, learn source-kind labels. Practice `--cp-*`
(CPR-040), the PD/HQ shell and every frozen sidebar structure are untouched.

## Stages

1. **Tokens/foundation** — `productTheme`, generated theme rules; `src/lib/design/product-themes.ts` is the one
   presentation registry (name, role line, description, action, icon, theme) per destination.
2. **Login, account, shell** — `/login` "many" state is now `DestinationChooser`: heading "How would you like to use
   Competen?", one tinted card per authorised destination with its own icon, role line, description and prominent
   action; 3px focus ring, `pointer-coarse` 88px cards, `aria-describedby`. "Last used" (localStorage
   `cmp.lastDestination`) only **marks and orders** a card already in the server's set (COMP-ID-ROUTE-001 s5/s8):
   it never adds, preselects or navigates; a stale code is ignored. One destination still auto-continues (resolver,
   unchanged). `next` now goes through the shared `safeNextPath` guard (was a weaker inline check). The Individual
   "Signing in to …" banner wears the experience's theme.
3. **Product rollout** — Individual / experience layouts set `data-cmp-theme`; home, learning-return, Learning
   module and Scholar paper selection read the theme instead of raw teal; Individual accent unified to indigo across
   marketing (`individual-family.ts`, `products.ts`), sign-in and `experiences.ts`. Platform `/dashboard` sidebar
   and mobile sidebar moved from navy/teal to the emerald theme.
4. **Config + checks** — governed presentation through CONFIG-002 (below); `scripts/design-system-themes-harness.ts`
   (61 checks, in CI); unit tests `src/lib/design/presentation-config.test.ts` (11).

## Governed presentation (CONFIG-002, no new engine)

Path `individual.presentation` in scope `platform/individual`, written only by `/api/hq/individual/config`
`{action:"presentation"}` behind `hq.individual.config.manage` (Individual Product Administrator), drafted →
published as a version → rollback, audited in `workspace_config_audit`. Editor: HQ → Individual → Configuration →
"Sign-in presentation". `/api/auth/destinations` returns the published wording beside the set; unreadable or
unpublished = code defaults.

Editable per Individual / Scholar / Professional: role line (3–60), description (10–200), action label (3–40),
icon from the fixed set. **Not editable:** product names (bound to operating entities, terms, legal pages) and
colours (approved palette in tokens.ts, AA-pinned by the harness, changed only through review). Platform and
Practice presentation are outside this door and stay code defaults. If the owner wants names/colours or
Platform wording under HQ config, that needs a Platform-scope door and an owner decision on the capability.

## Verification

- `design-system-themes-harness` 61/61; plant (teal utility in the chooser) → red, restored → green.
- individual-foundation 74/74 (12i now pins `safeNextPath`), access-doors 39/39, pui-tokens 58/58, pui-colour 17/17,
  pui-components 46/46, cpr040 14, hq-nav-registry 32/32.
- vitest: design / identity / individual / marketing — 63 files, 709 tests pass.
- tsc clean apart from the pre-existing PDF-package typing errors from the junction `node_modules`; eslint clean on changed files.
- public-disclosure: source checks unchanged; HTTP checks need a running server; 2h (stale Practice social cards) is pre-existing.
- Browser: see PR description.

## Not done / follow-ups

- Account menus already shared via the Individual `AccountMenu` (HFE-01); no separate account-menu rework here.
- Product-name and colour governance in HQ (needs owner decision on a Platform-scope door).
