import type { SearchModuleKey } from "../search/registry";
import type { ProfessionalSearchKey } from "../search/registry-professional";

// What Global Search sends back, and its limits: read by the route's server code and the browser panel. Imports types only.

export const GLOBAL_SEARCH_MIN = 2;
export const GLOBAL_SEARCH_MAX = 120;

export type GlobalResult = { id: string; title: string; detail: string | null; path: string };
export type GlobalType = { label: string; results: GlobalResult[] };
export type GlobalGroup = { module: SearchModuleKey | ProfessionalSearchKey; product: string; label: string; types: GlobalType[]; unreadable: boolean; morePath: string };
