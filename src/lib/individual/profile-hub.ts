// ── PROFILE & HISTORY: THE PERSONAL AND PROFESSIONAL IDENTITY HUB ── COMPETEN-INDIVIDUAL-IDENTITY-HUB-01 ─────────
//
// One page, shared by Scholar and Professional (owner directive, 26 Oct, "functional redesign"; mock-up: a header
// with photo, name and headline, then a two-column grid of cards, each edited in place):
//   personal    the one Competen identity (profiles, via /api/account/profile) -- private
//   summary     headline and biography (590 individual_identity_profile) and interests (450 records)
//   education   qualifications and education (450) -- HOME: this page (HFE D2)
//   registration  shown from My practice (450 registrations + the primary registration) -- HOME: My practice (D2)
//   work        roles and employment (450)
//   skills      skills (590 skill kind on 450), specialties, and My competencies summarised (520) -- Professional's
//               competency EVIDENCE stays in Credentials & evidence (D2)
//   training    CPD (373, added in place with the CPD form) and Competen Learning completions, read where they live
//   objectives  career objectives and learning goals (450 aspirations)
//   portfolio   the Passport: what is on it, by trust, and where to share it or make a document
//   studies     Scholar's programme, level and institution (387/402)
// One record has one home: a card that shows another home's records reads them, it never copies them.
//
// ⚠ CONFIGURED, NOT HARD-CODED. Which record cards appear follows the published professional_profile_sections.
// ⚠ NOTHING HERE VERIFIES ANYTHING. Entries are self-declared or document-supported, exactly as 450 generates them.
//
// THIS MODULE IMPORTS ONLY TYPES, so the page, the route and the unit tests share it.

import type { ExperienceKey } from "./experiences";
import type { ItemKind, ProfileSection } from "./professional/profile-vocabulary";

/** The experiences a profile record may come from (450 individual_professional_profile_item_experience_check). */
export const HUB_EXPERIENCES = ["scholar", "professional"] as const;
export type HubExperience = (typeof HUB_EXPERIENCES)[number];
export const isHubExperience = (v: unknown): v is HubExperience => (HUB_EXPERIENCES as readonly unknown[]).includes(v);
export function toHubExperience(e: ExperienceKey): HubExperience | null { return isHubExperience(e) ? e : null; }

/** The record kinds each experience may add from the hub. Registrations are added in My practice (D2). */
export const HUB_KINDS: Record<HubExperience, readonly ItemKind[]> = {
  scholar: ["qualification", "employment", "interest", "aspiration", "skill"],
  professional: ["qualification", "employment", "specialty", "interest", "aspiration", "skill"],
};
export const kindAllowed = (experience: HubExperience, kind: unknown): kind is ItemKind => (HUB_KINDS[experience] as readonly unknown[]).includes(kind);

export type HubCard = "personal" | "summary" | "education" | "registration" | "work" | "skills" | "training" | "objectives" | "portfolio" | "studies";

/** The configured section each record card follows. A card with none always shows. */
const CARD_SECTION: Partial<Record<HubCard, ProfileSection>> = {
  education: "qualifications", registration: "registrations", work: "employment", skills: "specialties", objectives: "aspirations",
};

export type CardSpec = { card: HubCard; title: string; note: string; kinds: { kind: ItemKind; heading: string | null; add: string; empty: string }[] };

const COPY: Record<ItemKind, { heading: string; add: string; empty: string }> = {
  qualification: { heading: "Education and qualifications", add: "Add education or a qualification", empty: "Add your degrees, diplomas, courses and certificates. Each one keeps its own dates." },
  registration: { heading: "Registrations and licences", add: "Add a registration or licence", empty: "None recorded." },
  employment: { heading: "Roles", add: "Add a role", empty: "Add the roles you have held, current and past. Ending one never removes it." },
  specialty: { heading: "Specialties and practice areas", add: "Add a specialty", empty: "No specialties recorded." },
  interest: { heading: "Interests", add: "Add an interest", empty: "What you care about and want to grow in." },
  aspiration: { heading: "Objectives and goals", add: "Add an objective or goal", empty: "Where you want to get to, and by when if you know." },
  skill: { heading: "Skills", add: "Add a skill", empty: "Add the skills you bring: clinical, technical, teaching, languages." },
};
const kind = (k: ItemKind, heading: boolean) => ({ kind: k, heading: heading ? COPY[k].heading : null, add: COPY[k].add, empty: COPY[k].empty });

