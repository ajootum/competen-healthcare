/* eslint-disable @typescript-eslint/no-explicit-any */
import { allowedProfessionalModules, professionalSearchPath, type ProfessionalSearchAccess, type ProfessionalSearchKey } from "../search/registry-professional";
import { matchesSearch, searchWords } from "../search/match";
import { GLOBAL_SEARCH_MAX, GLOBAL_SEARCH_MIN, type GlobalGroup, type GlobalType } from "../scholar/global-search-types";
import { loadProfessionalRecord } from "./record";
import { loadCompetencyWorkspace } from "./competency-store";
import { loadProfessionalProfile } from "./profile-store";
import { CPD_ACTIVITY_LABEL, GOAL_STATUS_LABEL, NEED_STATUS_LABEL } from "./vocabulary";
import { ITEM_LABEL, ITEM_SECTION, type ItemKind } from "./profile-vocabulary";

// COMPETEN UNIVERSAL SEARCH STANDARD: Global Search across Professional. Each registered module the person may open is searched through
// the reads its own page uses, always for the signed-in professional's own records. No AI. A module the registry refuses is never read,
// so it sends back no result, count or preview.
//
// ⚠ PROFESSIONAL READS NO SCHOLAR RECORD. The reads below are Professional's own record, competency workspace and profile, each by the
// signed-in user's id. Nothing from Scholar (study, materials, evaluations, Scholar policy) is searched here.
//
// A result opens the record itself and never starts anything. Paths are below /individual/professional. A source that fails says so
// and is never shown as zero. Words typed are not kept.

const PER_TYPE = 4;

/** What is typed, tidied, or null where there is too little to search. */
export function parseProfessionalQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim().slice(0, GLOBAL_SEARCH_MAX);
  return q.length >= GLOBAL_SEARCH_MIN && searchWords(q).length > 0 ? q : null;
}

type Ctx = { admin: any; userId: string };
const date = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const brief = (text: string | null | undefined, max = 110) => (text ? text.replace(/\s+/g, " ").trim().slice(0, max) : null) || null;

/** Where a profile record belongs on My practice. */
const SECTION_ANCHOR: Record<string, string> = { qualifications: "sec-qual", registrations: "sec-reg", employment: "sec-emp", specialties: "sec-spec", aspirations: "sec-asp" };
/** The profile records My practice shows itself. Qualifications and skills live in Profile and history, which is not searched here. */
const PRACTICE_KINDS: readonly ItemKind[] = ["registration", "employment", "specialty", "interest", "aspiration"];

type Source = (q: string) => Promise<GlobalType[] | null>;

function sources(ctx: Ctx): Record<ProfessionalSearchKey, Source> {
  const { admin, userId } = ctx;
  // Read at most once, and only when an allowed module asks for it.
  let record: ReturnType<typeof loadProfessionalRecord> | null = null;
  const theRecord = () => (record ??= loadProfessionalRecord(admin, userId));
  return {
    registration: async q => {
      const view = await loadProfessionalProfile(admin, userId);
      if (view.items === null) return null;
      const hits = view.items.filter(i => !i.superseded_at && !i.withdrawn_at && PRACTICE_KINDS.includes(i.section) && matchesSearch([i.title, i.type_label ?? "", i.organisation ?? ""], q));
      return [{ label: "Profile records", results: hits.slice(0, PER_TYPE).map(i => ({
        id: i.id, title: i.title, detail: [ITEM_LABEL[i.section], i.organisation].filter(Boolean).join(", ") || null,
        path: `registration#${SECTION_ANCHOR[ITEM_SECTION[i.section]] ?? "sec-overview"}`,
      })) }];
    },
    development: async q => {
      const r = await theRecord();
      if (r.needs === null && r.goals === null) return null;
      const needs = (r.needs ?? []).filter(n => matchesSearch([n.title, n.detail ?? ""], q));
      const goals = (r.goals ?? []).filter(g => matchesSearch([g.title, g.detail ?? ""], q));
      return [
        { label: "Development needs", results: needs.slice(0, PER_TYPE).map(n => ({ id: n.id, title: n.title, detail: NEED_STATUS_LABEL[n.status] ?? n.status, path: `development?need=${encodeURIComponent(n.id)}#needs-h` })) },
        { label: "Goals", results: goals.slice(0, PER_TYPE).map(g => ({ id: g.id, title: g.title, detail: [GOAL_STATUS_LABEL[g.status] ?? g.status, g.target_date ? `target ${date(g.target_date)}` : null].filter(Boolean).join(", "), path: `development?goal=${encodeURIComponent(g.id)}#plan-h` })) },
      ];
    },
    cpd: async q => {
      const r = await theRecord();
      if (r.cpd === null) return null;
      const label = (code: string) => CPD_ACTIVITY_LABEL[code] ?? code.replace(/_/g, " ");
      const hits = r.cpd.filter(c => matchesSearch([c.title, c.provider ?? "", label(c.activity_type)], q));
      return [{ label: "CPD entries", results: hits.slice(0, PER_TYPE).map(c => ({ id: c.id, title: c.title, detail: [label(c.activity_type), date(c.activity_date)].filter(Boolean).join(", "), path: `cpd?q=${encodeURIComponent(c.title)}#log-h` })) }];
    },
    evidence: async q => {
      const r = await theRecord();
      if (r.evidence === null) return null;
      const hits = r.evidence.filter(e => matchesSearch([e.title, e.issuing_body ?? "", e.detail ?? "", e.document_name ?? ""], q));
      const row = (e: (typeof hits)[number]) => ({ id: e.id, title: e.title, detail: brief(e.issuing_body) ?? brief(e.detail), path: `evidence?q=${encodeURIComponent(e.title)}` });
      return [
        { label: "Credentials", results: hits.filter(e => e.kind === "credential").slice(0, PER_TYPE).map(row) },
        { label: "Competency evidence", results: hits.filter(e => e.kind !== "credential").slice(0, PER_TYPE).map(row) },
      ];
    },
    competencies: async q => {
      const ws = await loadCompetencyWorkspace(admin, userId);
      if (ws.entries === null) return null;
      const hits = ws.entries.filter(e => !e.removed_at && matchesSearch([e.title, e.description ?? "", e.category_label ?? ""], q));
      return [{ label: "Competencies", results: hits.slice(0, PER_TYPE).map(e => ({ id: e.id, title: e.title, detail: e.category_label ?? null, path: `competencies?c=${encodeURIComponent(e.id)}#competency` })) }];
    },
  };
}

/** Every module this person may open, in the registry's order, with what matched. Modules with nothing are left out, except as a way to look there. */
export async function professionalGlobalSearch(ctx: Ctx, access: ProfessionalSearchAccess, q: string): Promise<GlobalGroup[]> {
  const allowed = allowedProfessionalModules(access);
  const from = sources(ctx);
  return Promise.all(allowed.map(async (m): Promise<GlobalGroup> => {
    const base = { module: m.key, product: m.product, label: m.label, morePath: professionalSearchPath(m.key, q) };
    try {
      const types = await from[m.key](q);
      return types ? { ...base, types: types.filter(t => t.results.length > 0), unreadable: false } : { ...base, types: [], unreadable: true };
    } catch {
      return { ...base, types: [], unreadable: true };
    }
  }));
}
