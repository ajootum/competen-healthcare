// COMPETEN UNIVERSAL SEARCH STANDARD: what each module offers to search. One declaration per module: its record types, the fields
// searched, its filters, where a search on its page goes, and who may see it. A module that is not registered here is not searched,
// and a module whose rule says no sends nothing back at all: no result, no count, no preview, and no mention of it.
//
// ⚠ THIS MODULE IMPORTS NOTHING but types: client and server both read it. Scholar is registered now. Professional and HQ register
// their own lists: HQ stays on its own route and catalogue, because the landlord plane never reads a learner's records (plane-boundary.ts).

import type { ScholarModuleKey } from "../scholar/module-access";

export type SearchProduct = "Scholar";
export type SearchModuleKey = "learn" | "library" | "saved" | "revise" | "apply" | "evaluate" | "plan" | "competencies";

export type SearchAccess = {
  /** My Plan is offered and installed. */
  planOn: boolean;
  /** Saved learning is offered and installed. */
  savedOn: boolean;
  /** The private modules this person may see. */
  modules: ReadonlySet<ScholarModuleKey>;
};

export type SearchModule = {
  key: SearchModuleKey;
  product: SearchProduct;
  /** Where a result belongs, as the sidebar names it. */
  label: string;
  /** The scope line under a box on this page: "Searching …". */
  scope: string;
  recordTypes: readonly { key: string; label: string }[];
  fields: readonly string[];
  filters: readonly string[];
  /** Below /individual/scholar: where a search on this module goes, with `q`. */
  segment: string;
  /** Other parameters that page needs for its search view. */
  params?: Readonly<Record<string, string>>;
  allowed: (a: SearchAccess) => boolean;
};

const always = () => true;

export const SCHOLAR_SEARCH_MODULES: readonly SearchModule[] = [
  { key: "learn", product: "Scholar", label: "Learn", scope: "your notes, topics and learning sessions", segment: "study/learn",
    recordTypes: [{ key: "topic", label: "Topics" }, { key: "section", label: "Sections of your notes" }, { key: "session", label: "Learning sessions" }],
    fields: ["topic names", "the text of your notes", "session titles"], filters: ["kind of result", "file type", "date", "subject"], allowed: always },
  { key: "library", product: "Scholar", label: "My Library", scope: "My Library", segment: "study/library",
    recordTypes: [{ key: "material", label: "Materials" }],
    fields: ["titles", "file names"], filters: ["file type"], allowed: always },
  { key: "saved", product: "Scholar", label: "Saved learning", scope: "your saved learning", segment: "study/saved",
    recordTypes: [{ key: "saved", label: "Saved lessons, notes and cards" }],
    fields: ["saved teaching", "your notes", "flashcards"], filters: ["material", "topic", "date", "status"], allowed: a => a.savedOn },
  { key: "revise", product: "Scholar", label: "Revise", scope: "your Revise topics and materials", segment: "study/revise", params: { view: "topics" },
    recordTypes: [{ key: "topic", label: "Topics to revise" }],
    fields: ["titles", "topics"], filters: ["material", "topic", "competency", "status", "date"], allowed: always },
  { key: "apply", product: "Scholar", label: "Apply", scope: "your cases, OSCE stations and papers", segment: "study/apply", params: { view: "library" },
    recordTypes: [{ key: "practice", label: "Cases, OSCE stations and papers" }],
    fields: ["titles", "clinical concepts", "competencies", "sources", "gaps"], filters: ["format", "status", "date", "gaps"], allowed: always },
  { key: "evaluate", product: "Scholar", label: "Evaluate", scope: "your evaluations", segment: "study/evaluate", params: { view: "history" },
    recordTypes: [{ key: "evaluation", label: "Evaluations" }],
    fields: ["what each evaluation was of"], filters: ["date"], allowed: always },
  { key: "plan", product: "Scholar", label: "My Plan", scope: "My Plan", segment: "study/plan",
    recordTypes: [{ key: "plan", label: "Goals, priorities and calendar entries" }],
    fields: ["your goal", "your priorities", "your exam", "your calendar entries"], filters: [], allowed: a => a.planOn },
  { key: "competencies", product: "Scholar", label: "My Competencies", scope: "your competencies", segment: "my-competencies",
    recordTypes: [{ key: "competency", label: "Competencies" }],
    fields: ["title", "code"], filters: ["status", "Area", "sort"], allowed: a => a.modules.has("competencies") },
];

export const searchModule = (key: SearchModuleKey): SearchModule => SCHOLAR_SEARCH_MODULES.find(m => m.key === key)!;

/** Only what this person may see. */
export const allowedSearchModules = (a: SearchAccess): SearchModule[] => SCHOLAR_SEARCH_MODULES.filter(m => m.allowed(a));

/** The line that says what a box searches. */
export const scopeLine = (key: SearchModuleKey) => `Searching ${searchModule(key).scope}`;

/** Boxes that filter one page's own list and are not a Global Search source: the words under the box. */
export const PAGE_SCOPES = {
  history: "your search history",
  flashcards: "your flashcards",
  osce: "your OSCE stations",
  progress: "your progress history",
} as const;
export const pageScope = (key: keyof typeof PAGE_SCOPES) => `Searching ${PAGE_SCOPES[key]}`;

/** A search on a module's own page, below /individual/scholar. */
export function moduleSearchPath(key: SearchModuleKey, q: string): string {
  const m = searchModule(key);
  return `${m.segment}?${new URLSearchParams({ ...(m.params ?? {}), q }).toString()}`;
}