/**
 * Pure: the cards, in the mock-up's order, for the experience the person is in and the experiences they hold. A
 * record card the configuration removes is not shown. Registration and training show only for Professional, and
 * studies only for Scholar.
 */
export function hubCards(configured: readonly ProfileSection[], experience: HubExperience, holds: { scholar: boolean; professional: boolean }): CardSpec[] {
  const pro = holds.professional, allowed = HUB_KINDS[experience];
  const k = (list: ItemKind[], headings = false) => list.filter(x => allowed.includes(x)).map(x => kind(x, headings));
  const cards: CardSpec[] = [
    { card: "personal", title: "Personal details", note: "Private to you. Never on your Passport or a shared link.", kinds: [] },
    { card: "summary", title: "Professional summary", note: "How you describe yourself. You choose, link by link, whether it is shared.", kinds: k(["interest"]) },
    { card: "education", title: "Education", note: "Self-declared. A document makes a record document-supported, never verified.", kinds: k(["qualification"]) },
    ...(pro ? [{ card: "registration" as const, title: "Professional registration", note: "Private by default. Kept and changed in My practice.", kinds: [] }] : []),
    { card: "work", title: "Work experience", note: "Every role keeps its own period.", kinds: k(["employment"]) },
    { card: "skills", title: "Skills & competencies", note: "Skills you declare, and the competencies you are developing.", kinds: k(["skill", "specialty"], experience === "professional") },
    { card: "training", title: "Training & CPD", note: pro ? "Learning and continuing professional development, from where they are kept." : "Courses completed in Competen Learning.", kinds: [] },
    { card: "objectives", title: "Career objectives", note: "Private to you unless you share it.", kinds: k(["aspiration"]) },
    { card: "portfolio", title: "Portfolio & Passport", note: "What is on your Passport, and how each record is labelled.", kinds: [] },
    ...(holds.scholar ? [{ card: "studies" as const, title: "Your studies", note: "Changing it later keeps your earlier study in the context it was done in.", kinds: [] }] : []),
  ];
  return cards.filter(c => !CARD_SECTION[c.card] || configured.includes(CARD_SECTION[c.card]!));
}

export type CompletionInput = { photo: boolean; headline: boolean; biography: boolean; counts: Partial<Record<ItemKind, number>> };
export type Prompt = { key: string; text: string; target: string };

/**
 * Pure: progressive completion. For encouragement only: nothing is required, and nothing is blocked by it. The
 * prompts name the next useful thing, in the order a reader of the profile notices it.
 */
export function completion(cards: readonly CardSpec[], c: CompletionInput): { done: number; total: number; prompts: Prompt[] } {
  const steps: (Prompt & { ok: boolean })[] = [
    { key: "photo", ok: c.photo, text: "Add a photo", target: "profile-header" },
    { key: "headline", ok: c.headline, text: "Write a headline", target: "card-summary" },
    { key: "biography", ok: c.biography, text: "Add a short biography", target: "card-summary" },
    ...cards.filter(x => x.kinds.length && x.card !== "summary").map(x => ({
      key: x.card, ok: x.kinds.some(k => (c.counts[k.kind] ?? 0) > 0), text: x.kinds[0].add, target: `card-${x.card}`,
    })),
  ];
  return { done: steps.filter(s => s.ok).length, total: steps.length, prompts: steps.filter(s => !s.ok).slice(0, 3).map(({ key, text, target }) => ({ key, text, target })) };
}
