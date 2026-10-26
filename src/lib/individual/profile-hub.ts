// ── PROFILE & HISTORY: THE SHARED PERSONAL PROFILE ── COMPETEN-INDIVIDUAL-PROFILE-HFE (owner directive, 26 Oct) ──
//
// One Individual identity (profiles, edited through /api/account/profile) and one set of repeatable profile
// records (migration 450 individual_professional_profile_item, whose experience_code is 'scholar' or
// 'professional'), shown on the one Profile & History page in both experiences. Each experience adds its own
// context: Scholar its studies (387/402), Professional its overview and primary registration (450).
//
// ⚠ CONFIGURED, NOT HARD-CODED. Which sections appear, and their order, follow the published
// professional_profile_sections sequence (WCE). An experience shows only the kinds that mean something in it:
// a Scholar learner has no registrations or specialties to declare, so those stay Professional.
//
// ⚠ NOTHING HERE VERIFIES ANYTHING. Every record is self-declared (or document-supported), exactly as 450
// generates it. A record becomes verified only when the person asks and a Competen verifier checks it (451),
// from the Professional experience.
//
// ⚠ THIS MODULE IMPORTS ONLY TYPES AND THE VOCABULARY, so the page, the route and the unit tests share it.

import type { ExperienceKey } from "./experiences";
import type { ItemKind, ProfileSection } from "./professional/profile-vocabulary";

/** The experiences a profile record may come from (450 individual_professional_profile_item_experience_check). */
export const HUB_EXPERIENCES = ["scholar", "professional"] as const;
export type HubExperience = (typeof HUB_EXPERIENCES)[number];
export const isHubExperience = (v: unknown): v is HubExperience => (HUB_EXPERIENCES as readonly unknown[]).includes(v);

/** The record kinds each experience may add from the hub. */
export const HUB_KINDS: Record<HubExperience, readonly ItemKind[]> = {
  scholar: ["qualification", "employment", "interest", "aspiration"],
  professional: ["qualification", "registration", "employment", "specialty", "interest", "aspiration"],
};
export const kindAllowed = (experience: HubExperience, kind: unknown): kind is ItemKind => (HUB_KINDS[experience] as readonly unknown[]).includes(kind);

/** The sections of the configured sequence, and the kinds each shows. "overview" is the experience's own context. */
const SECTION_KINDS: Record<ProfileSection, readonly ItemKind[]> = {
  overview: [], qualifications: ["qualification"], registrations: ["registration"], employment: ["employment"],
  specialties: ["specialty", "interest"], aspirations: ["aspiration"],
};

export type HubSection = { section: ProfileSection; title: string; note: string; kinds: { kind: ItemKind; heading: string | null; add: string; empty: string }[] };

const TITLE: Record<HubExperience, Record<ProfileSection, string>> = {
  scholar: {
    overview: "Your studies", qualifications: "Education and qualifications", registrations: "Registration and licensing",
    employment: "Work experience", specialties: "Interests", aspirations: "Learning goals",
  },
  professional: {
    overview: "Your practice", qualifications: "Education and qualifications", registrations: "Registration and licensing",
    employment: "Practice and employment history", specialties: "Specialties and interests", aspirations: "Learning goals and career aspirations",
  },
};

const NOTE: Record<ProfileSection, string> = {
  overview: "",
  qualifications: "Add as many as you like, whenever you like. Each says it was recorded by you: a document makes it document-supported, never verified.",
  registrations: "Self-declared. Competen does not check registrations with any regulator.",
  employment: "Every role keeps its own period. Ending one or starting another never removes the earlier record.",
  specialties: "What you care about and want to grow in. Optional.",
  aspirations: "Where you want to get to, and by when if you know. Private to you unless you share it.",
};

const COPY: Record<ItemKind, { heading: string; add: string; empty: string }> = {
  qualification: { heading: "Education and qualifications", add: "Add education or a qualification", empty: "Nothing recorded yet. Add your courses, degrees and certificates when you are ready." },
  registration: { heading: "Other registrations and licences", add: "Add a registration or licence", empty: "None recorded." },
  employment: { heading: "Roles", add: "Add a role", empty: "No roles recorded yet." },
  specialty: { heading: "Specialties and practice areas", add: "Add a specialty", empty: "No specialties recorded." },
  interest: { heading: "Interests", add: "Add an interest", empty: "No interests recorded yet." },
  aspiration: { heading: "Goals", add: "Add a goal", empty: "No goals recorded yet." },
};

/**
 * Pure: the hub's sections, in the configured order, for the experience the person is in. A section with no kind
 * this experience may add is left out, except the overview (the experience's own context), which always shows.
 */
export function hubSections(configured: readonly ProfileSection[], experience: HubExperience): HubSection[] {
  const allowed = HUB_KINDS[experience];
  const order = configured.includes("overview") ? configured : ["overview" as const, ...configured];
  return order.flatMap(section => {
    const kinds = SECTION_KINDS[section].filter(k => allowed.includes(k));
    if (section !== "overview" && kinds.length === 0) return [];
    return [{
      section, title: TITLE[experience][section], note: NOTE[section],
      kinds: kinds.map(k => ({ kind: k, heading: kinds.length > 1 ? COPY[k].heading : null, add: COPY[k].add, empty: COPY[k].empty })),
    }];
  });
}

/** Pure: progressive completion, for encouragement only. Nothing is required, and nothing is blocked by it. */
export function completion(sections: readonly HubSection[], counts: Partial<Record<ItemKind, number>>): { started: number; total: number } {
  const withKinds = sections.filter(s => s.kinds.length);
  return { started: withKinds.filter(s => s.kinds.some(k => (counts[k.kind] ?? 0) > 0)).length, total: withKinds.length };
}

export function toHubExperience(e: ExperienceKey): HubExperience | null { return isHubExperience(e) ? e : null; }
