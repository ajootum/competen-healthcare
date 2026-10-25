import type { ProfessionalProfileView } from "./profile-store";
import { chainsOf } from "./profile-records";
import type { ItemKind } from "./profile-vocabulary";

// ── THE PROFESSIONAL PROFILE AS PERSONAL-AI GROUNDING ── COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1, GO s7 ─────
//
// Plain lines from the person's OWN self-declared profile (migration 450), added to the Professional record
// grounding the Holdings Personal AI already receives (src/lib/individual/personal-ai.ts, scope
// professional_record). Only when the privacy policy professional_profile_ai is on.
//
// ⚠ THE AI MAY ORGANISE WHAT IS HERE, NEVER ADD TO IT. The block opens with the rule, so a summary or a
// development suggestion cannot invent a qualification, licence, employer or credential. Only CURRENT records
// are given (no earlier versions, nothing withdrawn), and never a registration number or a document name.

const KINDS: [ItemKind, string][] = [
  ["qualification", "Qualifications"], ["registration", "Registrations and licences"], ["employment", "Roles and employment"],
  ["specialty", "Further specialties"], ["interest", "Professional interests"], ["aspiration", "Career aspirations"],
];

export function profileContext(view: ProfessionalProfileView): string | null {
  if (!view.provisioned) return null;
  const lines: string[] = [
    "Professional profile (every fact self-declared by the person, none verified). Use ONLY these facts. Never add a qualification, licence, registration, employer, role or credential that is not listed here.",
  ];
  const p = view.pointer;
  if (p === null) lines.push("Profile details: could not be read just now.");
  else if (!p) lines.push("Profile details: not recorded yet.");
  else {
    const facts: [string, string | number | null][] = [
      ["Profession", p.self_declared_profession], ["Practises in", p.self_declared_practice_jurisdiction], ["Status", p.self_declared_professional_status],
      ["Title", p.self_declared_professional_title], ["Primary specialty", p.self_declared_primary_specialty], ["Practice setting", p.self_declared_practice_setting],
      ["Current role", p.self_declared_current_role], ["Years of experience", p.self_declared_years_experience],
    ];
    const given = facts.filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}: ${v}`);
    lines.push(given.length ? `${given.join(". ")}.` : "Profile details: none given yet.");
    if (p.self_declared_summary) lines.push(`Their own summary: ${p.self_declared_summary.slice(0, 1200)}`);
  }
  if (view.items === null) lines.push("Profile records: could not be read just now.");
  else for (const [kind, label] of KINDS) {
    const live = chainsOf(view.items, kind).live.slice(0, 10).map(c => c.current);
    if (!live.length) continue;
    lines.push(`${label}: ${live.map(i => [i.title, i.type_label, i.organisation, i.started_on && `from ${i.started_on}`, i.ended_on && `to ${i.ended_on}`, i.target_on && `by ${i.target_on}`]
      .filter(Boolean).join(", ")).join("; ")}.`);
  }
  return lines.join("\n");
}
