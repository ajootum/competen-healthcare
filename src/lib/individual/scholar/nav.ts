// ── THE SCHOLAR NAVIGATION MODEL ── modular restructuring, 2 Nov 2026 ───────────────────────────────────────────
//
// Home, three modules (My Learning, Courses & Training, My Competencies) and the shared foundation links, as ONE list
// that the sidebar (ScholarSidebar) and the mobile drawer (ScholarDrawer) both draw, so they cannot disagree. A module is
// a heading that opens and closes; a leaf is a real page. `navFor` in experiences.ts stays flat (harness 7a walks it).
//
// My Learning's leaves are generated from SCHOLAR_SPACES (spaces.ts), in its order, so a space cannot exist without a
// leaf (nav.test.ts). Its labels are the sidebar's words; SCHOLAR_SPACES.tab is unchanged.
//
// ⚠ IMPORTS spaces.ts ONLY (which imports nothing): client and server components both read it. Shared leaves repeat the
// FOUNDATION_NAV segments and labels; nav.test.ts pins them to the registry.
// ⚠ A LEAF IS A PAGE, NOT A PERMISSION. `status: "future"` only marks a page that says it is not available yet.

import { SCHOLAR_SPACES, type ScholarSpaceKey } from "./spaces";

export type NavLeaf = {
  key: string;
  label: string;
  /** Path below /individual/scholar ("" is Home). */
  segment: string;
  /** Other paths below /individual/scholar on which this leaf is current. */
  also?: readonly string[];
  /** "myPlan": drawn only while My Plan is on (the layout decides). */
  gate?: "myPlan";
  status: "live" | "future";
  /** My Learning leaves carry ?study=<id> while a connected study session is open. */
  carriesStudy?: boolean;
};

export type NavModuleKey = "learning" | "courses" | "competencies";
export type NavModule = { key: NavModuleKey; label: string; icon: string; items: readonly NavLeaf[] };

const LEARNING_LABEL: Record<ScholarSpaceKey, string> = {
  plan: "My Plan", library: "My Library", learn: "Learn", revise: "Revise", apply: "Apply", evaluate: "Evaluate", progress: "My Progress",
};

const learning: NavModule = {
  key: "learning", label: "My Learning", icon: "▤",
  items: SCHOLAR_SPACES.map<NavLeaf>(s => ({
    key: s.key, label: LEARNING_LABEL[s.key], segment: s.segment, ...(s.also ? { also: s.also } : {}),
    ...(s.key === "plan" ? { gate: "myPlan" as const } : {}), status: "live", carriesStudy: true,
  })),
};

const courses: NavModule = {
  key: "courses", label: "Courses & Training", icon: "◫",
  items: [
    { key: "courses", label: "Overview", segment: "courses", status: "live" },
    { key: "courses-explore", label: "Explore Courses", segment: "courses/explore", status: "live" },
    { key: "courses-mine", label: "My Courses", segment: "courses/mine", status: "live" },
    { key: "courses-programmes", label: "My Programmes", segment: "courses/programmes", status: "live" },
    { key: "courses-progress", label: "Learning Progress", segment: "courses/progress", status: "live" },
  ],
};

const competencies: NavModule = {
  key: "competencies", label: "My Competencies", icon: "◈",
  items: [
    { key: "competencies", label: "Overview", segment: "my-competencies", status: "live" },
    { key: "competencies-profile", label: "My Competency Profile", segment: "my-competencies/profile", status: "live" },
    { key: "competencies-frameworks", label: "Competency Frameworks", segment: "my-competencies/frameworks", status: "live" },
    { key: "competencies-gaps", label: "My Development Gaps", segment: "my-competencies/gaps", status: "live" },
    { key: "competencies-practice", label: "Practice Assessments", segment: "my-competencies/practice", status: "live" },
    { key: "competencies-assessments", label: "Competen Assessments", segment: "my-competencies/assessments", status: "future" },
    { key: "competencies-verification", label: "Competency Verification", segment: "my-competencies/verification", status: "future" },
    { key: "competencies-evidence", label: "My Evidence", segment: "my-competencies/evidence", status: "live" },
  ],
};

export const SCHOLAR_NAV: { home: NavLeaf; modules: readonly NavModule[]; shared: readonly NavLeaf[] } = {
  home: { key: "home", label: "Home", segment: "", status: "live" },
  modules: [learning, courses, competencies],
  shared: [
    { key: "assistant", label: "Personal AI", segment: "assistant", status: "live" },
    { key: "passport", label: "Competen Passport", segment: "passport", status: "live" },
    { key: "profile", label: "Profile & history", segment: "profile", status: "live" },
    { key: "settings", label: "Settings", segment: "settings", also: ["ai-allowance"], status: "live" },
  ],
};

/** Every leaf, in sidebar order. */
export const ALL_LEAVES: readonly NavLeaf[] = [SCHOLAR_NAV.home, ...SCHOLAR_NAV.modules.flatMap(m => m.items), ...SCHOLAR_NAV.shared];

const under = (path: string, segment: string) => path === segment || path.startsWith(`${segment}/`);
const cleanPath = (path: string) => path.replace(/^\/individual\/scholar\/?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

export type NavActive = { leaf: NavLeaf; module: NavModuleKey | null };

/**
 * The leaf a path below /individual/scholar belongs to, and the module holding it (null for Home and the shared links).
 * The longest matching segment wins, so study/learn is Learn, study/<material id> and study/ready are My Library, and
 * courses/explore is Explore Courses rather than the Overview. Home matches only the empty path. Unknown path: null.
 */
export function activeOf(path: string): NavActive | null {
  const p = cleanPath(path);
  let best: { leaf: NavLeaf; module: NavModuleKey | null; len: number } | null = null;
  const consider = (leaf: NavLeaf, module: NavModuleKey | null) => {
    for (const seg of [leaf.segment, ...(leaf.also ?? [])]) {
      if (seg === "" ? p !== "" : !under(p, seg)) continue;
      if (!best || seg.length > best.len) best = { leaf, module, len: seg.length };
    }
  };
  consider(SCHOLAR_NAV.home, null);
  for (const m of SCHOLAR_NAV.modules) for (const l of m.items) consider(l, m.key);
  for (const l of SCHOLAR_NAV.shared) consider(l, null);
  return best ? { leaf: best.leaf, module: best.module } : null;
}

export const NAV_STORAGE_KEY = "cmp:scholar:nav:v1";
const MODULE_KEYS: readonly string[] = SCHOLAR_NAV.modules.map(m => m.key);

/** The modules the learner left open, from what localStorage held. Anything unreadable is "none open" (never throws). */
export function parseExpanded(raw: string | null | undefined): NavModuleKey[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return MODULE_KEYS.filter(k => v.includes(k)) as NavModuleKey[];
  } catch { return []; }
}

/** The leaves a module shows: the gated ones only while their gate is on. */
export const visibleItems = (m: NavModule, gates: { myPlan: boolean }): NavLeaf[] => m.items.filter(l => !l.gate || gates[l.gate]);
