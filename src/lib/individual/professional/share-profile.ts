/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import { isUuid } from "./validate";
import { ITEM_SECTION, type ItemKind, type ProfileSection } from "./profile-vocabulary";
import { NO_VERIFICATION, groupVerifications, type ItemVerification } from "./profile-verification";

// ── WHAT OF THE PROFILE A PASSPORT LINK CARRIES ── COMPETEN-PROFESSIONAL-PROFILE-01 part B, migration 453 ─────
//
// ⚠ NOTHING BY DEFAULT, AND ONLY WHAT WAS CHOSEN. A link carries the overview only when the person ticked it,
// and only the record VERSIONS they ticked, for that link. If they later change or withdraw a record, the link
// stops showing it -- it never shows words they did not choose. A section the sharing policy no longer allows
// is not shown either.
//
// ⚠ PROVENANCE AND VERIFICATION EXACTLY, NEVER UPGRADED. Each shared record keeps its evidence class (450,
// generated) and its own verification state (451, derived from that version's history). Never shown: the
// registration number, the document, the details text, earlier versions, withdrawn records, the summary.

export type ShareProfileChoice = { overview: boolean; itemIds: string[] };
export const NO_PROFILE: ShareProfileChoice = { overview: false, itemIds: [] };

/** Pure: the choice as the share form sends it -- `profileOverview` and one `item:<id>` key per ticked record. */
export function parseShareProfile(b: Record<string, unknown>): ShareProfileChoice {
  const ticked = (v: unknown) => v === true || v === "true" || v === "on" || v === "1";
  const itemIds = Object.keys(b).filter(k => k.startsWith("item:") && ticked(b[k])).map(k => k.slice(5)).filter(isUuid);
  return { overview: ticked(b.profileOverview), itemIds: [...new Set(itemIds)].slice(0, 200) };
}

/** Before minting: every chosen record is the person's own, current, and in a section the policy lets them share. */
export async function checkShareChoice(admin: any, userId: string, c: ShareProfileChoice, sections: readonly ProfileSection[]): Promise<string | null> {
  if (c.overview && !sections.includes("overview")) return "The overview cannot be shared at the moment.";
  if (!c.itemIds.length) return null;
  const { data, error } = await admin.from("individual_professional_profile_item").select("id, section, superseded_at, withdrawn_at")
    .eq("user_id", userId).in("id", c.itemIds);
  if (error) return "Your records could not be checked just now. Try again shortly.";
  const ok = (data ?? []).filter((i: any) => !i.superseded_at && !i.withdrawn_at && sections.includes(ITEM_SECTION[i.section as ItemKind]));
  return ok.length === c.itemIds.length ? null : "One of the records you chose is not a current record you can share. Refresh and choose again.";
}

export type SharedRecord = {
  section: ItemKind; title: string; typeLabel: string | null; organisation: string | null; jurisdiction: string | null;
  startedOn: string | null; endedOn: string | null; expiresOn: string | null; targetOn: string | null;
  evidenceClass: string; verification: ItemVerification;
};
export type SharedOverview = { profession: string | null; jurisdiction: string | null; status: string | null; title: string | null; specialty: string | null; setting: string | null };
export type SharedProfile = { overview: SharedOverview | null; records: SharedRecord[] };

/** For /verify: what this link carries of the profile. null: unreadable (show nothing). Empty before 453. */
export async function loadSharedProfile(admin: any, shareTokenId: string, userId: string, sections: readonly ProfileSection[], today: string): Promise<SharedProfile | null> {
  try {
    const { data: link, error } = await admin.from("individual_professional_share").select("profile_overview")
      .eq("share_token_id", shareTokenId).eq("user_id", userId).maybeSingle();
    if (error) return isNotProvisioned(error) ? { overview: null, records: [] } : null;
    const { data: chosen, error: chErr } = await admin.from("individual_professional_share_item").select("item_id")
      .eq("share_token_id", shareTokenId).eq("user_id", userId);
    if (chErr) return isNotProvisioned(chErr) ? { overview: null, records: [] } : null;

    let overview: SharedOverview | null = null;
    if (link?.profile_overview && sections.includes("overview")) {
      const { data: p } = await admin.from("individual_professional_profile")
        .select("self_declared_profession, self_declared_practice_jurisdiction, self_declared_professional_status, self_declared_professional_title, self_declared_primary_specialty, self_declared_practice_setting")
        .eq("user_id", userId).maybeSingle();
      if (p) overview = { profession: p.self_declared_profession, jurisdiction: p.self_declared_practice_jurisdiction, status: p.self_declared_professional_status,
        title: p.self_declared_professional_title, specialty: p.self_declared_primary_specialty, setting: p.self_declared_practice_setting };
    }
    const ids = (chosen ?? []).map((r: any) => r.item_id);
    if (!ids.length) return { overview, records: [] };
    const { data: items, error: itErr } = await admin.from("individual_professional_profile_item")
      .select("id, section, title, type_label, organisation, jurisdiction, started_on, ended_on, expires_on, target_on, evidence_class, superseded_at, withdrawn_at, created_at")
      .eq("user_id", userId).in("id", ids).is("superseded_at", null).is("withdrawn_at", null).order("created_at");
    if (itErr) return null;
    const visible = (items ?? []).filter((i: any) => sections.includes(ITEM_SECTION[i.section as ItemKind]));
    const { data: ver } = visible.length ? await admin.from("individual_professional_item_verification")
      .select("id, item_id, event, method, valid_until, reason, created_at").in("item_id", visible.map((i: any) => i.id)).order("created_at") : { data: [] };
    const byItem = groupVerifications(ver ?? [], today);
    return {
      overview,
      records: visible.map((i: any) => ({
        section: i.section, title: i.title, typeLabel: i.type_label, organisation: i.organisation, jurisdiction: i.jurisdiction,
        startedOn: i.started_on, endedOn: i.ended_on, expiresOn: i.expires_on, targetOn: i.target_on, evidenceClass: i.evidence_class,
        // The person's reasons and the verifier's notes stay private: the link says WHAT the state is, not why.
        verification: { ...(byItem[i.id] ?? NO_VERIFICATION), reason: null, history: [] },
      })),
    };
  } catch { return null; }
}
