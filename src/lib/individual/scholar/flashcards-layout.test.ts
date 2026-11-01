import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// SCHOLAR-FLASHCARDS-QA-01 (staging browser check, 31 Oct): the study screen's layout, asserted on its classes and
// structure. The defects measured: at tablet 768 the content area (517px, after the 236px shell sidebar) was cut into a
// 200px nav column and a 213px card column, leaving a 43px card; on a phone the card and buttons started below the
// fold; on desktop the card stayed at 375px. The fix lays out by the content area's OWN width (container queries) and
// keeps CPR-MOB-001's single md viewport edge. The arithmetic below is the grid's, at the three measured widths.

const STUDY = "src/app/individual/(app)/[experience]/(scholar)/study";
const client = readFileSync(`${STUDY}/_components/flashcards-client.tsx`, "utf8");
const page = readFileSync(`${STUDY}/revise/flashcards/page.tsx`, "utf8");
const nav = readFileSync(`${STUDY}/_components/revise-nav.tsx`, "utf8");
const constant = (name: string) => new RegExp(`export const ${name} = "([^"]+)"`).exec(client)?.[1] ?? "";
const REM = 16;

describe("flashcards layout: by available width, one md viewport edge", () => {
  it("no viewport breakpoint but md in the flashcards screens (sm:, lg:, xl:, 2xl: removed)", () => {
    for (const src of [client, page]) expect(src.match(/(?<![\w@-])(sm|lg|xl|2xl):[\w[]/g) ?? []).toEqual([]);
  });
  it("the page grid sits in an @container and switches on the container's width, not the viewport's", () => {
    expect(page).toMatch(/className="@container"/);
    expect(page).toMatch(/<FlashcardsGrid\s/);
    expect(client).toMatch(/<div ref=\{setBox\} className=\{solo \? FLASHCARDS_GRID_SOLO : FLASHCARDS_GRID\}/);
    expect(page).toMatch(/<ReviseNav [^>]*container[^>]*\/>/);
    const grid = constant("FLASHCARDS_GRID");
    expect(grid).toMatch(/^grid grid-cols-1 /);
    expect(grid).toContain("@min-[39rem]:grid-cols-[minmax(22rem,1fr)_minmax(16rem,20rem)]");
    // From 56rem: nav | divider | card | divider | Deck Options. The nav and Deck Options widths default to 11.5rem / 16rem and are the user's to drag (CSS variables).
    expect(grid).toContain("@min-[56rem]:grid-cols-[var(--fc-nav,11.5rem)_auto_minmax(22rem,1fr)_auto_var(--fc-side,16rem)]");
    expect(client).toMatch(/defaultPx: 184,/);
    expect(client).toMatch(/defaultPx: 256,/);
    expect(grid).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
    // The Revise nav is a row until the content area has room for its column.
    expect(nav).toContain("@min-[56rem]:flex-col");
  });
  it("the card's width at the three measured content widths: tablet >= 400px, desktop grows toward 640px, phone full width", () => {
    const sectionPad = { phone: 16, md: 24 }; // p-4, md:p-6
    // A study session has no side column (FLASHCARDS_GRID_SOLO): the card takes the main column, up to max-w-[52rem].
    const cardMax = 52 * REM; // max-w-[52rem]
    expect(client).toMatch(/mx-auto mt-4 w-full max-w-\[52rem\]/);
    const cardWidth = (area: number, md: boolean) => {
      const pad = 2 * (md ? sectionPad.md : sectionPad.phone);
      const col = area >= 56 * REM ? area - 11.5 * REM - 20 : area;
      return Math.min(cardMax, col - pad);
    };
    expect(cardWidth(517, true)).toBeGreaterThanOrEqual(440); // tablet 768: content area 517, one column (was 43px)
    expect(cardWidth(1100, true)).toBeGreaterThanOrEqual(600); // desktop 1440: content area about 1100 (was 375px)
    expect(cardWidth(1400, true)).toBe(832);
    expect(cardWidth(343, false)).toBeGreaterThanOrEqual(300); // phone 375
    // Previous and next no longer sit beside the card, taking its width: they are a row under it at every width.
    expect(client).not.toMatch(/aria-label="Previous card" className=\{`hidden/);
    expect(client).toMatch(/aria-label="Previous card" className=\{ghost\}/);
  });
  it("phone focus mode: one-line header in a session; the card and both buttons are one block brought into view, fitting the first screen", () => {
    expect(client).toMatch(/<DeckHeader compact=\{!\(finished \|\| \(allDone && props\.completed\)\)\}/);
    expect(client).toMatch(/data-testid="deck-header-compact" className="flex min-w-0 items-center gap-3"/);
    // One block: card, sensitive note, rate buttons -- scrolled into view on start and previous / next only.
    const block = client.slice(client.indexOf('data-testid="card-focus"'), client.indexOf('aria-label="Previous card"'));
    expect(block).toContain('aria-keyshortcuts="1"');
    expect(block).toContain('aria-keyshortcuts="2"');
    expect(block).toMatch(/scroll-mt-\[4\.5rem\]/);
    expect(client).toMatch(/useEffect\(\(\) => \{ bringIntoView\(\); \}, \[bringIntoView\]\);/);
    expect(client).toMatch(/requestAnimationFrame\(bringIntoView\)/);
    expect(client.match(/bringIntoView\(/g)!.length).toBe(1); // called once at start; otherwise only through go()
    // The budget at 375 x 812: sticky header 56, bottom bar 56. Card 220 + gap 16 + buttons 56 (+ a 44px note when flipped).
    const height = 240 + 16 + 56 + 44;
    expect(height).toBeLessThanOrEqual(812 - 56 - 56);
    expect(block).toMatch(/min-h-\[240px\]/);
    expect(block).toMatch(/min-h-\[56px\]/);
  });
  it("touch targets keep their pointer-coarse minimums", () => {
    expect(client).toMatch(/const ghost = `[^`]*pointer-coarse:min-h-\[var\(--cmp-touch-min\)\]/);
    expect(nav).toMatch(/pointer-coarse:min-h-\[var\(--cmp-touch-min\)\]/);
    expect(client).toMatch(/inline-flex items-center[^`]*pointer-coarse:min-h-\[var\(--cmp-touch-min\)\][^`]*`[\s\S]{0,120}>Edit this card/);
  });
});

// FLASHCARD LEARNING EXPERIENCE (owner GO, 1 Nov 2026): three experiences, a study session with no side column, typed practice.
const modes = readFileSync(`${STUDY}/_components/flashcards-modes.tsx`, "utf8");

describe("flashcards experience: Study cards / Test myself / Create & manage", () => {
  it("the grid collapses to the card column when there is no side column", () => {
    const solo = constant("FLASHCARDS_GRID_SOLO");
    expect(solo).toMatch(/^grid grid-cols-1 /);
    expect(solo).toContain("@min-[56rem]:grid-cols-[var(--fc-nav,11.5rem)_auto_minmax(22rem,1fr)]");
    expect(solo).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
    expect(client).toMatch(/\{!solo && <ResizeHandle/);
    expect(page).toMatch(/side=\{side \? <aside /);
  });
  it("a study session, Study, Test and Revision History show no creation form; Create & manage does", () => {
    const branch = (from: string, to: string) => page.slice(page.indexOf(from), page.indexOf(to));
    const session = branch("if (q.session) {", "// ── All cards ──");
    expect(session).not.toMatch(/CreateMore|createMore|DeckOptions|deckOptions|side\(/);
    expect(session).toMatch(/null, false,\s*\);/);
    const history = branch('if (q.view === "history")', "// ── Study cards (the landing)");
    expect(history).not.toMatch(/CreateMore|createMore|side\(/);
    expect(history).toContain('null, true, "study"');
    const test = branch('if (q.view === "test")', "// ── Study cards (the landing)");
    expect(test).not.toMatch(/CreateMore|createMore/);
    const landing = page.slice(page.indexOf("// ── Study cards (the landing)"));
    expect(landing).not.toMatch(/CreateMore|createMore|WriteCard/);
    const manage = branch('if (q.view === "manage")', 'if (q.view === "test")');
    expect(manage).toMatch(/createMore\(q\.create/);
    expect(manage).toContain("deckOptions");
    // All cards and My Decks keep Create More beside them.
    expect(page).toMatch(/const side = \(preset: string \| null = null\) => <>\{deckOptions\}\{createMore\(preset\)\}/);
  });
  it("the segmented control is three links with aria-current, a touch minimum, text and an icon", () => {
    for (const label of ["Study cards", "Test myself", "Create & manage"]) expect(modes).toContain(`label: "${label}"`);
    expect(modes).toMatch(/aria-current=\{on \? "page" : undefined\}/);
    expect(modes).toMatch(/pointer-coarse:min-h-\[var\(--cmp-touch-min\)\]/);
    expect(modes).not.toMatch(/role="tablist"/);
    expect(modes).not.toMatch(/(?<![\w@-])(sm|lg|xl|2xl):[\w[]/);
    expect(page).toMatch(/<FlashcardModeNav current=\{mode\}/);
    expect(modes).toContain('view: k === "study" ? null : k');
  });
  it("typed practice: the answer is fetched only after Check, the typed text is never sent, and hotkeys stay off while typing", () => {
    // The only place typed text is read is the textarea's value and the comparison panel; no call() body mentions it.
    expect(client).not.toMatch(/call\([^)]*typed/);
    expect(client).not.toMatch(/(localStorage|sessionStorage|JSON\.stringify\([^)]*typed)/);
    expect(client).toContain("Your typed answer is not saved");
    expect(client).toContain("You judge your own answer. This counts as a flashcard review.");
    expect(client).toMatch(/if \(!card\.back\) \{ if \(!typedMode\) await reveal\(\); return; \}/);
    expect(client).toMatch(/e\.key === " " && !typedMode/);
    expect(client).toMatch(/\["INPUT", "TEXTAREA", "SELECT"\]\.includes\(t\.tagName\)/);
    // The rating buttons are not on screen until the answer is.
    expect(client).toMatch(/\(!typedMode \|\| card\.back\) && \(/);
  });
  it("a study card links to Create & manage to edit instead of an inline editor", () => {
    expect(client).toMatch(/flashcardsHref\(\{ view: "cards", edit: card\.id \}\)/);
    expect(client).not.toMatch(/panel === "edit"/);
    expect(page).toMatch(/editId=\{q\.edit \?\? null\}/);
  });
  it("Test myself: the quiz is a Revise (quick) session that excludes flashcards; typed practice is a flashcards session", () => {
    expect(modes).toMatch(/mode: "quick", formats: \["mcq"\], scope, excludeFlashcards: true/);
    expect(modes).toMatch(/mode: "flashcards", deck: deck\.key \}\)/);
    expect(modes).toMatch(/practice: "typed"/);
    expect(modes).toContain("Test results are marked and kept with your Revise results, apart from your flashcard reviews. Practice is formative: it is not verified competence.");
    expect(readFileSync("src/app/api/individual/scholar/revision/sessions/route.ts", "utf8")).toMatch(/body\?\.excludeFlashcards === true && mode !== "flashcards"/);
  });
  it("?material= is the contract Learn links to: the lesson's cards, studied by id", () => {
    expect(page).toMatch(/cardsOfMaterial\(cards, q\.material, q\.section\)/);
    expect(modes).toMatch(/mode: "flashcards", cardIds: ids/);
    expect(modes).toContain("No cards from this lesson yet");
  });
});
