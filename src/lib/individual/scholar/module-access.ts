/* eslint-disable @typescript-eslint/no-explicit-any */
import { cache } from "react";
import { notFound } from "next/navigation";
import { loadIndividualPolicyOnce, type IndividualPolicy, type ModuleAccess } from "../policy";
import { isParticipationCategory, type ParticipationCategory } from "../../hq/account-participation";

// ── PRIVATE MODULE DEVELOPMENT ACCESS ── owner GO "COMPETEN SCHOLAR -- Private Module Development Access", 2 Nov 2026 ──
//
// Courses & Training and My Competencies are built but not released. Each is visible only to the accounts HQ names (Individual
// policy: scholar_module_courses_access, scholar_module_competencies_access), or in Pilot also to a participation category. My
// Learning, Home and the shared links are not governed here.
//
// ⚠ A MODULE GRANT NEVER REPLACES THE SCHOLAR ENTITLEMENT. It is checked in ADDITION to experienceModulePage (release gate, live
// experience, terms), always after it, never instead of it.
// ⚠ FAIL CLOSED. Nothing published, an unreadable policy, an unreadable participation row, any error at all: no module. The answer
// to "not allowed" is the app's ordinary not-found, with no message that says the module exists.
// ⚠ ACCOUNTS ARE IDS. Nothing here names a person; who is listed is HQ's published policy, never source code.

export type ScholarModuleKey = "courses" | "competencies";
export const SCHOLAR_MODULE_KEYS: readonly ScholarModuleKey[] = ["courses", "competencies"];

/** Pure: whether one account may see one module. Public: yes. Private: only a listed account. Pilot: a listed account, or one in a listed category. */
export function moduleAllowed(access: ModuleAccess, userId: string, participation: ParticipationCategory | null): boolean {
  if (access.mode === "public") return true;
  const id = String(userId ?? "").toLowerCase();
  if (id !== "" && access.users.includes(id)) return true;
  return access.mode === "pilot" && participation !== null && access.groups.includes(participation);
}

/** The category the account is labelled with, or null when it has none, it has ended, or the label table is not set up here. A read that failed throws. */
async function participationOf(admin: any, userId: string): Promise<ParticipationCategory | null> {
  const { data, error } = await admin.from("hq_account_participation").select("category, valid_until").eq("user_id", userId).maybeSingle();
  if (error) {
    // Migration 850 not applied: there is no label to match, which is "no category", not a failure.
    if (["42P01", "42703", "PGRST204", "PGRST205"].includes(String(error.code ?? ""))) return null;
    throw new Error("participation unreadable");
  }
  if (!data || !isParticipationCategory(data.category)) return null;
  if (data.valid_until && !(Date.parse(data.valid_until) > Date.now())) return null;
  return data.category;
}

/** The modules this account may see. Reads the published policy, and the participation label only when a Pilot names a category. Any error: none. */
export async function scholarModulesFor(admin: any, userId: string, policy?: Pick<IndividualPolicy, "scholarModuleAccess">): Promise<Set<ScholarModuleKey>> {
  try {
    const access = (policy ?? await loadIndividualPolicyOnce(admin)).scholarModuleAccess;
    const needsLabel = SCHOLAR_MODULE_KEYS.some(k => access[k].mode === "pilot" && access[k].groups.length > 0);
    const label = needsLabel ? await participationOf(admin, userId) : null;
    return new Set(SCHOLAR_MODULE_KEYS.filter(k => moduleAllowed(access[k], userId, label)));
  } catch {
    return new Set();
  }
}

/** The same answer once per server render (the layout, the page and the metadata all ask), keyed by the shell's one admin client. */
export const scholarModulesOnce = cache((admin: any, userId: string) => scholarModulesFor(admin, userId));

/** Called by every page of a private module, first, before any data read. Not allowed: the ordinary not-found. */
export async function requireScholarModule(admin: any, userId: string, key: ScholarModuleKey): Promise<void> {
  if (!(await scholarModulesOnce(admin, userId)).has(key)) notFound();
}
