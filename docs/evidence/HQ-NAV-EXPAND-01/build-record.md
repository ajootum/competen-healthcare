# HQ-NAV-EXPAND-01: the HQ sidebar's parents expand and collapse (owner GO, 28 Oct 2026)

**What changed:**

- **Parents toggle instead of navigating.** A workspace, or an item with children (for example Competency Delivery, AI Services Platform, Product Health or Governance & Regulation Home), is now a button. Tapping it opens or closes its submenu and never navigates. Items without children are links, as before.
- **Overview row.** An item's own landing page is now the first row of its submenu, labelled "Overview", on the same href.
- **Open state:**
  - The parents of the page you are on open by themselves when you arrive.
  - A choice made on a page sticks on that page, and what you open stays open as you move.
  - Several parents can be open at once; there is no accordion.
  - Choices are kept per tab (sessionStorage), shared by the desktop rail and the mobile drawer. The server renders only the active chain open, so hydration cannot mismatch.
- **Accessibility:**
  - Parents are real buttons with `aria-expanded`, `aria-controls` and a turning chevron.
  - Keyboard (Enter/Space) and visible focus work.
  - Touch targets use `pointer-coarse`, not viewport width (CPR-MOB-001).
  - In the drawer, a parent tap keeps it open and a row tap closes it.
- **Sections open by default in HQ.** Sections inside an opened workspace are now open unless the person has closed them (`NavGroup` gains an optional `defaultOpen`; other workspaces are unchanged).

**Unchanged:**

- The registry and nav config, and C1–C12.
- Routes and capability filtering.
- Module visibility.
- The PD sidebar and the Practice navigation.

| Proof | Result |
|---|---|
| `src/lib/nav/expand.test.ts` | 8/8 |
| `WorkspaceSidebar.test.tsx` (jsdom, real registry) | 13/13. Two planted breaks went red: toggles ignored 7/13, Overview removed 2/13. |
| Nav harnesses | hq-nav-registry 32/0, hq-nav-filter 30/0, sidebar-active 15/0, pd-nav 34/0, hq-guard 51/0, plane-boundary 35/0 |
| Browser, 768px | Tapping Governance and AI opens submenus without navigating; AI Services opens with Overview first; the lit row is kept. |
| Browser, 375px | Parent taps keep the drawer open; a row tap navigates and closes it; no sideways scroll; the menu scrolls. |
