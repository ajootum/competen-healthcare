// ── THE STAFF GATEWAY DECISION, PURE ── COMP-STAFF-ACCESS-001 s7 step 7 / s11 / s15 ─────────────────
//
// ⚠ PURE ON PURPOSE. This module imports only other pure modules (roles.ts and ogs/lifecycle carry no
// server imports), so scripts/access-doors-harness.ts can hold the decision with fixture identities
// without dragging next/headers into a node process -- the enterprise-constants trap, avoided by
// construction. The server loader that FEEDS it real reads is src/lib/staff/gateway.ts.
//
// ⚠ THE DECISION OFFERS, IT NEVER GRANTS. Every destination this returns is re-authorised by its own
// layout gate on arrival (/super-admin's door, the workspaces' ALLOWED gates, gate 1 in all eleven
// estate layouts). The worst a wrong offer can do is show a door a gate then refuses -- and the
// resolver below is built so it cannot even do that: destinations come from workspaceLinksForUser,
// the SAME resolver the Workspace Launcher and GlobalHeader already use, whose contract is "the
// gate's own condition, no looser and no tighter".
//
// ⚠ GATE 1 OUTRANKS EVERY OFFER. A practice-only identity (platform_membership says no) is refused
// the staff environment BEFORE any workspace list is consulted -- COMP-STAFF-ACCESS-001 s2: customer
// credentials do not grant staff access. Even a contradictory workspace list cannot override it,
// because every one of those workspaces sits behind the estate gate that would refuse them anyway.
// The harness break-tests this ordering.

import type { WorkspaceLink } from "@/lib/roles";
import { appointmentGrantsAccess } from "@/lib/ogs/lifecycle";

/** One live governance appointment, as the selector shows it (a subset of hq's GovernanceContext). */
export type StaffGovernanceContext = {
  appointmentId: string;
  positionCode: string;
  positionName: string;
  productLineCode: string | null;
};

/** Everything the decision needs, gathered by the server loader -- fixture-writable by the harness. */
export type StaffSnapshot = {
  /** super_admin or platform_owner -- the break-glass pair, resolved before any table read. */
  isOwner: boolean;
  /** admitToEstate().admitted -- gate 1. Unreadable admits there, deliberately (its module argues it). */
  platformMember: boolean;
  /**
   * The destinations this identity actually holds, from workspaceLinksForUser: org-role workspaces
   * (WORKSPACE_CATALOGUE via workspacesFor), the HQ door when live capabilities exist, Enterprise
   * when membership is active. NOT respelled here -- the one resolver feeds launcher, header and this.
   */
  workspaces: WorkspaceLink[];
  /** Live HQ governance appointments (listGovernanceContexts) -- shown under the HQ card. */
  governanceContexts: StaffGovernanceContext[];
  /** The status of EVERY ogs_office_appointments row this person has, live or not, any office. */
  appointmentStatuses: (string | null)[];
};

export type StaffGatewayDecision =
  /**
   * ⚠ EXACTLY ONE DESTINATION -- go there, do not ask (COMP-HQ-ACCESS-001 UPDATED s7/s8).
   *
   * This surface used to render a one-card chooser here, deliberately: COMP-STAFF-ACCESS-001 s7
   * step 7 permits "route OR confirm", and confirming let somebody see which door they were walking
   * through. The newer consolidated HQ specification takes that choice away in as many words --
   * "HQ is a secure operating shell, not a mandatory intermediate page", "eliminate Staff Login ->
   * HQ -> Product -> Role -> Mission Control for routine use" -- and makes it acceptance test one:
   * a Product Director with a single assignment arrives directly in their Mission Control. The
   * newest document governs, so the confirm step is superseded rather than merely dropped.
   *
   * ⚠ THE OLD COMMENT'S SECOND REASON WAS CHECKED, NOT WAVED AWAY. It claimed loop-freedom "by
   * construction" because nothing here redirected. The refusal paths were read before this changed:
   * /super-admin refuses to NO_MEMBERSHIP_DESTINATION (/practice/home) and no offerable destination
   * redirects back to the staff door, so a refused direct landing terminates elsewhere. If a future
   * workspace ever bounces back here, THAT is the loop -- and this note is where to look.
   *
   * Governance contexts still ride along: a person holding several appointments inside one HQ door
   * has one DESTINATION, and the context switcher lives on the other side of it. The day My HQ
   * exists, a cross-portfolio identity may land there instead -- that is s12's pattern, not this
   * branch's.
   */
  | { state: "DIRECT"; destination: WorkspaceLink; governanceContexts: StaffGovernanceContext[] }
  /** More than one workspace is genuinely held -- render the selector listing exactly those. */
  | { state: "SELECT"; workspaces: WorkspaceLink[]; governanceContexts: StaffGovernanceContext[] }
  /** Gate 1 says this account belongs to Competen Practice, not the estate. No staff environment. */
  | { state: "PRACTICE_ONLY"; destination: "/practice/home" }
  /** A LIVE appointment exists but opens no workspace (position deactivated, grants withdrawn, or a
   *  tenant office whose workspace is reached another way). Authenticated, not authorised. */
  | { state: "INSUFFICIENT" }
  /** Appointment rows exist and none is active any more -- ended, suspended or revoked. */
  | { state: "ACCESS_WITHDRAWN" }
  /** No appointment has ever been made and no role opens a workspace. The honest ground state. */
  | { state: "NO_APPOINTMENT" };

/**
 * ⚠ NOT respelled from ROLE_CONFIG.super_admin.portal -- this is the HQ DOOR for people who are not
 * super admins, the same label/href pair workspace-links.ts uses (HQ_WORKSPACE). An owner reaches
 * /super-admin through ROLE_CONFIG, so workspaceLinksForUser deliberately omits it for them; the
 * decision below adds it back, because for the staff gateway the owner's HQ standing IS a context.
 */
export const HQ_DOOR: WorkspaceLink = { label: "Competen HQ", icon: "🏛️", href: "/super-admin" };

export function decideStaffGateway(s: StaffSnapshot): StaffGatewayDecision {
  // Gate 1 first -- see the header. Owners are exempt by the same break-glass rule zero every other
  // gate applies (admitToEstate answers super_admin before it reads anything).
  if (!s.isOwner && !s.platformMember) return { state: "PRACTICE_ONLY", destination: "/practice/home" };

  // Deduped by href, order preserved: workspaceLinksForUser already returns each once, but a fixture
  // (or a future caller) must not be able to render the same door twice.
  const seen = new Set<string>();
  const workspaces: WorkspaceLink[] = [];
  const offer = (w: WorkspaceLink) => {
    if (!seen.has(w.href)) { seen.add(w.href); workspaces.push(w); }
  };
  // The owner's HQ standing is a context even though the launcher reaches it via ROLE_CONFIG.
  if (s.isOwner) offer(HQ_DOOR);
  for (const w of s.workspaces) offer(w);

  // ⚠ ONE DESTINATION IS NOT A CHOICE. See the DIRECT branch's note above for the supersession and
  // the loop check that had to be done before this line could exist.
  if (workspaces.length === 1)
    return { state: "DIRECT", destination: workspaces[0], governanceContexts: s.governanceContexts };
  if (workspaces.length > 0)
    return { state: "SELECT", workspaces, governanceContexts: s.governanceContexts };

  // No destinations. Say WHY, truthfully -- the three no-access states are distinct facts.
  if (s.appointmentStatuses.some(appointmentGrantsAccess)) return { state: "INSUFFICIENT" };
  if (s.appointmentStatuses.length > 0) return { state: "ACCESS_WITHDRAWN" };
  return { state: "NO_APPOINTMENT" };
}
